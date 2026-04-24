// worker/src/lib/intelligence.ts
// Omni-Orchard Aggregator — builds a per-child intelligence snapshot
// for the AI Mentor at chat time. All queries are read-only.

import type { D1Database } from '@cloudflare/workers-types'
import type { ChildIntelligence, Currency, Locale, FamilyContext } from '../types.js'

const DAY_SECONDS = 86_400
const WEEK_SECONDS = 7 * DAY_SECONDS
const FORTNIGHT_SECONDS = 14 * DAY_SECONDS
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ─────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────

export async function getChildIntelligence(
  db: D1Database,
  childId: string,
): Promise<ChildIntelligence | null> {
  const now = Math.floor(Date.now() / 1000)
  const week_ago = now - WEEK_SECONDS
  const fortnight_ago = now - FORTNIGHT_SECONDS

  // Run all queries in parallel for speed
  const SIXTY_DAYS_SECONDS = 60 * DAY_SECONDS

  const [
    identity,
    balance,
    goals,
    choreStats,
    completionDays,
    velocity,
    spending,
    snapshot,
    bonus,
    parentMsg,
    planningHorizonDays,
    consecutiveLowConfidence,
    batchingDetected,
    isBurner,
    isStagnant,
    inflationNudge,
    isHoarder,
    overdueChoreCount,
    distinctIps7d,
  ] = await Promise.all([
    queryIdentity(db, childId),
    queryBalance(db, childId),
    queryGoals(db, childId),
    queryChoreStats(db, childId, week_ago),
    queryCompletionDays(db, childId, fortnight_ago),
    queryVelocity(db, childId, week_ago),
    querySpending(db, childId, week_ago),
    querySnapshot(db, childId),
    queryBonus(db, childId, week_ago),
    queryParentMessage(db, childId, now),
    queryPlanningHorizon(db, childId, now),
    queryConsecutiveLowConfidence(db, childId),
    queryBatchingDetected(db, childId, week_ago),
    queryIsBurner(db, childId),
    queryIsStagnant(db, childId, fortnight_ago, week_ago),
    queryInflationNudge(db, childId),
    queryIsHoarder(db, childId, now - SIXTY_DAYS_SECONDS),
    queryOverdueChoreCount(db, childId, now),
    queryDistinctIps7d(db, childId, week_ago),
  ])

  if (!identity) return null

  // ── Reliability Rating ──────────────────────────────────────────
  // Base: first-time-pass rate over all completed chores (lifetime)
  // Quality penalty: −5 points per needs_revision in last 7 days (max −25)
  // This accurately penalises recent quality failures without wiping
  // a long track record from a single bad week.
  const firstTimePassRate = choreStats.total_completed > 0
    ? (choreStats.first_time_pass / choreStats.total_completed) * 100
    : 0
  const qualityPenalty = Math.min(choreStats.needs_revision_7d * 5, 25)
  const reliability_rating = Math.max(0, Math.round(firstTimePassRate - qualityPenalty))

  // ── Velocity ────────────────────────────────────────────────────
  // Minor units earned over last 7 days ÷ 7 = daily rate
  const velocity_7d = Math.round(velocity.earned_7d / 7)

  // ── Sunday Scrambler detection ──────────────────────────────────
  const { is_scrambler, scrambler_day } = detectScrambler(completionDays)

  // ── Spend-to-balance ────────────────────────────────────────────
  const spend_to_balance_pct = balance > 0
    ? Math.round((spending.spent_minor_7d / balance) * 100)
    : 0

  // ── Goal enrichment ─────────────────────────────────────────────
  const enrichedGoals = goals.map(g => ({
    ...g,
    progress_pct: g.target_minor > 0
      ? Math.round((g.saved_minor / g.target_minor) * 100)
      : 0,
  }))

  return {
    child_id: childId,
    display_name: identity.display_name,
    locale: (identity.locale as Locale) ?? 'en',
    currency: (identity.currency as Currency) ?? 'GBP',
    app_view: (identity.app_view as 'ORCHARD' | 'CLEAN') ?? 'ORCHARD',
    earnings_mode: (identity.earnings_mode as 'ALLOWANCE' | 'CHORES' | 'HYBRID') ?? 'HYBRID',

    balance_minor: balance,
    goals: enrichedGoals,

    assigned_chore_count: choreStats.assigned_count,
    completed_7d: choreStats.completed_7d,
    needs_revision_7d: choreStats.needs_revision_7d,

    reliability_rating,
    velocity_7d,
    planning_horizon_days: planningHorizonDays,

    is_sunday_scrambler: is_scrambler,
    scrambler_day,

    spent_minor_7d: spending.spent_minor_7d,
    spend_to_balance_pct,

    consistency_score: snapshot?.consistency_score ?? null,
    responsibility_score: snapshot?.responsibility_score ?? null,
    last_snapshot_date: snapshot?.snapshot_date ?? null,

    bonus_pence_7d: bonus,
    has_parent_message: !!parentMsg,
    parent_message: parentMsg,

    consecutive_low_confidence: consecutiveLowConfidence,
    batching_detected: batchingDetected,

    is_burner: isBurner,
    is_stagnant: isStagnant,
    inflation_nudge: inflationNudge,
    is_hoarder: isHoarder,
    overdue_chore_count: overdueChoreCount,
    distinct_ips_7d: distinctIps7d,
  }
}

// ─────────────────────────────────────────────────────────────────
// Individual query helpers
// ─────────────────────────────────────────────────────────────────

async function queryIdentity(db: D1Database, childId: string) {
  return db
    .prepare(`
      SELECT u.display_name, u.locale, u.earnings_mode,
             f.base_currency AS currency,
             us.app_view
      FROM   users u
      JOIN   families f ON f.id = u.family_id
      LEFT JOIN user_settings us ON us.user_id = u.id
      WHERE  u.id = ?
    `)
    .bind(childId)
    .first<{
      display_name: string
      locale: string
      earnings_mode: string
      currency: string
      app_view: string | null
    }>()
}

async function queryBalance(db: D1Database, childId: string): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'credit'  THEN amount
          WHEN 'payment' THEN -amount
          ELSE 0
        END
      ), 0) AS balance
      FROM ledger
      WHERE child_id = ?
        AND verification_status IN ('verified_auto','verified_manual')
    `)
    .bind(childId)
    .first<{ balance: number }>()
  return row?.balance ?? 0
}

interface GoalRow {
  title: string
  target_minor: number
  saved_minor: number
  deadline: string | null
  parent_match_pct: number
}

async function queryGoals(db: D1Database, childId: string): Promise<GoalRow[]> {
  const result = await db
    .prepare(`
      SELECT title,
             target_amount      AS target_minor,
             current_saved_pence AS saved_minor,
             deadline,
             parent_match_pct
      FROM   goals
      WHERE  child_id = ?
        AND  status = 'ACTIVE'
      ORDER BY current_saved_pence DESC
      LIMIT 3
    `)
    .bind(childId)
    .all<GoalRow>()
  return result.results ?? []
}

interface ChoreStats {
  assigned_count: number
  total_completed: number
  first_time_pass: number
  completed_7d: number
  needs_revision_7d: number
}

async function queryChoreStats(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<ChoreStats> {
  const [assigned, completions] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS n FROM chores WHERE assigned_to = ? AND archived = 0`)
      .bind(childId)
      .first<{ n: number }>(),
    db
      .prepare(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')                             AS total_completed,
          COUNT(*) FILTER (WHERE status = 'completed' AND attempt_count = 1)       AS first_time_pass,
          COUNT(*) FILTER (WHERE status = 'completed' AND submitted_at >= ?)       AS completed_7d,
          COUNT(*) FILTER (WHERE status = 'needs_revision' AND submitted_at >= ?)  AS needs_revision_7d
        FROM completions
        WHERE child_id = ?
      `)
      .bind(week_ago, week_ago, childId)
      .first<{
        total_completed: number
        first_time_pass: number
        completed_7d: number
        needs_revision_7d: number
      }>(),
  ])
  return {
    assigned_count:    assigned?.n ?? 0,
    total_completed:   completions?.total_completed ?? 0,
    first_time_pass:   completions?.first_time_pass ?? 0,
    completed_7d:      completions?.completed_7d ?? 0,
    needs_revision_7d: completions?.needs_revision_7d ?? 0,
  }
}

// Returns weekday index (0=Mon … 6=Sun) for each completed submission
// in the last fortnight — used for Sunday Scrambler detection.
async function queryCompletionDays(
  db: D1Database,
  childId: string,
  fortnight_ago: number,
): Promise<number[]> {
  const result = await db
    .prepare(`
      SELECT CAST(strftime('%w', datetime(submitted_at, 'unixepoch')) AS INTEGER) AS dow
      FROM   completions
      WHERE  child_id = ?
        AND  status = 'completed'
        AND  submitted_at >= ?
    `)
    .bind(childId, fortnight_ago)
    .all<{ dow: number }>()
  // SQLite %w: 0=Sunday … 6=Saturday — remap to 0=Monday … 6=Sunday
  return (result.results ?? []).map(r => (r.dow + 6) % 7)
}

async function queryVelocity(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<{ earned_7d: number }> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS earned_7d
      FROM   ledger
      WHERE  child_id = ?
        AND  entry_type = 'credit'
        AND  verification_status IN ('verified_auto','verified_manual')
        AND  created_at >= ?
    `)
    .bind(childId, week_ago)
    .first<{ earned_7d: number }>()
  return { earned_7d: row?.earned_7d ?? 0 }
}

async function querySpending(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<{ spent_minor_7d: number }> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS spent_minor_7d
      FROM   spending
      WHERE  child_id = ?
        AND  spent_at >= ?
    `)
    .bind(childId, week_ago)
    .first<{ spent_minor_7d: number }>()
  return { spent_minor_7d: row?.spent_minor_7d ?? 0 }
}

async function queryPlanningHorizon(
  db: D1Database,
  childId: string,
  nowEpoch: number,
): Promise<number> {
  const row = await db
    .prepare(`
      SELECT MAX(
        CAST(
          (julianday(week_start) + day_of_week - julianday(datetime(?, 'unixepoch')))
        AS INTEGER)
      ) AS horizon_days
      FROM plans
      WHERE child_id = ?
        AND week_start >= date(datetime(?, 'unixepoch'))
    `)
    .bind(nowEpoch, childId, nowEpoch)
    .first<{ horizon_days: number | null }>()
  return row?.horizon_days ?? 0
}

interface SnapshotRow {
  consistency_score: number | null
  responsibility_score: number | null
  snapshot_date: string
}

async function querySnapshot(
  db: D1Database,
  childId: string,
): Promise<SnapshotRow | null> {
  return db
    .prepare(`
      SELECT consistency_score, responsibility_score, snapshot_date
      FROM   insight_snapshots
      WHERE  child_id = ?
      ORDER  BY snapshot_date DESC
      LIMIT  1
    `)
    .bind(childId)
    .first<SnapshotRow>()
}

async function queryBonus(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM   bonus_payments
      WHERE  child_id = ?
        AND  created_at >= ?
    `)
    .bind(childId, week_ago)
    .first<{ total: number }>()
  return row?.total ?? 0
}

async function queryParentMessage(
  db: D1Database,
  childId: string,
  nowEpoch: number,
): Promise<string | null> {
  const row = await db
    .prepare(`
      SELECT message
      FROM   parent_messages
      WHERE  to_child = ?
        AND  expires_at > ?
      ORDER  BY created_at DESC
      LIMIT  1
    `)
    .bind(childId, nowEpoch)
    .first<{ message: string }>()
  return row?.message ?? null
}

// ─────────────────────────────────────────────────────────────────
// Audit-Evidence Signals
// ─────────────────────────────────────────────────────────────────

// Returns how many consecutive recent proof uploads scored 'Low' confidence.
// We read the last 10 uploads ordered newest-first and count the leading run of 'Low'.
// Stops counting as soon as we hit a non-Low row so the trigger resets when
// the child takes a genuine live photo.
async function queryConsecutiveLowConfidence(
  db: D1Database,
  childId: string,
): Promise<number> {
  const { results } = await db
    .prepare(`
      SELECT verification_confidence
      FROM   completions
      WHERE  child_id = ?
        AND  verification_confidence IS NOT NULL
      ORDER  BY submitted_at DESC
      LIMIT  10
    `)
    .bind(childId)
    .all<{ verification_confidence: string }>()

  let count = 0
  for (const row of results ?? []) {
    if (row.verification_confidence === 'Low') count++
    else break
  }
  return count
}

// Returns true when the child completed ≥3 distinct chores within a
// 60-minute window (per EXIF DateTimeOriginal) at any point in the last 7 days.
// This detects "gallery cramming" — submitting old photos back-to-back —
// or genuine same-session batching of chores (legitimate but still worth a lesson).
//
// Strategy: parse each proof_exif JSON in SQLite, extract dateTimeOriginal,
// convert to epoch via strftime, and use a self-join to find any 60-min window
// containing ≥3 rows. We do this in application code (not SQL) to avoid
// complex window-function SQL that D1's SQLite version may not support.
async function queryBatchingDetected(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<boolean> {
  // Pull EXIF timestamps for completed uploads in last 7 days.
  // proof_exif is a JSON string: { dateTimeOriginal: "YYYY:MM:DD HH:MM:SS", ... }
  const { results } = await db
    .prepare(`
      SELECT proof_exif
      FROM   completions
      WHERE  child_id    = ?
        AND  submitted_at >= ?
        AND  proof_exif  IS NOT NULL
        AND  status IN ('awaiting_review', 'completed', 'needs_revision')
      ORDER  BY submitted_at ASC
    `)
    .bind(childId, week_ago)
    .all<{ proof_exif: string }>()

  // Parse EXIF timestamps into epoch seconds
  const epochs: number[] = []
  for (const row of results ?? []) {
    try {
      const exif = JSON.parse(row.proof_exif) as { dateTimeOriginal?: string | null }
      if (!exif.dateTimeOriginal) continue
      // EXIF format: 'YYYY:MM:DD HH:MM:SS' → ISO: 'YYYY-MM-DDTHH:MM:SSZ'
      const iso = exif.dateTimeOriginal.replace(
        /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
        '$1-$2-$3T$4:$5:$6Z',
      )
      const ms = Date.parse(iso)
      if (!isNaN(ms)) epochs.push(ms / 1000)
    } catch {
      // Malformed JSON — skip
    }
  }

  if (epochs.length < 3) return false

  epochs.sort((a, b) => a - b)

  // Sliding window: find any window of 60 minutes containing ≥3 entries
  const SIXTY_MINUTES = 3600
  for (let i = 0; i <= epochs.length - 3; i++) {
    if (epochs[i + 2] - epochs[i] <= SIXTY_MINUTES) return true
  }
  return false
}

// ─────────────────────────────────────────────────────────────────
// Behavioural Trigger Queries
// ─────────────────────────────────────────────────────────────────

// The Burner: balance dropped to 0 within 24h of a ledger credit in the last 30 days.
// Detects impulsive "spend it all" behaviour → module 04-needs-vs-wants
async function queryIsBurner(db: D1Database, childId: string): Promise<boolean> {
  const THIRTY_DAYS = 30 * 86_400
  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS
  // Single query: for each credit in the last 30 days, compute the running
  // balance at 24h after that credit. If any window-end balance reaches 0,
  // the child is spending earnings immediately (burner pattern).
  const row = await db
    .prepare(`
      WITH verified AS (
        SELECT created_at,
               entry_type,
               amount
        FROM ledger
        WHERE child_id = ?
          AND verification_status IN ('verified_auto','verified_manual')
      ),
      credits AS (
        SELECT created_at AS credit_at
        FROM verified
        WHERE entry_type = 'credit'
          AND created_at >= ?
      )
      SELECT 1 AS is_burner
      FROM credits c
      WHERE (
        SELECT COALESCE(SUM(
          CASE v.entry_type
            WHEN 'credit'  THEN v.amount
            WHEN 'payment' THEN -v.amount
            ELSE 0
          END
        ), 0)
        FROM verified v
        WHERE v.created_at <= c.credit_at + 86400
      ) <= 0
      LIMIT 1
    `)
    .bind(childId, cutoff)
    .first<{ is_burner: number }>()
  return row != null
}

// Stagnant Earner: 0 completions in last 14 days, but had >2 completions in the
// 14 days before that (i.e. prior high activity followed by silence).
// → module 18-money-and-mental-health
async function queryIsStagnant(
  db: D1Database,
  childId: string,
  fortnight_ago: number,
  week_ago: number,
): Promise<boolean> {
  // week_ago here is used as the boundary between the two fortnights
  // recent window: fortnight_ago → now (current), prior window: 4 weeks ago → fortnight_ago
  const four_weeks_ago = fortnight_ago - (14 * 86_400)
  const [recent, prior] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS n FROM completions
                WHERE child_id = ? AND status = 'completed' AND submitted_at >= ?`)
      .bind(childId, fortnight_ago)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM completions
                WHERE child_id = ? AND status = 'completed'
                  AND submitted_at >= ? AND submitted_at < ?`)
      .bind(childId, four_weeks_ago, fortnight_ago)
      .first<{ n: number }>(),
  ])
  return (recent?.n ?? 0) === 0 && (prior?.n ?? 0) > 2
}

// Inflation Nudge: a chore the child has completed before had its reward_amount increased.
// Detects by comparing the current reward_amount to the earliest completion's reward_amount
// for any chore assigned to this child. → module 14-inflation
async function queryInflationNudge(db: D1Database, childId: string): Promise<boolean> {
  // Join completions → chores to find chores where current reward > first completion reward
  // We store reward_amount on completions indirectly via the chore; use a subquery to
  // compare the chore's current reward to the earliest ledger credit amount for that chore.
  const { results } = await db
    .prepare(`
      SELECT ch.id
      FROM chores ch
      JOIN completions comp ON comp.chore_id = ch.id AND comp.child_id = ?
        AND comp.status = 'completed'
      JOIN ledger l ON l.chore_id = ch.id AND l.child_id = ?
        AND l.entry_type = 'credit'
      GROUP BY ch.id
      HAVING ch.reward_amount > MIN(l.amount)
      LIMIT 1
    `)
    .bind(childId, childId)
    .all<{ id: string }>()
  return (results?.length ?? 0) > 0
}

// The Hoarder: current balance > 10000 (£100) AND no spending in last 60 days.
// → module 13-compound-growth
async function queryIsHoarder(
  db: D1Database,
  childId: string,
  sixty_days_ago: number,
): Promise<boolean> {
  const [balRow, spendRow] = await Promise.all([
    db
      .prepare(`
        SELECT COALESCE(SUM(
          CASE entry_type WHEN 'credit' THEN amount WHEN 'payment' THEN -amount ELSE 0 END
        ), 0) AS balance
        FROM ledger
        WHERE child_id = ?
          AND verification_status IN ('verified_auto','verified_manual')
      `)
      .bind(childId)
      .first<{ balance: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM spending
                WHERE child_id = ? AND spent_at >= ?`)
      .bind(childId, sixty_days_ago)
      .first<{ n: number }>(),
  ])
  return (balRow?.balance ?? 0) > 10_000 && (spendRow?.n ?? 0) === 0
}

// The Default: number of chores with due_date before today that are not yet completed.
// Trigger fires at ≥2. → module 12-good-vs-bad-debt
async function queryOverdueChoreCount(
  db: D1Database,
  childId: string,
  nowEpoch: number,
): Promise<number> {
  // due_date is stored as a DATE string (YYYY-MM-DD) on plans, not chores.
  // We check plans for this child where the plan's due date has passed and
  // the corresponding completion is not yet in 'completed' state.
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM chores
      WHERE assigned_to = ?
        AND archived = 0
        AND due_date IS NOT NULL
        AND due_date < date(datetime(?, 'unixepoch'))
        AND id NOT IN (
          SELECT chore_id FROM completions
          WHERE child_id = ? AND status = 'completed'
        )
    `)
    .bind(childId, nowEpoch, childId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

// Device Swapper: count of distinct IP addresses from child logins in last 7 days.
// Trigger fires at ≥3. → module 05-scams-digital-safety
async function queryDistinctIps7d(
  db: D1Database,
  childId: string,
  week_ago: number,
): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COUNT(DISTINCT ip_address) AS n
      FROM child_logins
      WHERE child_id = ? AND logged_in_at >= ?
    `)
    .bind(childId, week_ago)
    .first<{ n: number }>()
  return row?.n ?? 0
}

// ─────────────────────────────────────────────────────────────────
// Sunday Scrambler detection
// ─────────────────────────────────────────────────────────────────
// If >60% of the last 14 completions cluster on one weekday, the child
// is a "scrambler" — they batch all chores on one day rather than
// distributing them. This is a planning/habit signal.

function detectScrambler(days: number[]): {
  is_scrambler: boolean
  scrambler_day: string | null
} {
  if (days.length < 4) return { is_scrambler: false, scrambler_day: null }

  const counts = new Array<number>(7).fill(0)
  for (const d of days) counts[d]++

  const maxCount = Math.max(...counts)
  const maxDay = counts.indexOf(maxCount)
  const pct = maxCount / days.length

  if (pct > 0.6) {
    return { is_scrambler: true, scrambler_day: DAYS[maxDay] }
  }
  return { is_scrambler: false, scrambler_day: null }
}

// ─────────────────────────────────────────────────────────────────
// Family Context — queried fresh on every AI call (not cached)
// ─────────────────────────────────────────────────────────────────

export async function getFamilyContext(
  db: D1Database,
  familyId: string,
): Promise<FamilyContext> {
  const THIRTY_DAYS = 30 * 86_400
  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS

  const [familyRow, parentRows, childRows, approvalRows] = await Promise.all([
    // 1. Family metadata
    db
      .prepare(`SELECT parenting_mode, name, has_shield FROM families WHERE id = ?`)
      .bind(familyId)
      .first<{ parenting_mode: string; name: string | null; has_shield: number }>(),

    // 2. Parent names (lead + co_parent roles)
    db
      .prepare(`
        SELECT u.display_name
        FROM   family_roles fr
        JOIN   users u ON u.id = fr.user_id
        WHERE  fr.family_id = ?
          AND  fr.role = 'parent'
        ORDER  BY CASE fr.parent_role WHEN 'lead' THEN 0 ELSE 1 END
      `)
      .bind(familyId)
      .all<{ display_name: string }>(),

    // 3. Child names + IDs
    db
      .prepare(`
        SELECT id, display_name FROM users
        WHERE  family_id = ? AND role = 'child'
        ORDER  BY created_at ASC
      `)
      .bind(familyId)
      .all<{ id: string; display_name: string }>(),

    // 4. Approval counts per parent in last 30d (for skew + active detection)
    db
      .prepare(`
        SELECT authorised_by, COUNT(*) AS cnt
        FROM   ledger
        WHERE  family_id = ?
          AND  entry_type = 'credit'
          AND  authorised_by IS NOT NULL
          AND  created_at >= ?
        GROUP  BY authorised_by
      `)
      .bind(familyId, cutoff)
      .all<{ authorised_by: string; cnt: number }>(),
  ])

  // ── Derive values ──────────────────────────────────────────────
  const parenting_mode = (familyRow?.parenting_mode ?? 'single') as 'single' | 'co-parenting'
  const has_shield     = Boolean(familyRow?.has_shield)
  const family_name    = familyRow?.name?.trim() || 'the family'

  const parent_names = (parentRows.results ?? [])
    .map(r => r.display_name.split(' ')[0] || '')
    .filter(Boolean)

  const childEntries = (childRows.results ?? [])
    .map(r => ({ id: r.id, name: r.display_name.split(' ')[0] || '' }))
    .filter(r => r.name)

  const child_names = childEntries.map(r => r.name)
  const child_ids   = childEntries.map(r => r.id)

  const child_count = Math.max(1, child_names.length)

  // Approval skew: % held by the single most-active parent
  const approvals = approvalRows.results ?? []
  const totalApprovals = approvals.reduce((s, r) => s + r.cnt, 0)

  let approval_skew: number | null = null
  let co_parent_active = false

  if (parenting_mode === 'co-parenting' && totalApprovals >= 5) {
    const maxApprovals = Math.max(...approvals.map(r => r.cnt))
    approval_skew = Math.round((maxApprovals / totalApprovals) * 100)
    // Both parents active = at least 2 distinct approvers with ≥1 approval each
    co_parent_active = approvals.length >= 2
  }

  return {
    parenting_mode,
    child_count,
    child_names,
    child_ids,
    parent_names,
    family_name,
    co_parent_active,
    approval_skew,
    has_shield,
  }
}
