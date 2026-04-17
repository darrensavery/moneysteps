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
}

// Completion lifecycle statuses
// 'available'       — lazy-generated for a recurring chore period, not yet submitted
// 'awaiting_review' — child submitted, parent to review
// 'completed'       — approved, ledger written
// 'needs_revision'  — parent sent back with notes
export type CompletionStatus = 'available' | 'awaiting_review' | 'completed' | 'needs_revision';

export type PaymentType = 'LIFETIME' | 'AI_ANNUAL';

/** Shape returned by SELECT on the families table for trial/license checks. */
export interface FamilyLicenseRow {
  id: string;
  trial_start_date: string | null;   // ISO datetime string from D1
  is_activated: number;              // D1 returns booleans as 0/1
  has_lifetime_license: number;
  ai_subscription_expiry: string | null;
}

/** Result shape passed to the frontend for the TrialCountdown component. */
export interface TrialStatus {
  is_activated: boolean;
  days_remaining: number | null;   // null = trial not yet started
  is_expired: boolean;
  has_lifetime_license: boolean;
  ai_subscription_active: boolean;
}

export type Currency = 'GBP' | 'PLN' | 'USD';
export type Locale = 'en' | 'en-US' | 'pl';
export type VerifyMode = 'amicable' | 'standard';
export type ParentingMode = 'single' | 'co-parenting';
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
