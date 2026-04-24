export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any; // Cloudflare Workers AI binding (@cloudflare/workers-types Ai)
  ENVIRONMENT: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  APP_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FIREBASE_PROJECT_ID: string;
  GOOGLE_CLIENT_ID:     string;
  GOOGLE_CLIENT_SECRET: string;
  POSTHOG_API_KEY:      string;
  POSTHOG_HOST:         string;
  OPENAI_API_KEY:       string;
}

// Completion lifecycle statuses
// 'available'       — lazy-generated for a recurring chore period, not yet submitted
// 'awaiting_review' — child submitted, parent to review
// 'completed'       — approved, ledger written
// 'needs_revision'  — parent sent back with notes
export type CompletionStatus = 'available' | 'awaiting_review' | 'completed' | 'needs_revision';

export type PaymentType = 'LIFETIME' | 'COMPLETE' | 'AI_ANNUAL' | 'SHIELD';

/** Shape returned by SELECT on the families table for trial/license checks. */
export interface FamilyLicenseRow {
  id: string;
  trial_start_date: string | null;   // ISO datetime string from D1
  is_activated: number;              // D1 returns booleans as 0/1
  has_lifetime_license: number;
  ai_subscription_expiry: string | null;
  has_shield: number;                // 0 or 1
}

/** Result shape passed to the frontend for the TrialCountdown component. */
export interface TrialStatus {
  is_activated: boolean;
  days_remaining: number | null;   // null = trial not yet started
  is_expired: boolean;
  has_lifetime_license: boolean;
  ai_subscription_active: boolean;
  has_shield: boolean;              // Shield plan add-on (£149.99 one-off)
}

export type Currency = 'GBP' | 'PLN' | 'USD';
export type Locale = 'en' | 'en-US' | 'pl';
export type VerifyMode = 'amicable' | 'standard';
export type ParentingMode = 'single' | 'co-parenting';

export interface FamilyContext {
  parenting_mode:   'single' | 'co-parenting';
  child_count:      number;
  child_names:      string[];    // first names of all children
  parent_names:     string[];    // first names of lead + all co-parents
  family_name:      string;      // families.name fallback: "the family"
  co_parent_active: boolean;     // both parents approved ≥1 chore in last 30d
  approval_skew:    number | null; // % of approvals by most-active parent (last 30d); null when single or <5 approvals
  has_shield:       boolean;     // Shield plan active — suppresses collaboration nudges
}

export type InviteRole = 'child' | 'co-parent';
export type EntryType = 'credit' | 'reversal' | 'payment';
export type VerificationStatus = 'pending' | 'verified_auto' | 'verified_manual' | 'disputed' | 'reversed';
export type GovernanceStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type Role = 'parent' | 'child';

export type DisputeCode =
  | 'ERR_NO_CONSENT'
  | 'ERR_NO_PROOF'
  | 'ERR_OUT_OF_SCOPE'
  | 'ERR_SPLIT_MISMATCH'
  | 'ERR_DUPLICATE';

export const DISPUTE_CODES: DisputeCode[] = [
  'ERR_NO_CONSENT',
  'ERR_NO_PROOF',
  'ERR_OUT_OF_SCOPE',
  'ERR_SPLIT_MISMATCH',
  'ERR_DUPLICATE',
];

export type CategoryCode =
  | 'CAT_EDUCATION'
  | 'CAT_MEDICAL'
  | 'CAT_CLOTHING'
  | 'CAT_ACTIVITIES'
  | 'CAT_TRAVEL'
  | 'CAT_CHILDCARE'
  | 'CAT_MAINTENANCE'
  | 'CAT_OTHER';

export const CATEGORY_CODES: CategoryCode[] = [
  'CAT_EDUCATION', 'CAT_MEDICAL', 'CAT_CLOTHING', 'CAT_ACTIVITIES',
  'CAT_TRAVEL', 'CAT_CHILDCARE', 'CAT_MAINTENANCE', 'CAT_OTHER',
];

export interface LedgerEntry {
  id: number;
  family_id: string;
  child_id: string;
  chore_id: string | null;
  entry_type: EntryType;
  amount: number;
  currency: Currency;
  description: string;
  receipt_id: string | null;
  category: CategoryCode | null;
  verification_status: VerificationStatus;
  authorised_by: string | null;
  verified_at: number | null;
  verified_by: string | null;
  dispute_code: DisputeCode | null;
  dispute_before: number | null;
  previous_hash: string;
  record_hash: string;
  ip_address: string;
  created_at: number;
}

export interface GovernanceRequest {
  id: number;
  family_id: string;
  requested_by: string;
  confirmed_by: string | null;
  old_mode: VerifyMode;
  new_mode: VerifyMode;
  status: GovernanceStatus;
  requested_at: number;
  expires_at: number;
  confirmed_at: number | null;
  request_ip: string;
  confirm_ip: string | null;
}

export interface StatusLogEntry {
  id: number;
  ledger_id: number;
  from_status: VerificationStatus;
  to_status: VerificationStatus;
  actor_id: string;
  dispute_code: DisputeCode | null;
  ip_address: string;
  created_at: number;
}

// ─────────────────────────────────────────────────────────────────
// AI Mentor — Intelligence snapshot & response shapes
// ─────────────────────────────────────────────────────────────────

export type FinancialPillar =
  | 'LABOR_VALUE'
  | 'DELAYED_GRATIFICATION'
  | 'OPPORTUNITY_COST'
  | 'CAPITAL_MANAGEMENT'
  | 'SOCIAL_RESPONSIBILITY';

/** Per-child intelligence snapshot built by getChildIntelligence(). */
export interface ChildIntelligence {
  // Identity
  child_id: string;
  display_name: string;
  locale: Locale;
  currency: Currency;
  app_view: 'ORCHARD' | 'CLEAN';
  earnings_mode: 'ALLOWANCE' | 'CHORES' | 'HYBRID';

  // Balance (smallest unit: pence/cents/grosze)
  balance_minor: number;

  // Goals (top 3 active, sorted by progress desc)
  goals: Array<{
    title: string;
    target_minor: number;
    saved_minor: number;
    progress_pct: number;          // 0–100
    deadline: string | null;
    parent_match_pct: number;
  }>;

  // Chores
  assigned_chore_count: number;
  completed_7d: number;           // completions in last 7 days
  needs_revision_7d: number;      // sent back in last 7 days

  // Reliability Rating (0–100, US "credit score" proxy)
  // = (first_time_pass / total_completed) * 100 − quality_penalty
  reliability_rating: number;

  // Velocity (minor units earned per day, trailing 7 days)
  velocity_7d: number;

  // Planning horizon (days ahead furthest planned chore)
  planning_horizon_days: number;

  // Sunday Scrambler flag
  // true when >60% of last 14 completions landed on the same weekday
  is_sunday_scrambler: boolean;
  scrambler_day: string | null;   // e.g. "Sunday"

  // Audit-Evidence Signals (derived from proof_exif / verification_confidence)
  consecutive_low_confidence: number; // leading run of 'Low' proof uploads; triggers integrity lesson at 3+
  batching_detected: boolean;         // ≥3 chores within 60-min EXIF window; triggers routine lesson

  // Behavioural Trigger Signals — each maps to a specific curriculum module unlock
  is_burner: boolean;           // balance hit 0 within 24h of a ledger credit → 04-needs-vs-wants
  is_stagnant: boolean;         // 0 completions in 14d after prior high activity → 18-money-and-mental-health
  inflation_nudge: boolean;     // reward increased on a chore the child has completed before → 14-inflation
  is_hoarder: boolean;          // balance > £100 + 0 spend in 60 days → 13-compound-growth
  overdue_chore_count: number;  // chores with due_date < today; triggers at ≥2 → 12-good-vs-bad-debt
  distinct_ips_7d: number;      // distinct IP addresses from child_logins in 7 days; triggers at 3+ → 05-scams-digital-safety

  // Spending (last 7 days)
  spent_minor_7d: number;
  spend_to_balance_pct: number;   // spent_7d / balance * 100

  // Cached snapshot from insight_snapshots (may be null first week)
  consistency_score: number | null;
  responsibility_score: number | null;
  last_snapshot_date: string | null;

  // Parent engagement
  bonus_pence_7d: number;
  has_parent_message: boolean;
  parent_message: string | null;
}

/** Structured response returned by the chat endpoint. */
export interface MentorResponse {
  reply: string;
  pillar: FinancialPillar;
  data_points: Record<string, string | number | boolean>;
  app_view: 'ORCHARD' | 'CLEAN';
  locale: Locale;
  unlock_slug?: string; // present only when this response triggered a module unlock
}

export interface ReferralStats {
  clicks:          number;
  sign_ups:        number;
  conversions:     number;
  rewards_pending: number;
}
