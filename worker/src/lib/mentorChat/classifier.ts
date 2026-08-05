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

export async function classifyChildMessage(
  env: Env,
  opts: { text: string; moderation: ModerationResult },
): Promise<{ branch: ChatBranch; rawFlags: Record<string, unknown> }> {
  const systemPrompt = `Classify the following message from a teenager in a financial-literacy chat app. Respond as JSON: {"off_topic": boolean, "distress_signal": boolean, "abuse_signal": boolean}. "distress_signal" = self-harm, suicidal ideation, or severe emotional distress. "abuse_signal" = any suggestion a parent/guardian is hurting, threatening, or mistreating them, including financially. "off_topic" = the message is not about money, chores, or financial literacy AND has no distress or abuse signal. If uncertain between distress and abuse, set BOTH to true.`;

  let raw: Partial<RawClassification>;
  try {
    raw = await callClassifier(env, systemPrompt, opts.text) as Partial<RawClassification>;
  } catch (err) {
    // Fail-closed: a thrown classifier call must never silently resolve to on_topic.
    // If OpenAI's own moderation pre-check already flagged something, treat that as a
    // real signal — crisis resources are always safe to show, and routing to distress
    // is the least-bad guess when we have no way to tell distress apart from abuse
    // (the moderation API has no caregiver-abuse category to lean on here). If
    // moderation found nothing either, this was very likely an infra blip on an
    // ordinary message — surface it as a normal service error instead of fabricating
    // a crisis branch for a plain network failure.
    if (opts.moderation.flagged) {
      return { branch: 'distress', rawFlags: { classifierFailed: true } };
    }
    throw err;
  }

  const distressSignal = raw.distress_signal === true || opts.moderation.categories['self-harm'] === true;
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
  const raw = await callClassifier(env, systemPrompt, opts.text) as { on_topic?: boolean };
  return { onTopic: raw.on_topic !== false };
}
