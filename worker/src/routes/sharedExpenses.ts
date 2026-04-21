// worker/src/routes/sharedExpenses.ts
import { computeSharedExpenseHash, getLastCommittedHash, GENESIS_HASH } from '../lib/sharedExpenseHash.js';
import { sendApprovalEmail, AuthedRequest } from './auth.js';
import { Env } from '../types.js';
import { json as jsonOk, error as jsonErr, clientIp as ip } from '../lib/response.js';

// ---------------------------------------------------------------------------
// POST /api/shared-expenses
// Log a new shared expense. Auto-commits if under threshold or amicable mode.
// ---------------------------------------------------------------------------
export async function handleCreateSharedExpense(req: AuthedRequest, env: Env): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const body = await req.json<{
    description: string;
    category: string;
    total_amount: number;
    split_bp?: number;
    attachment_key?: string;
  }>();

  if (!body.description?.trim()) return jsonErr('description required', 400);
  if (!body.category) return jsonErr('category required', 400);
  if (!Number.isInteger(body.total_amount) || body.total_amount <= 0) return jsonErr('total_amount must be a positive integer (pence)', 400);

  const VALID_CATEGORIES = ['education', 'health', 'clothing', 'travel', 'activities', 'other'];
  if (!VALID_CATEGORIES.includes(body.category)) return jsonErr('invalid category', 400);

  const family = await env.DB
    .prepare('SELECT currency, verify_mode, shared_expense_threshold, shared_expense_split_bp FROM families WHERE id = ?')
    .bind(req.auth.family_id)
    .first<{ currency: string; verify_mode: string; shared_expense_threshold: number; shared_expense_split_bp: number }>();

  if (!family) return jsonErr('family not found', 404);

  const splitBp = body.split_bp ?? family.shared_expense_split_bp;
  if (!Number.isInteger(splitBp) || splitBp < 0 || splitBp > 10000) return jsonErr('split_bp must be an integer 0–10000', 400);

  const isAmicable = family.verify_mode === 'amicable';
  const underThreshold = body.total_amount <= family.shared_expense_threshold;
  const autoCommit = isAmicable || underThreshold;

  const insertStatus = autoCommit ? 'committed_auto' : 'pending';

  let previousHash = GENESIS_HASH;
  let recordHash = 'PENDING';

  if (autoCommit) {
    previousHash = await getLastCommittedHash(env.DB, req.auth.family_id);
  }

  const insertStmt = env.DB
    .prepare(
      `INSERT INTO shared_expenses
         (family_id, logged_by, description, category, total_amount, currency,
          split_bp, verification_status, attachment_key, previous_hash, record_hash, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      req.auth.family_id,
      req.auth.sub,
      body.description.trim(),
      body.category,
      body.total_amount,
      family.currency,
      splitBp,
      insertStatus,
      body.attachment_key ?? null,
      previousHash,
      recordHash,
      ip(req),
    );

  const result = await insertStmt.run();
  const newId = result.meta.last_row_id as number;

  if (autoCommit) {
    recordHash = await computeSharedExpenseHash(
      newId,
      req.auth.family_id,
      req.auth.sub,
      body.total_amount,
      family.currency,
      splitBp,
      previousHash,
    );
    // Atomic batch: write the hash immediately so concurrent reads never see PENDING for committed rows
    await env.DB.batch([
      env.DB.prepare('UPDATE shared_expenses SET record_hash = ? WHERE id = ?').bind(recordHash, newId),
    ]);
  } else {
    const otherParent = await env.DB
      .prepare(
        `SELECT u.email, u.display_name FROM users u
         JOIN family_roles fr ON fr.user_id = u.id
         WHERE fr.family_id = ? AND fr.role = 'parent' AND u.id != ?
         LIMIT 1`,
      )
      .bind(req.auth.family_id, req.auth.sub)
      .first<{ email: string; display_name: string }>();

    // Fetch the logging parent's display_name for the email notification
    const loggerUser = await env.DB
      .prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(req.auth.sub)
      .first<{ display_name: string }>();

    if (otherParent?.email) {
      await sendApprovalEmail(
        otherParent.email,
        otherParent.display_name,
        loggerUser?.display_name ?? 'A parent',
        body.total_amount,
        family.currency,
        body.description.trim(),
        newId,
        env,
      );
    }
  }

  return jsonOk({ id: newId, verification_status: insertStatus }, 201);
}

// ---------------------------------------------------------------------------
// GET /api/shared-expenses
// Returns all non-deleted expenses for the family, newest first.
// ---------------------------------------------------------------------------
export async function handleListSharedExpenses(req: AuthedRequest, env: Env): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const rows = await env.DB
    .prepare(
      `SELECT se.*,
              ul.display_name AS logged_by_name,
              ua.display_name AS authorised_by_name
       FROM shared_expenses se
       LEFT JOIN users ul ON ul.id = se.logged_by
       LEFT JOIN users ua ON ua.id = se.authorised_by
       WHERE se.family_id = ? AND se.deleted_at IS NULL
       ORDER BY se.created_at DESC`,
    )
    .bind(req.auth.family_id)
    .all();

  return jsonOk({ expenses: rows.results });
}

// ---------------------------------------------------------------------------
// POST /api/shared-expenses/:id/approve
// Parent B approves a pending expense. Computes + writes the record_hash.
// ---------------------------------------------------------------------------
export async function handleApproveSharedExpense(
  req: AuthedRequest,
  env: Env,
  expenseId: string,
): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const expense = await env.DB
    .prepare('SELECT * FROM shared_expenses WHERE id = ? AND family_id = ?')
    .bind(expenseId, req.auth.family_id)
    .first<{
      id: number; logged_by: string; total_amount: number; currency: string;
      split_bp: number; verification_status: string;
    }>();

  if (!expense) return jsonErr('expense not found', 404);
  if (expense.verification_status !== 'pending') return jsonErr('expense is not pending', 409);
  if (expense.logged_by === req.auth.sub) return jsonErr('cannot approve your own expense', 403);

  const previousHash = await getLastCommittedHash(env.DB, req.auth.family_id);
  const recordHash = await computeSharedExpenseHash(
    expense.id,
    req.auth.family_id,
    expense.logged_by,
    expense.total_amount,
    expense.currency,
    expense.split_bp,
    previousHash,
  );

  await env.DB
    .prepare(
      `UPDATE shared_expenses
       SET verification_status = 'committed_manual',
           authorised_by = ?,
           previous_hash = ?,
           record_hash = ?
       WHERE id = ?`,
    )
    .bind(req.auth.sub, previousHash, recordHash, expense.id)
    .run();

  return jsonOk({ id: expense.id, verification_status: 'committed_manual' });
}

// ---------------------------------------------------------------------------
// POST /api/shared-expenses/:id/reject
// Parent B rejects a pending expense. Stays in DB, excluded from settlement.
// ---------------------------------------------------------------------------
export async function handleRejectSharedExpense(
  req: AuthedRequest,
  env: Env,
  expenseId: string,
): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const expense = await env.DB
    .prepare('SELECT * FROM shared_expenses WHERE id = ? AND family_id = ?')
    .bind(expenseId, req.auth.family_id)
    .first<{ logged_by: string; verification_status: string }>();

  if (!expense) return jsonErr('expense not found', 404);
  if (expense.verification_status !== 'pending') return jsonErr('expense is not pending', 409);
  if (expense.logged_by === req.auth.sub) return jsonErr('cannot reject your own expense', 403);

  await env.DB
    .prepare(`UPDATE shared_expenses SET verification_status = 'rejected' WHERE id = ? AND family_id = ?`)
    .bind(expenseId, req.auth.family_id)
    .run();

  return jsonOk({ id: Number(expenseId), verification_status: 'rejected' });
}

// ---------------------------------------------------------------------------
// DELETE /api/shared-expenses/:id
// Soft-delete. Only allowed for pending or rejected rows.
// Committed records are immutable — issue a reversal entry instead.
// ---------------------------------------------------------------------------
export async function handleDeleteSharedExpense(
  req: AuthedRequest,
  env: Env,
  expenseId: string,
): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const expense = await env.DB
    .prepare('SELECT * FROM shared_expenses WHERE id = ? AND family_id = ?')
    .bind(expenseId, req.auth.family_id)
    .first<{ logged_by: string; verification_status: string; deleted_at: number | null }>();

  if (!expense) return jsonErr('expense not found', 404);
  if (expense.deleted_at) return jsonErr('already deleted', 409);

  if (!['pending', 'rejected'].includes(expense.verification_status)) {
    return jsonErr(
      'Committed records are immutable. Issue a reversal entry to correct them.',
      403,
    );
  }

  if (expense.logged_by !== req.auth.sub) {
    return jsonErr('only the logging parent can remove this expense', 403);
  }

  await env.DB
    .prepare('UPDATE shared_expenses SET deleted_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), expenseId)
    .run();

  return jsonOk({ id: Number(expenseId), deleted: true });
}

// ---------------------------------------------------------------------------
// POST /api/shared-expenses/reconcile
// Marks all committed expenses in the open period as reconciled.
// Returns the settlement summary (net balance between parents).
// ---------------------------------------------------------------------------
export async function handleReconcileSharedExpenses(req: AuthedRequest, env: Env): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  const body = await req.json<{ period?: string }>().catch(() => ({} as { period?: string }));
  const period: string = body.period ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return jsonErr('period must be YYYY-MM format', 400);
  }

  const alreadyReconciled = await env.DB
    .prepare(
      `SELECT COUNT(*) as cnt FROM shared_expenses
       WHERE family_id = ? AND settlement_period = ? AND reconciled_at IS NOT NULL`,
    )
    .bind(req.auth.family_id, period)
    .first<{ cnt: number }>();

  if ((alreadyReconciled?.cnt ?? 0) > 0) {
    return jsonErr(`period ${period} is already reconciled`, 409);
  }

  const expenses = await env.DB
    .prepare(
      `SELECT se.*, ul.display_name AS logged_by_name
       FROM shared_expenses se
       LEFT JOIN users ul ON ul.id = se.logged_by
       WHERE se.family_id = ?
         AND se.deleted_at IS NULL
         AND se.verification_status IN ('committed_auto', 'committed_manual')
         AND (se.settlement_period IS NULL OR se.settlement_period = ?)
       ORDER BY se.created_at ASC`,
    )
    .bind(req.auth.family_id, period)
    .all<{
      id: number; logged_by: string; logged_by_name: string;
      total_amount: number; split_bp: number; currency: string;
      description: string; category: string;
    }>();

  if (!expenses.results.length) {
    return jsonOk({ period, net_pence: 0, expenses: [], message: 'No committed expenses to reconcile.' });
  }

  let netPence = 0;
  for (const e of expenses.results) {
    const loggedByAmount = Math.round((e.total_amount * e.split_bp) / 10000);
    const otherAmount = e.total_amount - loggedByAmount;
    if (e.logged_by === req.auth.sub) {
      netPence -= otherAmount;
    } else {
      netPence += loggedByAmount;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  for (const e of expenses.results) {
    await env.DB
      .prepare(
        `UPDATE shared_expenses
         SET settlement_period = ?, reconciled_at = ?, reconciled_by = ?
         WHERE id = ?`,
      )
      .bind(period, now, req.auth.sub, e.id)
      .run();
  }

  return jsonOk({
    period,
    net_pence: netPence,
    currency: expenses.results[0].currency,
    expenses: expenses.results.map(e => ({
      id: e.id,
      description: e.description,
      category: e.category,
      total_amount: e.total_amount,
      logged_by_name: e.logged_by_name,
      split_bp: e.split_bp,
    })),
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/family/settings
// Updates shared_expense_threshold and shared_expense_split_bp on families.
// Only the lead parent can change family settings.
// ---------------------------------------------------------------------------
export async function handleUpdateFamilySettings(req: AuthedRequest, env: Env): Promise<Response> {
  if (!req.auth) return jsonErr('Unauthorized', 401);

  // Fetch parent_role from DB since it is not stored in the JWT
  const callerRole = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(req.auth.sub, req.auth.family_id)
    .first<{ parent_role: string | null }>();

  if (!callerRole || callerRole.parent_role !== 'lead') {
    return jsonErr('only the lead parent can change family settings', 403);
  }

  const body = await req.json<{
    shared_expense_threshold?: number;
    shared_expense_split_bp?: number;
  }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.shared_expense_threshold !== undefined) {
    if (!Number.isInteger(body.shared_expense_threshold) || body.shared_expense_threshold < 0) {
      return jsonErr('shared_expense_threshold must be a non-negative integer', 400);
    }
    updates.push('shared_expense_threshold = ?');
    values.push(body.shared_expense_threshold);
  }

  if (body.shared_expense_split_bp !== undefined) {
    if (!Number.isInteger(body.shared_expense_split_bp) || body.shared_expense_split_bp < 0 || body.shared_expense_split_bp > 10000) {
      return jsonErr('shared_expense_split_bp must be an integer 0–10000', 400);
    }
    updates.push('shared_expense_split_bp = ?');
    values.push(body.shared_expense_split_bp);
  }

  if (!updates.length) return jsonErr('no valid fields to update', 400);

  values.push(req.auth.family_id);
  await env.DB
    .prepare(`UPDATE families SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return jsonOk({ updated: true });
}
