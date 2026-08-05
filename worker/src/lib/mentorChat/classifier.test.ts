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
});
