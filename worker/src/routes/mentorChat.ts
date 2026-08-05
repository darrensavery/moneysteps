import { error, json, parseBody } from '../lib/response.js';
import { isTeenAccount } from '../lib/ageGate.js';
import { moderateText } from '../lib/mentorChat/moderation.js';
import { buildSystemPrompt, getCrisisResources } from '../lib/mentorChat/prompts.js';
import { classifyChildMessage, classifyAssistantOutput } from '../lib/mentorChat/classifier.js';
import { notifyParentsOfDistress } from '../lib/mentorChat/alerts.js';
import { nanoid } from '../lib/nanoid.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

const HOURLY_LIMIT = 20;
const DAILY_LIMIT = 60;

const OFF_TOPIC_REPLY_EN = "That's outside what I can help with — want to talk to a parent about it instead? I'm here for money, chores, and saving questions any time.";
const OFF_TOPIC_REPLY_PL = 'To wykracza poza to, w czym mogę pomóc — może porozmawiasz o tym z rodzicem? Jestem tu, żeby pomóc z pieniędzmi, obowiązkami i oszczędzaniem.';

export async function handlePostMentorChatMessage(request: Request, env: Env): Promise<Response> {
  if (env.MENTOR_CHAT_ENABLED !== 'true') return error('Not available', 403);

  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Forbidden', 403);

  const body = await parseBody(request);
  const childId = body?.child_id;
  const message = body?.message;
  if (typeof childId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return error('child_id and message are required', 400);
  }
  if (childId !== auth.sub) return error('Forbidden', 403);

  const child = await env.DB
    .prepare('SELECT family_id, birth_date, locale, display_name FROM users WHERE id = ?')
    .bind(childId)
    .first<{ family_id: string; birth_date: string | null; locale: 'en' | 'pl'; display_name: string }>();
  if (!child || child.family_id !== auth.family_id) return error('Forbidden', 403);
  if (!isTeenAccount(child.birth_date)) return error('Not available for this account', 403);

  const consent = await env.DB
    .prepare('SELECT consented FROM mentor_chat_consents WHERE user_id = ? ORDER BY consented_at DESC LIMIT 1')
    .bind(childId)
    .first<{ consented: number }>();
  if (!consent || consent.consented !== 1) return error('Consent required', 403);

  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  const hourlyCount = await env.DB
    .prepare(`SELECT COUNT(*) as n FROM mentor_chat_messages WHERE child_id = ? AND role = 'child' AND created_at > ?`)
    .bind(childId, oneHourAgo)
    .first<{ n: number }>();
  if ((hourlyCount?.n ?? 0) >= HOURLY_LIMIT) return error('Rate limit exceeded', 429);
  const dailyCount = await env.DB
    .prepare(`SELECT COUNT(*) as n FROM mentor_chat_messages WHERE child_id = ? AND role = 'child' AND created_at > ?`)
    .bind(childId, oneDayAgo)
    .first<{ n: number }>();
  if ((dailyCount?.n ?? 0) >= DAILY_LIMIT) return error('Rate limit exceeded', 429);

  let moderationResult;
  let classification;
  try {
    moderationResult = await moderateText(env, message);
    classification = await classifyChildMessage(env, { text: message, moderation: moderationResult });
  } catch {
    // Covers both: the moderation pre-check itself failing (no signal at all to act
    // on), and classifyChildMessage's own fail-closed path re-throwing when moderation
    // found nothing (see classifier.ts) — in both cases this was an infra failure on
    // an otherwise-ordinary message, not a crisis, so surface a plain service error.
    return error('Mentor is unavailable right now, try again shortly', 503);
  }

  const childMessageId = nanoid();
  await env.DB
    .prepare(`INSERT INTO mentor_chat_messages (id, family_id, child_id, role, content, moderation_flags, created_at)
              VALUES (?, ?, ?, 'child', ?, ?, unixepoch())`)
    .bind(childMessageId, child.family_id, childId, message, JSON.stringify(moderationResult))
    .run();

  let reply: string;

  if (classification.branch === 'off_topic') {
    reply = child.locale === 'pl' ? OFF_TOPIC_REPLY_PL : OFF_TOPIC_REPLY_EN;
  } else if (classification.branch === 'distress' || classification.branch === 'abuse_pattern') {
    const resources = getCrisisResources(child.locale, classification.branch);
    reply = `${resources.title}. ${resources.body}`;

    const escalationId = nanoid();
    const parentsNotified = classification.branch === 'distress';
    await env.DB
      .prepare(`INSERT INTO mentor_chat_escalations (id, message_id, escalation_type, parents_notified, created_at)
                VALUES (?, ?, ?, ?, unixepoch())`)
      .bind(escalationId, childMessageId, classification.branch, parentsNotified ? 1 : 0)
      .run();

    if (parentsNotified) {
      await notifyParentsOfDistress(env, {
        familyId: child.family_id,
        childDisplayName: child.display_name,
        locale: child.locale,
      });
    }
  } else {
    const systemPrompt = buildSystemPrompt(child.locale);
    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!chatRes.ok) return error('Mentor is unavailable right now, try again shortly', 503);
    const chatData = await chatRes.json() as { choices: Array<{ message: { content: string } }> };
    const draftReply = chatData.choices[0]?.message?.content ?? '';

    // classifyAssistantOutput throws on a malformed/unparseable classifier response
    // (deliberately — see classifier.ts) rather than silently defaulting to on_topic.
    // A reply has already been generated at this point, so a thrown output-check is
    // NOT treated the same as the pre-reply moderation/classification failure above
    // (which surfaces a 503 because there is nothing safe to show yet). Here we already
    // have *something*, we just can't confirm it's safe to show verbatim — so fail
    // closed the same way a genuinely off-topic reply would: swap in the redirect text
    // and still return 200.
    let onTopic: boolean;
    try {
      const outputCheck = await classifyAssistantOutput(env, { text: draftReply });
      onTopic = outputCheck.onTopic;
    } catch {
      onTopic = false;
    }
    reply = onTopic
      ? draftReply
      : (child.locale === 'pl' ? OFF_TOPIC_REPLY_PL : OFF_TOPIC_REPLY_EN);
  }

  await env.DB
    .prepare(`INSERT INTO mentor_chat_messages (id, family_id, child_id, role, content, moderation_flags, created_at)
              VALUES (?, ?, ?, 'assistant', ?, NULL, unixepoch())`)
    .bind(nanoid(), child.family_id, childId, reply)
    .run();

  return json({ reply, branch: classification.branch });
}
