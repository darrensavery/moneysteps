/**
 * Chores routes
 *
 * POST   /api/chores                  Parent creates a job
 * GET    /api/chores                  List jobs (family_id, child_id?, archived?)
 * PATCH  /api/chores/:id              Parent edits a job
 * DELETE /api/chores/:id              Parent archives a job (soft delete)
 * POST   /api/chores/:id/submit       Child marks job done → completion record (or instant settlement if auto_approve)
 * POST   /api/chores/:id/restore      Parent restores an archived job
 */

import { Env } from '../types.js';
import { json, error, clientIp } from '../lib/response.js';
import { nanoid } from '../lib/nanoid.js';
import { JwtPayload } from '../lib/jwt.js';
import { computeRecordHash, GENESIS_HASH } from '../lib/hash.js';

type AuthedRequest = Request & { auth: JwtPayload };

const VALID_FREQUENCIES = ['daily','weekly','bi_weekly','monthly','quarterly','as_needed'];

// ----------------------------------------------------------------
// POST /api/chores
// Parent creates a job definition.
// Body: { family_id, assigned_to, title, reward_amount, currency,
//         frequency?, due_date?, description?, is_priority?, is_flash?,
//         flash_deadline?, proof_required?, auto_approve? }
// ----------------------------------------------------------------
export async function handleChoreCreate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const {
    family_id, assigned_to, title, reward_amount, currency,
    frequency, due_date, description, is_priority, is_flash, flash_deadline,
    proof_required, auto_approve,
  } = body;

  if (!family_id   || typeof family_id   !== 'string') return error('family_id required');
  if (!assigned_to || typeof assigned_to !== 'string') return error('assigned_to required');
  if (!title       || typeof title       !== 'string') return error('title required');
  if (!currency    || !['GBP','PLN','USD'].includes(currency as string)) return error('Invalid currency');
  if (!Number.isInteger(reward_amount) || (reward_amount as number) <= 0)
    return error('reward_amount must be a positive integer (pence/groszy)');

  if (family_id !== auth.family_id) return error('Forbidden', 403);

  if (frequency && !VALID_FREQUENCIES.includes(frequency as string))
    return error(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`);

  // proof_required and auto_approve are mutually exclusive:
  // auto_approve implicitly means no proof needed.
  const proofRequired = proof_required ? 1 : 0;
  const autoApprove   = auto_approve   ? 1 : 0;

  // 'anyone' and 'everyone' are sentinel values — skip child lookup.
  // Any other value must be a real child in this family.
  const isSentinel = (assigned_to as string) === 'anyone' || (assigned_to as string) === 'everyone';
  if (!isSentinel) {
    const child = await env.DB
      .prepare(`SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
                WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
      .bind(assigned_to, family_id).first<{ id: string }>();
    if (!child) return error('Child not found in this family', 404);
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO chores
      (id, family_id, assigned_to, created_by, title, description, reward_amount,
       currency, frequency, due_date, is_priority, is_flash, flash_deadline,
       proof_required, auto_approve, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id, family_id, assigned_to, auth.sub,
    (title as string).trim(),
    description ? (description as string).trim() : null,
    reward_amount,
    currency,
    frequency ?? 'as_needed',
    due_date ?? null,
    is_priority ? 1 : 0,
    is_flash ? 1 : 0,
    flash_deadline ?? null,
    proofRequired,
    autoApprove,
    now, now,
  ).run();

  const chore = await env.DB.prepare('SELECT * FROM chores WHERE id = ?').bind(id).first();
  return json(chore, 201);
}

// ----------------------------------------------------------------
// GET /api/chores?family_id=&child_id=&archived=&assigned_to=
// ----------------------------------------------------------------
export async function handleChoreList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id   = url.searchParams.get('family_id');
  const child_id    = url.searchParams.get('child_id');
  const assigned_to = url.searchParams.get('assigned_to');  // 'anyone' sentinel filter
  const archived    = url.searchParams.get('archived') === '1' ? 1 : 0;

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  // Sentinel filter: return only open (unclaimed) chores
  if (assigned_to === 'anyone') {
    const { results } = await env.DB.prepare(
      `SELECT c.*, NULL as child_name, p.display_name as parent_name
       FROM chores c
       LEFT JOIN users p ON p.id = c.created_by
       WHERE c.family_id = ? AND c.assigned_to = 'anyone' AND c.archived = 0
       ORDER BY c.is_priority DESC, c.created_at DESC`
    ).bind(family_id).all();
    return json({ chores: results });
  }

  // Children can only see their own chores
  const effectiveChildId = auth.role === 'child' ? auth.sub : (child_id ?? null);

  let stmt;
  if (effectiveChildId) {
    stmt = env.DB.prepare(
      `SELECT c.*, u.display_name as child_name, p.display_name as parent_name
       FROM chores c
       LEFT JOIN users u ON u.id = c.assigned_to
       JOIN users p ON p.id = c.created_by
       WHERE c.family_id = ? AND c.assigned_to = ? AND c.archived = ?
       ORDER BY c.is_priority DESC, c.due_date ASC, c.created_at DESC`
    ).bind(family_id, effectiveChildId, archived);
  } else {
    stmt = env.DB.prepare(
      `SELECT c.*, u.display_name as child_name, p.display_name as parent_name
       FROM chores c
       LEFT JOIN users u ON u.id = c.assigned_to
       JOIN users p ON p.id = c.created_by
       WHERE c.family_id = ? AND c.archived = ?
       ORDER BY c.is_priority DESC, c.due_date ASC, c.created_at DESC`
    ).bind(family_id, archived);
  }

  const { results } = await stmt.all();

  // Lazy generation: for child requests, ensure every recurring chore has an
  // 'available' completion record for the current period.
  if (auth.role === 'child' && effectiveChildId) {
    await lazyGenerateCompletions(
      env, family_id,
      effectiveChildId,
      (results as { id: string; frequency: string }[]),
    );
  }

  return json({ chores: results });
}

// ----------------------------------------------------------------
// PATCH /api/chores/:id
// Parent edits a job.
// ----------------------------------------------------------------
export async function handleChoreUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const chore = await env.DB
    .prepare('SELECT * FROM chores WHERE id = ?')
    .bind(id)
    .first<{ family_id: string; archived: number }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);
  if (chore.archived) return error('Cannot edit an archived chore');

  const allowed = [
    'title','description','reward_amount','currency','frequency',
    'due_date','is_priority','is_flash','flash_deadline',
    'proof_required','auto_approve',
  ];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      if (key === 'reward_amount') {
        if (!Number.isInteger(body[key]) || (body[key] as number) <= 0)
          return error('reward_amount must be a positive integer');
      }
      if (key === 'currency' && !['GBP','PLN'].includes(body[key] as string))
        return error('Invalid currency');
      if (key === 'frequency' && !VALID_FREQUENCIES.includes(body[key] as string))
        return error('Invalid frequency');
      updates.push(`${key} = ?`);
      values.push(body[key] ?? null);
    }
  }

  if (updates.length === 0) return error('No valid fields to update');

  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(id);

  await env.DB
    .prepare(`UPDATE chores SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM chores WHERE id = ?').bind(id).first();
  return json(updated);
}

// ----------------------------------------------------------------
// DELETE /api/chores/:id  (soft archive)
// ----------------------------------------------------------------
export async function handleChoreArchive(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const chore = await env.DB
    .prepare('SELECT family_id FROM chores WHERE id = ?')
    .bind(id).first<{ family_id: string }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);

  await env.DB
    .prepare('UPDATE chores SET archived = 1, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), id)
    .run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /api/chores/:id/restore
// ----------------------------------------------------------------
export async function handleChoreRestore(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const chore = await env.DB
    .prepare('SELECT family_id FROM chores WHERE id = ?')
    .bind(id).first<{ family_id: string }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);

  await env.DB
    .prepare('UPDATE chores SET archived = 0, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), id)
    .run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /api/chores/:id/claim
// Child claims an open ('anyone') chore.
// Atomic: only succeeds if assigned_to is still 'anyone'.
// ----------------------------------------------------------------
export async function handleChoreClaim(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can claim chores', 403);

  const chore = await env.DB
    .prepare('SELECT id, family_id, assigned_to, archived FROM chores WHERE id = ?')
    .bind(id)
    .first<{ id: string; family_id: string; assigned_to: string; archived: number }>();

  if (!chore)                              return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id)  return error('Forbidden', 403);
  if (chore.archived)                      return error('This chore has been removed');
  if (chore.assigned_to !== 'anyone')      return error('This chore is no longer available to claim', 409);

  // Atomic UPDATE: only touches the row if assigned_to is still 'anyone'.
  // D1 executes this as a single statement so concurrent claims are safe.
  const result = await env.DB
    .prepare(`UPDATE chores SET assigned_to = ?, updated_at = ?
              WHERE id = ? AND assigned_to = 'anyone'`)
    .bind(auth.sub, Math.floor(Date.now() / 1000), id)
    .run();

  if (result.meta.changes === 0) {
    // Another child claimed it in the same moment
    return error('Someone else just claimed this task — check back for more!', 409);
  }

  const updated = await env.DB.prepare('SELECT * FROM chores WHERE id = ?').bind(id).first();
  return json(updated);
}

// ----------------------------------------------------------------
// POST /api/chores/:id/submit
// Child marks a job done.
//
// Two paths:
//   auto_approve = 1 → instant ledger write, returns status: 'completed'
//   auto_approve = 0 → creates completion record, returns status: 'awaiting_review'
//
// proof_required = 1 → proof_url must already be set on an existing
//   awaiting_review completion (uploaded via POST /api/completions/:id/proof).
//   This endpoint does NOT accept raw file data.
//
// Rate-limit: one non-needs_revision submission per chore per child per day.
// Double-dip guard: explicit status check before any write.
// Body: { note? }
// ----------------------------------------------------------------
export async function handleChoreSubmit(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can submit chores', 403);

  const body = await parseBody(request);
  const note = (body?.note && typeof body.note === 'string') ? body.note.trim() : null;

  const chore = await env.DB
    .prepare('SELECT * FROM chores WHERE id = ?')
    .bind(id)
    .first<{
      id: string; family_id: string; assigned_to: string; title: string;
      reward_amount: number; currency: string; archived: number;
      is_flash: number; flash_deadline: string | null;
      proof_required: number; auto_approve: number;
    }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);
  if (chore.assigned_to !== auth.sub) return error('This chore is not assigned to you', 403);
  if (chore.archived) return error('This chore has been archived');

  // Flash deadline check
  if (chore.is_flash && chore.flash_deadline) {
    const deadline = new Date(chore.flash_deadline).getTime();
    if (Date.now() > deadline) return error('Flash job deadline has passed', 409);
  }

  // Rate-limit: one active submission per chore per child per day
  // (needs_revision is exempt — child is resubmitting after feedback)
  const todayStart = todayEpoch();
  const existing = await env.DB
    .prepare(`SELECT id FROM completions
              WHERE chore_id = ? AND child_id = ? AND status = 'awaiting_review'
              AND submitted_at >= ? LIMIT 1`)
    .bind(id, auth.sub, todayStart)
    .first<{ id: string }>();

  if (existing) return error('Already submitted today — wait for parent review first', 409);

  // Double-dip guard: cannot submit if a completed entry exists today
  const alreadyCompleted = await env.DB
    .prepare(`SELECT id FROM completions
              WHERE chore_id = ? AND child_id = ? AND status = 'completed'
              AND submitted_at >= ? LIMIT 1`)
    .bind(id, auth.sub, todayStart)
    .first<{ id: string }>();

  if (alreadyCompleted) return error('This chore was already completed and paid today', 409);

  const now = Math.floor(Date.now() / 1000);

  // ── AUTO-APPROVE PATH ──────────────────────────────────────────
  if (chore.auto_approve) {
    const ip = clientIp(request);

    const family = await env.DB
      .prepare('SELECT verify_mode FROM families WHERE id = ?')
      .bind(chore.family_id)
      .first<{ verify_mode: string }>();
    if (!family) return error('Family not found', 404);

    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(chore.family_id)
      .first<{ id: number; record_hash: string }>();

    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
    const maxRow = await env.DB
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger')
      .first<{ max_id: number }>();
    const newLedgerId = (maxRow?.max_id ?? 0) + 1;

    const recordHash = await computeRecordHash(
      newLedgerId, chore.family_id, auth.sub,
      chore.reward_amount, chore.currency, 'credit', previousHash,
    );

    const completionId = nanoid();

    await env.DB.batch([
      // Write completion as already completed
      env.DB.prepare(`
        INSERT INTO completions
          (id, family_id, chore_id, child_id, note, status, ledger_id, submitted_at, resolved_at, resolved_by)
        VALUES (?,?,?,?,?,'completed',?,?,?,?)
      `).bind(completionId, chore.family_id, id, auth.sub, note, newLedgerId, now, now, auth.sub),

      // Write immutable ledger entry — verified_auto since trust was pre-granted
      env.DB.prepare(`
        INSERT INTO ledger
          (id, family_id, child_id, chore_id, entry_type, amount, currency,
           description, verification_status, authorised_by, verified_at, verified_by,
           previous_hash, record_hash, ip_address)
        VALUES (?,?,?,?,'credit',?,?,?,'verified_auto',?,?,?,?,?,?)
      `).bind(
        newLedgerId,
        chore.family_id, auth.sub, id,
        chore.reward_amount, chore.currency,
        `Auto-approved: ${chore.title}`,
        auth.sub, now, auth.sub,
        previousHash, recordHash, ip,
      ),
    ]);

    return json({
      id: completionId,
      chore_id: id,
      title: chore.title,
      reward_amount: chore.reward_amount,
      currency: chore.currency,
      status: 'completed',
      ledger_id: newLedgerId,
      submitted_at: now,
      auto_approved: true,
    }, 201);
  }

  // ── STANDARD PATH — create / transition to awaiting_review ───
  // Priority order:
  //   1. needs_revision record → resubmission (bump attempt_count)
  //   2. available record → lazy-gen transition (child tapped Done)
  //   3. neither → fresh INSERT

  const existingRecord = await env.DB
    .prepare(`SELECT id, status, attempt_count FROM completions
              WHERE chore_id = ? AND child_id = ? AND status IN ('needs_revision','available')
              ORDER BY submitted_at DESC LIMIT 1`)
    .bind(id, auth.sub)
    .first<{ id: string; status: string; attempt_count: number }>();

  if (existingRecord) {
    const newAttemptCount = existingRecord.status === 'needs_revision'
      ? existingRecord.attempt_count + 1
      : 1; // available → first real attempt

    await env.DB.prepare(`
      UPDATE completions
      SET status = 'awaiting_review', note = ?, parent_notes = NULL,
          attempt_count = ?, submitted_at = ?, resolved_at = NULL, resolved_by = NULL
      WHERE id = ?
    `).bind(note, newAttemptCount, now, existingRecord.id).run();

    const updated = await env.DB
      .prepare('SELECT * FROM completions WHERE id = ?')
      .bind(existingRecord.id).first();
    return json(updated, 200);
  }

  // Fresh submission — no prior record
  const completionId = nanoid();

  await env.DB.prepare(`
    INSERT INTO completions (id, family_id, chore_id, child_id, note, status, submitted_at)
    VALUES (?,?,?,?,?,'awaiting_review',?)
  `).bind(completionId, chore.family_id, id, auth.sub, note, now).run();

  return json({
    id: completionId,
    chore_id: id,
    title: chore.title,
    reward_amount: chore.reward_amount,
    currency: chore.currency,
    status: 'awaiting_review',
    submitted_at: now,
  }, 201);
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}

function todayEpoch(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Lazy generation — called when a child fetches their chore list.
 *
 * For each active recurring chore assigned to the child, checks whether an
 * 'available' or later completion exists for the current period.
 * If not, inserts a new 'available' record so the child sees the task immediately.
 *
 * Period boundaries use the UTC offset implicit in the Worker runtime.
 * Periods: daily = calendar day, weekly = Mon–Sun, monthly = calendar month.
 * 'as_needed', 'quarterly' → skipped (no recurring period).
 */
export async function lazyGenerateCompletions(
  env: Env,
  familyId: string,
  childId: string,
  chores: { id: string; frequency: string }[],
): Promise<void> {
  const now = new Date();

  // Period start timestamps (epoch seconds)
  const dayStart = Math.floor(new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
  ).getTime() / 1000);

  // ISO week: Mon = day 1
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Mon … 6=Sun
  const weekStart = Math.floor(new Date(
    now.getFullYear(), now.getMonth(), now.getDate() - dow,
  ).getTime() / 1000);

  const monthStart = Math.floor(new Date(
    now.getFullYear(), now.getMonth(), 1,
  ).getTime() / 1000);

  const SKIP = new Set(['as_needed', 'quarterly']);

  for (const chore of chores) {
    if (SKIP.has(chore.frequency)) continue;

    const periodStart =
      chore.frequency === 'daily' || chore.frequency === 'school_days' ? dayStart :
      chore.frequency === 'weekly' || chore.frequency === 'bi_weekly'  ? weekStart :
      chore.frequency === 'monthly'                                      ? monthStart :
      weekStart; // fallback

    // Check: does a non-orphan completion already exist for this period?
    const existing = await env.DB.prepare(`
      SELECT id FROM completions
      WHERE chore_id = ? AND child_id = ?
        AND status IN ('available','awaiting_review','completed','needs_revision')
        AND submitted_at >= ?
      LIMIT 1
    `).bind(chore.id, childId, periodStart).first<{ id: string }>();

    if (existing) continue; // already covered

    // Insert lazy record
    const id = nanoid();
    await env.DB.prepare(`
      INSERT INTO completions
        (id, family_id, chore_id, child_id, status, submitted_at)
      VALUES (?,?,?,?,'available',?)
    `).bind(id, familyId, chore.id, childId, Math.floor(Date.now() / 1000)).run();
  }
}
