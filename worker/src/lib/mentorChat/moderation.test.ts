import { describe, it, expect, vi, afterEach } from 'vitest';
import { moderateText } from './moderation.js';

const env = { OPENAI_API_KEY: 'test-key' } as any;

afterEach(() => vi.restoreAllMocks());

describe('moderateText', () => {
  it('returns the parsed moderation result on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.9 } }],
      }),
    }) as any;

    const result = await moderateText(env, 'test message');
    expect(result.flagged).toBe(true);
    expect(result.categories['self-harm']).toBe(true);
  });

  it('throws on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    await expect(moderateText(env, 'test')).rejects.toThrow('OpenAI moderation 500');
  });
});
