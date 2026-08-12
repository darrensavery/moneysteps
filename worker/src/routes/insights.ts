/**
 * Insights route — worker-side SQL aggregates for parent behavioural dashboard.
 *
 * GET /api/insights?family_id=&child_id=&period=week|month|all
 *
 * Returns:
 *   isDiscoveryPhase        — true when < 3 completed tasks or < 7 days of history
 *   first_time_pass_rate    — % approved on first attempt (0–100 | null)
 *   consistency_score       — stability of weekly task volume over 28 days (0–100 | null)
 *   effort_preference       — 'high_yield' | 'steady' | null
 *   planning_horizon        — % of earned value locked in goals vs available (0–100 | null)
 *   savings_consistency     — % of (spent+saved) that went to goals (0–100 | null)
 *   tasks_completed         — total completed in period
 *   tasks_revised           — needed at least one revision
 *   total_earned_pence      — sum of ledger credits in period
 *   total_spent_pence       — sum of spending records in period
 *   total_saved_pence       — sum of goal contributions in period
 *   available_balance_pence — child's current spendable balance
 *   lifetime_earned_pence   — all-time ledger credits
 *   goals_locked_pence      — sum of (target - saved) across active goals
 */

import { Env, FamilyContext } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';
import { captureAiGeneration } from '../lib/posthog.js';
import { getFamilyContext } from '../lib/intelligence.js';
import { computeJarSignals, JarSignals } from '../lib/jar-balance.js';
import { getAvailableBalancePence } from '../lib/ledgerBalance.js';
import {
  buildSetupSignature, getOutstandingCandidates, buildRuleBasedDiscoveryBriefing,
  type DiscoverySetupFacts, type DiscoveryCandidateKey, type DiscoveryBriefingContent,
} from '../lib/discoveryBriefing.js';

type AuthedRequest = Request & { auth: JwtPayload };

export function computeLearningLabEnabled(
  row: { has_ai_mentor: number | null; has_shield: number | null } | null,
): boolean {
  return Boolean(row?.has_ai_mentor) || Boolean(row?.has_shield);
}

// ----------------------------------------------------------------
// GET /api/insights
// ----------------------------------------------------------------
export async function handleInsights(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);

  const family_id = url.searchParams.get('family_id');
  const child_id  = url.searchParams.get('child_id');
  // Demo family always uses all-time data so the account never shows zeros
  const isDemo    = family_id === 'demo-family-thomson';
  const period    = isDemo ? 'all' : (url.searchParams.get('period') ?? 'week');

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const effectiveChildId = auth.role === 'child' ? auth.sub : child_id;
  if (!effectiveChildId) return error('child_id required');
  if (auth.role === 'child' && effectiveChildId !== auth.sub) return error('Forbidden', 403);

  const periodStart = getPeriodStart(period);
  const now         = Math.floor(Date.now() / 1000);

  // Family context — queried fresh, not cached
  const familyCtx = await getFamilyContext(env.DB, family_id).catch((): FamilyContext => ({
    parenting_mode:   'single',
    child_count:      1,
    child_names:      [],
    child_ids:        [],
    parent_names:     [],
    family_name:      'the family',
    co_parent_active: false,
    approval_skew:    null,
    has_shield:       false,
  }));

  // ── 1. First-Time Pass Rate ───────────────────────────────────────────────
  const passRateRow = await env.DB.prepare(`
    SELECT
      COUNT(*)                                            AS total_completed,
      SUM(CASE WHEN attempt_count = 1 THEN 1 ELSE 0 END) AS first_time_passes,
      MIN(resolved_at)                                    AS earliest_resolved
    FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
      AND (? = 0 OR resolved_at >= ?)
  `).bind(family_id, effectiveChildId, periodStart, periodStart)
    .first<{ total_completed: number; first_time_passes: number; earliest_resolved: number | null }>();

  const totalCompleted    = passRateRow?.total_completed  ?? 0;
  const firstTimePasses   = passRateRow?.first_time_passes ?? 0;
  const tasksRevised      = totalCompleted - firstTimePasses;

  const firstTimePassRate = totalCompleted > 0
    ? Math.round((firstTimePasses / totalCompleted) * 100)
    : null;

  // ── 2. Discovery Phase Flag ───────────────────────────────────────────────
  // < 3 completed tasks all-time OR < 7 days since first ever completion.
  // Uses all-time MIN(resolved_at), not period-filtered, so weekly view
  // correctly exits discovery phase after 7 days of history.
  const allTimeRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total, MIN(resolved_at) AS first_resolved FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
  `).bind(family_id, effectiveChildId)
    .first<{ total: number; first_resolved: number | null }>();

  const allTimeCompleted  = allTimeRow?.total ?? 0;
  const firstEverResolved = allTimeRow?.first_resolved ?? null;
  const daysSinceFirst    = firstEverResolved ? (now - firstEverResolved) / 86400 : 0;
  const isDiscoveryPhase  = allTimeCompleted < 3 || daysSinceFirst < 7;

  // ── 3. Consistency Score (28-day weekly volume stability) ─────────────────
  // Group completed tasks into 4 weekly buckets (last 28 days).
  // Score = 100 - (coefficient_of_variation * 100), clamped 0–100.
  // CoV = stddev / mean. If mean = 0, score = 0.
  const twentyEightDaysAgo = now - 28 * 86400;

  const weeklyRows = await env.DB.prepare(`
    SELECT
      CAST((resolved_at - ?) / (7 * 86400) AS INTEGER) AS week_bucket,
      COUNT(*) AS cnt
    FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
      AND resolved_at >= ?
    GROUP BY week_bucket
  `).bind(twentyEightDaysAgo, family_id, effectiveChildId, twentyEightDaysAgo)
    .all<{ week_bucket: number; cnt: number }>();

  let consistencyScore: number | null = null;
  if (!isDiscoveryPhase) {
    // Fill all 4 buckets (0–3), defaulting missing weeks to 0
    const buckets = [0, 0, 0, 0];
    for (const row of weeklyRows.results) {
      const idx = Math.min(3, Math.max(0, row.week_bucket));
      buckets[idx] = row.cnt;
    }
    const mean = buckets.reduce((s, v) => s + v, 0) / 4;
    if (mean === 0) {
      consistencyScore = 0;
    } else {
      const variance = buckets.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / 4;
      const stddev   = Math.sqrt(variance);
      const cov      = stddev / mean; // 0 = perfectly consistent, higher = more volatile
      consistencyScore = Math.max(0, Math.min(100, Math.round((1 - cov) * 100)));
    }
  }

  // ── 4. Effort Preference ─────────────────────────────────────────────────
  // Compare child's avg reward vs family avg using the chores table.
  // Requires ≥ 3 completions.
  let effortPreference: 'high_yield' | 'steady' | null = null;
  if (allTimeCompleted >= 3) {
    const [childAvgRow, familyAvgRow] = await Promise.all([
      env.DB.prepare(`
        SELECT AVG(ch.reward_amount) AS avg_reward
        FROM completions c JOIN chores ch ON ch.id = c.chore_id
        WHERE c.family_id = ? AND c.child_id = ? AND c.status = 'completed'
      `).bind(family_id, effectiveChildId)
        .first<{ avg_reward: number | null }>()
        .catch(() => ({ avg_reward: null })),
      env.DB.prepare(`
        SELECT AVG(ch.reward_amount) AS avg_reward
        FROM completions c JOIN chores ch ON ch.id = c.chore_id
        WHERE c.family_id = ? AND c.status = 'completed'
      `).bind(family_id)
        .first<{ avg_reward: number | null }>()
        .catch(() => ({ avg_reward: null })),
    ]);

    const childAvg  = childAvgRow?.avg_reward  ?? 0;
    const familyAvg = familyAvgRow?.avg_reward ?? 0;

    if (familyAvg > 0) {
      effortPreference = childAvg >= familyAvg * 1.1 ? 'high_yield' : 'steady';
    } else if (childAvg > 0) {
      effortPreference = 'steady';
    }
  }

  // ── 5. Financial Metrics ─────────────────────────────────────────────────
  const [earnedRow, spentRow, savedRow, lifetimeRow, goalsRow] = await Promise.all([
    env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM ledger
      WHERE family_id = ? AND child_id = ? AND entry_type = 'credit'
        AND (? = 0 OR created_at >= ?)
    `).bind(family_id, effectiveChildId, periodStart, periodStart)
      .first<{ total: number }>(),

    env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM spending
      WHERE family_id = ? AND child_id = ?
        AND (? = 0 OR spent_at >= ?)
    `).bind(family_id, effectiveChildId, periodStart, periodStart)
      .first<{ total: number }>(),

    env.DB.prepare(`
      SELECT COALESCE(SUM(amount_pence), 0) AS total FROM goal_contributions
      WHERE family_id = ? AND child_id = ?
        AND (? = 0 OR contributed_at >= ?)
    `).bind(family_id, effectiveChildId, periodStart, periodStart)
      .first<{ total: number }>()
      .catch(() => ({ total: 0 })),

    // Lifetime earned
    env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM ledger
      WHERE family_id = ? AND child_id = ? AND entry_type = 'credit'
    `).bind(family_id, effectiveChildId)
      .first<{ total: number }>(),

    // Goals locked = sum of (target - current_saved) for active, non-archived goals
    env.DB.prepare(`
      SELECT COALESCE(SUM(target_amount - current_saved_pence), 0) AS locked
      FROM goals
      WHERE family_id = ? AND child_id = ? AND archived = 0
        AND target_amount > current_saved_pence
    `).bind(family_id, effectiveChildId)
      .first<{ locked: number }>()
      .catch(() => ({ locked: 0 })),
  ]);

  const totalEarned   = earnedRow?.total     ?? 0;
  const totalSpent    = spentRow?.total      ?? 0;
  const totalSaved    = savedRow?.total      ?? 0;
  const availableBal  = await getAvailableBalancePence(env.DB, family_id, effectiveChildId);
  const lifetimeEarned = lifetimeRow?.total  ?? 0;
  const goalsLocked   = goalsRow?.locked     ?? 0;

  const savingsConsistency = (totalSpent + totalSaved) > 0
    ? Math.round((totalSaved / (totalSpent + totalSaved)) * 100)
    : null;

  // ── 6. Planning Horizon ───────────────────────────────────────────────────
  // % of (available + goals_locked) that is locked in goals.
  // Measures whether child is a planner or a spender.
  let planningHorizon: number | null = null;
  if (!isDiscoveryPhase) {
    const totalHeld = availableBal + goalsLocked;
    planningHorizon = totalHeld > 0
      ? Math.max(0, Math.min(100, Math.round((goalsLocked / totalHeld) * 100)))
      : 0;
  }

  // ── 7. Snapshot & Trend Calculation ──────────────────────────────────────
  // Fetch the most recent prior snapshot (at least 6 days old).
  const sixDaysAgo = now - 6 * 86400;

  const priorSnapshot = await env.DB.prepare(`
    SELECT consistency_score, responsibility_score, planning_horizon, total_earned_pence
    FROM insight_snapshots
    WHERE child_id = ? AND created_at <= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(effectiveChildId, sixDaysAgo)
    .first<{
      consistency_score:    number | null;
      responsibility_score: number | null;
      planning_horizon:     number | null;
      total_earned_pence:   number;
    }>();

  // Jar signals for this week
  const jarSignals = await computeJarSignals(env.DB, effectiveChildId, family_id, now).catch(() => null);

  // weeks_at_current_deviation and positive_streak_weeks from snapshot history
  let weeksAtCurrentDeviation = 0;
  let positiveStreakWeeks = 0;
  if (jarSignals) {
    const snapHistory = await env.DB
      .prepare(`SELECT jar_snapshot FROM insight_snapshots WHERE child_id=? AND snapshot_date!=? ORDER BY snapshot_date DESC LIMIT 8`)
      .bind(effectiveChildId, getIsoWeekKey(new Date()))
      .all<{ jar_snapshot: string | null }>();

    for (const snap of snapHistory.results) {
      if (!snap.jar_snapshot) break;
      const prev = JSON.parse(snap.jar_snapshot) as { deviation_score?: number };
      if ((prev.deviation_score ?? 100) > 25) weeksAtCurrentDeviation++;
      else break;
    }
    for (const snap of snapHistory.results) {
      if (!snap.jar_snapshot) break;
      const prev = JSON.parse(snap.jar_snapshot) as { deviation_score?: number };
      if ((prev.deviation_score ?? 100) <= 25) positiveStreakWeeks++;
      else break;
    }
    jarSignals.weeks_at_current_deviation = weeksAtCurrentDeviation;
    jarSignals.positive_streak_weeks = positiveStreakWeeks;
  }

  // Upsert today's snapshot if none exists for the current ISO week.
  const weekKey = getIsoWeekKey(new Date()); // e.g. '2026-W15'

  // Only write a snapshot once per ISO week — avoid a D1 write on every read request.
  // The SELECT is cheap; the INSERT only fires on the first load of the week.
  const snapshotExists = await env.DB
    .prepare('SELECT 1 FROM insight_snapshots WHERE child_id = ? AND snapshot_date = ?')
    .bind(effectiveChildId, weekKey)
    .first();

  if (!snapshotExists) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO insight_snapshots
        (child_id, family_id, snapshot_date, consistency_score, responsibility_score,
         planning_horizon, total_earned_pence, jar_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      effectiveChildId,
      family_id,
      weekKey,
      consistencyScore,
      firstTimePassRate,
      planningHorizon,
      lifetimeEarned,
      jarSignals ? JSON.stringify(jarSignals) : null,
    ).run();
  }

  // Build trends object.
  const trends = buildTrends(
    { consistency: consistencyScore, responsibility: firstTimePassRate, horizon: planningHorizon },
    priorSnapshot
      ? { consistency: priorSnapshot.consistency_score, responsibility: priorSnapshot.responsibility_score, horizon: priorSnapshot.planning_horizon }
      : null,
  );

  // ── 8. Velocity Context (view_mode-aware) & Locale ──────────────────────
  const [settingsRow, userRow] = await Promise.all([
    env.DB.prepare(`SELECT teen_mode FROM user_settings WHERE user_id = ?`)
      .bind(effectiveChildId).first<{ teen_mode: number }>().catch(() => null),
    env.DB.prepare(
      `SELECT u.locale, u.display_name FROM users u
       JOIN family_roles fr ON fr.user_id = u.id
       WHERE u.id = ? AND fr.family_id = ?`,
    ).bind(effectiveChildId, family_id).first<{ locale: string; display_name: string }>().catch(() => null),
  ]);

  const isTeenMode  = (settingsRow?.teen_mode ?? 0) === 1;
  const locale      = (userRow?.locale ?? 'en') as 'en' | 'pl';
  // First name only — used for formal Polish address and child-friendly nudges
  const childName   = (userRow?.display_name ?? '').split(' ')[0] || 'there';
  const honorific   = locale === 'pl' && isTeenMode
    ? getPolishHonorific(childName)
    : '';

  // Weeks of history (min 1 to avoid division by zero)
  // firstEverResolved is already fetched in the allTimeRow query above
  const oldestEpoch    = firstEverResolved ?? now;
  const weeksOfHistory = Math.max(1, (now - oldestEpoch) / (7 * 86400));

  const velocityContext = isTeenMode
    ? {
        mode:                   'professional' as const,
        avg_earned_pence_week:  Math.round(lifetimeEarned / weeksOfHistory),
      }
    : {
        mode:                   'seedling' as const,
        avg_tasks_per_week:     Math.round(allTimeCompleted / weeksOfHistory),
      };

  // ── 8b. Discovery Briefing (Discovery Phase only) ────────────────────────
  let discoveryBriefing: (DiscoveryBriefingContent & { source: 'ai' | 'rule_based' }) | null = null;

  if (isDiscoveryPhase) {
    const [choreRow, proofRow, goalRow] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS cnt FROM chores WHERE assigned_to = ?`)
        .bind(effectiveChildId).first<{ cnt: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS cnt FROM chores WHERE assigned_to = ? AND proof_required = 1`)
        .bind(effectiveChildId).first<{ cnt: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS cnt FROM goals WHERE child_id = ? AND archived = 0`)
        .bind(effectiveChildId).first<{ cnt: number }>(),
    ]);

    const setupFacts: DiscoverySetupFacts = {
      chore_count:              choreRow?.cnt ?? 0,
      has_proof_required_chore: (proofRow?.cnt ?? 0) > 0,
      has_active_goal:          (goalRow?.cnt ?? 0) > 0,
    };
    const signature = buildSetupSignature(setupFacts);

    const cachedDiscovery = await env.DB.prepare(`
      SELECT setup_signature, intro, actions, source FROM discovery_briefings WHERE child_id = ?
    `).bind(effectiveChildId)
      .first<{ setup_signature: string; intro: string; actions: string; source: 'ai' | 'rule_based' }>();

    if (cachedDiscovery && cachedDiscovery.setup_signature === signature) {
      discoveryBriefing = {
        intro:   cachedDiscovery.intro,
        actions: JSON.parse(cachedDiscovery.actions) as string[],
        source:  cachedDiscovery.source,
      };
    } else {
      const outstanding = getOutstandingCandidates(setupFacts);
      const generated    = await generateDiscoveryBriefing(env, effectiveChildId, childName, outstanding);

      await env.DB.prepare(`
        INSERT INTO discovery_briefings (child_id, family_id, setup_signature, intro, actions, source)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(child_id) DO UPDATE SET
          family_id       = excluded.family_id,
          setup_signature = excluded.setup_signature,
          intro           = excluded.intro,
          actions         = excluded.actions,
          source          = excluded.source,
          created_at      = unixepoch()
      `).bind(
        effectiveChildId, family_id, signature,
        generated.intro, JSON.stringify(generated.actions), generated.source,
      ).run();

      discoveryBriefing = generated;
    }
  }

  // ── 9. Orchard Lead Mentor Briefing (AI, cached per week) ────────────────
  let mentorBriefing: MentorBriefing | null = null;

  if (!isDiscoveryPhase) {
    const snapshotRow = await env.DB.prepare(`
      SELECT id, observation, behavioral_root, the_nudge
      FROM insight_snapshots
      WHERE child_id = ? AND snapshot_date = ?
    `).bind(effectiveChildId, weekKey)
      .first<{ id: number; observation: string | null; behavioral_root: string | null; the_nudge: string | null }>();

    if (snapshotRow?.observation) {
      // Cache hit — return stored briefing immediately.
      mentorBriefing = {
        observation:      snapshotRow.observation,
        behavioral_root:  snapshotRow.behavioral_root!,
        the_nudge:        snapshotRow.the_nudge!,
        source:           'cache',
      };
    } else if (snapshotRow) {
      // Cache miss — run AI inference with 5-second timeout.
      mentorBriefing = await generateBriefing(env, effectiveChildId, {
        consistencyScore,
        firstTimePassRate,
        planningHorizon,
        trends,
        velocityContext,
        effortPreference,
        availableBalancePence: Math.max(0, availableBal),
        goalsLockedPence:      goalsLocked,
        locale,
        childName,
        honorific,
        familyCtx,
        familyId: family_id,
        jarSignals,
        weeksOfHistory,
      });

      // Persist to D1 so the next call within this week is instant.
      await env.DB.prepare(`
        UPDATE insight_snapshots
        SET observation = ?, behavioral_root = ?, the_nudge = ?
        WHERE id = ?
      `).bind(
        mentorBriefing.observation,
        mentorBriefing.behavioral_root,
        mentorBriefing.the_nudge,
        snapshotRow.id,
      ).run();
    }
  }

  // ── 10. Sparkline point arrays ────────────────────────────────────────────
  // Use all-time window so charts always show real historical trend data even
  // when recent activity is sparse. 28 buckets evenly distributed across
  // the full history gives a smooth, meaningful curve.
  const sparklinePoints = isDiscoveryPhase ? null : await buildSparklinePoints(
    env.DB, family_id, effectiveChildId, 'all', 28,
  );

  // ── 11. Learning Lab data ─────────────────────────────────────────────────
  const licenceRow = await env.DB.prepare(`
    SELECT has_ai_mentor, has_shield FROM families WHERE id = ?
  `).bind(family_id).first<{ has_ai_mentor: number | null; has_shield: number | null }>().catch(() => null);

  const learningLabEnabled = computeLearningLabEnabled(licenceRow);

  let currentModule: { slug: string; title: string; progress_pct: number; pillar: string } | null = null;
  let completedModuleSlugs: string[] = [];
  let retentionScore: number | null = null;
  const milestoneMarkers: { metric: 'responsibility'|'consistency'|'savings'; point_index: number; module_title: string; delta_after: number }[] = [];

  // Per-module act progress (Hook/Lesson/Lab/Quiz) populated from module_act_progress
  type LabModuleProgress = {
    slug:           string;
    title:          string;
    pillar:         string;
    level:          number;
    unlocked_at:    number;
    completed_acts: number[];   // e.g. [1, 2]
    total_minutes:  number;
    minutes_done:   number;
  };
  let labModuleProgress: LabModuleProgress[] = [];
  let labActsCompleted         = 0;
  let labTimeInvestedMinutes   = 0;
  let labLastActiveAt: number | null = null;

  // Static lookups for M-series module metadata (mirrors labCatalogue.ts)
  const M_META: Record<string, { title: string; pillar: string; level: number; actMins: [number,number,number,number] }> = {
    'M2':   { title: 'Taxes & Net Pay',              pillar: 'LABOR_VALUE',       level: 2, actMins: [2,5,7,4]   },
    'M3':   { title: 'Entrepreneurship',             pillar: 'LABOR_VALUE',       level: 3, actMins: [2,7,8,3]   },
    'M3b':  { title: 'Gig Trap vs Salary Safety',    pillar: 'LABOR_VALUE',       level: 3, actMins: [2,6,8,3]   },
    'M5':   { title: 'Scams & Digital Safety',       pillar: 'SPENDING_CHOICES',  level: 2, actMins: [1,4,5,4]   },
    'M6':   { title: 'Advertising & Influence',      pillar: 'SPENDING_CHOICES',  level: 3, actMins: [1,5,6,4]   },
    'M8':   { title: 'Banking 101',                  pillar: 'SAVING_GROWTH',     level: 2, actMins: [2,5,6,3]   },
    'M9':   { title: 'Opportunity Cost',             pillar: 'SAVING_GROWTH',     level: 3, actMins: [2,6,7,3]   },
    'M9b':  { title: 'The Snowball',                 pillar: 'SAVING_GROWTH',     level: 2, actMins: [2,6,10,4]  },
    'M10':  { title: 'The Interest Trap',            pillar: 'BORROWING_DEBT',    level: 2, actMins: [2,5,7,3]   },
    'M11':  { title: 'Credit Scores & Trust',        pillar: 'BORROWING_DEBT',    level: 3, actMins: [2,5,7,3]   },
    'M12':  { title: 'Good vs Bad Debt',             pillar: 'BORROWING_DEBT',    level: 3, actMins: [2,7,8,4]   },
    'M13':  { title: 'Stocks & Shares',              pillar: 'INVESTING_FUTURE',  level: 4, actMins: [2,8,10,5]  },
    'M14':  { title: 'Inflation',                    pillar: 'INVESTING_FUTURE',  level: 2, actMins: [1,5,6,3]   },
    'M15':  { title: 'Risk & Diversification',       pillar: 'INVESTING_FUTURE',  level: 4, actMins: [2,7,10,4]  },
    'M16':  { title: 'Insurance & Protection',       pillar: 'INVESTING_FUTURE',  level: 3, actMins: [2,6,6,4]   },
    'M17':  { title: 'Digital vs Physical Currency', pillar: 'SOCIETY_WELLBEING', level: 2, actMins: [1,4,5,3]   },
    'M18':  { title: 'Money & Mental Health',        pillar: 'SOCIETY_WELLBEING', level: 3, actMins: [1,5,5,4]   },
    'M18b': { title: 'Social Comparison',            pillar: 'SOCIETY_WELLBEING', level: 3, actMins: [1,4,6,3]   },
    'M19':  { title: 'Pensions & The Long Game',     pillar: 'INVESTING_FUTURE',  level: 4, actMins: [2,7,10,4]  },
    'M20':  { title: 'Gambling & Loot Boxes',        pillar: 'SOCIETY_WELLBEING', level: 3, actMins: [2,6,7,4]   },
    'M21':  { title: 'Consumer Rights & Contracts',  pillar: 'SPENDING_CHOICES',  level: 3, actMins: [2,6,6,4]   },
  };

  // Legacy slug→M mapping (old chat-based unlocks)
  const LEGACY_TO_M: Record<string, string> = {
    'taxes-net-pay':               'M2',
    'entrepreneurship':            'M3',
    'gig-trap-vs-salary':          'M3b',
    'scams-digital-safety':        'M5',
    'advertising-influence':       'M6',
    'banking-101':                 'M8',
    'opportunity-cost':            'M9',
    'the-snowball':                'M9b',
    'compound-interest':           'M9b',  // very old slug
    'the-interest-trap':           'M10',
    'credit-scores-trust':         'M11',
    'good-vs-bad-debt':            'M12',
    'compound-growth':             'M13',
    'inflation':                   'M14',
    'risk-and-diversification':    'M15',
    'digital-vs-physical-currency':'M17',
    'money-and-mental-health':     'M18',
    'social-comparison':           'M18b',
  };

  if (learningLabEnabled) {
    // Fetch unlocked modules + act progress in parallel
    const [modRows, actRows] = await Promise.all([
      env.DB.prepare(
        `SELECT module_slug, unlocked_at FROM unlocked_modules WHERE child_id = ? ORDER BY unlocked_at ASC`
      ).bind(effectiveChildId).all<{ module_slug: string; unlocked_at: number }>().catch(() => ({ results: [] })),

      env.DB.prepare(
        `SELECT module_slug, act_num, completed_at FROM module_act_progress WHERE child_id = ? ORDER BY completed_at ASC`
      ).bind(effectiveChildId).all<{ module_slug: string; act_num: number; completed_at: number }>().catch(() => ({ results: [] })),
    ]);

    // Build act-progress map (M-series slugs)
    const actMap = new Map<string, { acts: number[]; lastAt: number }>();
    for (const row of actRows.results) {
      // Normalise legacy slugs
      const slug = LEGACY_TO_M[row.module_slug] ?? row.module_slug;
      const existing = actMap.get(slug) ?? { acts: [], lastAt: 0 };
      if (!existing.acts.includes(row.act_num)) existing.acts.push(row.act_num);
      if (row.completed_at > existing.lastAt) existing.lastAt = row.completed_at;
      actMap.set(slug, existing);
      if (row.completed_at > (labLastActiveAt ?? 0)) labLastActiveAt = row.completed_at;
    }

    // Build enriched module list
    for (const row of modRows.results) {
      const mSlug = LEGACY_TO_M[row.module_slug] ?? row.module_slug;
      const meta  = M_META[mSlug];
      if (!meta) continue;  // unknown/Phase-2 module

      const actData     = actMap.get(mSlug) ?? { acts: [], lastAt: 0 };
      const totalMins   = meta.actMins.reduce((s, m) => s + m, 0);
      const minutesDone = actData.acts.reduce((s, actNum) => s + (meta.actMins[actNum - 1] ?? 0), 0);

      labModuleProgress.push({
        slug:           mSlug,
        title:          meta.title,
        pillar:         meta.pillar,
        level:          meta.level,
        unlocked_at:    row.unlocked_at,
        completed_acts: actData.acts,
        total_minutes:  totalMins,
        minutes_done:   minutesDone,
      });

      labActsCompleted       += actData.acts.length;
      labTimeInvestedMinutes += minutesDone;
    }

    // completed_module_slugs: M-series slugs where all 4 acts are done
    completedModuleSlugs = labModuleProgress
      .filter(m => m.completed_acts.length === 4)
      .map(m => m.slug);

    // current_module: most recently active with incomplete acts
    const inProgress = labModuleProgress
      .filter(m => m.completed_acts.length > 0 && m.completed_acts.length < 4)
      .sort((a, b) => (actMap.get(b.slug)?.lastAt ?? 0) - (actMap.get(a.slug)?.lastAt ?? 0));

    if (inProgress.length > 0) {
      const cm = inProgress[0];
      currentModule = {
        slug:         cm.slug,
        title:        cm.title,
        progress_pct: Math.round((cm.completed_acts.length / 4) * 100),
        pillar:       cm.pillar,
      };
    }

    // Retention score: quiz acts completed / quiz acts possible
    // Act 4 = quiz. Count how many modules have act 4 done vs total unlocked.
    const modulesWithQuizUnlocked = labModuleProgress.filter(m => m.completed_acts.length >= 3).length;
    const modulesWithQuizDone     = labModuleProgress.filter(m => m.completed_acts.includes(4)).length;
    retentionScore = modulesWithQuizUnlocked > 0
      ? Math.round((modulesWithQuizDone / modulesWithQuizUnlocked) * 100)
      : null;

    // Milestone markers — map unlock dates onto sparkline buckets
    if (sparklinePoints && modRows.results.length > 0) {
      const sparklineCount = 28;
      const now2           = Math.floor(Date.now() / 1000);
      const periodSecs2    = Math.max(30 * 86400, now2 - oldestEpoch);
      const sparklineStart = now2 - periodSecs2;
      const bucketDuration = periodSecs2 / sparklineCount;

      for (const mod of modRows.results) {
        if (mod.unlocked_at < sparklineStart) continue;
        const mSlug = LEGACY_TO_M[mod.module_slug] ?? mod.module_slug;
        const meta  = M_META[mSlug];
        if (!meta) continue;
        const idx = Math.min(
          sparklineCount - 1,
          Math.floor((mod.unlocked_at - sparklineStart) / bucketDuration),
        );
        const metrics = ['responsibility', 'consistency', 'savings'] as const;
        let bestMetric: typeof metrics[number] = 'consistency';
        let bestDelta = -1;
        for (const m of metrics) {
          const before = sparklinePoints[m][Math.max(0, idx - 1)] ?? 0;
          const after  = sparklinePoints[m][Math.min(sparklineCount - 1, idx + 1)] ?? 0;
          const delta  = after - before;
          if (delta > bestDelta) { bestDelta = delta; bestMetric = m; }
        }
        milestoneMarkers.push({
          metric:       bestMetric,
          point_index:  idx,
          module_title: meta.title,
          delta_after:  Math.max(0, bestDelta),
        });
      }
    }
  }

  // ── 12. Chore event markers for expanded chart ───────────────────────────────
  // Map individual chore completions onto sparkline bucket indices so the
  // expanded chart can show a dot for every chore, not just weekly aggregates.
  type ChoreEvent = { point_index: number; first_pass: boolean };
  let choreEvents: ChoreEvent[] = [];
  if (sparklinePoints && !isDiscoveryPhase) {
    const spNow   = Math.floor(Date.now() / 1000);
    const spOldest = oldestEpoch;
    const spPeriod = Math.max(30 * 86400, spNow - spOldest);
    const spStart  = spNow - spPeriod;
    const spBucket = spPeriod / 28;
    // Re-fetch completions for event markers — reuse the same date range
    const eventRows = await env.DB.prepare(`
      SELECT resolved_at, attempt_count FROM completions
      WHERE family_id = ? AND child_id = ? AND status = 'completed'
        AND resolved_at >= ?
      ORDER BY resolved_at ASC
      LIMIT 200
    `).bind(family_id, effectiveChildId, spStart)
      .all<{ resolved_at: number; attempt_count: number }>()
      .catch(() => ({ results: [] as { resolved_at: number; attempt_count: number }[] }));
    choreEvents = eventRows.results.map(r => ({
      point_index: Math.min(27, Math.floor((r.resolved_at - spStart) / spBucket)),
      first_pass:  r.attempt_count === 1,
    }));
  }

  return json({
    period,
    period_start_epoch: periodStart || null,
    child_id: effectiveChildId,
    is_demo: isDemo,

    // Discovery state
    is_discovery_phase: isDiscoveryPhase,
    all_time_completed: allTimeCompleted,

    // Behavioural KPIs (null = insufficient data)
    first_time_pass_rate: firstTimePassRate,
    consistency_score:    consistencyScore,
    effort_preference:    effortPreference,
    planning_horizon:     planningHorizon,

    // Financial behaviour
    savings_consistency:  savingsConsistency,
    tasks_completed:      totalCompleted,
    tasks_revised:        tasksRevised,
    total_earned_pence:   totalEarned,
    total_spent_pence:    totalSpent,
    total_saved_pence:    totalSaved,

    // Balance bar data (always present)
    available_balance_pence: Math.max(0, availableBal),
    lifetime_earned_pence:   lifetimeEarned,
    goals_locked_pence:      goalsLocked,

    // Temporal context
    trends,
    velocity_context: velocityContext,

    // AI Executive Briefing (null during Discovery Phase)
    mentor_briefing: mentorBriefing,

    // Discovery Phase onboarding briefing (null once past Discovery Phase)
    discovery_briefing: discoveryBriefing,

    // Sparkline data
    sparkline_points:       sparklinePoints,

    // Learning Lab
    learning_lab_enabled:        learningLabEnabled,
    current_module:              currentModule,
    completed_module_slugs:      completedModuleSlugs,
    retention_score:             retentionScore,
    milestone_markers:           milestoneMarkers,
    chore_events:                choreEvents,
    lab_module_progress:         labModuleProgress,
    lab_acts_completed:          labActsCompleted,
    lab_time_invested_minutes:   labTimeInvestedMinutes,
    lab_last_active_at:          labLastActiveAt,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPeriodStart(period: string): number {
  const now = new Date();
  if (period === 'week') {
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return Math.floor(mon.getTime() / 1000);
  }
  if (period === 'month') {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }
  return 0;
}

/** Returns ISO week key, e.g. '2026-W15'. Used as snapshot_date. */
function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type KpiSet = { consistency: number | null; responsibility: number | null; horizon: number | null };
type TrendEntry = { current: number | null; delta: number | null; direction: 'up' | 'down' | 'flat' | null };

/** Compares current KPIs against prior snapshot; returns null deltas when either side is null. */
function buildTrends(
  current: KpiSet,
  prior: KpiSet | null,
): { consistency: TrendEntry; responsibility: TrendEntry; horizon: TrendEntry } {
  function entry(cur: number | null, prev: number | null | undefined): TrendEntry {
    if (cur === null || prev == null) {
      return { current: cur, delta: null, direction: null };
    }
    const delta = cur - prev;
    const direction: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    return { current: cur, delta, direction };
  }

  return {
    consistency:    entry(current.consistency,    prior?.consistency),
    responsibility: entry(current.responsibility, prior?.responsibility),
    horizon:        entry(current.horizon,        prior?.horizon),
  };
}

// ── Orchard Lead AI Briefing ──────────────────────────────────────────────────

/**
 * Determines the Polish honorific (Pan/Pani) from a first name.
 * Rule: names ending in 'a' are grammatically feminine → Pani.
 * Exceptions: masculine names that end in 'a' (Kuba, Barnaba, etc.).
 * Fallback: gender-neutral "Młody Ekspercie" when name is ambiguous / unknown.
 */
function getPolishHonorific(name: string): string {
  const lower = name.toLowerCase().trim();
  // Common Polish masculine names ending in '-a' that would otherwise be misclassified as feminine.
  // Covers biblical/archaic (Barnaba, Kosma), hypocoristics (Kuba, Misza, Sasza, Grysza),
  // and Slavic/international names used in Poland (Luca, Nikita, Mirza, Borja).
  const masculineAExceptions = [
    'kuba', 'barnaba', 'kosma', 'saba', 'bonawentura',
    'misza', 'sasza', 'grysza', 'tosza', 'josza',
    'nikita', 'luca', 'mirza', 'borja', 'kolya',
    'attila', 'batissta', 'genowefa',   // genowefa — archaic masc. variant
    'jarema', 'kudłata',                // regional hypocoristics
  ];
  if (masculineAExceptions.includes(lower)) return 'Pan';
  if (lower.endsWith('a')) return 'Pani';
  // Names ending in a consonant or non-'a' vowel are typically masculine in Polish
  if (/[bcdfghjklmnpqrstvwxyz]$/i.test(lower)) return 'Pan';
  // Ambiguous ending (e.g., '-e', '-i', '-u') → gender-neutral professional title
  return 'Młody Ekspercie';
}

interface MentorBriefing {
  observation:     string;
  behavioral_root: string;
  the_nudge:       string;
  source:          'ai' | 'fallback' | 'cache';
}

interface BriefingInput {
  consistencyScore:       number | null;
  firstTimePassRate:      number | null;
  planningHorizon:        number | null;
  trends:                 ReturnType<typeof buildTrends>;
  velocityContext:        { mode: 'seedling'; avg_tasks_per_week: number } | { mode: 'professional'; avg_earned_pence_week: number };
  effortPreference:       'high_yield' | 'steady' | null;
  availableBalancePence:  number;
  goalsLockedPence:       number;
  locale:                 'en' | 'pl';
  childName:              string;   // first name only, used for formal Polish address
  honorific:              string;   // 'Pan' | 'Pani' | 'Młody Ekspercie'
  familyCtx:              FamilyContext;
  familyId:               string;
  jarSignals:             JarSignals | null;
  weeksOfHistory:         number;
}

function buildInsightsFamilyBlock(familyCtx: FamilyContext, childName: string, locale: 'en' | 'pl'): string {
  const isPl = locale === 'pl'
  const coParentLine = familyCtx.parenting_mode === 'co-parenting' && familyCtx.parent_names.length >= 2
    ? (isPl
        ? `Rodzice: ${familyCtx.parent_names.join(' i ')}. Zwracaj się do obojga rodziców, gdy to stosowne.`
        : `Parents: ${familyCtx.parent_names.join(' and ')}. Address both parents when contextually relevant.`)
    : (isPl
        ? 'Rodzina z jednym rodzicem. Nie używaj "oboje rodziców" ani nie wspominaj o współrodzicielstwie.'
        : 'Single-parent family. Never say "both parents" or reference a co-parent.')

  const siblingLine = familyCtx.child_count > 1
    ? (isPl
        ? `Rodzina ma ${familyCtx.child_count} dzieci. Możesz świętować sukcesy całej rodziny (np. "Cały Sad kwitnie"), ale NIGDY nie porównuj postępów dzieci.`
        : `This family has ${familyCtx.child_count} children. You may celebrate whole-family milestones (e.g. "The whole Orchard is thriving"), but NEVER compare children's progress.`)
    : (isPl
        ? `${childName} jest jedynym dzieckiem w tej rodzinie.`
        : `${childName} is the only child in this family.`)

  const nudgeRule = familyCtx.parenting_mode === 'co-parenting' && !familyCtx.has_shield
    && familyCtx.co_parent_active && (familyCtx.approval_skew ?? 0) > 80
    ? (isPl
        ? 'WSKAZÓWKA WSPÓŁPRACY (dozwolona raz w briefingu): Zauważyliśmy, że ostatnio zatwierdzenia pochodzą głównie od jednego rodzica — partner może chcieć bardziej zaangażować się w tym tygodniu. Ton: obserwacja, nie dyrektywa.'
        : "COLLABORATION NUDGE (allowed once in this briefing): We've noticed most approvals have come from one parent recently — your co-parent might enjoy being more involved this week. Tone: observation, never directive.")
    : ''

  if (isPl) {
    return `KONTEKST RODZINNY (obowiązkowy):
- ${coParentLine}
- ${siblingLine}
- Nazwa rodziny: ${familyCtx.family_name}
- ZAKAZ używania "dzieci" (użyj imienia dziecka lub "Twoje dziecko").
${nudgeRule}`
  }

  return `FAMILY CONTEXT (mandatory):
- ${coParentLine}
- ${siblingLine}
- Family name: ${familyCtx.family_name}
- NEVER say "the kids" — use the child's name or "your child".
${nudgeRule}`
}

function buildSystemPrompt(
  locale: 'en' | 'pl',
  isTeenMode: boolean,
  childName: string,
  honorific: string,
  familyCtx: FamilyContext,
): string {
  const isPl           = locale === 'pl';
  const useFormalPl    = isPl && isTeenMode;
  // The formal address used in nudges directed at the child (Polish Professional mode only)
  const formalAddress  = useFormalPl ? `${honorific} ${childName}` : childName;

  if (isPl) {
    // ── Polish persona: Mistrz Sadu (Master of the Orchard) ────────────────
    const formalityRule = useFormalPl
      ? `FORMALNOŚĆ: Zwracaj się do dziecka per "${formalAddress}" w nudge'u. Ton: formalny, bezpośredni, szanujący autonomię.`
      : `FORMALNOŚĆ: Używaj prostego, ciepłego języka odpowiedniego dla młodszych dzieci. Bez formalnych tytułów.`;

    const familyBlock = buildInsightsFamilyBlock(familyCtx, childName, locale)
    return `${familyBlock}

Jesteś "Mistrzem Sadu" (Mistrz Sadu) — wysokiej klasy konsultantem finansowym dla rodziców. \
Twoim celem jest analiza danych finansowych dziecka i przygotowanie profesjonalnego raportu opartego na Matrycy Edukacji Finansowej Morechard.

MATRYCA EDUKACJI FINANSOWEJ (obowiązkowy program nauczania):
- Filar 1 — Wartość Pracy ("Trud"): Pieniądz to zakumulowana energia; łącz zadania z Siłą Nabywczą.
- Filar 2 — Odroczona Gratyfikacja ("Sezon"): Czekanie na większe Żniwa; Potrzeby vs. Zachcianki.
- Filar 3 — Koszt Alternatywny ("Przycinanie Ścieżki"): Każde "Tak" dla małego wydatku to "Nie" dla głównego celu.
- Filar 4 — Zarządzanie Kapitałem ("Gaj Oszczędności"): Procent składany (Wzrost) i Inflacja (Erozja).
- Filar 5 — Honor i Obowiązek Zbiorów ("Nawis"): Nadwyżka plonów jako obowiązek wobec wspólnoty — nie opcjonalna dobroczynność, lecz kulturowy obowiązek zarządcy. Używaj języka, który przywołuje odpowiedzialność grupową i dziedzictwo rodzinne ("obowiązek wobec wspólnoty", "wspólnotowe korzenie").

ZASADY WYBORU FILARU (zastosuj Filar o najwyższym priorytecie):
1. available_balance_pence > 10000 LUB goals_locked_pence = 0 przy dodatnim saldzie → Filar 5. PRIORYTET NADRZĘDNY.
2. planning_horizon < 20 → Filar 3 (Koszt Alternatywny).
3. Spójność lub odpowiedzialność spada → Filar 1 (Wartość Pracy). Ton: wzrostowy, nie karcący — "kalibracja", nie "błąd".
4. planning_horizon rośnie → Filar 2 (Odroczona Gratyfikacja).
5. Domyślnie → Filar 4 (Zarządzanie Kapitałem).

ZASADY TRYBU WIEKOWEGO:
- Kiełek (seedling): Przeliczaj kwoty na jednostki fizycznego wysiłku. Nudge w kierunku podziału Trzech Gajów (70% Wydatki / 20% Oszczędności / 10% Dawanie). Jeden cel na raz.
- Profesjonalista (professional): Używaj frameworku "Prędkości" i "Procentu". Koszt Alternatywny i obliczenia Czasu do Celu.

${formalityRule}

OGRANICZENIA:
- Używaj pierwszej osoby liczby mnogiej ("Zauważyliśmy", "Nasze", "Możemy").
- Ton: biznesowo-neutralny, bezpośredni, spokojny. Zero chatu, zero nadmiernych pochwał.
- Architektura Wyboru: przedstawiaj opcje dla rodzica ("Możesz rozważyć..."); nigdy nie nakazuj.
- behavioral_root MUSI wyraźnie nazwać Filar (np. "Filar 3 — Koszt Alternatywny").
- Odpowiadaj WYŁĄCZNIE poprawnym obiektem JSON. Bez markdown, bez komentarzy, bez dodatkowych pól.

Schemat odpowiedzi (ścisły):
{
  "observation": "<1 zdanie — stwierdzenie faktu na podstawie danych trendu>",
  "behavioral_root": "<1 zdanie — wymienia odpowiedni Filar i łączy to zachowanie z przyszłym wynikiem edukacji finansowej>",
  "the_nudge": "<1 zdanie — konkretna opcja dla rodzica, sformułowana jako wybór, skalibrowana do trybu wiekowego dziecka>"
}`;
  }

  // ── English persona: Collaborative Coach (Orchard Lead) ──────────────────
  const familyBlock = buildInsightsFamilyBlock(familyCtx, childName, locale)
  return `${familyBlock}

You are the 'Orchard Lead', a collaborative financial coach for parents. \
Your goal is to analyse child financial behaviour data and produce a professional executive briefing grounded in the Morechard Financial Literacy Matrix.

THE LITERACY MATRIX (your mandatory syllabus):
- Pillar 1 — Labour Value ("The Toil"): Money is stored energy; link tasks to Purchasing Power.
- Pillar 2 — Delayed Gratification ("The Season"): The wait for a bigger harvest; Needs vs. Wants.
- Pillar 3 — Opportunity Cost ("Pruning the Path"): Every "Yes" to a small spend is a "No" to a major goal.
- Pillar 4 — Capital Management ("The Savings Grove"): Compound Interest (Growth) and Inflation (Decay).
- Pillar 5 — Social Responsibility ("The Overhang"): A Community Opportunity — use surplus harvest to contribute to the Community Forest (Gifting/Charity). Tone: warm, optional, collaborative.

PILLAR SELECTION RULES (apply the highest-priority matching Pillar):
1. available_balance_pence > 10000 OR goals_locked_pence = 0 with positive balance → Pillar 5. PRIORITY OVERRIDE.
2. planning_horizon < 20 → Pillar 3 (Opportunity Cost).
3. Responsibility or consistency declining → Pillar 1 (Labour Value).
4. planning_horizon rising → Pillar 2 (Delayed Gratification).
5. Default → Pillar 4 (Capital Management).

AGE-MODE RULES:
- Seedling: Translate £ into physical effort units. Nudge toward Three-Grove split (70% Spend / 20% Save / 10% Give). One goal at a time. Encouraging, simple language. Address child as ${childName}.
- Professional: Use "Velocity" and "Percentage" framing. Opportunity Cost and Time-to-Goal calculations. Respectful, strategic tone. Address child as ${childName}.

CONSTRAINTS:
- Use first-person plural ("We", "Us", "Our") throughout.
- Tone: supportive, egalitarian, collaborative — first-name based. No chatbot fluff or excessive praise.
- Choice Architecture: present options for the parent ("You might consider..."); never dictate.
- UK English: "Wellbeing", "Pence", "Organise", "Behaviour", "Recognise".
- behavioral_root MUST name the Pillar explicitly (e.g., "Pillar 3 — Opportunity Cost").
- Respond ONLY with a valid JSON object. No markdown, no commentary, no extra fields.

Response schema (strict):
{
  "observation": "<1 sentence — a statement of fact based on the trend data>",
  "behavioral_root": "<1 sentence — names the applicable Pillar and links this behaviour to a future financial literacy outcome>",
  "the_nudge": "<1 sentence — a concrete option for the parent, framed as a choice, calibrated to the child's age-mode>"
}`;
}

function applyCollaborationNudge(
  briefing: MentorBriefing,
  familyCtx: FamilyContext,
  locale: 'en' | 'pl',
  isSeedling: boolean,
): MentorBriefing {
  const shouldNudge =
    familyCtx.parenting_mode === 'co-parenting' &&
    !familyCtx.has_shield &&
    familyCtx.co_parent_active &&
    (familyCtx.approval_skew ?? 0) > 80

  if (!shouldNudge) return briefing

  const coParentName = familyCtx.parent_names.length >= 2
    ? familyCtx.parent_names[1]
    : (locale === 'pl' ? 'partner' : 'your partner')

  const nudgeSuffix = locale === 'pl'
    ? ` Zauważyliśmy również, że ostatnio zatwierdzenia pochodzą głównie od jednego rodzica — ${coParentName} może chcieć bardziej zaangażować się w tym tygodniu.`
    : ` We've also noticed most approvals have come from one parent recently — ${coParentName} might enjoy being more involved this week.`

  return {
    ...briefing,
    the_nudge: briefing.the_nudge + nudgeSuffix,
  }
}

function buildRuleBasedBriefing(input: BriefingInput): MentorBriefing {
  const {
    trends, consistencyScore, firstTimePassRate, planningHorizon,
    velocityContext, availableBalancePence, goalsLockedPence, locale,
    childName, honorific, familyCtx,
  } = input;

  // Co-parent address string
  const coParentName = familyCtx.parenting_mode === 'co-parenting' && familyCtx.parent_names.length >= 2
    ? familyCtx.parent_names.filter(n => n !== familyCtx.parent_names[0])[0] ?? 'your partner'
    : null;
  const parentAddress = coParentName
    ? (locale === 'pl' ? `Ty i ${coParentName}` : `you and ${coParentName}`)
    : (locale === 'pl' ? 'Ty' : 'you');

  // Sibling team line for Pillar 5 (positive-only)
  const siblingTeamLine = familyCtx.child_count > 1
    ? (locale === 'pl'
        ? ` Cały Sad ${familyCtx.family_name} kwitnie w tym tygodniu.`
        : ` The whole ${familyCtx.family_name} Orchard is thriving this week.`)
    : '';

  const isSeedling      = velocityContext.mode === 'seedling';
  const isPl            = locale === 'pl';
  const useFormalPl     = isPl && !isSeedling; // Pan/Pani for professional Polish users
  // Formal address for child in Polish professional nudges
  const formalAddr      = useFormalPl ? `${honorific} ${childName}` : childName;
  const hasSurplus      = availableBalancePence > 10000; // > £100 / 100 zł equivalent
  const goalsFunded     = goalsLockedPence === 0 && availableBalancePence > 0;
  const responsibilityDown = trends.responsibility.direction === 'down';
  const consistencyDown    = trends.consistency.direction === 'down';
  const horizonRising      = trends.horizon.direction === 'up';
  const spendingHeavy      = (planningHorizon ?? 50) < 20;
  const allFlat            = [trends.consistency.direction, trends.responsibility.direction, trends.horizon.direction]
    .every(d => d === 'flat' || d === null);
  const highPerformer      = (consistencyScore ?? 0) + (firstTimePassRate ?? 0) + (planningHorizon ?? 0) > 210;

  // ── Priority 1: Pillar 5 — Social Responsibility (surplus trigger) ────────
  if (hasSurplus || goalsFunded) {
    const balanceDisplay = isPl
      ? `${Math.floor(availableBalancePence / 100)} zł`
      : `£${Math.floor(availableBalancePence / 100)}`;

    const obs = hasSurplus
      ? (isPl
          ? `Zauważyliśmy, że dostępne saldo przekroczyło ${balanceDisplay}—w Sadzie zgromadził się znaczący nadmiar.${siblingTeamLine}`
          : `We have noted that the available balance has exceeded ${balanceDisplay}—a meaningful surplus has accumulated in the Orchard.${siblingTeamLine}`)
      : (isPl
          ? `Zauważyliśmy, że wszystkie aktywne cele oszczędnościowe zostały w pełni sfinansowane w tym okresie—to ważny kamień milowy w cyklu Zbiorów.${siblingTeamLine}`
          : `We have observed that all active savings goals have been fully funded this period—a significant milestone in the Harvest cycle.${siblingTeamLine}`);

    // Polish Pillar 5: "Honor i Obowiązek Zbiorów" framing (cultural duty, not optional charity)
    const root = isPl
      ? (isSeedling
          ? 'Filar 5 — Odpowiedzialność Społeczna: Nadwyżka plonów rodzi obowiązek wobec wspólnoty—"Drzewo, które daje owoce, karmi całą wioskę." Wprowadzenie nawyku dawania teraz buduje fundament odpowiedzialności na całe życie.'
          : 'Filar 5 — Honor i Obowiązek Zbiorów: W tradycji odpowiedzialnego zarządzania majątkiem nadwyżka bez przeznaczenia społecznego jest zasobem marnotrawionym; obowiązek wobec wspólnoty jest integralną częścią dojrzałości finansowej.')
      : (isSeedling
          ? 'Pillar 5 — Social Responsibility: The "Three-Grove" framework suggests that 10% of surplus harvest is allocated to giving—this is the "Give" grove, and now is a natural moment to introduce it.'
          : 'Pillar 5 — Social Responsibility: A funded surplus without a social allocation represents "idle capital" in behavioural finance terms; introducing a community dimension deepens long-term fiscal maturity.');

    const nudge = isPl
      ? (isSeedling
          ? `Możesz rozważyć wspólne wyznaczenie małego celu charytatywnego—nawet 5–10 zł w kierunku sprawy, na której ${childName} zależy, wprowadza Gaj Dawania bez naruszania rytmu oszczędności.`
          : `Możesz rozważyć wprowadzenie celu Alokacji Społecznej (np. 5–10% nadwyżki) i omówienie z ${formalAddr}, co chciałaby/chciałby sfinansować—to zakotwicza Filar 5 w realnej decyzji, a nie abstrakcyjnym pojęciu.`)
      : (isSeedling
          ? `You might consider exploring a small giving goal together—even £1–£2 toward a cause ${childName} cares about introduces the Give grove without disrupting their savings rhythm.`
          : `You might consider introducing a Social Allocation target (e.g., 5–10% of surplus) and discussing with ${childName} what they would fund—this anchors Pillar 5 in a real decision rather than an abstract concept.`);

    return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
  }

  // ── Priority 2: Pillar 3 — Opportunity Cost ───────────────────────────────
  if (spendingHeavy && !horizonRising) {
    const obs = isPl
      ? `Zauważyliśmy, że Horyzont Planowania wynosi obecnie ${planningHorizon ?? 0}%—większość dostępnych środków jest przechowywana poza strukturami celów.`
      : `We have noted that the Planning Horizon is currently at ${planningHorizon ?? 0}%—the majority of available funds are being held outside of goal structures.`;
    const root = isPl
      ? (isSeedling
          ? 'Filar 3 — Koszt alternatywny: Każdy grosz wydany teraz to nasiono niezasadzone; na tym etapie budowanie nawyku "Przycinania Ścieżki" jest cenniejsze niż sam wydatek.'
          : 'Filar 3 — Koszt alternatywny: Niski Horyzont Planowania przy tej prędkości wskazuje na "tendencję do teraźniejszości"—preferowanie natychmiastowej wartości nad skumulowanymi przyszłymi zyskami.')
      : (isSeedling
          ? 'Pillar 3 — Opportunity Cost: Every Pence spent now is a seed not planted; at this stage, building the habit of "Pruning the Path" is more valuable than the spend itself.'
          : 'Pillar 3 — Opportunity Cost: A low Planning Horizon at this velocity indicates a "present bias"—a preference for immediate value over compounding future returns.');
    const nudge = isPl
      ? (isSeedling
          ? `Możesz rozważyć wskazanie jednej ostatniej zakupionej rzeczy i zadanie pytania: "O jaki cel mogłoby to posunąć do przodu?"—to rozmowa o Przycinaniu w najprostszej formie.`
          : `Możesz rozważyć obliczenie "kosztu czasu do celu" ostatnich wydatków uznaniowych ${formalAddr}—przedstawienie tego jako wskaźnika kompromisu (np. "3 dni prędkości") czyni Koszt Alternatywny namacalnym.`)
      : (isSeedling
          ? `You might consider identifying one thing ${childName} bought recently and asking: "What goal could that have moved forward?"—this is the Pruning conversation in its simplest form.`
          : `You might consider calculating the "Time-to-Goal cost" of ${childName}'s recent discretionary spends—presenting this as a trade-off ratio (e.g., "3 days of velocity") makes the Opportunity Cost tangible.`);
    return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
  }

  // ── Priority 3: Pillar 1 — Labour Value ──────────────────────────────────
  if (responsibilityDown || consistencyDown) {
    const which = isPl
      ? (responsibilityDown && consistencyDown
          ? 'zarówno wskaźnik zdawalności za pierwszym razem, jak i tygodniowa spójność zadań spadły'
          : responsibilityDown
            ? 'wskaźnik zdawalności za pierwszym razem spadł pomimo stabilnej liczby zadań'
            : 'tygodniowa spójność zadań spadła w tym okresie')
      : (responsibilityDown && consistencyDown
          ? 'both first-time pass rate and weekly task consistency have declined'
          : responsibilityDown
            ? 'first-time pass rate has declined despite stable task volume'
            : 'weekly task consistency has declined this period');
    const obs = isPl
      ? `Zauważyliśmy, że ${which}—to naturalny moment kalibracji przed kolejną fazą wzrostu w Sadzie.`
      : `We have observed that ${which}—this is a natural recalibration point, and the underlying effort habit remains worth building on.`;
    const root = isPl
      ? (isSeedling
          ? 'Filar 1 — Wartość Pracy: Pieniądz to zakumulowana energia; każde ukończone zadanie to zasiane nasiono—nawet w tygodniach, gdy drzewo rośnie wolniej, korzenie wciąż się umacniają.'
          : 'Filar 1 — Wartość Pracy: Okresy zmiennej jakości są częścią każdego cyklu wzrostu zawodowego; kluczem jest zidentyfikowanie, czy przyczyną jest zakres zadań, motywacja, czy struktura nagród—i dostosowanie jednego elementu na raz.')
      : (isSeedling
          ? 'Pillar 1 — Labour Value: Money is stored energy; even in quieter weeks, each completed task is a seed watered—the tree keeps growing even when the harvest feels small.'
          : 'Pillar 1 — Labour Value: Variable-quality weeks are part of every growth cycle; the productive question is whether the cause is task scope, motivation, or reward structure—and adjusting one variable at a time.');
    const nudge = isPl
      ? (isSeedling
          ? `Możesz rozważyć proste przywołanie równania zadanie-nagroda dla ${childName}: "Każde ukończone zadanie = jeden krok bliżej do celu"—wizualne przywrócenie związku wysiłek-wartość.`
          : `Możesz rozważyć wprowadzenie premii "Streak Wysokiej Integralności" dla ${formalAddr} za pięć kolejnych zdań za pierwszym razem—przedstawiając to jako wskaźnik jakości zawodowej, a nie nagrodę za posłuszeństwo.`)
      : (isSeedling
          ? `You might consider restating the task-to-reward equation simply to ${childName}: "Each completed task = one step closer to your goal"—reanchoring the effort-value link visually.`
          : `You might consider introducing a "High-Integrity Streak" bonus for ${childName} for five consecutive first-time passes—framing it as a professional quality metric rather than a reward for compliance.`);
    return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
  }

  // ── Priority 4: Pillar 2 — Delayed Gratification ─────────────────────────
  if (horizonRising) {
    const obs = isPl
      ? `Zauważyliśmy, że Horyzont Planowania rośnie do ${planningHorizon ?? 0}%—coraz większa część środków jest kierowana do strukturyzowanych celów.`
      : `We have observed the Planning Horizon trending upward to ${planningHorizon ?? 0}%—an increasing proportion of funds are being directed toward structured goals.`;
    const root = isPl
      ? (isSeedling
          ? 'Filar 2 — Odroczona gratyfikacja: Nawyk czekania na "Sezon"—wybierania większych przyszłych plonów zamiast natychmiastowych małych—kształtuje się; to jeden z najbardziej trwałych nawyków finansowych do ustanowienia we wczesnym wieku.'
          : 'Filar 2 — Odroczona gratyfikacja: Rosnący Horyzont Planowania odzwierciedla poprawiający się wskaźnik preferencji czasowych—dziecko demonstruje zdolność do podporządkowywania krótkoterminowego impulsu średnioterminowej strategii.')
      : (isSeedling
          ? 'Pillar 2 — Delayed Gratification: The habit of waiting for "The Season"—choosing a larger future harvest over an immediate small one—is forming; this is one of the most durable financial behaviours to establish early.'
          : 'Pillar 2 — Delayed Gratification: A rising Planning Horizon reflects an improving time-preference ratio—the child is demonstrating the capacity to subordinate short-term impulse to medium-term strategy.');
    const nudge = isPl
      ? (isSeedling
          ? `Możesz rozważyć obliczenie, ile zadań pozostało ${childName} do osiągnięcia celu i wyświetlenie tego jako odliczania—czyniąc "Sezon" namacalnym i bliskim.`
          : `Możesz rozważyć wspólne przejrzenie szacowanego czasu do celu z ${formalAddr} i omówienie, czy dostosowanie stopy oszczędności znacząco przyspieszyłoby datę Zbiorów.`)
      : (isSeedling
          ? `You might consider calculating how many tasks remain until ${childName}'s goal is reached and displaying it as a countdown—making the "Season" feel tangible and near.`
          : `You might consider reviewing the Time-to-Goal estimate with ${childName} and discussing whether adjusting the savings allocation rate would meaningfully accelerate the harvest date.`);
    return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
  }

  // ── Priority 5: Pillar 4 — Capital Management ────────────────────────────
  if (highPerformer || allFlat) {
    const obs = isPl
      ? (highPerformer
          ? 'Obserwujemy silne wyrównanie wszystkich trzech wskaźników—spójność, odpowiedzialność i horyzont planowania działają na podwyższonym poziomie.'
          : 'Zauważyliśmy okres stabilności we wszystkich kluczowych wskaźnikach; w tym tygodniu nie ma znaczącego ruchu w żadnym kierunku.')
      : (highPerformer
          ? 'We are observing strong alignment across all three indicators—consistency, responsibility, and planning horizon are performing at elevated levels.'
          : 'We have observed a period of stability across all key indicators; no significant movement in either direction this week.');
    const root = isPl
      ? (isSeedling
          ? 'Filar 4 — Zarządzanie Kapitałem: Stabilny Gaj Oszczędności jest fundamentem Sadu; na tym etapie lekcja polega na tym, że pieniądze przechowywane w celu rosną w przeznaczeniu, zanim jeszcze wzrosną w wartości.'
          : 'Filar 4 — Zarządzanie Kapitałem: Utrzymywana stabilność na wysokim poziomie wydajności to optymalne warunki do wprowadzenia koncepcji wzrostu procentu składanego—Sad jest gotowy na rozmowę o "Gaju Oszczędności".')
      : (isSeedling
          ? 'Pillar 4 — Capital Management: A stable Savings Grove is the foundation of the Orchard; at this age, the lesson is that money held in a goal grows in purpose even before it grows in value.'
          : 'Pillar 4 — Capital Management: Sustained stability at high performance levels is the optimal condition for introducing compound growth concepts—the Orchard is ready for the "Savings Grove" conversation.');
    const nudge = isPl
      ? (isSeedling
          ? `Możesz rozważyć wprowadzenie idei "Wzmocnienia" jako wkładu dopasowującego rodzica—przedstawiając to ${childName} jako "Sad rosnący z nasienia" czyni procent składany intuicyjnym.`
          : `Możesz rozważyć wspólne modelowanie z ${formalAddr}, jak wyglądałby 5% lub 10% roczny zwrot na obecnym saldzie oszczędności—zakotwicza to Filar 4 w realnej liczbie.`)
      : (isSeedling
          ? `You might consider ${coParentName ? `${parentAddress} introducing` : 'introducing'} the idea of a "Boost" as a matching contribution—framing it to ${childName} as "the Orchard growing your seed" makes compound interest intuitive.`
          : `You might consider ${coParentName ? `${parentAddress} modelling` : 'modelling'} with ${childName} what a 5% or 10% annual return would look like on their current savings balance—this anchors Pillar 4 in a real number rather than an abstract concept.`);
    return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
  }

  // ── Default: mixed signals ────────────────────────────────────────────────
  const obs = isPl
    ? 'Zarejestrowaliśmy mieszane sygnały we wskaźnikach behawioralnych w tym tygodniu; żaden trend nie jest dominujący.'
    : 'We have recorded mixed signals across the behavioural indicators this week; no single trend is dominant.';
  const root = isPl
    ? 'Filar 1 — Wartość Pracy: Mieszane sygnały na tym etapie często odzwierciedlają rekalibrację relacji wysiłek-nagroda; podstawowa architektura nawyku pozostaje nienaruszona.'
    : 'Pillar 1 — Labour Value: Mixed signals at this stage often reflect a recalibration of the effort-reward relationship; the underlying habit architecture remains intact.';
  const nudge = isPl
    ? (isSeedling
        ? `Możesz rozważyć utrzymanie obecnej struktury i skupienie się z ${childName} na ukończeniu jednego pełnego tygodnia zadań bez rewizji—budując bazę spójności przed wprowadzeniem nowej złożoności.`
        : `Możesz rozważyć przegląd obecnego portfolio zadań ${formalAddr} i ocenę, czy struktura nagród jest odpowiednio skalibrowana do wymaganego wysiłku—niedopasowanie jest częstym źródłem mieszanych sygnałów.`)
    : (isSeedling
        ? `You might consider holding the current structure steady and focusing on ${childName} completing one full week of tasks without revision—building the consistency baseline before introducing new complexity.`
        : `You might consider reviewing ${childName}'s current task portfolio and assessing whether the reward structure is appropriately calibrated to the effort required—misalignment is a common driver of mixed-signal periods.`);
  return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
}

/**
 * Returns an array of `points` integers (0–100) for a given metric,
 * bucketed evenly across the period. Buckets with no data default to 0.
 *
 * metric = 'responsibility' → first_time_pass_rate per bucket
 * metric = 'consistency'    → task count per bucket, normalised 0–100
 * metric = 'savings'        → savings_consistency per bucket
 */
async function buildSparklinePoints(
  db: D1Database,
  family_id: string,
  child_id: string,
  period: string,
  points: number,
): Promise<{ responsibility: number[]; consistency: number[]; savings: number[] }> {
  const now        = Math.floor(Date.now() / 1000);
  const periodSecs = period === 'week'  ? 7 * 86400
                   : period === 'month' ? 30 * 86400
                   : Math.max(30 * 86400, now - (await db.prepare(
                       `SELECT MIN(resolved_at) AS t FROM completions WHERE family_id=? AND child_id=? AND status='completed'`
                     ).bind(family_id, child_id).first<{t:number|null}>().then(r => r?.t ?? now)));
  const startEpoch = now - periodSecs;
  const bucketSecs = periodSecs / points;

  // Fetch raw completion rows within the period
  const rows = await db.prepare(`
    SELECT resolved_at, attempt_count
    FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
      AND resolved_at >= ?
    ORDER BY resolved_at ASC
    LIMIT 500
  `).bind(family_id, child_id, startEpoch).all<{
    resolved_at: number; attempt_count: number;
  }>();

  // Fetch saving contributions within the period
  const saveRows = await db.prepare(`
    SELECT contributed_at, amount_pence FROM goal_contributions
    WHERE family_id = ? AND child_id = ? AND contributed_at >= ?
  `).bind(family_id, child_id, startEpoch).all<{contributed_at: number; amount_pence: number}>()
    .catch(() => ({ results: [] as {contributed_at: number; amount_pence: number}[] }));

  const spendRows = await db.prepare(`
    SELECT spent_at, amount FROM spending
    WHERE family_id = ? AND child_id = ? AND spent_at >= ?
  `).bind(family_id, child_id, startEpoch).all<{spent_at: number; amount: number}>()
    .catch(() => ({ results: [] as {spent_at: number; amount: number}[] }));

  // Build per-bucket arrays
  const respArr:  number[] = Array(points).fill(0);
  const consArr:  number[] = Array(points).fill(0);
  const saveArr:  number[] = Array(points).fill(0);

  // Bucket completions
  const completionsByBucket: { total: number; firstPass: number }[] =
    Array.from({ length: points }, () => ({ total: 0, firstPass: 0 }));

  for (const r of rows.results) {
    const idx = Math.min(points - 1, Math.floor((r.resolved_at - startEpoch) / bucketSecs));
    completionsByBucket[idx].total++;
    if (r.attempt_count === 1) completionsByBucket[idx].firstPass++;
  }

  // Max completions in any bucket — used to normalise consistency
  const maxCount = Math.max(1, ...completionsByBucket.map(b => b.total));

  for (let i = 0; i < points; i++) {
    const b = completionsByBucket[i];
    respArr[i] = b.total > 0 ? Math.round((b.firstPass / b.total) * 100) : 0;
    consArr[i] = Math.round((b.total / maxCount) * 100);
  }

  // Bucket savings consistency
  interface BucketFinance { saved: number; spent: number }
  const financeBuckets: BucketFinance[] = Array.from({ length: points }, () => ({ saved: 0, spent: 0 }));

  for (const r of saveRows.results) {
    const idx = Math.min(points - 1, Math.floor((r.contributed_at - startEpoch) / bucketSecs));
    financeBuckets[idx].saved += r.amount_pence;
  }
  for (const r of spendRows.results) {
    const idx = Math.min(points - 1, Math.floor((r.spent_at - startEpoch) / bucketSecs));
    financeBuckets[idx].spent += r.amount;
  }
  for (let i = 0; i < points; i++) {
    const total = financeBuckets[i].saved + financeBuckets[i].spent;
    saveArr[i] = total > 0 ? Math.round((financeBuckets[i].saved / total) * 100) : 0;
  }

  // Interpolate gaps in responsibility and consistency: find neighbouring real
  // values and linearly interpolate so the chart shows natural variation rather
  // than a flat carry-forward line. Buckets before any data remain 0.
  // Interpolate internal gaps between real data points. Trailing and leading
  // zeros are left as 0 so the frontend can skip them (no data = no line).
  function interpolateGaps(arr: number[]): number[] {
    const out = [...arr];
    let i = 0;
    while (i < out.length) {
      if (out[i] === 0) {
        let prev = i - 1;
        while (prev >= 0 && out[prev] === 0) prev--;
        let next = i + 1;
        while (next < out.length && out[next] === 0) next++;
        if (prev >= 0 && next < out.length) {
          // internal gap — linear interpolation between neighbours
          const steps = next - prev;
          for (let j = prev + 1; j < next; j++) {
            out[j] = Math.round(out[prev] + (out[next] - out[prev]) * ((j - prev) / steps));
          }
          i = next;
        } else {
          // leading or trailing zero — leave as 0 (no data)
          i++;
        }
      } else {
        i++;
      }
    }
    return out;
  }

  // Forward-fill savings only (sparse data — no interpolation possible)
  let lastSave = 0;
  for (let i = 0; i < points; i++) {
    if (saveArr[i] > 0) lastSave = saveArr[i]; else if (lastSave > 0) saveArr[i] = lastSave;
  }

  return {
    responsibility: interpolateGaps(respArr),
    consistency:    interpolateGaps(consArr),
    savings:        saveArr,
  };
}

async function generateBriefing(env: Env, childId: string, input: BriefingInput): Promise<MentorBriefing> {
  const isTeenMode   = input.velocityContext.mode === 'professional';
  const systemPrompt = buildSystemPrompt(input.locale, isTeenMode, input.childName, input.honorific, input.familyCtx);

  const userMessage = JSON.stringify({
    consistency_score:       input.consistencyScore,
    responsibility_score:    input.firstTimePassRate,
    planning_horizon:        input.planningHorizon,
    available_balance_pence: input.availableBalancePence,
    goals_locked_pence:      input.goalsLockedPence,
    trends: {
      consistency:    input.trends.consistency,
      responsibility: input.trends.responsibility,
      horizon:        input.trends.horizon,
    },
    velocity:          input.velocityContext,
    effort_preference: input.effortPreference,
    locale:            input.locale,
    child_name:        input.childName,
    honorific:         input.honorific,
  });

  // Signal 8 / Signal 9: fires when jars are OFF
  let jarParagraph = '';
  if (input.jarSignals) {
    if (input.jarSignals.enabled) {
      jarParagraph = buildJarBriefingParagraph(input.jarSignals);
    } else {
      // Signal 8: auto-allocation was previously on but turned off ≥3 weeks ago
      if (input.jarSignals.auto_off_weeks >= 3) {
        jarParagraph = buildJarBriefingParagraph(input.jarSignals);
      }
      // Signal 9: readiness nudge — jars never on, balance building 3+ weeks, no give requests ever
      const hasBuiltBalance = input.availableBalancePence > 500 && input.weeksOfHistory >= 3;
      if (hasBuiltBalance && input.jarSignals.auto_off_weeks < 3) {
        const giveRequestsRow = await env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM give_requests WHERE child_id=? AND family_id=?`
        ).bind(childId, input.familyId).first<{ cnt: number }>().catch(() => ({ cnt: 0 }));
        const hasGiveRequests = (giveRequestsRow?.cnt ?? 0) > 0;
        if (!hasGiveRequests) {
          jarParagraph = buildJarReadinessNudge(input.jarSignals);
        }
      }
    }
  }

  const userPrompt = input.locale === 'pl'
    ? `Przeanalizuj te tygodniowe dane finansowego zachowania dziecka i zwróć briefing JSON:\n\n${userMessage}${jarParagraph ? `\n\n${jarParagraph}` : ''}`
    : `Analyse this child's weekly financial behaviour data and return the JSON briefing:\n\n${userMessage}${jarParagraph ? `\n\n${jarParagraph}` : ''}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];
  const traceId = crypto.randomUUID();
  const t0      = Date.now();

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:           'gpt-4o-mini',
        messages,
        max_tokens:      350,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const latency      = (Date.now() - t0) / 1000;
    const raw          = data.choices[0]?.message?.content ?? '';
    const parsed       = JSON.parse(raw) as Partial<MentorBriefing>;

    if (!parsed.observation || !parsed.behavioral_root || !parsed.the_nudge) {
      throw new Error('Incomplete AI response schema');
    }

    captureAiGeneration(env, {
      distinctId:      childId,
      traceId,
      spanName:        'mentor_briefing',
      model:           'gpt-4o-mini',
      provider:        'openai',
      input:           messages,
      outputText:      raw,
      latencySeconds:  latency,
    });

    return {
      observation:     parsed.observation,
      behavioral_root: parsed.behavioral_root,
      the_nudge:       parsed.the_nudge,
      source:          'ai',
    };
  } catch (err) {
    const latency = (Date.now() - t0) / 1000;

    captureAiGeneration(env, {
      distinctId:     childId,
      traceId,
      spanName:       'mentor_briefing',
      model:          'gpt-4o-mini',
      provider:       'openai',
      input:          messages,
      latencySeconds: latency,
      isError:        true,
      errorMessage:   err instanceof Error ? err.message : String(err),
    });

    return buildRuleBasedBriefing(input);
  }
}

async function generateDiscoveryBriefing(
  env:         Env,
  childId:     string,
  childName:   string,
  outstanding: DiscoveryCandidateKey[],
): Promise<DiscoveryBriefingContent & { source: 'ai' | 'rule_based' }> {
  const systemPrompt = `You are the 'Orchard Lead', a collaborative financial coach for parents. \
A child has just started on Morechard and has not yet completed enough tasks for real behavioural \
coaching. Your job is to write a short, warm onboarding note for the parent.

You are given a list of "outstanding" setup steps for this child — a subset of:
- ASSIGN_MORE_CHORES: fewer than 3 chores are currently assigned to the child.
- SET_A_GOAL: the child has no active savings goal.
- ENABLE_PHOTO_CHECKIN: none of the child's chores require photo proof.

CONSTRAINTS:
- Only write about the steps in the given "outstanding" list. Never invent or mention a step that
  is not listed — if a step isn't listed, treat it as already done and do not reference it.
- If "outstanding" is an empty array, write ONLY a short intro telling the parent everything is
  set up and you just need a few completions from the child to start coaching — return an empty
  "actions" array in that case.
- Use first-person singular ("I'm building a picture of...") — this note is from the Mentor
  observing the child, distinct from the family-wide "We" voice used elsewhere in the app.
- Tone: warm, professional, not childish. UK English.
- Respond ONLY with a valid JSON object. No markdown, no commentary, no extra fields.

Response schema (strict):
{
  "intro": "<1-2 sentences>",
  "actions": ["<one sentence per outstanding step, same order as given, empty array if none>"]
}`;

  const userPrompt = JSON.stringify({ child_name: childName, outstanding });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];
  const traceId = crypto.randomUUID();
  const t0      = Date.now();

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:           'gpt-4o-mini',
        messages,
        max_tokens:      250,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);

    const data   = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw    = data.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as Partial<DiscoveryBriefingContent>;

    if (!parsed.intro || !Array.isArray(parsed.actions)) {
      throw new Error('Incomplete AI response schema');
    }

    const actions = parsed.actions.filter((a): a is string => typeof a === 'string').slice(0, 3);

    captureAiGeneration(env, {
      distinctId:     childId,
      traceId,
      spanName:       'discovery_briefing',
      model:          'gpt-4o-mini',
      provider:       'openai',
      input:          messages,
      outputText:     raw,
      latencySeconds: (Date.now() - t0) / 1000,
    });

    return { intro: parsed.intro, actions, source: 'ai' };
  } catch (err) {
    captureAiGeneration(env, {
      distinctId:     childId,
      traceId,
      spanName:       'discovery_briefing',
      model:          'gpt-4o-mini',
      provider:       'openai',
      input:          messages,
      latencySeconds: (Date.now() - t0) / 1000,
      isError:        true,
      errorMessage:   err instanceof Error ? err.message : String(err),
    });

    return { ...buildRuleBasedDiscoveryBriefing(childName, outstanding), source: 'rule_based' };
  }
}

// ── Jar Briefing Helpers ──────────────────────────────────────────────────────

function buildJarBriefingParagraph(s: {
  save_raids: number; give_balance_age_days: number; weeks_at_current_deviation: number;
  auto_off_weeks: number; manual_move_count: number; give_pct: number;
  deviation_score: number; positive_streak_weeks: number; spend_pct: number; save_pct: number;
  enabled: boolean;
}): string {
  const lines: string[] = ['JAR ALLOCATION DATA (Spend/Save/Give feature):'];
  // Priority 1
  if (s.save_raids >= 2) lines.push(`⚠ SAVE-JAR RAIDING: ${s.save_raids} moves from Save to Spend this week. Child's savings goal may be at risk.`);
  // Priority 2
  if (s.give_balance_age_days >= 21) lines.push(`⚠ GIVE-JAR STAGNATION: Give balance has sat untouched for ${s.give_balance_age_days} days. Child may need a prompt to follow through on giving.`);
  // Priority 3
  if (s.weeks_at_current_deviation >= 3 && s.deviation_score > 25) lines.push(`⚠ PERSISTENT DEVIATION: Allocation has been more than 25 points from the ideal 70/20/10 split for ${s.weeks_at_current_deviation} consecutive weeks.`);
  // Priority 4
  if (s.auto_off_weeks >= 2) lines.push(`⚠ AUTO-ALLOCATION DORMANT: Auto-split has been off for ${s.auto_off_weeks} weeks. The habit may be lapsing.`);
  // Priority 5
  if (s.manual_move_count >= 4) lines.push(`NOTE: ${s.manual_move_count} manual jar moves this week — possible indecision or gaming.`);
  // Priority 6
  if (s.give_pct === 0 && s.weeks_at_current_deviation >= 4) lines.push(`NOTE: Give jar set to 0% for 4+ weeks. Mention gently — autonomy is respected.`);
  // Priority 8: disengagement — handled in the jars-off path in generateBriefing; fires here
  // only when jars are disabled and auto_off_weeks >= 3 (called from the outer else branch).
  if (!s.enabled && s.auto_off_weeks >= 3) {
    lines.push(`⚠ HABIT DISENGAGEMENT: Child turned off auto-allocation ${s.auto_off_weeks} weeks ago and has not re-enabled it.`);
  }
  // Priority 10 (positive)
  if (s.positive_streak_weeks >= 3) lines.push(`✓ POSITIVE STREAK: On-target 70/20/10 split maintained for ${s.positive_streak_weeks} consecutive weeks — celebrate this.`);

  // Priority 7: impulse/hoarding — complex condition, omitted per spec note
  // (requires cross-week spend velocity data not available in JarSignals)

  if (lines.length === 1) lines.push('No jar behaviour signals this week.');
  const topLines = lines.slice(0, 3); // max 3 signals per briefing (header + 2 signal lines)
  return topLines.join('\n');
}

function buildJarReadinessNudge(_s: { enabled: boolean; deviation_score: number }): string {
  // Signal 9: fires when jars are OFF and balance has been building (checked in insights route)
  return 'JAR READINESS NUDGE: This child has been earning consistently but has not yet enabled the Spend/Save/Give jar split. This might be a good week to suggest it — let them choose their own percentages.';
}
