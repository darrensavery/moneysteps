import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handleCompletionReject } from './completions.js';

function fakeCtx(): { ctx: ExecutionContext; flush: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
  } as unknown as ExecutionContext;
  return { ctx, flush: async () => { await Promise.allSettled(pending); } };
}

function authedRequest(url: string, auth: Record<string, unknown>, body: unknown) {
  const req = new Request(url, { method: 'POST', body: JSON.stringify(body) });
  (req as any).auth = auth;
  return req;
}

function makeEnv(opts: {
  comp?: { id: string; family_id: string; child_id: string; status: string } | null;
} = {}) {
  const first = vi.fn((sql: string, args: readonly unknown[]) => {
    if (sql.includes('SELECT id, family_id, child_id, status FROM completions WHERE id = ?')) {
      return Promise.resolve(
        opts.comp !== undefined
          ? opts.comp
          : { id: args[0], family_id: 'fam_1', child_id: 'child_1', status: 'awaiting_review' },
      );
    }
    // getChildPendingCount — new chores count
    if (sql.includes('FROM chores c')) {
      return Promise.resolve({ count: 0 });
    }
    // getChildPendingCount — needs-redo count
    if (sql.includes("status IN ('rejected', 'needs_revision')")) {
      return Promise.resolve({ count: 0 });
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
  return { DB: { prepare } } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('handleCompletionReject — push notification', () => {
  it('notifies the child that the completion needs a redo', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv();
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/completions/completion_1/reject', auth, {
      parent_notes: 'Missed the corners',
    });

    const { ctx, flush } = fakeCtx();
    const res = await handleCompletionReject(req, env, ctx, 'completion_1');
    expect(res.status).toBe(200);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'child_1',
      expect.objectContaining({ route: '/chores/completion_1' }),
    );
  });

  it('does not notify when the completion is not in awaiting_review', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      comp: { id: 'completion_1', family_id: 'fam_1', child_id: 'child_1', status: 'completed' },
    });
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/completions/completion_1/reject', auth, {});

    const { ctx, flush } = fakeCtx();
    const res = await handleCompletionReject(req, env, ctx, 'completion_1');
    expect(res.status).toBe(409);
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
