// ----------------------------------------------------------------
// Pending-action count helpers for push-notification badge counts.
//
// getParentPendingCount mirrors handleCompletionCount (routes/completions.ts)
// plus pending give (jar) requests, so the push badge matches what the
// in-app Activity tab already shows.
//
// getChildPendingCount counts chores newly assigned to the child (no open
// completion row yet) plus completions the child needs to act on again
// (rejected / needs_revision), per the locked v1 scope: "new chore assigned
// + reward ready".
// ----------------------------------------------------------------

export async function getParentPendingCount(db: D1Database, familyId: string): Promise<number> {
  const awaitingReview = await db
    .prepare(`SELECT COUNT(*) AS count FROM completions WHERE family_id = ? AND status = 'awaiting_review'`)
    .bind(familyId)
    .first<{ count: number }>();

  const giveRequests = await db
    .prepare(`SELECT COUNT(*) AS count FROM give_requests WHERE family_id = ? AND status = 'requested'`)
    .bind(familyId)
    .first<{ count: number }>();

  return (awaitingReview?.count ?? 0) + (giveRequests?.count ?? 0);
}

export async function getChildPendingCount(db: D1Database, familyId: string, childId: string): Promise<number> {
  const newChores = await db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM chores c
      LEFT JOIN completions comp ON comp.chore_id = c.id AND comp.child_id = c.assigned_to
        AND comp.status IN ('awaiting_review', 'completed')
      WHERE c.family_id = ? AND c.assigned_to = ? AND c.archived = 0 AND comp.id IS NULL
    `)
    .bind(familyId, childId)
    .first<{ count: number }>();

  const needsRedo = await db
    .prepare(`SELECT COUNT(*) AS count FROM completions WHERE family_id = ? AND child_id = ? AND status IN ('rejected', 'needs_revision')`)
    .bind(familyId, childId)
    .first<{ count: number }>();

  return (newChores?.count ?? 0) + (needsRedo?.count ?? 0);
}
