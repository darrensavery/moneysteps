import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyChildMessage, classifyAssistantOutput } from './classifier.js';

const env = { OPENAI_API_KEY: 'test-key' } as any;

afterEach(() => vi.restoreAllMocks());

function mockClassifyResponse(json: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }),
  }) as any;
}

describe('classifyChildMessage', () => {
  it('returns off_topic for an on-topic-flagged-false, no distress/abuse signal', async () => {
    mockClassifyResponse({ off_topic: true, distress_signal: false, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'what console should I buy',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('off_topic');
  });

  it('returns distress when only distress_signal is true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: true, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'I don\'t see the point in saving, nothing matters anymore',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.8 } },
    });
    expect(result.branch).toBe('distress');
  });

  it('returns abuse_pattern when only abuse_signal is true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: true });
    const result = await classifyChildMessage(env, {
      text: 'my dad takes all my chore money and won\'t give it back',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('abuse_pattern');
  });

  it('fail-safe: returns abuse_pattern when BOTH distress and abuse signals are true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: true, abuse_signal: true });
    const result = await classifyChildMessage(env, {
      text: 'I want to run away or worse, my dad won\'t stop screaming at me',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.6 } },
    });
    expect(result.branch).toBe('abuse_pattern');
  });

  it('returns on_topic when nothing is flagged', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'should I save for a bike or spend on games',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('on_topic');
  });
});

describe('classifyChildMessage fail-closed behavior', () => {
  it('fails closed to distress when moderation flagged something but the classifier call itself throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await classifyChildMessage(env, {
      text: 'something is really wrong',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.7 } },
    });
    expect(result.branch).toBe('distress');
  });

  it('rethrows when the classifier call fails and moderation found nothing (ordinary service error, not a fabricated crisis branch)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(classifyChildMessage(env, {
      text: 'should I buy a game or save',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    })).rejects.toThrow('network error');
  });
});

describe('classifyAssistantOutput', () => {
  it('flags output that drifted off-topic', async () => {
    mockClassifyResponse({ on_topic: false });
    const result = await classifyAssistantOutput(env, { text: 'Let\'s talk about your favorite movie instead' });
    expect(result.onTopic).toBe(false);
  });

  it('throws on a malformed response missing on_topic', async () => {
    mockClassifyResponse({});
    await expect(classifyAssistantOutput(env, { text: 'some reply' }))
      .rejects.toThrow('Malformed classifier response shape');
  });

  it('throws on a malformed response with a non-boolean on_topic', async () => {
    mockClassifyResponse({ on_topic: 'true' });
    await expect(classifyAssistantOutput(env, { text: 'some reply' }))
      .rejects.toThrow('Malformed classifier response shape');
  });
});

describe('classifyChildMessage malformed-response handling', () => {
  it('fails closed to distress when the classifier returns an empty object and moderation flagged something', async () => {
    mockClassifyResponse({});
    const result = await classifyChildMessage(env, {
      text: 'something is really wrong',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.7 } },
    });
    expect(result.branch).toBe('distress');
    expect(result.rawFlags).toEqual({ classifierFailed: true });
  });

  it('rethrows when the classifier returns an empty object and moderation found nothing', async () => {
    mockClassifyResponse({});
    await expect(classifyChildMessage(env, {
      text: 'should I buy a game or save',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    })).rejects.toThrow('Malformed classifier response shape');
  });

  it('does not treat a non-boolean abuse_signal (e.g. the string "true") as abuse_signal: true — fails closed instead of silently coercing', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: 'true' });
    // The malformed shape (abuse_signal is a string, not boolean) fails shape validation
    // and is routed through the fail-closed catch, same as any other malformed response —
    // it must NOT be silently coerced to abuse_signal: true nor fall through to on_topic.
    await expect(classifyChildMessage(env, {
      text: 'my dad takes all my chore money',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    })).rejects.toThrow('Malformed classifier response shape');
  });

  it('fails closed to distress (not silently coerced abuse) when abuse_signal is non-boolean but moderation flagged something', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: 'true' });
    const result = await classifyChildMessage(env, {
      text: 'my dad takes all my chore money',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.5 } },
    });
    expect(result.branch).toBe('distress');
  });
});

describe('classifyChildMessage self-harm subcategory backstop', () => {
  it('routes to distress when moderation flags self-harm/intent even if the classifier says no distress', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'I have been thinking about hurting myself',
      moderation: {
        flagged: true,
        categories: { 'self-harm': false, 'self-harm/intent': true },
        category_scores: { 'self-harm/intent': 0.75 },
      },
    });
    expect(result.branch).toBe('distress');
  });
});
