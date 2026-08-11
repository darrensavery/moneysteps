import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handlePostGiveRequest } from './give-requests.js';

function fakeCtx(): { ctx: ExecutionContext; flush: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
  } as unknown as ExecutionContext;
  return { ctx, flush: async () => { await Promise.allSettled(pending); } };
}

function authedRequest(url: string, auth: Record<string, unknown>, body?: unknown) {
  const req = new Request(url, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  (req as any).auth = auth;
  return req;
}

function makeEnv(opts: {
  giveBalance?: number;
  parents?: Array<{ id: string }>;
  displayName?: string;
} = {}) {
  const first = vi.fn((sql: string) => {
    if (sql.includes('SELECT base_currency FROM families')) {
      return Promise.resolve({ base_currency: 'GBP' });
    }
    if (sql.includes('SELECT display_name FROM users WHERE id = ?')) {
      return Promise.resolve({ display_name: opts.displayName ?? 'Robin' });
    }
    // getParentPendingCount — awaiting-review count
    if (sql.includes('COUNT(*) AS count') && sql.includes("status = 'awaiting_review'")) {
      return Promise.resolve({ count: 0 });
    }
    // getParentPendingCount — give-requests count
    if (sql.includes('give_requests') && sql.includes('COUNT(*)')) {
      return Promise.resolve({ count: 0 });
    }
    return Promise.resolve(null);
  });

  const all = vi.fn((sql: string) => {
    if (sql.includes("fr.role = 'parent'")) {
      return Promise.resolve({ results: opts.parents ?? [{ id: 'parent_1' }] });
    }
    return Promise.resolve({ results: [] });
  });

  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });

  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: () => first(sql),
      all: () => all(sql),
      run,
    }),
  }));

  const batch = vi.fn((stmts: unknown[]) =>
    Promise.resolve(
      stmts.map((_s, i) =>
        i === 0
          ? { results: [{ id: 42 }], success: true }
          : { success: true, meta: { last_row_id: 99 } },
      ),
    ),
  );

  return { DB: { prepare, batch } } as any;
}

// jar-balance helper hits the real getJarBalances module, so we mock it to
// report sufficient Give-jar balance without needing to model jar_movements SQL.
vi.mock('../lib/jar-balance.js', () => ({
  getJarBalances: vi.fn().mockResolvedValue({ enabled: true, give: 10000, save: 0, spend: 0 }),
}));

afterEach(() => vi.restoreAllMocks());

describe('handlePostGiveRequest — push notification', () => {
  it('notifies every parent when a give request is created', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({ parents: [{ id: 'parent_1' }, { id: 'parent_2' }], displayName: 'Robin' });
    const auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const req = authedRequest('https://x/api/give-requests', auth, {
      family_id: 'fam_1', child_id: 'child_1', cause: 'Animal shelter', amount: 500,
    });

    const { ctx, flush } = fakeCtx();
    const res = await handlePostGiveRequest(req, env, ctx);
    expect(res.status).toBe(201);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'parent_1',
      expect.objectContaining({ route: '/parent?tab=activity' }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'parent_2',
      expect.objectContaining({ route: '/parent?tab=activity' }),
    );
  });

  it('does not notify when the caller is not a child', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv();
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/give-requests', auth, {
      family_id: 'fam_1', child_id: 'child_1', cause: 'Animal shelter', amount: 500,
    });

    const { ctx, flush } = fakeCtx();
    const res = await handlePostGiveRequest(req, env, ctx);
    expect(res.status).toBe(403);
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
