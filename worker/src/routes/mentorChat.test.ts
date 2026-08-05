import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { handlePostMentorChatMessage, handleGetMentorChatHistory } from './mentorChat.js';
import * as moderation from '../lib/mentorChat/moderation.js';
import * as classifier from '../lib/mentorChat/classifier.js';
import * as alerts from '../lib/mentorChat/alerts.js';
import * as Sentry from '@sentry/cloudflare';

/**
 * `members` mirrors the real family_roles-backed users table (same technique as
 * childSettings.test.ts): the family_roles-joined child-resolution query only
 * resolves when the bound (childId, familyId) pair matches a family member whose
 * role is 'child'. This lets tests distinguish "target is a child in this family"
 * from "target is a parent/co-parent" or "target is in a different family" — a
 * plain object mock can't, since it ignores the SQL/params.
 */
function makeEnv(overrides: {
  childRow?: unknown;
  rateCount?: number;
  consentRow?: unknown;
  familyRow?: unknown;
  members?: Array<{ id: string; family_id: string; role: 'child' | 'parent' }>;
} = {}) {
  const first = vi.fn((sql: string, args: unknown[]) => {
    if (sql.includes('has_ai_mentor')) {
      return Promise.resolve(overrides.familyRow ?? { has_ai_mentor: 1, has_shield: 0, currency: 'GBP' });
    }
    if (sql.includes('FROM users')) {
      if (overrides.members) {
        const [childId, familyId] = args as [string, string];
        const match = overrides.members.find(
          (m) => m.id === childId && m.family_id === familyId && m.role === 'child',
        );
        return Promise.resolve(match ? { birth_date: '2013-01-01', locale: 'en', display_name: 'Robin' } : null);
      }
      return Promise.resolve(overrides.childRow ?? { birth_date: '2013-01-01', locale: 'en', display_name: 'Robin' });
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
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: () => first(sql, args),
      run,
    }),
  }));
  return {
    DB: { prepare },
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

  it('returns US crisis resources for a USD-currency family on the distress branch', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: true, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'distress', rawFlags: {} });
    vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'nothing matters anymore' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const env = makeEnv({ familyRow: { has_ai_mentor: 1, has_shield: 0, currency: 'USD' } });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('distress');
    expect(body.reply).toContain('988');
  });

  it('still returns 200 with crisis resources when the parent-notification email fails, and records parents_notified=0', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: true, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'distress', rawFlags: {} });
    vi.spyOn(alerts, 'notifyParentsOfDistress').mockRejectedValue(new Error('email provider 500'));
    const captureSpy = vi.spyOn(Sentry, 'captureException').mockReturnValue('evt_1' as any);

    const escalationBinds: unknown[][] = [];
    const env = makeEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...args: unknown[]) => {
          if (sql.includes('mentor_chat_escalations')) escalationBinds.push(args);
          return stmt.bind(...args);
        },
      };
    };

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'nothing matters anymore' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('distress');
    expect(body.reply).toContain('Childline');
    expect(captureSpy).toHaveBeenCalledOnce();
    // mentor_chat_escalations columns are (id, message_id, escalation_type, parents_notified, created_at
    // via unixepoch()) — parents_notified is bound arg index 3, and must be 0 since the send failed.
    expect(escalationBinds).toHaveLength(1);
    expect(escalationBinds[0][3]).toBe(0);
  });

  it("links the escalation row to the assistant's crisis-reply message id via assistant_message_id, matching the id actually used for the assistant's INSERT", async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: true, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'distress', rawFlags: {} });
    vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const escalationBinds: unknown[][] = [];
    const assistantMessageInserts: unknown[][] = [];
    const env = makeEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...args: unknown[]) => {
          if (sql.includes('mentor_chat_escalations')) escalationBinds.push(args);
          if (sql.includes('INSERT INTO mentor_chat_messages') && sql.includes("'assistant'")) {
            assistantMessageInserts.push(args);
          }
          return stmt.bind(...args);
        },
      };
    };

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'nothing matters anymore' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(200);
    expect(escalationBinds).toHaveLength(1);
    expect(assistantMessageInserts).toHaveLength(1);
    // mentor_chat_escalations columns are (id, message_id, escalation_type, parents_notified,
    // assistant_message_id, created_at via unixepoch()) — assistant_message_id is bind arg
    // index 4. It must equal the id actually used to insert the assistant's reply row
    // (bind arg index 0 of that INSERT), not a fresh/unlinked id.
    expect(escalationBinds[0][4]).toBe(assistantMessageInserts[0][0]);
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
    const env = makeEnv({ childRow: { birth_date: '2018-01-01', locale: 'en', display_name: 'Robin' } });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(403);
  });

  it('rejects when the family_roles join finds no matching child row (e.g. family_id mismatch), via the family_roles-join predicate shared with childSettings.ts', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    // The JWT claims fam_1, but the family_roles table (the actual source of truth for
    // family membership) has this user attached to fam_2 — the family_roles join must
    // catch this even though the JWT's own family_id field looks fine.
    const env = makeEnv({ members: [{ id: 'child_1', family_id: 'fam_2', role: 'child' }] });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(403);
  });

  it('still inserts the child message row (advancing the rate-limit counter) when moderation/classification fails', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockRejectedValue(new Error('network error'));

    const insertedChildRows: unknown[][] = [];
    const env = makeEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args);
          return {
            ...bound,
            run: () => {
              if (sql.includes('INSERT INTO mentor_chat_messages') && sql.includes("'child'")) {
                insertedChildRows.push(args);
              }
              return bound.run();
            },
          };
        },
      };
    };

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(503);
    // The child message row must exist BEFORE moderation/classification is attempted, so a
    // retried request after this 503 sees one more row counted against the rate limit —
    // otherwise a client could retry indefinitely against OpenAI moderation/classification
    // for free.
    expect(insertedChildRows).toHaveLength(1);
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
  function makeHistoryEnv(rows: unknown[], overrides: {
    childFamilyId?: string;
    mentorChatEnabled?: string;
    familyRow?: unknown;
    members?: Array<{ id: string; family_id: string; role: 'child' | 'parent' }>;
    birthDate?: string | null;
  } = {}) {
    const all = vi.fn().mockResolvedValue({ results: rows });
    const first = vi.fn((sql: string, args: unknown[]) => {
      if (sql.includes('has_ai_mentor')) {
        return Promise.resolve(overrides.familyRow ?? { has_ai_mentor: 1, has_shield: 0 });
      }
      if (sql.includes('family_roles')) {
        // Parent branch: family_roles-joined child lookup, keyed by (childId, familyId).
        if (overrides.members) {
          const [childId, familyId] = args as [string, string];
          const match = overrides.members.find(
            (m) => m.id === childId && m.family_id === familyId && m.role === 'child',
          );
          return Promise.resolve(match ? { birth_date: overrides.birthDate ?? '2013-01-01' } : null);
        }
        const [, familyId] = args as [string, string];
        const targetFamilyId = overrides.childFamilyId ?? 'fam_1';
        return Promise.resolve(familyId === targetFamilyId ? { birth_date: overrides.birthDate ?? '2013-01-01' } : null);
      }
      if (sql.includes('FROM users')) {
        // Child-self branch: plain birth_date lookup (JWT already proves role+identity).
        return Promise.resolve({ birth_date: overrides.birthDate ?? '2013-01-01' });
      }
      return Promise.resolve(null);
    });
    const prepare = vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: () => first(sql, args),
        all,
      }),
    }));
    return { DB: { prepare }, MENTOR_CHAT_ENABLED: overrides.mentorChatEnabled ?? 'true' } as any;
  }

  it('uses the correct join predicate (er.assistant_message_id = m.id) to identify the crisis-reply row, not er.message_id = m.id (which would instead flag the CHILD\'s triggering message)', async () => {
    // The GET tests elsewhere in this describe block hand-supply `crisis_reply_escalation_id`
    // directly on mock row fixtures via `all`, which is opaque to the actual SQL — those
    // tests would pass identically even if the join predicate below were inverted. This test
    // instead wraps `env.DB.prepare` (the same technique used by the POST-side FK-link test
    // above) to capture the REAL SQL text the handler sends, so an inverted/wrong join
    // predicate is caught here even though it can't be caught by asserting on returned rows
    // (the `all` mock ignores SQL and just returns whatever fixture rows it's given).
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    let capturedSql = '';
    const env = makeHistoryEnv([]);
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM mentor_chat_messages m')) capturedSql = sql;
      return originalPrepare(sql);
    };

    const res = await handleGetMentorChatHistory(req, env);
    expect(res.status).toBe(200);
    expect(capturedSql).not.toBe('');
    // Correct: `er` identifies the row that IS an escalation's linked assistant reply.
    expect(capturedSql).toContain('LEFT JOIN mentor_chat_escalations er ON er.assistant_message_id = m.id');
    // Explicitly guard against the inverted bug class: `er.message_id = m.id` would instead
    // match on the CHILD's triggering message (mentor_chat_escalations.message_id references
    // the child message, not the assistant reply — see the `e` alias join two lines above),
    // redacting the wrong party's content for parents.
    expect(capturedSql).not.toContain('er.message_id = m.id');
  });

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

  it('rejects a parent-shaped child_id target that is not actually a child in the family (co-parent)', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=parent_2');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const env = makeHistoryEnv([], { members: [{ id: 'parent_2', family_id: 'fam_1', role: 'parent' }] });
    const res = await handleGetMentorChatHistory(req, env);
    expect(res.status).toBe(403);
  });

  it('rejects a sub-13 account reading its own history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { birthDate: '2018-01-01' }));
    expect(res.status).toBe(403);
  });

  it('rejects a parent reading a sub-13 child\'s history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { birthDate: '2018-01-01' }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when MENTOR_CHAT_ENABLED is not set, even for an otherwise-authorized request', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { mentorChatEnabled: 'false' }));
    expect(res.status).toBe(403);
  });

  it('rejects a family without AI Mentor/Shield tier', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([], { familyRow: { has_ai_mentor: 0, has_shield: 0 } }));
    expect(res.status).toBe(403);
  });

  it("maps both distress and abuse_pattern escalation_type to the generic 'flagged' for a parent, collapsing what were previously distinct values", async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const rows = [
      { id: 'm1', role: 'child', content: 'a', created_at: 1000, escalation_type: 'distress' },
      { id: 'm2', role: 'child', content: 'b', created_at: 1001, escalation_type: 'abuse_pattern' },
      { id: 'm3', role: 'assistant', content: 'c', created_at: 1002, escalation_type: null },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0].escalation_type).toBe('flagged');
    expect(body.messages[1].escalation_type).toBe('flagged');
    expect(body.messages[2].escalation_type).toBeNull();
  });

  it('leaves the real, distinct escalation_type values intact for a child reading their own history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const rows = [
      { id: 'm1', role: 'child', content: 'a', created_at: 1000, escalation_type: 'distress' },
      { id: 'm2', role: 'child', content: 'b', created_at: 1001, escalation_type: 'abuse_pattern' },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0].escalation_type).toBe('distress');
    expect(body.messages[1].escalation_type).toBe('abuse_pattern');
  });

  it("replaces the assistant crisis-reply content with a generic string for a parent on the distress branch, identified via the explicit assistant_message_id FK link (crisis_reply_escalation_id populated)", async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const rows = [
      { id: 'm1', role: 'child', content: 'nothing matters anymore', created_at: 1000, escalation_type: 'distress', crisis_reply_escalation_id: null },
      { id: 'm2', role: 'assistant', content: "Childline... we've also let your parent(s) know you might be struggling.", created_at: 1001, escalation_type: null, crisis_reply_escalation_id: 'esc_1' },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Child's own triggering message is untouched — out of scope for this fix.
    expect(body.messages[0].content).toBe('nothing matters anymore');
    expect(body.messages[1].content).toBe('Support resources were shared with your child.');
    expect(body.messages[1].content).not.toContain('parent(s)');
  });

  it("replaces the assistant crisis-reply content with the SAME generic string for a parent on the abuse_pattern branch, so a parent cannot distinguish distress from abuse_pattern via content OR escalation_type", async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const rows = [
      { id: 'm1', role: 'child', content: 'my dad takes my chore money', created_at: 1000, escalation_type: 'abuse_pattern', crisis_reply_escalation_id: null },
      { id: 'm2', role: 'assistant', content: "Childline... you can talk to someone without anyone else finding out.", created_at: 1001, escalation_type: null, crisis_reply_escalation_id: 'esc_2' },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[1].content).toBe('Support resources were shared with your child.');
    expect(body.messages[1].content).not.toContain('without anyone else finding out');
    expect(body.messages[0].escalation_type).toBe('flagged');
  });

  it('does not redact ordinary (non-crisis) assistant reply content for a parent', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const rows = [
      { id: 'm1', role: 'child', content: 'should I buy a game or save', created_at: 1000, escalation_type: null, crisis_reply_escalation_id: null },
      { id: 'm2', role: 'assistant', content: 'Have you thought about splitting it between saving and spending?', created_at: 1001, escalation_type: null, crisis_reply_escalation_id: null },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[1].content).toBe('Have you thought about splitting it between saving and spending?');
  });

  it("leaves the real, distinct crisis-reply text visible for a child reading their own history on both branches", async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const rows = [
      { id: 'm1', role: 'assistant', content: "we've also let your parent(s) know", created_at: 1000, escalation_type: null, crisis_reply_escalation_id: 'esc_1' },
      { id: 'm2', role: 'assistant', content: 'without anyone else finding out', created_at: 1001, escalation_type: null, crisis_reply_escalation_id: 'esc_2' },
    ];
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv(rows));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0].content).toBe("we've also let your parent(s) know");
    expect(body.messages[1].content).toBe('without anyone else finding out');
  });
});
