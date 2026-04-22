/**
 * Payments routes — Payment Bridge V1.
 *
 * POST /api/completions/:id/mark-paid       Stamp paid_out_at on one completion
 * POST /api/completions/mark-paid-batch     Atomically stamp N completions
 * GET  /api/completions/unpaid-summary      Per-child unpaid totals
 *
 * These routes manage *delivery status* only. They do NOT write to the
 * ledger and do NOT mutate any field that feeds the SHA-256 hash chain.
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// POST /api/completions/:id/mark-paid
// ----------------------------------------------------------------
export async function handleMarkPaid(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can mark a payment', 403);

  const row = await env.DB
    .prepare('SELECT id, family_id, status, paid_out_at FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ id: string; family_id: string; status: string; paid_out_at: number | null }>();

  if (!row) return error('Completion not found', 404);
  if (row.family_id !== auth.family_id) return error('Forbidden', 403);
  if (row.status !== 'completed')
    return error(`Cannot mark paid — completion is '${row.status}'`, 409);

  // Idempotent: first write wins.
  if (row.paid_out_at != null) {
    return json({
      completion_id: row.id,
      paid_out_at: row.paid_out_at,
      was_already_paid: true,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('UPDATE completions SET paid_out_at = ? WHERE id = ?')
    .bind(now, completionId)
    .run();

  return json({
    completion_id: completionId,
    paid_out_at: now,
    was_already_paid: false,
  });
}

// ----------------------------------------------------------------
// POST /api/completions/mark-paid-batch
// Body: { family_id: string, completion_ids: string[] }
// Atomic: all valid (same family, status='completed', unstamped) or none.
// ----------------------------------------------------------------
export async function handleMarkPaidBatch(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can mark a payment', 403);

  let body: { family_id?: string; completion_ids?: string[] };
  try { body = await request.json(); } catch { return error('Invalid JSON body'); }

  const familyId = body.family_id;
  const ids = body.completion_ids;
  if (!familyId) return error('family_id required');
  if (familyId !== auth.family_id) return error('Forbidden', 403);
  if (!Array.isArray(ids) || ids.length === 0) return error('completion_ids required');
  if (ids.length > 100) return error('Max 100 completions per batch');

  // Validate every row in one query.
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB
    .prepare(
      `SELECT id, family_id, status, paid_out_at FROM completions WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{ id: string; family_id: string; status: string; paid_out_at: number | null }>();

  const foundIds = new Set(rows.results.map((r) => r.id));
  for (const id of ids) {
    if (!foundIds.has(id)) return error(`Completion ${id} not found`, 404);
  }
  for (const r of rows.results) {
    if (r.family_id !== familyId) return error('Forbidden', 403);
    if (r.status !== 'completed')
      return error(`Completion ${r.id} is '${r.status}', cannot mark paid`, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const toStamp = rows.results.filter((r) => r.paid_out_at == null).map((r) => r.id);

  if (toStamp.length > 0) {
    const stmts = toStamp.map((id) =>
      env.DB
        .prepare('UPDATE completions SET paid_out_at = ? WHERE id = ?')
        .bind(now, id),
    );
    await env.DB.batch(stmts);
  }

  return json({ stamped: toStamp.length, paid_out_at: now });
}

// ----------------------------------------------------------------
// GET /api/completions/unpaid-summary?family_id=
// Per-child aggregate of completed-but-unpaid completions.
// ----------------------------------------------------------------
export async function handleUnpaidSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can view unpaid summary', 403);

  const url = new URL(request.url);
  const familyId = url.searchParams.get('family_id');
  if (!familyId) return error('family_id required');
  if (familyId !== auth.family_id) return error('Forbidden', 403);

  const rows = await env.DB
    .prepare(
      `SELECT comp.child_id,
              SUM(ch.reward_amount) AS unpaid_total,
              COUNT(*)              AS unpaid_count,
              ch.currency
         FROM completions comp
         JOIN chores ch ON ch.id = comp.chore_id
        WHERE comp.family_id = ?
          AND comp.status = 'completed'
          AND comp.paid_out_at IS NULL
        GROUP BY comp.child_id, ch.currency`,
    )
    .bind(familyId)
    .all<{ child_id: string; unpaid_total: number; unpaid_count: number; currency: string }>();

  return json({ children: rows.results });
}
