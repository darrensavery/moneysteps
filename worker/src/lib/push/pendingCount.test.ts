import { describe, it, expect, vi } from 'vitest';
import { getParentPendingCount, getChildPendingCount } from './pendingCount.js';

function makeDb(counts: Record<string, number>) {
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: vi.fn().mockReturnValue({
      first: vi.fn().mockImplementation(async () => {
        // Order matters: the "new chores" query joins chores -> completions and
        // itself references 'awaiting_review' in its LEFT JOIN condition, so the
        // chores/LEFT JOIN check must run before the plain completions/awaiting_review check.
        if (/chores/.test(sql) && /LEFT JOIN/.test(sql)) return { count: counts.newChores ?? 0 };
        if (/completions/.test(sql) && /rejected|needs_revision/.test(sql)) return { count: counts.needsRedo ?? 0 };
        if (/completions/.test(sql) && /awaiting_review/.test(sql)) return { count: counts.awaitingReview ?? 0 };
        if (/give_requests/.test(sql) && /requested/.test(sql)) return { count: counts.giveRequests ?? 0 };
        return { count: 0 };
      }),
    }),
  }));
  return { DB: { prepare } } as any;
}

describe('getParentPendingCount', () => {
  it('sums awaiting-review completions and pending gifts', async () => {
    const db = makeDb({ awaitingReview: 3, giveRequests: 2 });
    const count = await getParentPendingCount(db.DB, 'fam_1');
    expect(count).toBe(5);
  });
});

describe('getChildPendingCount', () => {
  it('sums new chores and chores needing redo', async () => {
    const db = makeDb({ newChores: 2, needsRedo: 1 });
    const count = await getChildPendingCount(db.DB, 'fam_1', 'child_1');
    expect(count).toBe(3);
  });
});
