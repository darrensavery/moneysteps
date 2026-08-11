import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handleCompletionReject, handleCompletionApprove } from './completions.js';

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

function makeApproveEnv(opts: {
  comp?: {
    id: string; family_id: string; chore_id: string; child_id: string;
    status: string; title: string; reward_amount: number; currency: string;
    due_date: string | null; submitted_at: number;
  } | null;
} = {}) {
  const defaultComp = {
    id: 'completion_1', family_id: 'fam_1', chore_id: 'chore_1', child_id: 'child_1',
    status: 'awaiting_review', title: 'Wash the car', reward_amount: 250, currency: 'GBP',
    due_date: null, submitted_at: Math.floor(Date.now() / 1000),
  };
  const comp = opts.comp !== undefined ? opts.comp : defaultComp;

  const first = vi.fn((sql: string, args: readonly unknown[]) => {
    if (sql.includes('FROM completions comp') && sql.includes('JOIN chores ch')) {
      return Promise.resolve(comp);
    }
    if (sql.includes('SELECT verify_mode FROM families')) {
      return Promise.resolve({ verify_mode: 'amicable' });
    }
    if (sql.includes('FROM ledger WHERE family_id')) {
      // No prior ledger rows — chain starts fresh.
      return Promise.resolve(null);
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
  const all = vi.fn(() => Promise.resolve({ results: [] }));
  const run = vi.fn((sql: string) => {
    if (sql.includes(`UPDATE completions SET status = 'completed'`)) {
      return Promise.resolve({ success: true, meta: { changes: 1 } });
    }
    return Promise.resolve({ success: true, meta: { changes: 1 } });
  });
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: () => first(sql, args),
      all: () => all(),
      run: () => run(sql),
    }),
  }));
  const batch = vi.fn((stmts: unknown[]) =>
    Promise.resolve(stmts.map(() => ({ success: true }))),
  );
  return { DB: { prepare, batch } } as any;
}

describe('handleCompletionApprove — push notification', () => {
  it('notifies the child their chore was approved and paid', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeApproveEnv();
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/completions/completion_1/approve', auth, {});

    const { ctx, flush } = fakeCtx();
    const res = await handleCompletionApprove(req, env, ctx, 'completion_1');
    expect(res.status).toBe(200);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'child_1',
      expect.objectContaining({ route: '/child?tab=chores' }),
    );
  });

  it('does not notify when the completion is not awaiting review', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeApproveEnv({
      comp: {
        id: 'completion_1', family_id: 'fam_1', chore_id: 'chore_1', child_id: 'child_1',
        status: 'completed', title: 'Wash the car', reward_amount: 250, currency: 'GBP',
        due_date: null, submitted_at: Math.floor(Date.now() / 1000),
      },
    });
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/completions/completion_1/approve', auth, {});

    const { ctx, flush } = fakeCtx();
    const res = await handleCompletionApprove(req, env, ctx, 'completion_1');
    expect(res.status).toBe(409);
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

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
      expect.objectContaining({ route: '/child?tab=chores' }),
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
