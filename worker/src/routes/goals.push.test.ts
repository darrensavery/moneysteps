import { describe, it, expect, vi, afterEach } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handleGoalContribute } from './goals.js';

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

type GoalRow = {
  id: string; family_id: string; child_id: string; title: string;
  status: string; current_saved_pence: number; target_amount: number;
};

function makeEnv(opts: {
  goal?: GoalRow | null;
  jarEnabled?: boolean;
} = {}) {
  const goal = opts.goal !== undefined ? opts.goal : {
    id: 'goal_1', family_id: 'fam_1', child_id: 'child_1', title: 'New bike',
    status: 'IN_PROGRESS', current_saved_pence: 500, target_amount: 1000,
  };

  const updatedGoal = goal ? { ...goal, current_saved_pence: goal.current_saved_pence + 250 } : null;

  const first = vi.fn((sql: string) => {
    if (sql.includes('SELECT * FROM goals WHERE id = ? AND archived = 0')) {
      return Promise.resolve(goal);
    }
    if (sql.includes('SELECT * FROM goals WHERE id = ?')) {
      return Promise.resolve(updatedGoal);
    }
    // getChildPendingCount — new chores count
    if (sql.includes('FROM chores c')) {
      return Promise.resolve({ count: 0 });
    }
    // getChildPendingCount — needs-redo count
    if (sql.includes("status IN ('rejected', 'needs_revision')")) {
      return Promise.resolve({ count: 0 });
    }
    // jar config lookup
    if (sql.toLowerCase().includes('jar')) {
      return Promise.resolve(opts.jarEnabled === false ? null : { enabled: 0 });
    }
    return Promise.resolve(null);
  });

  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });

  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: () => first(sql),
      run,
    }),
  }));

  return { DB: { prepare } } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('handleGoalContribute — push notification', () => {
  it('notifies the child their goal got a boost', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv();
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/goals/goal_1/contribute', auth, { amount_pence: 250 });

    const { ctx, flush } = fakeCtx();
    const res = await handleGoalContribute(req, env, ctx, 'goal_1');
    expect(res.status).toBe(200);
    await flush();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      'child_1',
      expect.objectContaining({ route: '/child?tab=goals' }),
    );
  });

  it('does not notify when the goal is already reached', async () => {
    const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
    const env = makeEnv({
      goal: {
        id: 'goal_1', family_id: 'fam_1', child_id: 'child_1', title: 'New bike',
        status: 'REACHED', current_saved_pence: 1000, target_amount: 1000,
      },
    });
    const auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const req = authedRequest('https://x/api/goals/goal_1/contribute', auth, { amount_pence: 250 });

    const { ctx, flush } = fakeCtx();
    const res = await handleGoalContribute(req, env, ctx, 'goal_1');
    expect(res.status).toBe(409);
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
