// worker/src/lib/intelligence.ts
// Omni-Orchard Aggregator — builds a per-child intelligence snapshot
// for the AI Mentor at chat time. All queries are read-only.

import type { D1Database } from '@cloudflare/workers-types'
import type { ChildIntelligence, Currency, Locale } from '../types.js'

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
