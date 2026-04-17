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

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// GET /api/insights
// ----------------------------------------------------------------
export async function handleInsights(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);

  const family_id = url.searchParams.get('family_id');
  const child_id  = url.searchParams.get('child_id');
  const period    = url.searchParams.get('period') ?? 'week';

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const effectiveChildId = auth.role === 'child' ? auth.sub : child_id;
  if (!effectiveChildId) return error('child_id required');
  if (auth.role === 'child' && effectiveChildId !== auth.sub) return error('Forbidden', 403);

  const periodStart = getPeriodStart(period);
  const now         = Math.floor(Date.now() / 1000);

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
  const earliestResolved  = passRateRow?.earliest_resolved ?? null;
  const tasksRevised      = totalCompleted - firstTimePasses;

  const firstTimePassRate = totalCompleted > 0
    ? Math.round((firstTimePasses / totalCompleted) * 100)
    : null;

  // ── 2. Discovery Phase Flag ───────────────────────────────────────────────
  // < 3 completed tasks all-time OR < 7 days since first completion
  const allTimeRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
  `).bind(family_id, effectiveChildId)
    .first<{ total: number }>();

  const allTimeCompleted  = allTimeRow?.total ?? 0;
  const daysSinceFirst    = earliestResolved ? (now - earliestResolved) / 86400 : 0;
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
  // Compare child's avg reward vs family avg. Requires ≥ 3 completions.
  let effortPreference: 'high_yield' | 'steady' | null = null;
  if (allTimeCompleted >= 3) {
    const [childAvgRow, familyAvgRow] = await Promise.all([
      env.DB.prepare(`
        SELECT AVG(reward_amount) AS avg_reward FROM completions
        WHERE family_id = ? AND child_id = ? AND status = 'completed'
      `).bind(family_id, effectiveChildId)
        .first<{ avg_reward: number | null }>(),
      env.DB.prepare(`
        SELECT AVG(reward_amount) AS avg_reward FROM completions
        WHERE family_id = ? AND status = 'completed'
      `).bind(family_id)
        .first<{ avg_reward: number | null }>(),
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
  const [earnedRow, spentRow, savedRow, balanceRow, lifetimeRow, goalsRow] = await Promise.all([
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

    // Available balance: sum of credits minus debits from ledger
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END), 0) AS available
      FROM ledger
      WHERE family_id = ? AND child_id = ?
    `).bind(family_id, effectiveChildId)
      .first<{ available: number }>(),

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
  const availableBal  = balanceRow?.available ?? 0;
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

  // Upsert today's snapshot if none exists for the current ISO week.
  const weekKey = getIsoWeekKey(new Date()); // e.g. '2026-W15'

  const existingThisWeek = await env.DB.prepare(`
    SELECT id FROM insight_snapshots
    WHERE child_id = ? AND snapshot_date = ?
  `).bind(effectiveChildId, weekKey).first<{ id: number }>();

  if (!existingThisWeek) {
    await env.DB.prepare(`
      INSERT INTO insight_snapshots
        (child_id, family_id, snapshot_date, consistency_score, responsibility_score,
         planning_horizon, total_earned_pence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      effectiveChildId,
      family_id,
      weekKey,
      consistencyScore,
      firstTimePassRate,
      planningHorizon,
      lifetimeEarned,
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
    env.DB.prepare(`SELECT locale, display_name FROM users WHERE id = ?`)
      .bind(effectiveChildId).first<{ locale: string; display_name: string }>().catch(() => null),
  ]);

  const isTeenMode  = (settingsRow?.teen_mode ?? 0) === 1;
  const locale      = (userRow?.locale ?? 'en') as 'en' | 'pl';
  // First name only — used for formal Polish address and child-friendly nudges
  const childName   = (userRow?.display_name ?? '').split(' ')[0] || 'there';
  const honorific   = locale === 'pl' && isTeenMode
    ? getPolishHonorific(childName)
    : '';

  // Weeks of history (min 1 to avoid division by zero)
  const oldestCompletionRow = await env.DB.prepare(`
    SELECT MIN(resolved_at) AS oldest FROM completions
    WHERE family_id = ? AND child_id = ? AND status = 'completed'
  `).bind(family_id, effectiveChildId).first<{ oldest: number | null }>();

  const oldestEpoch    = oldestCompletionRow?.oldest ?? now;
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

  // ── 9. Orchard Lead Mentor Briefing (AI, cached per week) ────────────────
  let mentorBriefing: MentorBriefing | null = null;

  if (!isDiscoveryPhase) {
    // Re-fetch the snapshot row we just upserted so we have its briefing state.
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
      mentorBriefing = await generateBriefing(env, {
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

  return json({
    period,
    period_start_epoch: periodStart || null,
    child_id: effectiveChildId,

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
  const masculineAExceptions = ['kuba', 'barnaba', 'kosma', 'saba', 'bonawentura'];
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
}

function buildSystemPrompt(
  locale: 'en' | 'pl',
  isTeenMode: boolean,
  childName: string,
  honorific: string,
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

    return `Jesteś "Mistrzem Sadu" (Mistrz Sadu) — wysokiej klasy konsultantem finansowym dla rodziców. \
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
  return `You are the 'Orchard Lead', a collaborative financial coach for parents. \
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

function buildRuleBasedBriefing(input: BriefingInput): MentorBriefing {
  const {
    trends, consistencyScore, firstTimePassRate, planningHorizon,
    velocityContext, availableBalancePence, goalsLockedPence, locale,
    childName, honorific,
  } = input;

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
          ? `Zauważyliśmy, że dostępne saldo przekroczyło ${balanceDisplay}—w Sadzie zgromadził się znaczący nadmiar.`
          : `We have noted that the available balance has exceeded ${balanceDisplay}—a meaningful surplus has accumulated in the Orchard.`)
      : (isPl
          ? 'Zauważyliśmy, że wszystkie aktywne cele oszczędnościowe zostały w pełni sfinansowane w tym okresie—to ważny kamień milowy w cyklu Zbiorów.'
          : 'We have observed that all active savings goals have been fully funded this period—a significant milestone in the Harvest cycle.');

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

    return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
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
    return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
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
    return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
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
    return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
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
          ? `You might consider introducing the idea of a "Boost" from a parent as a matching contribution—framing it to ${childName} as "the Orchard growing your seed" makes compound interest intuitive.`
          : `You might consider modelling with ${childName} what a 5% or 10% annual return would look like on their current savings balance—this anchors Pillar 4 in a real number rather than an abstract concept.`);
    return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
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
  return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
}

async function generateBriefing(env: Env, input: BriefingInput): Promise<MentorBriefing> {
  const isTeenMode   = input.velocityContext.mode === 'professional';
  const systemPrompt = buildSystemPrompt(input.locale, isTeenMode, input.childName, input.honorific);

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

  const userPrompt = input.locale === 'pl'
    ? `Przeanalizuj te tygodniowe dane finansowego zachowania dziecka i zwróć briefing JSON:\n\n${userMessage}`
    : `Analyse this child's weekly financial behaviour data and return the JSON briefing:\n\n${userMessage}`;

  try {
    const result = await Promise.race([
      env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 350,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), 5000)
      ),
    ]) as { response?: string };

    const raw = result?.response ?? '';
    // Extract the first JSON object from the response (model may include preamble).
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('No JSON in AI response');

    const parsed = JSON.parse(match[0]) as Partial<MentorBriefing>;
    if (!parsed.observation || !parsed.behavioral_root || !parsed.the_nudge) {
      throw new Error('Incomplete AI response schema');
    }

    return {
      observation:     parsed.observation,
      behavioral_root: parsed.behavioral_root,
      the_nudge:       parsed.the_nudge,
      source:          'ai',
    };
  } catch {
    // Timeout or parse failure — return rule-based fallback.
    return buildRuleBasedBriefing(input);
  }
}
