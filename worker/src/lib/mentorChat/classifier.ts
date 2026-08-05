import type { Env } from '../../types.js';
import type { ModerationResult } from './moderation.js';

export type ChatBranch = 'on_topic' | 'off_topic' | 'distress' | 'abuse_pattern';

interface RawClassification {
  off_topic: boolean;
  distress_signal: boolean;
  abuse_signal: boolean;
}

async function callClassifier(env: Env, systemPrompt: string, userText: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OpenAI classifier ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return JSON.parse(data.choices[0]?.message?.content ?? '{}');
}

// A non-throwing but malformed/empty classifier response (e.g. OpenAI returns 200 OK
// with an empty `choices` array under finish_reason "content_filter"/"length") must
// never be allowed to silently resolve to on_topic / onTopic:true. This guard forces
// any response that isn't a genuinely well-typed classification to be treated as a
// failure and routed through the SAME fail-closed logic as a thrown network/API error.
function isValidRawClassification(x: unknown): x is RawClassification {
  return !!x && typeof x === 'object' &&
    typeof (x as Record<string, unknown>).off_topic === 'boolean' &&
    typeof (x as Record<string, unknown>).distress_signal === 'boolean' &&
    typeof (x as Record<string, unknown>).abuse_signal === 'boolean';
}

export async function classifyChildMessage(
  env: Env,
  opts: { text: string; moderation: ModerationResult },
): Promise<{ branch: ChatBranch; rawFlags: Record<string, unknown> }> {
  const systemPrompt = `Classify the following message from a teenager in a financial-literacy chat app. Respond as JSON: {"off_topic": boolean, "distress_signal": boolean, "abuse_signal": boolean}. "distress_signal" = self-harm, suicidal ideation, or severe emotional distress. "abuse_signal" = any suggestion a parent/guardian is hurting, threatening, or mistreating them, including financially. "off_topic" = the message is not about money, chores, or financial literacy AND has no distress or abuse signal. If uncertain between distress and abuse, set BOTH to true.`;

  let raw: RawClassification;
  try {
    const parsed = await callClassifier(env, systemPrompt, opts.text);
    if (!isValidRawClassification(parsed)) {
      throw new Error('Malformed classifier response shape');
    }
    raw = parsed;
  } catch (err) {
    // Fail-closed: a thrown classifier call (network/API failure) OR a non-throwing but
    // malformed/empty response must never silently resolve to on_topic. If OpenAI's own
    // moderation pre-check already flagged something, treat that as a real signal —
    // crisis resources are always safe to show, and routing to distress is the
    // least-bad guess when we have no way to tell distress apart from abuse (the
    // moderation API has no caregiver-abuse category to lean on here). If moderation
    // found nothing either, this was very likely an infra blip on an ordinary message —
    // surface it as a normal service error instead of fabricating a crisis branch.
    if (opts.moderation.flagged) {
      return { branch: 'distress', rawFlags: { classifierFailed: true } };
    }
    throw err;
  }

  const distressSignal = raw.distress_signal === true
    || opts.moderation.categories['self-harm'] === true
    || opts.moderation.categories['self-harm/intent'] === true
    || opts.moderation.categories['self-harm/instructions'] === true;
  const abuseSignal = raw.abuse_signal === true;

  // Fail-safe override: any abuse signal — alone or alongside distress — routes to
  // abuse_pattern, never distress. Wrongly alerting a potentially abusive parent is a
  // worse failure than wrongly withholding a distress alert (teen still gets in-chat
  // crisis resources on the abuse_pattern branch either way).
  let branch: ChatBranch;
  if (abuseSignal) {
    branch = 'abuse_pattern';
  } else if (distressSignal) {
    branch = 'distress';
  } else if (raw.off_topic === true) {
    branch = 'off_topic';
  } else {
    branch = 'on_topic';
  }

  return { branch, rawFlags: raw as Record<string, unknown> };
}

export async function classifyAssistantOutput(
  env: Env,
  opts: { text: string },
): Promise<{ onTopic: boolean }> {
  const systemPrompt = `Classify whether the following chatbot reply stays strictly within money, chores, and financial literacy topics for a teenager. Respond as JSON: {"on_topic": boolean}.`;
  const raw = await callClassifier(env, systemPrompt, opts.text);
  if (typeof (raw as Record<string, unknown>).on_topic !== 'boolean') {
    // Malformed/empty responses must throw rather than default to on_topic:true — that
    // default would silently defeat the output-side jailbreak-containment check. This
    // function intentionally does NOT fail-closed internally: whether to treat a thrown
    // classifyAssistantOutput as onTopic:false (and swap in the safe redirect string) is
    // a route-handler decision, not this classifier's — see Task 7.
    throw new Error('Malformed classifier response shape');
  }
  return { onTopic: (raw as { on_topic: boolean }).on_topic };
}
