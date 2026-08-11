import { describe, it, expect, vi } from 'vitest';
import { handleRegisterDeviceToken, handleUnregisterDeviceToken, handleGetPendingCount } from './push.js';

function makeEnv() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { env: { DB: { prepare } } as any, prepare, bind, run };
}

function authedRequest(body: unknown) {
  const req = new Request('https://x/api/push/register', { method: 'POST', body: JSON.stringify(body) });
  (req as any).auth = { sub: 'user_1', family_id: 'fam_1', role: 'parent' };
  return req;
}

describe('handleRegisterDeviceToken', () => {
  it('rejects a missing token', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ platform: 'ios', environment: 'production' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid platform', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ token: 'tok', platform: 'windows', environment: 'production' }), env);
    expect(res.status).toBe(400);
  });

  it('upserts a valid token', async () => {
    const { env, prepare } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ token: 'tok_1', platform: 'ios', environment: 'production' }), env);
    expect(res.status).toBe(200);
    expect(prepare.mock.calls[0][0]).toMatch(/ON CONFLICT\(token\)/);
  });
});

describe('handleUnregisterDeviceToken', () => {
  it('deletes the token scoped to the authenticated user', async () => {
    const { env, prepare, bind } = makeEnv();
    const req = authedRequest({ token: 'tok_1' });
    const res = await handleUnregisterDeviceToken(req, env);
    expect(res.status).toBe(200);
    expect(prepare.mock.calls[0][0]).toMatch(/DELETE FROM device_tokens WHERE token = \? AND user_id = \?/);
    expect(bind).toHaveBeenCalledWith('tok_1', 'user_1');
  });
});

describe('handleGetPendingCount', () => {
  // Dispatches the returned count — and records the bind() args — by
  // inspecting the SQL text passed to prepare(), rather than by call order.
  // This means a broken auth.role branch (e.g. always calling
  // getParentPendingCount) shows up as either the wrong SQL never being
  // prepared, or the wrong bind() args being used — not just a wrong total,
  // which a same-order-different-value mock would silently launder into a
  // passing test if the two role paths ever summed to the same number.
  function makeCountEnv() {
    const bindCalls: Array<{ sql: string; args: unknown[] }> = [];
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation((...args: unknown[]) => {
        bindCalls.push({ sql, args });
        let count = 0;
        if (/FROM completions WHERE family_id = \? AND status = 'awaiting_review'/.test(sql)) count = 3;
        else if (/FROM give_requests/.test(sql)) count = 2;
        else if (/FROM chores c/.test(sql)) count = 4;
        else if (/FROM completions WHERE family_id = \? AND child_id = \?/.test(sql)) count = 1;
        return { first: vi.fn().mockResolvedValue({ count }) };
      }),
    }));
    return { env: { DB: { prepare } } as any, bindCalls };
  }

  function roleRequest(role: 'parent' | 'child') {
    const req = new Request('https://x/api/push/pending-count', { method: 'GET' });
    (req as any).auth = { sub: role === 'child' ? 'child_1' : 'parent_1', family_id: 'fam_1', role };
    return req;
  }

  it('returns getParentPendingCount for a parent, scoped to family_id only', async () => {
    const { env, bindCalls } = makeCountEnv();
    const res = await handleGetPendingCount(roleRequest('parent'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending_count: 5 }); // awaiting_review(3) + give_requests(2)

    // Both parent-side queries ran, each bound to family_id alone — never
    // the child-scoped chores/completions queries, and never a child_id arg.
    expect(bindCalls.some(c => /status = 'awaiting_review'/.test(c.sql) && c.args.length === 1 && c.args[0] === 'fam_1')).toBe(true);
    expect(bindCalls.some(c => /FROM give_requests/.test(c.sql) && c.args.length === 1 && c.args[0] === 'fam_1')).toBe(true);
    expect(bindCalls.some(c => /FROM chores c/.test(c.sql))).toBe(false);
    expect(bindCalls.some(c => c.args.includes('child_1'))).toBe(false);
  });

  it('returns getChildPendingCount for a child, scoped to family_id + child_id', async () => {
    const { env, bindCalls } = makeCountEnv();
    const res = await handleGetPendingCount(roleRequest('child'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending_count: 5 }); // new chores(4) + needs-redo(1)

    // Both child-side queries ran, each bound to (family_id, child_id) —
    // never the family-wide parent completions/give_requests queries.
    expect(bindCalls.some(c => /FROM chores c/.test(c.sql) && c.args.join(',') === 'fam_1,child_1')).toBe(true);
    expect(bindCalls.some(c => /child_id = \?/.test(c.sql) && c.args.join(',') === 'fam_1,child_1')).toBe(true);
    expect(bindCalls.some(c => /FROM give_requests/.test(c.sql))).toBe(false);
    expect(bindCalls.some(c => /status = 'awaiting_review'/.test(c.sql))).toBe(false);
  });
});
