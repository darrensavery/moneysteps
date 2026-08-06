import * as Sentry from '@sentry/cloudflare';
import { error, json, parseBody } from '../lib/response.js';
import { isTeenAccount } from '../lib/ageGate.js';
import { moderateText } from '../lib/mentorChat/moderation.js';
import { buildSystemPrompt, getCrisisResources, resolveCrisisRegion } from '../lib/mentorChat/prompts.js';
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

  const family = await env.DB
    .prepare('SELECT has_ai_mentor, has_shield, currency FROM families WHERE id = ?')
    .bind(auth.family_id)
    .first<{ has_ai_mentor: number; has_shield: number; currency: string | null }>();
  if (!family?.has_ai_mentor && !family?.has_shield) {
    return error('AI Mentor required', 403);
  }

  if (auth.role !== 'child') return error('Forbidden', 403);

  const body = await parseBody(request);
  const childId = body?.child_id;
  const message = body?.message;
  if (typeof childId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return error('child_id and message are required', 400);
  }
  if (childId !== auth.sub) return error('Forbidden', 403);

  // childId === auth.sub and auth.role === 'child' are already enforced above, but we
  // still resolve the child through the family_roles join (matching childSettings.ts's
  // Task 1 fix and every other family-membership check in this codebase) rather than
  // a raw users.family_id comparison, so this stays consistent if that convention ever
  // changes and doesn't silently trust a stale/forged family_id claim in the JWT.
  const child = await env.DB
    .prepare(`SELECT u.birth_date, u.locale, u.display_name FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(childId, auth.family_id)
    .first<{ birth_date: string | null; locale: 'en' | 'pl'; display_name: string }>();
  if (!child) return error('Forbidden', 403);
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

  // Write the child's message row BEFORE calling out to moderation/classification, so
  // every attempt — successful or not — advances the rate-limit counter above (which
  // counts existing 'child' rows). Previously the row was only written after both calls
  // succeeded, so a client retrying a failing (503) request never tripped the rate
  // limit even though each attempt still cost a real OpenAI moderation + classification
  // call. moderation_flags starts NULL (already a valid state — assistant rows are
  // always NULL) and is filled in via UPDATE once moderation actually completes.
  const childMessageId = nanoid();
  await env.DB
    .prepare(`INSERT INTO mentor_chat_messages (id, family_id, child_id, role, content, moderation_flags, created_at)
              VALUES (?, ?, ?, 'child', ?, NULL, unixepoch())`)
    .bind(childMessageId, auth.family_id, childId, message)
    .run();

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
    // The child message row above already exists (with moderation_flags left NULL),
    // so this attempt still counts against the rate limit on the next request.
    return error('Mentor is unavailable right now, try again shortly', 503);
  }

  await env.DB
    .prepare(`UPDATE mentor_chat_messages SET moderation_flags = ? WHERE id = ?`)
    .bind(JSON.stringify(moderationResult), childMessageId)
    .run();

  let reply: string;

  // Generated up front (not inserted yet) so the distress/abuse_pattern branch below
  // can link the escalation row to this id via assistant_message_id, even though the
  // assistant message row itself isn't INSERTed until after `reply` is finalized.
  // IDs don't need to be generated in insert order — only the INSERTs themselves do.
  const assistantMessageId = nanoid();

  if (classification.branch === 'off_topic') {
    reply = child.locale === 'pl' ? OFF_TOPIC_REPLY_PL : OFF_TOPIC_REPLY_EN;
  } else if (classification.branch === 'distress' || classification.branch === 'abuse_pattern') {
    const region = resolveCrisisRegion(child.locale, family.currency);
    const resources = getCrisisResources(region, classification.branch);
    reply = `${resources.title}. ${resources.body}`;

    // Resolve the actual send outcome BEFORE writing the escalation row, so
    // `parents_notified` always reflects whether the email really went out — not
    // merely whether the code attempted it. notifyParentsOfDistress sends real email
    // via EmailService and can reject (network failure, provider 5xx, malformed parent
    // email); if it does, the child must still get their crisis-resource reply and a
    // normal 200 — a failed notification must never surface as a 500 to a distressed
    // teen and suppress the resources they were just shown.
    const shouldNotifyParents = classification.branch === 'distress';
    let parentsNotified = false;
    if (shouldNotifyParents) {
      try {
        await notifyParentsOfDistress(env, {
          familyId: auth.family_id,
          childDisplayName: child.display_name,
          locale: child.locale,
        });
        parentsNotified = true;
      } catch (err) {
        // Dedicated fingerprint so a Sentry alert rule can watch this specifically,
        // same pattern as 'webauthn-clone-detected' in routes/webauthn.ts.
        Sentry.captureException(err, {
          level: 'error',
          fingerprint: ['mentor-chat-parent-notify-failed'],
          extra: { family_id: auth.family_id, child_id: childId, escalation_type: classification.branch },
        });
      }
    }

    const escalationId = nanoid();
    await env.DB
      .prepare(`INSERT INTO mentor_chat_escalations (id, message_id, escalation_type, parents_notified, assistant_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, unixepoch())`)
      .bind(escalationId, childMessageId, classification.branch, parentsNotified ? 1 : 0, assistantMessageId)
      .run();
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
    .bind(assistantMessageId, auth.family_id, childId, reply)
    .run();

  return json({ reply, branch: classification.branch });
}

export async function handleGetMentorChatHistory(request: Request, env: Env): Promise<Response> {
  if (env.MENTOR_CHAT_ENABLED !== 'true') return error('Not available', 403);

  const auth = (request as AuthedRequest).auth;

  const family = await env.DB
    .prepare('SELECT has_ai_mentor, has_shield FROM families WHERE id = ?')
    .bind(auth.family_id)
    .first<{ has_ai_mentor: number; has_shield: number }>();
  if (!family?.has_ai_mentor && !family?.has_shield) {
    return error('AI Mentor required', 403);
  }

  const url = new URL(request.url);
  const childId = url.searchParams.get('child_id');
  if (!childId) return error('child_id required', 400);

  // Same family_roles-join convention as the POST handler and childSettings.ts: proves
  // the target is actually a child in this family (not e.g. a co-parent whose
  // users.family_id happens to match), and also gives us birth_date in the same query
  // so a sub-13 account is rejected here too, matching POST's isTeenAccount gate below.
  if (auth.role === 'child') {
    if (childId !== auth.sub) return error('Forbidden', 403);
    const self = await env.DB.prepare('SELECT birth_date FROM users WHERE id = ?')
      .bind(childId).first<{ birth_date: string | null }>();
    if (!isTeenAccount(self?.birth_date ?? null)) return error('Not available for this account', 403);
  } else {
    const child = await env.DB
      .prepare(`SELECT u.birth_date FROM users u
                JOIN family_roles fr ON fr.user_id = u.id
                WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
      .bind(childId, auth.family_id)
      .first<{ birth_date: string | null }>();
    if (!child) return error('Forbidden', 403);
    if (!isTeenAccount(child.birth_date)) return error('Not available for this account', 403);
  }

  // Second LEFT JOIN (aliased `er`) finds, for each row, whether it IS the
  // assistant's crisis-resource reply for some escalation — i.e. some escalation
  // row's assistant_message_id points at this exact message. This is the explicit
  // FK link added in migration 0091, not adjacency/ordering inference (see
  // parent-content-redaction-report.md, option b).
  const rows = await env.DB
    .prepare(`SELECT m.id, m.role, m.content, m.created_at, e.escalation_type,
                     er.id AS crisis_reply_escalation_id
              FROM mentor_chat_messages m
              LEFT JOIN mentor_chat_escalations e ON e.message_id = m.id
              LEFT JOIN mentor_chat_escalations er ON er.assistant_message_id = m.id
              WHERE m.child_id = ?
              ORDER BY m.created_at ASC`)
    .bind(childId)
    .all<{ id: string; role: string; content: string; created_at: number; escalation_type: string | null; crisis_reply_escalation_id: string | null }>();

  // Parents deliberately aren't told the specific escalation type: on the
  // abuse_pattern branch they're not notified in real time (a parent may be the
  // source of risk), so labelling a message 'abuse_pattern' in a transcript any
  // parent can later browse would create a written accusation of suspected
  // parental abuse, readable by the parent themselves. Parents see only a generic
  // 'flagged' indicator. The teen reading their own history still sees the real
  // value — this restriction is about what a parent sees, not the child.
  //
  // The crisis-reply text itself is also branch-revealing (e.g. "we've also let
  // your parent(s) know" only appears on the distress branch, "without anyone else
  // finding out" only on abuse_pattern), so for a parent it's replaced with a
  // generic, branch-agnostic string. The child's own triggering message is left
  // untouched — their own words are real information, out of scope here. Ordinary
  // (non-crisis) assistant replies are untouched for everyone.
  const GENERIC_CRISIS_REPLY = 'Support resources were shared with your child.';
  const messages = rows.results.map((row) => {
    const { crisis_reply_escalation_id, ...rest } = row;
    if (auth.role !== 'parent') return rest;
    return {
      ...rest,
      escalation_type: rest.escalation_type ? 'flagged' : null,
      content: crisis_reply_escalation_id ? GENERIC_CRISIS_REPLY : rest.content,
    };
  });

  return json({ messages });
}
