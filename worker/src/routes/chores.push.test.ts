import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handleChoreCreate, handleChoreSubmit } from './chores.js';

// Captures every ctx.waitUntil(...) promise so tests can flush them before
// asserting — the real handler never awaits waitUntil itself (that's the
// point of fire-and-forget), so the response can resolve before the push
// send does.
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

type ChoreRow = {
  id: string; family_id: string; assigned_to: string; title: string;
  reward_amount: number; currency: string; archived: number;
  is_flash: number; flash_deadline: string | null;
  proof_required: number; auto_approve: number;
};

function makeEnv(opts: {
  choreRow?: ChoreRow | null;
  childExists?: boolean;
  existingRecord?: unknown;
  rateLimited?: boolean;
  alreadyCompleted?: boolean;
  parents?: Array<{ id: string }>;
  displayName?: string;
} = {}) {
  const first = vi.fn((sql: string, args: readonly unknown[]) => {
    // Chore-create: child-in-family lookup
    if (sql.includes("fr.role = 'child'") && sql.includes('u.id = ?')) {
      return Promise.resolve(opts.childExists === false ? null : { id: args[0] });
    }
    // Chore-submit: fetch the chore
    if (sql.includes('SELECT * FROM chores WHERE id = ?')) {
      return Promise.resolve(opts.choreRow ?? null);
    }
    // Chore-submit: rate-limit check (has chore_id + child_id + submitted_at)
    if (sql.includes('chore_id = ? AND child_id = ?') && sql.includes("status = 'awaiting_review'")) {
      return Promise.resolve(opts.rateLimited ? { id: 'existing_completion' } : null);
    }
    // Chore-submit: double-dip guard (completed today)
    if (sql.includes('chore_id = ? AND child_id = ?') && sql.includes("status = 'completed'")) {
      return Promise.resolve(opts.alreadyCompleted ? { id: 'existing_completion' } : null);
    }
    // Chore-submit: existing needs_revision/available record
    if (sql.includes("status IN ('needs_revision','available')")) {
      return Promise.resolve(opts.existingRecord ?? null);
    }
    // Chore-submit: freshly-inserted completion re-fetch (only hit on the resubmission branch)
    if (sql.includes('SELECT * FROM completions WHERE id = ?')) {
      return Promise.resolve({ id: args[0], status: 'awaiting_review' });
    }
    // Push: child's display name
    if (sql.includes('SELECT display_name FROM users WHERE id = ?')) {
      return Promise.resolve({ display_name: opts.displayName ?? 'Robin' });
    }
    // getChildPendingCount — new chores count
    if (sql.includes('FROM chores c')) {
      return Promise.resolve({ count: 0 });
    }
    // getChildPendingCount — needs-redo count
    if (sql.includes("status IN ('rejected', 'needs_revision')")) {
      return Promise.resolve({ count: 0 });
    }
    // getParentPendingCount — awaiting-review count
    if (sql.includes('COUNT(*) AS count') && sql.includes("status = 'awaiting_review'")) {
      return Promise.resolve({ count: 0 });
    }
    // getParentPendingCount — give-requests count
    if (sql.includes('give_requests')) {
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

  const run = vi.fn().mockResolvedValue({ success: true });

  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: () => first(sql, args),
      all: () => all(sql),
      run,
    }),
  }));

  return { DB: { prepare } } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('handleChoreCreate — push notification', () => {
  it('notifies the assigned child on chore creation', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      choreRow: {
        id: 'chore_1', family_id: 'fam_1', assigned_to: 'child_1', title: 'Tidy room',
        reward_amount: 100, currency: 'GBP', archived: 0, is_flash: 0, flash_deadline: null,
        proof_required: 0, auto_approve: 0,
      },
    });
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/chores', auth, {
      family_id: 'fam_1', assigned_to: 'child_1', title: 'Tidy room',
      reward_amount: 100, currency: 'GBP',
    });

    const { ctx, flush } = fakeCtx();
    const res = await handleChoreCreate(req, env, ctx);
    expect(res.status).toBe(201);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'child_1',
      expect.objectContaining({ route: '/child?tab=chores' }),
    );
  });

  it('does not notify when assigned_to is the "anyone" sentinel', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      choreRow: {
        id: 'chore_1', family_id: 'fam_1', assigned_to: 'anyone', title: 'Tidy room',
        reward_amount: 100, currency: 'GBP', archived: 0, is_flash: 0, flash_deadline: null,
        proof_required: 0, auto_approve: 0,
      },
    });
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/chores', auth, {
      family_id: 'fam_1', assigned_to: 'anyone', title: 'Tidy room',
      reward_amount: 100, currency: 'GBP',
    });

    const { ctx, flush } = fakeCtx();
    const res = await handleChoreCreate(req, env, ctx);
    expect(res.status).toBe(201);
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('handleChoreSubmit — push notification (manual-review branch)', () => {
  it('notifies every parent when a fresh submission lands in awaiting_review', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      choreRow: {
        id: 'chore_1', family_id: 'fam_1', assigned_to: 'child_1', title: 'Tidy room',
        reward_amount: 100, currency: 'GBP', archived: 0, is_flash: 0, flash_deadline: null,
        proof_required: 0, auto_approve: 0,
      },
      parents: [{ id: 'parent_1' }, { id: 'parent_2' }],
      displayName: 'Robin',
    });
    const auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const req = authedRequest('https://x/api/chores/chore_1/submit', auth, {});

    const { ctx, flush } = fakeCtx();
    const res = await handleChoreSubmit(req, env, ctx, 'chore_1');
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

  it('notifies parents on the resubmission (needs_revision) branch too', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      choreRow: {
        id: 'chore_1', family_id: 'fam_1', assigned_to: 'child_1', title: 'Tidy room',
        reward_amount: 100, currency: 'GBP', archived: 0, is_flash: 0, flash_deadline: null,
        proof_required: 0, auto_approve: 0,
      },
      existingRecord: { id: 'completion_1', status: 'needs_revision', attempt_count: 1 },
      parents: [{ id: 'parent_1' }],
      displayName: 'Robin',
    });
    const auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const req = authedRequest('https://x/api/chores/chore_1/submit', auth, {});

    const { ctx, flush } = fakeCtx();
    const res = await handleChoreSubmit(req, env, ctx, 'chore_1');
    expect(res.status).toBe(200);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'parent_1',
      expect.objectContaining({ route: '/parent?tab=activity' }),
    );
  });
});
