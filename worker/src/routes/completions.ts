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
import type { ReviewPromptState } from '../types.js';

import { z } from 'zod';
import { json, error, clientIp } from '../lib/response.js';
import { parseValidatedBody } from '../lib/validate.js';
import { evaluateEligibility } from '../lib/reviewPrompt.js';
import { writeLedgerEntry } from '../lib/hash.js';
import { JwtPayload } from '../lib/jwt.js';
import { getStreakState, buildStreakEvent, saveStreakEvent, allScheduledChoresDone } from '../lib/streaks.js';
import { getBadgeStats, badgesToAward, insertBadges } from '../lib/badges.js';
import { evaluateOnChoreApproval, evaluatePassive } from '../lib/labTriggers.js';
import { nanoid } from '../lib/nanoid.js';
import { getJarConfig } from '../lib/jar-balance.js'
import { generateChildNudge, generateOnceChildNudge } from './child-nudges.js';
import { sendPushNotification } from '../lib/push/send.js';
import { getChildPendingCount } from '../lib/push/pendingCount.js';

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

  const validStatuses = ['available', 'awaiting_review', 'completed', 'needs_revision', 'rejected'];
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
      comp.paid_out_at,
      ch.title        AS chore_title,
      ch.reward_amount,
      ch.currency,
      ch.description  AS chore_description,
      ch.proof_required,
      u.display_name  AS child_name
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    JOIN users  u  ON u.id  = comp.child_id
    WHERE comp.id IS NOT NULL AND comp.family_id = ?
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
  ctx: ExecutionContext,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can approve completions', 403);

  const ip = clientIp(request);

  const comp = await env.DB.prepare(`
    SELECT comp.*, ch.title, ch.reward_amount, ch.currency, ch.due_date
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    WHERE comp.id = ?
  `).bind(completionId)
    .first<{
      id: string; family_id: string; chore_id: string; child_id: string;
      status: string; title: string; reward_amount: number; currency: string;
      due_date: string | null; submitted_at: number;
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

  // Atomically claim the completion — the WHERE guard is what actually makes this
  // safe against two concurrent approvals (double-tap, or approve + approve-all
  // racing); the earlier status read above is just a fast, friendly rejection.
  const claim = await env.DB.prepare(`
    UPDATE completions SET status = 'completed', resolved_at = ?, resolved_by = ?
    WHERE id = ? AND status = 'awaiting_review'
  `).bind(now, auth.sub, completionId).run();
  if (claim.meta.changes === 0) {
    return error('Cannot approve — completion is no longer awaiting review', 409);
  }

  let newLedgerId: number;
  let recordHash: string;
  try {
    ({ id: newLedgerId, recordHash } = await writeLedgerEntry(
      env.DB, comp.family_id, comp.child_id, comp.reward_amount, comp.currency, 'credit',
      ({ id, previousHash, recordHash }) => env.DB.batch([
        env.DB.prepare(`
          INSERT INTO ledger
            (id, family_id, child_id, chore_id, entry_type, amount, currency,
             description, verification_status, authorised_by, verified_at, verified_by,
             previous_hash, record_hash, ip_address, dispute_before)
          VALUES (?,?,?,?,'credit',?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          id,
          comp.family_id, comp.child_id, comp.chore_id,
          comp.reward_amount, comp.currency,
          `Chore completed: ${comp.title}`,
          verificationStatus,
          auth.sub, now, auth.sub,
          previousHash, recordHash, ip,
          disputeBefore,
        ),
        env.DB.prepare(`UPDATE completions SET ledger_id = ? WHERE id = ?`).bind(id, completionId),
      ]),
    ));
  } catch (err) {
    console.error('[handleCompletionApprove] chain integrity/write failure:', err);
    return error('Ledger chain integrity failure — contact support', 500);
  }

  // Status log
  await env.DB.prepare(`
    INSERT INTO ledger_status_log
      (ledger_id, from_status, to_status, actor_id, ip_address)
    VALUES (?,?,?,?,?)
  `).bind(newLedgerId, 'pending', verificationStatus, auth.sub, ip).run();

  // Push notification — chore approved & paid. Non-critical, fire-and-forget.
  const currencySymbol = comp.currency === 'GBP' ? '£' : comp.currency === 'USD' ? '$' : 'zł';
  ctx.waitUntil(
    getChildPendingCount(env.DB, comp.family_id, comp.child_id).then(pendingCount =>
      sendPushNotification(env, comp.child_id, {
        title: `${comp.title} approved!`,
        body: `+${currencySymbol}${(comp.reward_amount / 100).toFixed(2)} added`,
        route: '/child?tab=chores',
        badgeCount: pendingCount,
      }),
    ),
  );

  // ── Jar allocation hook ────────────────────────────────────────────────────
  // Emit allocation jar_movements if the child has jars enabled.
  // Runs outside the ledger batch — non-critical, never blocks the approval.
  try {
    const jarCfg = await getJarConfig(env.DB, comp.family_id, comp.child_id);
    if (jarCfg.enabled) {
      const credit   = comp.reward_amount;
      const saveAmt  = Math.floor(credit * jarCfg.save_pct  / 100);
      const giveAmt  = Math.floor(credit * jarCfg.give_pct  / 100);
      // Remainder always goes to Spend (per spec)
      const spendFinal = credit - saveAmt - giveAmt;

      const allocations: [string, number][] = [
        ['spend', spendFinal],
        ['save',  saveAmt],
        ['give',  giveAmt],
      ];

      await env.DB.batch(
        allocations.map(([jar, amt]) =>
          env.DB.prepare(`
            INSERT INTO jar_movements (family_id,child_id,jar,delta,kind,ref_id,created_at)
            VALUES (?,?,?,?,'allocation',?,?)
          `).bind(comp.family_id, comp.child_id, jar, amt, String(newLedgerId), now)
        )
      );
    }
  } catch (e) {
    console.error('[jar allocation] non-critical failure:', e);
  }
  // ── End jar allocation hook ────────────────────────────────────────────────

  // ── Gamification hook ──────────────────────────────────────────────
  try {
    const pendingCelebrations: string[] = []
    const childId = comp.child_id
    const date = new Date(comp.submitted_at * 1000).toISOString().slice(0, 10)

    const [allDone, streakState] = await Promise.all([
      allScheduledChoresDone(env.DB, childId, date),
      getStreakState(env.DB, childId),
    ])

    const streakEvent = buildStreakEvent({ allChoresDone: allDone, date, state: streakState })
    if (streakEvent) {
      await saveStreakEvent(env.DB, childId, streakEvent, date)
      const { previousStreak, newStreak } = streakEvent
      if      (newStreak === 3)  pendingCelebrations.push(`STREAK_3:${previousStreak}:${newStreak}`)
      else if (newStreak === 7)  pendingCelebrations.push(`STREAK_7:${previousStreak}:${newStreak}`)
      else if (newStreak === 14) pendingCelebrations.push(`STREAK_14:${previousStreak}:${newStreak}`)
      else if (newStreak === 30) pendingCelebrations.push(`STREAK_30:${previousStreak}:${newStreak}`)

      // Child nudge — milestone streaks get a personalised coaching card
      if (newStreak === 3 || newStreak === 7 || newStreak === 14) {
        generateChildNudge(env.DB, childId, comp.family_id, `streak_${newStreak}`).catch(() => {})
      }
    }

    // Badge evaluation runs on every approval
    const stats = await getBadgeStats(env.DB, childId)
    const effectiveCurrentStreak = streakEvent ? streakEvent.newStreak : streakState.current_streak
    const effectiveLongestStreak = streakEvent
      ? Math.max(streakEvent.newStreak, streakState.longest_streak)
      : streakState.longest_streak
    // The completion is already marked 'completed' in the batch above, so
    // stats.totalApprovedChores already counts it — do NOT add 1 here.
    const newBadges = badgesToAward({
      earnedBadgeKeys:       stats.earnedBadgeKeys,
      currentStreak:         effectiveCurrentStreak,
      longestStreak:         effectiveLongestStreak,
      totalApprovedChores:   stats.totalApprovedChores,
      totalGoalsCompleted:   stats.totalGoalsCompleted,
      totalSavedPence:       stats.totalSavedPence,
      totalLessonsCompleted: stats.totalLessonsCompleted,
      totalPayouts:          stats.totalPayouts,
    })

    if (newBadges.length > 0) {
      await insertBadges(env.DB, childId, newBadges, nanoid)
      for (const key of newBadges) pendingCelebrations.push(`BADGE_${key}`)
    }

    // Lab triggers — fire-and-forget, non-blocking
    evaluateOnChoreApproval(env.DB, comp.child_id).catch(() => {})
    evaluatePassive(env.DB, comp.child_id).catch(() => {})

    // First-ever task completion nudge
    const firstTaskRow = await env.DB
      .prepare(`SELECT COUNT(*) AS cnt FROM completions WHERE child_id = ? AND status = 'completed'`)
      .bind(childId).first<{ cnt: number }>()
    if ((firstTaskRow?.cnt ?? 0) === 1) {
      generateChildNudge(env.DB, childId, comp.family_id, 'first_task_complete').catch(() => {})
    }

    // Cumulative earnings milestone nudges (£20 / £50 / £100)
    const lifetimeRow = await env.DB
      .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE child_id=? AND entry_type='credit' AND verification_status!='reversed'`)
      .bind(childId).first<{ total: number }>()
    const lifetimeEarnings = lifetimeRow?.total ?? 0
    if (lifetimeEarnings >= 2000)  generateOnceChildNudge(env.DB, childId, comp.family_id, 'earnings_milestone_20').catch(() => {})
    if (lifetimeEarnings >= 5000)  generateOnceChildNudge(env.DB, childId, comp.family_id, 'earnings_milestone_50').catch(() => {})
    if (lifetimeEarnings >= 10000) generateOnceChildNudge(env.DB, childId, comp.family_id, 'earnings_milestone_100').catch(() => {})

    // ── Review prompt eligibility check ───────────────────────────
    let showReviewPrompt = false
    try {
      const [rState, approvalsRow, familyRow] = await Promise.all([
        env.DB.prepare('SELECT * FROM review_prompt_state WHERE user_id = ?')
          .bind(auth.sub)
          .first<ReviewPromptState>(),
        env.DB.prepare(`SELECT COUNT(*) AS cnt FROM completions WHERE family_id = ? AND status = 'completed'`)
          .bind(comp.family_id)
          .first<{ cnt: number }>(),
        env.DB.prepare(`
          SELECT MIN(last_prompted_at) AS family_last
          FROM review_prompt_state
          WHERE family_id = ? AND user_id != ?
        `).bind(comp.family_id, auth.sub).first<{ family_last: number | null }>(),
      ])

      const approvalsCount   = (approvalsRow?.cnt ?? 0) + 1  // +1 for the one just approved
      const familyLastPrompt = familyRow?.family_last ?? null

      const verdict    = evaluateEligibility(rState ?? null, approvalsCount, familyLastPrompt, Date.now())
      showReviewPrompt = verdict.eligible
    } catch {
      // Non-critical — never block the approval response
    }
    // ── End review prompt check ────────────────────────────────────

    return json({
      ok: true,
      ledger_id:            newLedgerId,
      record_hash:          recordHash,
      verification_status:  verificationStatus,
      amount:               comp.reward_amount,
      currency:             comp.currency,
      pending_celebrations: pendingCelebrations,
      show_review_prompt:   showReviewPrompt,
    })
  } catch {
    // Gamification is non-critical — return success even if it fails
    return json({
      ok: true,
      ledger_id:            newLedgerId,
      record_hash:          recordHash,
      verification_status:  verificationStatus,
      amount:               comp.reward_amount,
      currency:             comp.currency,
      pending_celebrations: [],
      show_review_prompt:   false,
    })
  }
  // ── End gamification hook ──────────────────────────────────────────
}

// ----------------------------------------------------------------
// POST /api/completions/:id/revise
// Parent sends job back with notes (needs_revision).
// Child sees the orange badge + parent_notes in their task list.
// Body: { parent_notes? }
// ----------------------------------------------------------------
const completionReviseSchema = z.object({
  parent_notes: z.string().optional(),
});

export async function handleCompletionRevise(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can request revision', 403);

  const parsed = await parseValidatedBody(request, completionReviseSchema);
  if (parsed instanceof Response) return parsed;
  const parent_notes = parsed.parent_notes ? parsed.parent_notes.trim() : null;

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
// POST /api/completions/:id/reject
// Parent permanently rejects a submission — no payment, no resubmission.
// Body: { parent_notes? }
// ----------------------------------------------------------------
const completionRejectSchema = z.object({
  parent_notes: z.string().optional(),
});

export async function handleCompletionReject(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can reject completions', 403);

  const parsed = await parseValidatedBody(request, completionRejectSchema);
  if (parsed instanceof Response) return parsed;
  const parent_notes = parsed.parent_notes ? parsed.parent_notes.trim() : null;

  const comp = await env.DB
    .prepare('SELECT id, family_id, child_id, status FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ id: string; family_id: string; child_id: string; status: string }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);
  if (comp.status !== 'awaiting_review')
    return error(`Cannot reject — completion is '${comp.status}'`, 409);

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE completions
              SET status = 'rejected', parent_notes = ?, resolved_at = ?, resolved_by = ?
              WHERE id = ?`)
    .bind(parent_notes, now, auth.sub, completionId)
    .run();

  // Child nudge — honest feedback prompt after rejection
  generateChildNudge(env.DB, comp.child_id, comp.family_id, 'task_rejected').catch(() => {})

  ctx.waitUntil(
    getChildPendingCount(env.DB, comp.family_id, comp.child_id).then(pendingCount =>
      sendPushNotification(env, comp.child_id, {
        title: 'Needs a re-do',
        body: parent_notes ? `Tap to see the note: "${parent_notes}"` : 'Tap to check what to fix',
        route: '/child?tab=chores',
        badgeCount: pendingCount,
      }),
    ),
  );

  return json({ ok: true, parent_notes });
}

// ----------------------------------------------------------------
// POST /api/completions/:id/rate
// Child rates a completed completion. Body: { rating: 1 | -1 }
// ----------------------------------------------------------------
const completionRateSchema = z.object({
  rating: z.number().refine(
    r => r === 1 || r === -1,
    'rating must be 1 (thumbs up) or -1 (thumbs down)',
  ),
});

export async function handleCompletionRate(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can rate completions', 403);

  const parsed = await parseValidatedBody(request, completionRateSchema);
  if (parsed instanceof Response) return parsed;
  const rating = parsed.rating;

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
const approveAllSchema = z.object({
  family_id: z.string().optional(),
  child_id:  z.string().optional(),
});

export async function handleApproveAll(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can approve completions', 403);

  const parsed = await parseValidatedBody(request, approveAllSchema);
  if (parsed instanceof Response) return parsed;
  const { family_id, child_id } = parsed;
  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (!child_id) return error('child_id required');

  const { results: pending } = await env.DB.prepare(`
    SELECT comp.id AS comp_id, comp.chore_id, comp.child_id,
           comp.submitted_at,
           ch.title, ch.reward_amount, ch.currency
    FROM completions comp
    JOIN chores ch ON ch.id = comp.chore_id
    WHERE comp.family_id = ? AND comp.child_id = ? AND comp.status = 'awaiting_review'
    ORDER BY comp.submitted_at ASC
  `).bind(family_id, child_id).all<{
    comp_id: string; chore_id: string; child_id: string;
    submitted_at: number; title: string; reward_amount: number; currency: string;
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
  const disputeBefore = verificationStatus === 'verified_auto' ? now + 172800 : null;

  // Each completion is claimed atomically before its ledger entry is written, so a
  // manual /approve racing this same completion can't double-process it, and
  // writeLedgerEntry re-reads+retries the chain tip if another writer wins the race.
  const approved: typeof pending = [];
  for (const comp of pending) {
    const claim = await env.DB.prepare(`
      UPDATE completions SET status = 'completed', resolved_at = ?, resolved_by = ?
      WHERE id = ? AND status = 'awaiting_review'
    `).bind(now, auth.sub, comp.comp_id).run();
    if (claim.meta.changes === 0) continue; // already actioned by a concurrent request

    try {
      await writeLedgerEntry(
        env.DB, family_id, comp.child_id, comp.reward_amount, comp.currency, 'credit',
        ({ id, previousHash, recordHash }) => env.DB.batch([
          env.DB.prepare(`
            INSERT INTO ledger
              (id, family_id, child_id, chore_id, entry_type, amount, currency,
               description, verification_status, authorised_by, verified_at, verified_by,
               previous_hash, record_hash, ip_address, dispute_before)
            VALUES (?,?,?,?,'credit',?,?,?,?,?,?,?,?,?,?,?)
          `).bind(
            id, family_id, comp.child_id, comp.chore_id,
            comp.reward_amount, comp.currency,
            `Chore completed: ${comp.title}`,
            verificationStatus, auth.sub, now, auth.sub,
            previousHash, recordHash, ip, disputeBefore,
          ),
          env.DB.prepare(`UPDATE completions SET ledger_id = ? WHERE id = ?`).bind(id, comp.comp_id),
        ]),
      );
    } catch (err) {
      console.error('[handleApproveAll] chain integrity/write failure:', err);
      return error('Ledger chain integrity failure — contact support', 500);
    }

    approved.push(comp);
  }

  if (approved.length === 0) return json({ approved: 0 });

  // ── Gamification hook (approve-all) ───────────────────────────────
  try {
    const pendingCelebrations: string[] = []

    // Streak eval: check each unique submission date
    const uniqueDates = [...new Set(approved.map(c =>
      new Date(c.submitted_at * 1000).toISOString().slice(0, 10)
    ))]

    for (const date of uniqueDates) {
      const [allDone, streakState] = await Promise.all([
        allScheduledChoresDone(env.DB, child_id, date),
        getStreakState(env.DB, child_id),
      ])
      const streakEvent = buildStreakEvent({ allChoresDone: allDone, date, state: streakState })
      if (streakEvent) {
        await saveStreakEvent(env.DB, child_id, streakEvent, date)
        const { previousStreak, newStreak } = streakEvent
        if      (newStreak === 3)  pendingCelebrations.push(`STREAK_3:${previousStreak}:${newStreak}`)
        else if (newStreak === 7)  pendingCelebrations.push(`STREAK_7:${previousStreak}:${newStreak}`)
        else if (newStreak === 14) pendingCelebrations.push(`STREAK_14:${previousStreak}:${newStreak}`)
        else if (newStreak === 30) pendingCelebrations.push(`STREAK_30:${previousStreak}:${newStreak}`)
      }
    }

    // Badge eval for the whole batch
    const [stats, finalStreak] = await Promise.all([
      getBadgeStats(env.DB, child_id),
      getStreakState(env.DB, child_id),
    ])
    // Every pending completion was already marked 'completed' in the loop
    // above, so stats.totalApprovedChores already counts them — no offset.
    const newBadges = badgesToAward({
      earnedBadgeKeys:       stats.earnedBadgeKeys,
      currentStreak:         finalStreak.current_streak,
      longestStreak:         Math.max(finalStreak.longest_streak, finalStreak.current_streak),
      totalApprovedChores:   stats.totalApprovedChores,
      totalGoalsCompleted:   stats.totalGoalsCompleted,
      totalSavedPence:       stats.totalSavedPence,
      totalLessonsCompleted: stats.totalLessonsCompleted,
      totalPayouts:          stats.totalPayouts,
    })
    if (newBadges.length > 0) {
      await insertBadges(env.DB, child_id, newBadges, nanoid)
      for (const key of newBadges) pendingCelebrations.push(`BADGE_${key}`)
    }

    return json({ approved: approved.length, pending_celebrations: pendingCelebrations })
  } catch {
    return json({ approved: approved.length, pending_celebrations: [] })
  }
  // ── End gamification hook (approve-all) ───────────────────────────
}
