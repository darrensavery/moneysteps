/**
 * Completions routes — Parent approval queue
 *
 * GET    /api/completions                   List completions by status (parent/child)
 * GET    /api/completions/count             Badge count: awaiting_review for a family
 * GET    /api/completions/history           Full history for a child (all statuses)
 * POST   /api/completions/:id/approve       Parent approves → writes ledger entry (status: completed)
 * POST   /api/completions/:id/revise        Parent requests revision with notes (status: needs_revision)
 * POST   /api/completions/:id/rate          Child rates a completed completion
 *
 * Completion lifecycle:
 *   (chore submitted) → awaiting_review → completed
 *                                       → needs_revision → awaiting_review (loop)
 *
 * "attempt_count" tracks how many times a job went through the loop.
 * This surfaces the child's "professionalism" metric in the UI.
 */

import { Env } from '../types.js';
import { json, error, clientIp } from '../lib/response.js';
import { computeRecordHash, GENESIS_HASH } from '../lib/hash.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// GET /api/completions?family_id=&child_id=&status=
// Default status: awaiting_review
// ----------------------------------------------------------------
export async function handleCompletionList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const child_id  = url.searchParams.get('child_id');
  const status    = url.searchParams.get('status') ?? 'awaiting_review';

  const validStatuses = ['available', 'awaiting_review', 'completed', 'needs_revision'];
  if (!validStatuses.includes(status)) return error(`status must be one of: ${validStatuses.join(', ')}`);

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const effectiveChildId = auth.role === 'child' ? auth.sub : (child_id ?? null);

  // Audit columns (proof_hash, proof_exif, system_verify, verification_confidence)
  // are intentionally excluded — they are reserved for the audit export route only.
  const baseQuery = `
    SELECT
      comp.id, comp.family_id, comp.chore_id, comp.child_id,
      comp.note, comp.status, comp.proof_url, comp.parent_notes,
      comp.attempt_count, comp.ledger_id, comp.rating,
      comp.submitted_at, comp.resolved_at, comp.resolved_by,
      ch.title        AS chore_title,
      ch.reward_amount,
      ch.currency,
      ch.description  AS chore_description,
      ch.proof_required,
      u.display_name  AS child_name
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    JOIN users  u  ON u.id  = comp.child_id
    WHERE comp.family_id = ?
  `;

  let stmt;
  if (effectiveChildId) {
    stmt = env.DB.prepare(
      `${baseQuery} AND comp.child_id = ? AND comp.status = ?
       ORDER BY comp.submitted_at DESC LIMIT 100`
    ).bind(family_id, effectiveChildId, status);
  } else {
    stmt = env.DB.prepare(
      `${baseQuery} AND comp.status = ?
       ORDER BY comp.submitted_at DESC LIMIT 100`
    ).bind(family_id, status);
  }

  const { results } = await stmt.all();
  return json({ completions: results });
}

// ----------------------------------------------------------------
// GET /api/completions/count?family_id=
// Returns count of awaiting_review completions — used for parent badge dot.
// ----------------------------------------------------------------
export async function handleCompletionCount(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id = url.searchParams.get('family_id');

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS count FROM completions
              WHERE family_id = ? AND status = 'awaiting_review'`)
    .bind(family_id)
    .first<{ count: number }>();

  return json({ awaiting_review: row?.count ?? 0 });
}

// ----------------------------------------------------------------
// GET /api/completions/history?family_id=&child_id=&limit=&offset=
// ----------------------------------------------------------------
export async function handleCompletionHistory(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const child_id  = url.searchParams.get('child_id');
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  ?? '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const effectiveChildId = auth.role === 'child' ? auth.sub : (child_id ?? null);
  if (!effectiveChildId) return error('child_id required for history');

  // Audit columns excluded — see handleCompletionList for rationale.
  const { results } = await env.DB.prepare(`
    SELECT
      comp.id, comp.family_id, comp.chore_id, comp.child_id,
      comp.note, comp.status, comp.proof_url, comp.parent_notes,
      comp.attempt_count, comp.ledger_id, comp.rating,
      comp.submitted_at, comp.resolved_at, comp.resolved_by,
      ch.title      AS chore_title,
      ch.reward_amount,
      ch.currency
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    WHERE comp.family_id = ? AND comp.child_id = ?
    ORDER BY comp.submitted_at DESC
    LIMIT ? OFFSET ?
  `).bind(family_id, effectiveChildId, limit, offset).all();

  return json({ history: results, limit, offset });
}

// ----------------------------------------------------------------
// POST /api/completions/:id/approve
// Parent approves → writes immutable ledger entry (hash-chained).
// Guard: completion must be in 'awaiting_review' state.
// ----------------------------------------------------------------
export async function handleCompletionApprove(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can approve completions', 403);

  const ip = clientIp(request);

  const comp = await env.DB.prepare(`
    SELECT comp.*, ch.title, ch.reward_amount, ch.currency
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    WHERE comp.id = ?
  `).bind(completionId)
    .first<{
      id: string; family_id: string; chore_id: string; child_id: string;
      status: string; title: string; reward_amount: number; currency: string;
    }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);

  // Double-dip guard: must be awaiting review
  if (comp.status !== 'awaiting_review')
    return error(`Cannot approve — completion is '${comp.status}'`, 409);

  const family = await env.DB
    .prepare('SELECT verify_mode FROM families WHERE id = ?')
    .bind(comp.family_id)
    .first<{ verify_mode: string }>();
  if (!family) return error('Family not found', 404);

  const verificationStatus = family.verify_mode === 'amicable' ? 'verified_auto' : 'verified_manual';
  const now = Math.floor(Date.now() / 1000);
  const disputeBefore = verificationStatus === 'verified_auto' ? now + 172800 : null;

  // Hash chain
  const prevRow = await env.DB
    .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
    .bind(comp.family_id)
    .first<{ id: number; record_hash: string }>();

  const previousHash = prevRow?.record_hash ?? GENESIS_HASH;

  const maxRow = await env.DB
    .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger')
    .first<{ max_id: number }>();
  const newLedgerId = (maxRow?.max_id ?? 0) + 1;

  const recordHash = await computeRecordHash(
    newLedgerId,
    comp.family_id,
    comp.child_id,
    comp.reward_amount,
    comp.currency,
    'credit',
    previousHash,
  );

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO ledger
        (id, family_id, child_id, chore_id, entry_type, amount, currency,
         description, verification_status, authorised_by, verified_at, verified_by,
         previous_hash, record_hash, ip_address, dispute_before)
      VALUES (?,?,?,?,'credit',?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      newLedgerId,
      comp.family_id, comp.child_id, comp.chore_id,
      comp.reward_amount, comp.currency,
      `Chore completed: ${comp.title}`,
      verificationStatus,
      auth.sub, now, auth.sub,
      previousHash, recordHash, ip,
      disputeBefore,
    ),
    env.DB.prepare(`
      UPDATE completions
      SET status = 'completed', resolved_at = ?, resolved_by = ?, ledger_id = ?
      WHERE id = ?
    `).bind(now, auth.sub, newLedgerId, completionId),
  ]);

  // Status log
  await env.DB.prepare(`
    INSERT INTO ledger_status_log
      (ledger_id, from_status, to_status, actor_id, ip_address)
    VALUES (?,?,?,?,?)
  `).bind(newLedgerId, 'pending', verificationStatus, auth.sub, ip).run();

  return json({
    ok: true,
    ledger_id: newLedgerId,
    record_hash: recordHash,
    verification_status: verificationStatus,
    amount: comp.reward_amount,
    currency: comp.currency,
  });
}

// ----------------------------------------------------------------
// POST /api/completions/:id/revise
// Parent sends job back with notes (needs_revision).
// Child sees the orange badge + parent_notes in their task list.
// Body: { parent_notes? }
// ----------------------------------------------------------------
export async function handleCompletionRevise(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can request revision', 403);

  const body = await parseBody(request);
  const parent_notes = body?.parent_notes ? String(body.parent_notes).trim() : null;

  const comp = await env.DB
    .prepare('SELECT id, family_id, status FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ id: string; family_id: string; status: string }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);
  if (comp.status !== 'awaiting_review')
    return error(`Cannot request revision — completion is '${comp.status}'`, 409);

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE completions
              SET status = 'needs_revision', parent_notes = ?, resolved_at = ?, resolved_by = ?
              WHERE id = ?`)
    .bind(parent_notes, now, auth.sub, completionId)
    .run();

  return json({ ok: true, parent_notes });
}

// ----------------------------------------------------------------
// POST /api/completions/:id/rate
// Child rates a completed completion. Body: { rating: 1 | -1 }
// ----------------------------------------------------------------
export async function handleCompletionRate(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can rate completions', 403);

  const body = await parseBody(request);
  const rating = body?.rating;
  if (rating !== 1 && rating !== -1) return error('rating must be 1 (thumbs up) or -1 (thumbs down)');

  const comp = await env.DB
    .prepare('SELECT family_id, child_id, status FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ family_id: string; child_id: string; status: string }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);
  if (comp.child_id !== auth.sub) return error('Not your completion', 403);
  if (comp.status !== 'completed') return error('Only completed jobs can be rated');

  await env.DB
    .prepare('UPDATE completions SET rating = ? WHERE id = ?')
    .bind(rating, completionId)
    .run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /api/completions/approve-all
// Approve all awaiting_review completions for a child in one action.
// Body: { family_id, child_id }
// ----------------------------------------------------------------
export async function handleApproveAll(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can approve completions', 403);

  const body = await parseBody(request);
  const { family_id, child_id } = body ?? {};
  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (!child_id) return error('child_id required');

  const { results: pending } = await env.DB.prepare(`
    SELECT comp.id AS comp_id, comp.chore_id, comp.child_id,
           ch.title, ch.reward_amount, ch.currency
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    WHERE comp.family_id = ? AND comp.child_id = ? AND comp.status = 'awaiting_review'
    ORDER BY comp.submitted_at ASC
  `).bind(family_id, child_id).all<{
    comp_id: string; chore_id: string; child_id: string;
    title: string; reward_amount: number; currency: string;
  }>();

  if (pending.length === 0) return json({ approved: 0 });

  const family = await env.DB
    .prepare('SELECT verify_mode FROM families WHERE id = ?')
    .bind(family_id)
    .first<{ verify_mode: string }>();
  if (!family) return error('Family not found', 404);

  const verificationStatus = family.verify_mode === 'amicable' ? 'verified_auto' : 'verified_manual';
  const ip = clientIp(request);
  const now = Math.floor(Date.now() / 1000);

  // Sequential to maintain hash chain integrity
  for (const comp of pending) {
    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(family_id)
      .first<{ id: number; record_hash: string }>();

    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
    const maxRow = await env.DB
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger')
      .first<{ max_id: number }>();
    const newLedgerId = (maxRow?.max_id ?? 0) + 1;
    const disputeBefore = verificationStatus === 'verified_auto' ? now + 172800 : null;

    const recordHash = await computeRecordHash(
      newLedgerId, family_id, comp.child_id,
      comp.reward_amount, comp.currency, 'credit', previousHash,
    );

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ledger
          (id, family_id, child_id, chore_id, entry_type, amount, currency,
           description, verification_status, authorised_by, verified_at, verified_by,
           previous_hash, record_hash, ip_address, dispute_before)
        VALUES (?,?,?,?,'credit',?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        newLedgerId, family_id, comp.child_id, comp.chore_id,
        comp.reward_amount, comp.currency,
        `Chore completed: ${comp.title}`,
        verificationStatus, auth.sub, now, auth.sub,
        previousHash, recordHash, ip, disputeBefore,
      ),
      env.DB.prepare(`
        UPDATE completions SET status = 'completed', resolved_at = ?, resolved_by = ?, ledger_id = ?
        WHERE id = ?
      `).bind(now, auth.sub, newLedgerId, comp.comp_id),
    ]);
  }

  return json({ approved: pending.length });
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}
