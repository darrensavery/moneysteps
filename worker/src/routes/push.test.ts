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
  function makeCountEnv(counts: number[]) {
    let call = 0;
    const first = vi.fn().mockImplementation(() => Promise.resolve({ count: counts[call++] ?? 0 }));
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    return { env: { DB: { prepare } } as any };
  }

  function roleRequest(role: 'parent' | 'child') {
    const req = new Request('https://x/api/push/pending-count', { method: 'GET' });
    (req as any).auth = { sub: role === 'child' ? 'child_1' : 'parent_1', family_id: 'fam_1', role };
    return req;
  }

  it('returns getParentPendingCount for a parent', async () => {
    const { env } = makeCountEnv([3, 2]); // awaiting_review + give_requests
    const res = await handleGetPendingCount(roleRequest('parent'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending_count: 5 });
  });

  it('returns getChildPendingCount for a child', async () => {
    const { env } = makeCountEnv([4, 1]); // new chores + needs-redo
    const res = await handleGetPendingCount(roleRequest('child'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending_count: 5 });
  });
});
