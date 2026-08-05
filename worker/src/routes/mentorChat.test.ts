import { describe, it, expect, vi, afterEach } from 'vitest';
import { handlePostMentorChatMessage, handleGetMentorChatHistory } from './mentorChat.js';
import * as moderation from '../lib/mentorChat/moderation.js';
import * as classifier from '../lib/mentorChat/classifier.js';
import * as alerts from '../lib/mentorChat/alerts.js';

function makeEnv(overrides: { childRow?: unknown; rateCount?: number; consentRow?: unknown; familyRow?: unknown } = {}) {
  const first = vi.fn((sql: string) => {
    if (sql.includes('has_ai_mentor')) {
      return Promise.resolve(overrides.familyRow ?? { has_ai_mentor: 1, has_shield: 0 });
    }
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

  it('rejects a family without AI Mentor tier', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const first = vi.fn((sql: string) => {
      if (sql.includes('has_ai_mentor')) return Promise.resolve({ has_ai_mentor: 0, has_shield: 0 });
      // Satisfy the FROM users lookup too, so a missing tier check doesn't
      // coincidentally 403 via the "child not found" path instead.
      if (sql.includes('FROM users')) {
        return Promise.resolve({ family_id: 'fam_1', birth_date: '2013-01-01', locale: 'en', display_name: 'Robin' });
      }
      if (sql.includes('mentor_chat_consents')) return Promise.resolve({ consented: 1 });
      if (sql.includes('COUNT(*)')) return Promise.resolve({ n: 0 });
      return Promise.resolve(null);
    });
    const prepare = vi.fn((sql: string) => ({
      bind: (..._args: unknown[]) => ({ first: () => first(sql) }),
    }));
    const env = { DB: { prepare }, MENTOR_CHAT_ENABLED: 'true' } as any;

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(403);
  });
});

describe('handleGetMentorChatHistory', () => {
  function makeHistoryEnv(rows: unknown[], overrides: { childFamilyId?: string; mentorChatEnabled?: string } = {}) {
    const all = vi.fn().mockResolvedValue({ results: rows });
    const first = vi.fn().mockResolvedValue({ family_id: overrides.childFamilyId ?? 'fam_1' });
    const bind = vi.fn().mockReturnValue({ all, first });
    const prepare = vi.fn().mockReturnValue({ bind });
    return { DB: { prepare }, MENTOR_CHAT_ENABLED: overrides.mentorChatEnabled ?? 'true' } as any;
  }

  it('lets a child read their own history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([
      { id: 'm1', role: 'child', content: 'hi', created_at: 1000, escalation_type: null },
    ]));
    expect(res.status).toBe(200);
  });

  it('blocks a child reading another child\'s history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_2');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([]));
    expect(res.status).toBe(403);
  });

  it('lets a parent read a child in their family', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([]));
    expect(res.status).toBe(200);
  });

  it('blocks a parent from a different family reading this family\'s chat', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_2', family_id: 'fam_2', role: 'parent' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { childFamilyId: 'fam_1' }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when MENTOR_CHAT_ENABLED is not set, even for an otherwise-authorized request', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { mentorChatEnabled: 'false' }));
    expect(res.status).toBe(403);
  });
});
