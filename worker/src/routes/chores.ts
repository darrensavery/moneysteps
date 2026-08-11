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

import { z } from 'zod';
import { json, error, clientIp } from '../lib/response.js';
import { parseValidatedBody } from '../lib/validate.js';
import { nanoid } from '../lib/nanoid.js';
import { JwtPayload } from '../lib/jwt.js';
import { computeRecordHash, GENESIS_HASH } from '../lib/hash.js';
import { planCompletionGeneration, type ExistingCompletion } from './completionGeneration.js';
import { getJarConfig } from '../lib/jar-balance.js';
import { getStreakState, buildStreakEvent, saveStreakEvent, allScheduledChoresDone } from '../lib/streaks.js';
import { getBadgeStats, badgesToAward, insertBadges } from '../lib/badges.js';
import { evaluateOnChoreApproval, evaluatePassive } from '../lib/labTriggers.js';
import { sendPushNotification } from '../lib/push/send.js';
import { getChildPendingCount, getParentPendingCount } from '../lib/push/pendingCount.js';

type AuthedRequest = Request & { auth: JwtPayload };

const VALID_FREQUENCIES = ['daily','weekly','bi_weekly','monthly','quarterly','as_needed'];

// ----------------------------------------------------------------
// POST /api/chores
// Parent creates a job definition.
// Body: { family_id, assigned_to, title, reward_amount, currency,
//         frequency?, due_date?, description?, is_priority?, is_flash?,
//         flash_deadline?, proof_required?, auto_approve? }
// ----------------------------------------------------------------
const choreCreateSchema = z.object({
  family_id:      z.string().min(1, 'family_id required'),
  assigned_to:    z.string().min(1, 'assigned_to required'),
  title:          z.string().min(1, 'title required'),
  reward_amount:  z.number().refine(
    n => Number.isInteger(n) && n > 0,
    'reward_amount must be a positive integer (pence/groszy)',
  ),
  currency:       z.enum(['GBP', 'PLN', 'USD'], { message: 'Invalid currency' }),
  frequency:      z.string().refine(
    f => VALID_FREQUENCIES.includes(f),
    { message: `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` },
  ).optional(),
  due_date:       z.string().optional(),
  description:    z.string().optional(),
  is_priority:    z.unknown().optional(),
  is_flash:       z.unknown().optional(),
  flash_deadline: z.string().optional(),
  proof_required: z.unknown().optional(),
  auto_approve:   z.unknown().optional(),
});

export async function handleChoreCreate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const parsed = await parseValidatedBody(request, choreCreateSchema);
  if (parsed instanceof Response) return parsed;

  const {
    family_id, assigned_to, title, reward_amount, currency,
    frequency, due_date, description, is_priority, is_flash, flash_deadline,
    proof_required, auto_approve,
  } = parsed;

  if (family_id !== auth.family_id) return error('Forbidden', 403);

  // Demo guard — professionals may only add 1 test chore; demo_parents have no chore limit.
  if (auth.demo_user_type === 'professional') {
    const row = await env.DB
      .prepare('SELECT COUNT(*) as cnt FROM chores WHERE family_id = ? AND is_seed = 0')
      .bind(family_id).first<{ cnt: number }>();
    if ((row?.cnt ?? 0) >= 1) return error('Demo accounts are limited to one test chore', 403);
  }

  // proof_required and auto_approve are mutually exclusive:
  // auto_approve cannot bypass a photo-evidence requirement.
  const proofRequired = proof_required ? 1 : 0;
  const autoApprove   = auto_approve   ? 1 : 0;
  if (proofRequired && autoApprove) return error('proof_required and auto_approve are mutually exclusive');

  // 'anyone' and 'everyone' are sentinel values — skip child lookup.
  // Any other value must be a real child in this family.
  const isSentinel = assigned_to === 'anyone' || assigned_to === 'everyone';
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
    title.trim(),
    description ? description.trim() : null,
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

  // Fire-and-forget push to the assigned child — skip the 'anyone'/'everyone'
  // sentinel values, which aren't a real user id to notify.
  if (!isSentinel) {
    ctx.waitUntil(
      getChildPendingCount(env.DB, family_id, assigned_to).then(pendingCount =>
        sendPushNotification(env, assigned_to, {
          title: 'New chore',
          body: title.trim(),
          route: `/chores/${id}`,
          badgeCount: pendingCount,
        }),
      ),
    );
  }

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
  // BUG-030 fix: exclude expired flash chores so children can't claim tasks they cannot submit.
  if (assigned_to === 'anyone') {
    const { results } = await env.DB.prepare(
      `SELECT c.*, NULL as child_name, p.display_name as parent_name
       FROM chores c
       LEFT JOIN users p ON p.id = c.created_by
       WHERE c.family_id = ? AND c.assigned_to = 'anyone' AND c.archived = 0
         AND (c.is_flash = 0 OR c.flash_deadline IS NULL OR c.flash_deadline > datetime('now'))
       ORDER BY c.is_priority DESC, c.created_at DESC`
    ).bind(family_id).all();
    return json({ chores: results });
  }

  // Children can only see their own chores (or 'everyone' broadcast chores)
  const effectiveChildId = auth.role === 'child' ? auth.sub : (child_id ?? null);

  let stmt;
  if (effectiveChildId) {
    // BUG-031 fix: exclude expired flash chores from child view — child can't submit
    // them, so showing them causes confusing "deadline has passed" 409 errors.
    // Parent view (effectiveChildId=null) still returns all chores for management.
    stmt = env.DB.prepare(
      `SELECT c.*, u.display_name as child_name, p.display_name as parent_name
       FROM chores c
       LEFT JOIN users u ON u.id = c.assigned_to
       JOIN users p ON p.id = c.created_by
       WHERE c.family_id = ? AND (c.assigned_to = ? OR c.assigned_to = 'everyone') AND c.archived = ?
         AND (c.is_flash = 0 OR c.flash_deadline IS NULL OR c.flash_deadline > datetime('now'))
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
  // 'available' completion record for the current period — but only on days
  // the parent has planned for that chore (if any plans exist for it).
  if (auth.role === 'child' && effectiveChildId) {
    const d = new Date();
    const diff = (d.getDay() === 0 ? -6 : 1 - d.getDay());
    d.setDate(d.getDate() + diff);
    const monday = d.toISOString().split('T')[0];
    const { results: planRows } = await env.DB.prepare(
      `SELECT chore_id, day_of_week FROM plans
       WHERE family_id = ? AND child_id = ? AND week_start = ?`
    ).bind(family_id, effectiveChildId, monday).all<{ chore_id: string; day_of_week: number }>();

    // Build map: chore_id → Set of planned days (1=Mon…7=Sun)
    const plannedDays = new Map<string, Set<number>>();
    for (const row of planRows) {
      if (!plannedDays.has(row.chore_id)) plannedDays.set(row.chore_id, new Set());
      plannedDays.get(row.chore_id)!.add(row.day_of_week);
    }

    await lazyGenerateCompletions(
      env, family_id,
      effectiveChildId,
      (results as { id: string; frequency: string }[]),
      plannedDays,
    );
  }

  return json({ chores: results });
}

// ----------------------------------------------------------------
// PATCH /api/chores/:id
// Parent edits a job.
// ----------------------------------------------------------------
const choreUpdateSchema = z.object({
  title:          z.string().optional(),
  description:    z.string().nullable().optional(),
  reward_amount:  z.number().refine(
    n => Number.isInteger(n) && n > 0,
    'reward_amount must be a positive integer',
  ).optional(),
  currency:       z.enum(['GBP', 'PLN', 'USD'], { message: 'Invalid currency' }).optional(),
  frequency:      z.string().refine(
    f => VALID_FREQUENCIES.includes(f),
    { message: 'Invalid frequency' },
  ).optional(),
  due_date:       z.string().nullable().optional(),
  is_priority:    z.unknown().optional(),
  is_flash:       z.unknown().optional(),
  flash_deadline: z.string().nullable().optional(),
  proof_required: z.unknown().optional(),
  auto_approve:   z.unknown().optional(),
});

export async function handleChoreUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const parsed = await parseValidatedBody(request, choreUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const chore = await env.DB
    .prepare('SELECT * FROM chores WHERE id = ?')
    .bind(id)
    .first<{ family_id: string; archived: number; is_seed: number }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);
  if (chore.is_seed) return error('Seed chores cannot be edited in the demo', 403);
  if (chore.archived) return error('Cannot edit an archived chore');

  const allowed = [
    'title','description','reward_amount','currency','frequency',
    'due_date','is_priority','is_flash','flash_deadline',
    'proof_required','auto_approve',
  ];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    // Field-level validation (type/range) was already enforced by choreUpdateSchema
    // above — this loop only needs to detect presence and build the dynamic SET clause.
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(body[key] ?? null);
    }
  }

  if (updates.length === 0) return error('No valid fields to update');

  // Enforce mutual exclusion — resolve against the current DB values if only
  // one flag is being changed in this update.
  const updatingProof   = body.proof_required !== undefined;
  const updatingApprove = body.auto_approve !== undefined;
  if (updatingProof || updatingApprove) {
    const current = await env.DB
      .prepare('SELECT proof_required, auto_approve FROM chores WHERE id = ?')
      .bind(id)
      .first<{ proof_required: number; auto_approve: number }>();
    const effectiveProof   = updatingProof   ? (body.proof_required ? 1 : 0) : (current?.proof_required ?? 0);
    const effectiveApprove = updatingApprove ? (body.auto_approve   ? 1 : 0) : (current?.auto_approve   ?? 0);
    if (effectiveProof && effectiveApprove) return error('proof_required and auto_approve are mutually exclusive');
  }

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
    .prepare('SELECT family_id, is_seed FROM chores WHERE id = ?')
    .bind(id).first<{ family_id: string; is_seed: number }>();

  if (!chore) return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id) return error('Forbidden', 403);
  if (chore.is_seed) return error('Seed chores cannot be deleted in the demo', 403);

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
    .prepare('SELECT id, family_id, assigned_to, archived, is_flash, flash_deadline FROM chores WHERE id = ?')
    .bind(id)
    .first<{ id: string; family_id: string; assigned_to: string; archived: number; is_flash: number; flash_deadline: string | null }>();

  if (!chore)                              return error('Chore not found', 404);
  if (chore.family_id !== auth.family_id)  return error('Forbidden', 403);
  if (chore.archived)                      return error('This chore has been removed');
  if (chore.assigned_to !== 'anyone')      return error('This chore is no longer available to claim', 409);
  // BUG-031 secondary fix: reject claim of already-expired flash chore (e.g. stale client cache)
  if (chore.is_flash && chore.flash_deadline && new Date(chore.flash_deadline).getTime() < Date.now())
    return error('Flash job deadline has passed', 409);

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

  // BUG-022 + BUG-023 fix: insert the 'available' completion immediately so
  // getCompletions (which runs in parallel with getChores on the child dashboard)
  // sees the row without depending on lazy-gen timing. Also covers as_needed /
  // quarterly chores which lazy gen intentionally skips.
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`INSERT OR IGNORE INTO completions
              (id, family_id, chore_id, child_id, status, submitted_at)
              VALUES (?,?,?,?,'available',?)`)
    .bind(nanoid(), auth.family_id, id, auth.sub, now)
    .run();

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
const choreSubmitSchema = z.object({
  note: z.string().optional(),
});

export async function handleChoreSubmit(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can submit chores', 403);

  const parsed = await parseValidatedBody(request, choreSubmitSchema);
  if (parsed instanceof Response) return parsed;
  const note = parsed.note ? parsed.note.trim() : null;

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
  if (chore.assigned_to !== auth.sub && chore.assigned_to !== 'everyone')
    return error('This chore is not assigned to you', 403);
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
    const newLedgerId = (prevRow?.id ?? 0) + 1;

    const recordHash = await computeRecordHash(
      newLedgerId, chore.family_id, auth.sub,
      chore.reward_amount, chore.currency, 'credit', previousHash,
    );

    const completionId = nanoid();
    const disputeBefore = now + 172800;

    await env.DB.batch([
      // BUG-013 fix: consume any dangling lazy-gen 'available' or 'needs_revision' slot
      // to prevent the child from double-earning on subsequent days within the same period.
      env.DB.prepare(`DELETE FROM completions WHERE chore_id = ? AND child_id = ? AND status IN ('available','needs_revision')`)
        .bind(id, auth.sub),

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
           previous_hash, record_hash, ip_address, dispute_before)
        VALUES (?,?,?,?,'credit',?,?,?,'verified_auto',?,?,?,?,?,?,?)
      `).bind(
        newLedgerId,
        chore.family_id, auth.sub, id,
        chore.reward_amount, chore.currency,
        `Auto-approved: ${chore.title}`,
        auth.sub, now, auth.sub,
        previousHash, recordHash, ip,
        disputeBefore,
      ),
    ]);

    // BUG-010 fix: audit log (same as handleCompletionApprove)
    await env.DB.prepare(`
      INSERT INTO ledger_status_log (ledger_id, from_status, to_status, actor_id, ip_address)
      VALUES (?,?,?,?,?)
    `).bind(newLedgerId, 'pending', 'verified_auto', auth.sub, ip).run();

    // BUG-011 fix: jar allocation — non-critical, never blocks the response
    try {
      const jarCfg = await getJarConfig(env.DB, chore.family_id, auth.sub);
      if (jarCfg.enabled) {
        const saveAmt    = Math.floor(chore.reward_amount * jarCfg.save_pct / 100);
        const giveAmt    = Math.floor(chore.reward_amount * jarCfg.give_pct / 100);
        const spendFinal = chore.reward_amount - saveAmt - giveAmt;
        const allocations: [string, number][] = [
          ['spend', spendFinal], ['save', saveAmt], ['give', giveAmt],
        ];
        await env.DB.batch(
          allocations.map(([jar, amt]) =>
            env.DB.prepare(`
              INSERT INTO jar_movements (family_id,child_id,jar,delta,kind,ref_id,created_at)
              VALUES (?,?,?,?,'allocation',?,?)
            `).bind(chore.family_id, auth.sub, jar, amt, String(newLedgerId), now)
          )
        );
      }
    } catch (e) {
      console.error('[auto_approve jar allocation] non-critical failure:', e);
    }

    // BUG-012 fix: gamification — streaks, badges, lab triggers
    const pendingCelebrations: string[] = [];
    try {
      const date = new Date(now * 1000).toISOString().slice(0, 10);
      const [allDone, streakState] = await Promise.all([
        allScheduledChoresDone(env.DB, auth.sub, date),
        getStreakState(env.DB, auth.sub),
      ]);
      const streakEvent = buildStreakEvent({ allChoresDone: allDone, date, state: streakState });
      if (streakEvent) {
        await saveStreakEvent(env.DB, auth.sub, streakEvent, date);
        const { previousStreak, newStreak } = streakEvent;
        if      (newStreak === 3)  pendingCelebrations.push(`STREAK_3:${previousStreak}:${newStreak}`);
        else if (newStreak === 7)  pendingCelebrations.push(`STREAK_7:${previousStreak}:${newStreak}`);
        else if (newStreak === 14) pendingCelebrations.push(`STREAK_14:${previousStreak}:${newStreak}`);
        else if (newStreak === 30) pendingCelebrations.push(`STREAK_30:${previousStreak}:${newStreak}`);
      }
      const stats = await getBadgeStats(env.DB, auth.sub);
      const effectiveCurrentStreak = streakEvent ? streakEvent.newStreak : streakState.current_streak;
      const effectiveLongestStreak = streakEvent
        ? Math.max(streakEvent.newStreak, streakState.longest_streak)
        : streakState.longest_streak;
      const newBadges = badgesToAward({
        earnedBadgeKeys:       stats.earnedBadgeKeys,
        currentStreak:         effectiveCurrentStreak,
        longestStreak:         effectiveLongestStreak,
        totalApprovedChores:   stats.totalApprovedChores,
        totalGoalsCompleted:   stats.totalGoalsCompleted,
        totalSavedPence:       stats.totalSavedPence,
        totalLessonsCompleted: stats.totalLessonsCompleted,
        totalPayouts:          stats.totalPayouts,
      });
      if (newBadges.length > 0) {
        await insertBadges(env.DB, auth.sub, newBadges, nanoid);
        for (const key of newBadges) pendingCelebrations.push(`BADGE_${key}`);
      }
      evaluateOnChoreApproval(env.DB, auth.sub).catch(() => {});
      evaluatePassive(env.DB, auth.sub).catch(() => {});
    } catch (e) {
      console.error('[auto_approve gamification] non-critical failure:', e);
    }

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
      pending_celebrations: pendingCelebrations,
    }, 201);
  }

  // ── STANDARD PATH — create / transition to awaiting_review ───
  // Priority order:
  //   1. needs_revision record → resubmission (bump attempt_count)
  //   2. available record → lazy-gen transition (child tapped Done)
  //   3. neither → fresh INSERT

  // Fire-and-forget: notify every parent in the family that a completion is
  // ready to approve. Shared by both the resubmission and fresh-insert paths
  // below, since both land the completion in 'awaiting_review'.
  const notifyParentsAwaitingReview = (completionId: string): void => {
    ctx.waitUntil((async () => {
      const childRow = await env.DB
        .prepare('SELECT display_name FROM users WHERE id = ?')
        .bind(auth.sub)
        .first<{ display_name: string }>();
      const childName = childRow?.display_name ?? 'Your child';

      // Note: 'role' lives on family_roles, not users — users has no role column.
      const parents = await env.DB
        .prepare(`SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
                  WHERE fr.family_id = ? AND fr.role = 'parent'`)
        .bind(chore.family_id)
        .all<{ id: string }>();
      const pendingCount = await getParentPendingCount(env.DB, chore.family_id);
      await Promise.allSettled(
        (parents.results ?? []).map(p =>
          sendPushNotification(env, p.id, {
            title: 'Ready to approve',
            body: `${childName} finished ${chore.title}`,
            route: `/chores/approvals/${completionId}`,
            badgeCount: pendingCount,
          }),
        ),
      );
    })());
  };

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
    notifyParentsAwaitingReview(existingRecord.id);
    return json(updated, 200);
  }

  // Fresh submission — no prior record
  const completionId = nanoid();

  await env.DB.prepare(`
    INSERT INTO completions (id, family_id, chore_id, child_id, note, status, submitted_at)
    VALUES (?,?,?,?,?,'awaiting_review',?)
  `).bind(completionId, chore.family_id, id, auth.sub, note, now).run();

  notifyParentsAwaitingReview(completionId);

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
  plannedDays?: Map<string, Set<number>>, // chore_id → Set<1–7 (Mon–Sun)>
): Promise<void> {
  const now = new Date();

  // Today's day of week: 1=Mon … 7=Sun
  const todayDow = now.getDay() === 0 ? 7 : now.getDay();

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

  // Fortnightly (bi_weekly) period: find the start of the current 2-week block
  // anchored to a known reference Monday (Mon 5 Jan 1970 = epoch second 345600).
  const EPOCH_MONDAY = 345600;
  const WEEK_SEC     = 7 * 24 * 3600;
  const weekIndex    = Math.floor((weekStart - EPOCH_MONDAY) / WEEK_SEC);
  const biWeeklyStart = EPOCH_MONDAY + Math.floor(weekIndex / 2) * 2 * WEEK_SEC;

  const SKIP = new Set(['as_needed', 'quarterly']);
  const SCHOOL_DAYS = new Set([1, 2, 3, 4, 5]); // Mon–Fri

  // --- Determine which chores are active today and their period start ---
  type ActiveChore = { id: string; periodStart: number };
  const activeChores: ActiveChore[] = [];

  for (const chore of chores) {
    if (SKIP.has(chore.frequency)) continue;

    const parentPlan = plannedDays?.get(chore.id);
    if (parentPlan && parentPlan.size > 0) {
      if (!parentPlan.has(todayDow)) continue;
    } else {
      if (chore.frequency === 'school_days' && !SCHOOL_DAYS.has(todayDow)) continue;
    }

    const periodStart =
      chore.frequency === 'daily' || chore.frequency === 'school_days' ? dayStart :
      chore.frequency === 'weekly'                                       ? weekStart :
      chore.frequency === 'bi_weekly'                                    ? biWeeklyStart :
      chore.frequency === 'monthly'                                      ? monthStart :
      weekStart;

    activeChores.push({ id: chore.id, periodStart });
  }

  if (activeChores.length === 0) return;

  // --- Batch existence check: one query for all active chores ---
  // Fetch every OPEN ('available') row regardless of age (so we can dedupe stale
  // duplicates) plus any row acted on within the current period (so we don't
  // regenerate a task the child already submitted/completed this period).
  const earliestPeriodStart = Math.min(...activeChores.map(c => c.periodStart));
  const choreIds = activeChores.map(c => c.id);
  const placeholders = choreIds.map(() => '?').join(',');

  const { results: existingRows } = await env.DB.prepare(`
    SELECT id, chore_id, status, submitted_at FROM completions
    WHERE child_id = ?
      AND chore_id IN (${placeholders})
      AND status IN ('available','awaiting_review','completed','needs_revision')
      AND (status = 'available' OR submitted_at >= ?)
  `).bind(childId, ...choreIds, earliestPeriodStart)
    .all<ExistingCompletion>();

  const { choreIdsToInsert, completionIdsToDelete } =
    planCompletionGeneration(activeChores, existingRows);

  // --- Retire stale duplicate 'available' rows (self-heals existing data) ---
  const statements: D1PreparedStatement[] = [];
  if (completionIdsToDelete.length > 0) {
    const delPlaceholders = completionIdsToDelete.map(() => '?').join(',');
    statements.push(
      env.DB.prepare(
        `DELETE FROM completions WHERE id IN (${delPlaceholders})`,
      ).bind(...completionIdsToDelete),
    );
  }

  // --- Insert a fresh 'available' row for each uncovered chore ---
  const nowEpoch = Math.floor(Date.now() / 1000);
  for (const choreId of choreIdsToInsert) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO completions
          (id, family_id, chore_id, child_id, status, submitted_at)
        VALUES (?,?,?,?,'available',?)
      `).bind(nanoid(), familyId, choreId, childId, nowEpoch),
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}
