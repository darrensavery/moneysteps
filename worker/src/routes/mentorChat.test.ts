import { describe, it, expect, vi, afterEach } from 'vitest';
import { handlePostMentorChatMessage } from './mentorChat.js';
import * as moderation from '../lib/mentorChat/moderation.js';
import * as classifier from '../lib/mentorChat/classifier.js';
import * as alerts from '../lib/mentorChat/alerts.js';

function makeEnv(overrides: { childRow?: unknown; rateCount?: number; consentRow?: unknown } = {}) {
  const first = vi.fn((sql: string) => {
    if (sql.includes('FROM users')) {
      return Promise.resolve(overrides.childRow ?? { family_id: 'fam_1', birth_date: '2013-01-01', locale: 'en', display_name: 'Robin' });
    }
    if (sql.includes('mentor_chat_consents')) {
      return Promise.resolve(overrides.consentRow ?? { consented: 1 });
    }
    if (sql.includes('COUNT(*)')) {
      return Promise.resolve({ n: overrides.rateCount ?? 0 });
    }
    return Promise.resolve(null);
  });
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn((sql: string) => ({ bind: () => bind(sql) }));
  // simpler: make prepare capture sql and bind return object using closures keyed by sql
  const realPrepare = vi.fn((sql: string) => ({
    bind: (..._args: unknown[]) => ({
      first: () => first(sql),
      run,
    }),
  }));
  return {
    DB: { prepare: realPrepare },
    OPENAI_API_KEY: 'test-key',
    MENTOR_CHAT_ENABLED: 'true',
  } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('handlePostMentorChatMessage', () => {
  it('returns the assistant reply for an on-topic message', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'on_topic', rawFlags: {} });
    vi.spyOn(classifier, 'classifyAssistantOutput').mockResolvedValue({ onTopic: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Have you thought about splitting it between saving and spending?' } }] }),
    }) as any;

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'should I buy a game or save' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('on_topic');
    expect(body.reply).toContain('splitting');
  });

  it('returns the off-topic redirect and writes no escalation row', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'off_topic', rawFlags: {} });

    const runCalls: string[] = [];
    const env = makeEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args);
          return {
            ...bound,
            run: () => { runCalls.push(sql); return bound.run(); },
          };
        },
      };
    };

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'what console should I buy' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('off_topic');
    expect(body.reply).toContain("outside what I can help with");
    expect(runCalls.some((sql) => sql.includes('mentor_chat_escalations'))).toBe(false);
  });

  it('returns crisis resources and notifies parents on distress branch', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: true, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'distress', rawFlags: {} });
    const notifySpy = vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'nothing matters anymore' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('distress');
    expect(body.reply).toContain('Childline');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('does not notify parents on abuse_pattern branch', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'abuse_pattern', rawFlags: {} });
    const notifySpy = vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'my dad takes my chore money' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('rejects a sub-13 account', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const env = makeEnv({ childRow: { family_id: 'fam_1', birth_date: '2018-01-01', locale: 'en', display_name: 'Robin' } });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(403);
  });

  it('rejects when the hourly rate limit is exceeded', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const env = makeEnv({ rateCount: 20 });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(429);
  });

  it('returns 503 when moderation succeeds but the classifier throws with no moderation flag (fail-closed to a plain service error, not a fabricated crisis branch)', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockRejectedValue(new Error('network error'));

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(503);
  });

  it('returns 200 with the safe off-topic redirect when classifyAssistantOutput throws after a reply was already generated', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'on_topic', rawFlags: {} });
    vi.spyOn(classifier, 'classifyAssistantOutput').mockRejectedValue(new Error('malformed classifier response'));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'some drafted reply that might be off-topic' } }] }),
    }) as any;

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'should I buy a game or save' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain("outside what I can help with");
    expect(body.branch).toBe('on_topic');
  });
});
