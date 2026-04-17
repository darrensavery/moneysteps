/**
 * Morechard API client
 * All requests go through the Cloudflare Worker at /api or /auth.
 * JWT is stored in localStorage under 'mc_token'.
 */

const BASE = '';

export function getToken(): string | null {
  return localStorage.getItem('mc_token');
}

export function setToken(token: string): void {
  localStorage.setItem('mc_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('mc_token');
  localStorage.removeItem('mc_family_id');
  localStorage.removeItem('mc_user_id');
  localStorage.removeItem('mc_role');
}

export function getFamilyId(): string {
  if (localStorage.getItem('mc_family_id')) {
    return localStorage.getItem('mc_family_id')!;
  }
  // Fall back to device identity (set during registration)
  try {
    const raw = localStorage.getItem('mc_device_identity');
    if (raw) return (JSON.parse(raw) as { family_id?: string }).family_id ?? '';
  } catch { /* ignore */ }
  return '';
}

export function getUserId(): string {
  return localStorage.getItem('mc_user_id') ?? '';
}

export function getRole(): 'parent' | 'child' | null {
  return localStorage.getItem('mc_role') as 'parent' | 'child' | null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json() as T & { error?: string };

  if (!res.ok) {
    throw new Error((data as Record<string, unknown>).error as string ?? `HTTP ${res.status}`);
  }
  return data;
}

// ----------------------------------------------------------------
// Auth
// ----------------------------------------------------------------
export interface CreateFamilyResult { family_id: string; user_id: string; email: string }
export async function createFamily(body: {
  display_name: string; email: string; password?: string;
  governance_mode?: string; base_currency?: string; parenting_mode?: string; locale?: string;
}): Promise<CreateFamilyResult> {
  return request('/auth/create-family', { method: 'POST', body: JSON.stringify(body) });
}

export interface LoginResult { token: string; expires_in: number }
export interface ChildLoginResult extends LoginResult { graduation_pending?: boolean }
export async function login(email: string, password: string): Promise<LoginResult> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export async function requestMagicLink(email: string): Promise<{ sent: boolean }> {
  return request('/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function verifyMagicLink(token: string): Promise<LoginResult & { family_id: string; user_id: string; role: string }> {
  return request(`/api/auth/verify?token=${encodeURIComponent(token)}`);
}

export async function childLogin(family_id: string, child_id: string, pin: string): Promise<ChildLoginResult> {
  return request('/auth/child/login', { method: 'POST', body: JSON.stringify({ family_id, child_id, pin }) });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
  clearToken();
}

export interface MeResult {
  id: string; display_name: string; email: string | null;
  email_verified: number; email_pending: string | null;
  family_id: string; role: 'parent' | 'child'; locale: string;
  has_password: boolean;
  has_pin: boolean;
}
export async function getMe(): Promise<MeResult> {
  return request('/auth/me');
}
export async function updateProfile(
  body: { display_name?: string; email?: string },
): Promise<MeResult> {
  return request('/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
}

// ----------------------------------------------------------------
// Co-parent-aware account deletion
// ----------------------------------------------------------------
export async function getLeadCount(): Promise<{ lead_count: number }> {
  return request('/auth/family/leads', { method: 'GET' });
}

export async function leaveFamily(): Promise<{ ok: boolean; action: string }> {
  return request('/auth/me/leave', { method: 'DELETE' });
}

export async function deleteFamily(): Promise<{ ok: boolean; action: string }> {
  return request('/auth/family', { method: 'DELETE' });
}

// ----------------------------------------------------------------
// Security — PIN & Sessions
// ----------------------------------------------------------------

export interface SessionRow {
  jti: string;
  issued_at: number;
  user_agent: string | null;
}

/** Set or change the parent PIN. Always requires the email password (master key). */
export async function setParentPin(password: string, newPin: string): Promise<{ ok: boolean }> {
  return request('/auth/pin/set', { method: 'POST', body: JSON.stringify({ password, new_pin: newPin }) });
}

/** Same server route as setParentPin — separate name for distinct UI copy ("Forgot PIN?"). */
export async function resetPinWithPassword(password: string, newPin: string): Promise<{ ok: boolean }> {
  return request('/auth/pin/reset-with-password', { method: 'POST', body: JSON.stringify({ password, new_pin: newPin }) });
}

/** Verify the parent's 4-digit PIN. Throws on 401 (wrong) or 429 (locked). */
export async function verifyPin(pin: string): Promise<{ ok: boolean }> {
  return request('/auth/verify-pin', { method: 'POST', body: JSON.stringify({ pin }) });
}

/** List all active sessions for the current parent. */
export async function getSessions(): Promise<{ sessions: SessionRow[] }> {
  return request('/auth/sessions');
}

/** Revoke a single session by JTI. */
export async function revokeSession(jti: string): Promise<{ ok: boolean }> {
  return request(`/auth/sessions/${jti}`, { method: 'DELETE' });
}

/** Revoke all sessions except the current one. */
export async function revokeOtherSessions(): Promise<{ ok: boolean; revoked: number }> {
  return request('/auth/sessions?others=true', { method: 'DELETE' });
}

// ----------------------------------------------------------------
// Family & children
// ----------------------------------------------------------------
export async function getFamily(): Promise<Record<string, unknown>> {
  return request('/api/family');
}

export interface TrialStatus {
  is_activated:         boolean
  days_remaining:       number | null
  is_expired:           boolean
  has_lifetime_license: boolean
  ai_subscription_active: boolean
}

export async function getTrialStatus(): Promise<TrialStatus> {
  return request('/api/trial/status')
}

export async function updateFamily(body: Record<string, unknown>): Promise<void> {
  await request('/api/family', { method: 'PATCH', body: JSON.stringify(body) });
}

export interface ChildRecord {
  id: string; display_name: string; avatar_id: string | null; locked_until: number | null;
}
export async function getChildren(): Promise<{ children: ChildRecord[] }> {
  return request('/api/children');
}

// ----------------------------------------------------------------
// Settings
// ----------------------------------------------------------------
export async function getSettings(): Promise<{ avatar_id: string; theme: string; locale: string; app_view: string }> {
  return request('/api/settings');
}

export async function updateSettings(body: { avatar_id?: string; theme?: string; locale?: string }): Promise<void> {
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
}

// Parent reads/writes settings for a specific child
export async function getChildSettings(child_id: string): Promise<{ avatar_id: string; theme: string; locale: string; app_view: string }> {
  return request(`/api/child/${child_id}/settings`);
}

export async function updateChildSettings(child_id: string, body: { app_view?: string }): Promise<void> {
  return request(`/api/child/${child_id}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ----------------------------------------------------------------
// Child growth path (earnings mode + allowance)
// ----------------------------------------------------------------
export interface ChildGrowthSettings {
  id: string;
  display_name: string;
  earnings_mode: 'ALLOWANCE' | 'CHORES' | 'HYBRID';
  allowance_amount: number;
  allowance_frequency: 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';
}

export async function getChildGrowth(child_id: string): Promise<ChildGrowthSettings> {
  return request(`/api/child-growth/${encodeURIComponent(child_id)}`);
}

export async function updateChildGrowth(child_id: string, body: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>): Promise<void> {
  await request(`/api/child-growth/${encodeURIComponent(child_id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ----------------------------------------------------------------
// Chores
// ----------------------------------------------------------------
export interface Chore {
  id: string; family_id: string; assigned_to: string; created_by: string;
  title: string; description: string | null; reward_amount: number; currency: string;
  frequency: string; due_date: string | null; is_priority: number; is_flash: number;
  flash_deadline: string | null; archived: number;
  proof_required: number; auto_approve: number;
  child_name: string; parent_name: string;
  created_at: number; updated_at: number;
}

export async function getChores(params: { family_id: string; child_id?: string; archived?: boolean }): Promise<{ chores: Chore[] }> {
  const q = new URLSearchParams({ family_id: params.family_id });
  if (params.child_id) q.set('child_id', params.child_id);
  if (params.archived) q.set('archived', '1');
  return request(`/api/chores?${q}`);
}

export async function createChore(body: {
  family_id: string; assigned_to: string; title: string;
  reward_amount: number; currency: string; frequency?: string;
  due_date?: string; description?: string; is_priority?: boolean;
  is_flash?: boolean; flash_deadline?: string;
  proof_required?: boolean; auto_approve?: boolean;
}): Promise<Chore> {
  return request('/api/chores', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateChore(id: string, body: Partial<Chore>): Promise<Chore> {
  return request(`/api/chores/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function archiveChore(id: string): Promise<void> {
  await request(`/api/chores/${id}`, { method: 'DELETE' });
}

export async function restoreChore(id: string): Promise<void> {
  await request(`/api/chores/${id}/restore`, { method: 'POST' });
}

export async function submitChore(id: string, note?: string): Promise<{ id: string; status: string }> {
  return request(`/api/chores/${id}/submit`, { method: 'POST', body: JSON.stringify({ note }) });
}

// ----------------------------------------------------------------
// Completions
// ----------------------------------------------------------------
export interface Completion {
  id: string; chore_id: string; child_id: string; child_name: string;
  chore_title: string; reward_amount: number; currency: string;
  note: string | null;
  /** @deprecated use parent_notes */
  rejection_note: string | null;
  parent_notes: string | null;
  proof_url: string | null;      // R2 object key — fetch presigned URL separately
  attempt_count: number;         // > 1 means resubmission
  status: 'awaiting_review' | 'completed' | 'needs_revision' | 'pending';
  rating: number; submitted_at: number; resolved_at: number | null;
}

export async function getCompletions(params: {
  family_id: string; child_id?: string; status?: string;
}): Promise<{ completions: Completion[] }> {
  const q = new URLSearchParams({ family_id: params.family_id });
  if (params.child_id) q.set('child_id', params.child_id);
  if (params.status)   q.set('status', params.status);
  return request(`/api/completions?${q}`);
}

export async function getHistory(params: {
  family_id: string; child_id: string; limit?: number; offset?: number;
}): Promise<{ history: Completion[] }> {
  const q = new URLSearchParams({ family_id: params.family_id, child_id: params.child_id });
  if (params.limit)  q.set('limit',  String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  return request(`/api/completions/history?${q}`);
}

export async function approveCompletion(id: string): Promise<{ ledger_id: number; amount: number; currency: string }> {
  return request(`/api/completions/${id}/approve`, { method: 'POST' });
}

/** @deprecated use reviseCompletion */
export async function rejectCompletion(id: string, rejection_note?: string): Promise<void> {
  await request(`/api/completions/${id}/revise`, { method: 'POST', body: JSON.stringify({ parent_notes: rejection_note }) });
}

export async function reviseCompletion(id: string, parent_notes: string): Promise<void> {
  await request(`/api/completions/${id}/revise`, { method: 'POST', body: JSON.stringify({ parent_notes }) });
}

/** Upload photo evidence for a completion. Returns the R2 object key. */
export async function uploadProof(completionId: string, file: File): Promise<{ proof_url: string }> {
  const token = getToken();
  const res = await fetch(`/api/completions/${completionId}/proof`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const data = await res.json() as { proof_url?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { proof_url: data.proof_url ?? '' };
}

/** Get a short-lived presigned URL for a completion's proof photo. */
export async function getProofUrl(completionId: string): Promise<{ url: string }> {
  return request(`/api/completions/${completionId}/proof`);
}

// ----------------------------------------------------------------
// Insights
// ----------------------------------------------------------------
export interface TrendEntry {
  current: number | null;
  delta: number | null;
  direction: 'up' | 'down' | 'flat' | null;
}

export interface MentorBriefing {
  observation: string;
  behavioral_root: string;
  the_nudge: string;
  source: 'ai' | 'fallback' | 'cache';
}

export interface InsightsData {
  period: string;
  period_start_epoch: number | null;
  child_id: string;
  is_discovery_phase: boolean;
  all_time_completed: number;
  first_time_pass_rate: number | null;
  consistency_score: number | null;
  effort_preference: 'high_yield' | 'steady' | null;
  planning_horizon: number | null;
  savings_consistency: number | null;
  tasks_completed: number;
  tasks_revised: number;
  total_earned_pence: number;
  total_spent_pence: number;
  total_saved_pence: number;
  available_balance_pence: number;
  lifetime_earned_pence: number;
  goals_locked_pence: number;
  trends: {
    consistency: TrendEntry;
    responsibility: TrendEntry;
    horizon: TrendEntry;
  } | null;
  velocity_context: (
    | { mode: 'seedling';      avg_tasks_per_week: number }
    | { mode: 'professional';  avg_earned_pence_week: number }
  ) | null;
  mentor_briefing: MentorBriefing | null;
}

export async function getInsights(
  family_id: string,
  child_id: string,
  period: 'week' | 'month' | 'all' = 'week',
): Promise<InsightsData> {
  return request(`/api/insights?family_id=${family_id}&child_id=${child_id}&period=${period}`);
}

export async function approveAll(family_id: string, child_id: string): Promise<{ approved: number }> {
  return request('/api/completions/approve-all', { method: 'POST', body: JSON.stringify({ family_id, child_id }) });
}

export async function rateCompletion(id: string, rating: 1 | -1): Promise<void> {
  await request(`/api/completions/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating }) });
}

// ----------------------------------------------------------------
// Balance
// ----------------------------------------------------------------
export interface BalanceSummary {
  earned: number; pending: number; reversals: number;
  paid_out: number; spent: number; available: number;
}
export async function getBalance(family_id: string, child_id: string): Promise<BalanceSummary> {
  return request(`/api/balance?family_id=${family_id}&child_id=${child_id}`);
}

// ----------------------------------------------------------------
// Goals
// ----------------------------------------------------------------
export interface Goal {
  id: string; child_id: string; family_id: string; title: string;
  target_amount: number; currency: string; category: string;
  deadline: string | null; alloc_pct: number; match_rate: number;
  sort_order: number; archived: number; created_at: number; updated_at: number;
  // Savings Grove fields (migration 0013)
  status: 'ACTIVE' | 'REACHED' | 'ARCHIVED';
  current_saved_pence: number;
  product_url: string | null;
  parent_match_pct: number;
  parent_fixed_contribution: number;
}

/** Effective child-only target accounting for parent match */
export function effectiveTarget(goal: Goal): number {
  if (goal.parent_match_pct <= 0) return goal.target_amount;
  // child needs to save X so that X + X*(match_pct/100) = target
  return Math.ceil(goal.target_amount / (1 + goal.parent_match_pct / 100));
}

export async function getGoals(family_id: string, child_id: string): Promise<{ goals: Goal[] }> {
  return request(`/api/goals?family_id=${family_id}&child_id=${child_id}`);
}
export async function createGoal(body: Partial<Goal> & { family_id: string; child_id: string }): Promise<Goal> {
  return request('/api/goals', { method: 'POST', body: JSON.stringify(body) });
}
export async function updateGoal(id: string, body: Partial<Goal>): Promise<Goal> {
  return request(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deleteGoal(id: string): Promise<void> {
  await request(`/api/goals/${id}`, { method: 'DELETE' });
}
export async function purchaseGoal(id: string): Promise<{ ok: boolean; spend_id: string }> {
  return request(`/api/goals/${id}/purchase`, { method: 'POST' });
}
export async function contributeToGoal(id: string, amount_pence: number): Promise<Goal> {
  return request(`/api/goals/${id}/contribute`, { method: 'POST', body: JSON.stringify({ amount_pence }) });
}

// ----------------------------------------------------------------
// Plans
// ----------------------------------------------------------------
export interface Plan {
  id: string; chore_id: string; day_of_week: number; week_start: string;
  chore_title: string; reward_amount: number; currency: string;
}
export async function getPlans(family_id: string, child_id: string, week_start?: string): Promise<{ plans: Plan[] }> {
  const q = new URLSearchParams({ family_id, child_id });
  if (week_start) q.set('week_start', week_start);
  return request(`/api/plans?${q}`);
}
export async function createPlan(body: { family_id: string; chore_id: string; child_id: string; day_of_week: number; week_start?: string }): Promise<{ id: string }> {
  return request('/api/plans', { method: 'POST', body: JSON.stringify(body) });
}
export async function deletePlan(id: string): Promise<void> {
  await request(`/api/plans/${id}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------
// Suggestions
// ----------------------------------------------------------------
export interface Suggestion {
  id: string; child_id: string; child_name: string; title: string;
  frequency: string | null; proposed_amount: number; reason: string | null; status: string;
  submitted_at: number;
}
export async function getSuggestions(family_id: string, status?: string): Promise<{ suggestions: Suggestion[] }> {
  const q = new URLSearchParams({ family_id });
  if (status) q.set('status', status);
  return request(`/api/suggestions?${q}`);
}
export async function createSuggestion(body: { family_id: string; title: string; proposed_amount: number; frequency?: string; reason?: string }): Promise<{ id: string }> {
  return request('/api/suggestions', { method: 'POST', body: JSON.stringify(body) });
}

// ----------------------------------------------------------------
// Finance
// ----------------------------------------------------------------
export async function getSpending(family_id: string, child_id: string) {
  return request<{ spending: SpendingRecord[] }>(`/api/spending?family_id=${family_id}&child_id=${child_id}`);
}
export async function logSpend(body: { family_id: string; title: string; amount: number; currency: string; note?: string; goal_id?: string }) {
  return request('/api/spending', { method: 'POST', body: JSON.stringify(body) });
}
export async function getPayouts(family_id: string, child_id: string) {
  return request<{ payouts: PayoutRecord[] }>(`/api/payouts?family_id=${family_id}&child_id=${child_id}`);
}
export async function createPayout(body: { family_id: string; child_id: string; amount: number; currency: string; note?: string }) {
  return request('/api/payouts', { method: 'POST', body: JSON.stringify(body) });
}
export async function createBonus(body: { family_id: string; child_id: string; amount: number; currency: string; reason: string }) {
  return request('/api/bonus', { method: 'POST', body: JSON.stringify(body) });
}
export async function getSubscriptions(family_id: string, child_id: string) {
  return request<{ subscriptions: Subscription[] }>(`/api/subscriptions?family_id=${family_id}&child_id=${child_id}`);
}

export interface SpendingRecord { id: string; title: string; amount: number; currency: string; note: string | null; spent_at: number }
export interface PayoutRecord { id: string; amount: number; currency: string; note: string | null; paid_at: number; paid_by_name: string }
export interface Subscription { id: string; title: string; category: string; amount: number; currency: string; frequency: string; start_date: string }

// ----------------------------------------------------------------
// Invites
// ----------------------------------------------------------------
export interface AddChildResult { child_id: string; invite_code: string }
export async function addChild(
  display_name: string,
  earnings_mode: 'ALLOWANCE' | 'CHORES' | 'HYBRID',
  opening_balance_pence?: number,
): Promise<AddChildResult> {
  return request('/auth/child/add', {
    method: 'POST',
    body: JSON.stringify({ display_name, family_id: getFamilyId(), earnings_mode, opening_balance_pence }),
  });
}
export async function generateInvite(role: 'child' | 'co-parent'): Promise<{ code: string; expires_at: number }> {
  return request('/auth/invite/generate', {
    method: 'POST', body: JSON.stringify({ family_id: getFamilyId(), role }),
  });
}
export async function saveRegistrationStep(step: number, data: Record<string, unknown>): Promise<void> {
  const family_id = getFamilyId();
  if (!family_id) return;
  await request('/auth/registration/save-step', {
    method: 'POST', body: JSON.stringify({ family_id, step, step_data: data }),
  });
}

// ----------------------------------------------------------------
// Child identity management
// ----------------------------------------------------------------

export async function renameChild(childId: string, display_name: string): Promise<{ ok: boolean; display_name: string }> {
  return request(`/api/child/${childId}/display-name`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name }),
  });
}

export interface LoginEntry {
  id:           number;
  logged_at:    number;   // unixepoch
  ip_address:   string;
  device_label: string;   // e.g. "iPhone · Safari"
  device_type:  'mobile' | 'tablet' | 'desktop';
  is_current:   boolean;
}

export async function getChildLoginHistory(childId: string): Promise<{ logins: LoginEntry[] }> {
  return request(`/api/child/${childId}/login-history`);
}

export async function setChildPin(childId: string, pin: string): Promise<{ ok: boolean }> {
  return request('/auth/child/set-pin', {
    method: 'POST',
    body: JSON.stringify({ child_id: childId, pin }),
  });
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
export function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === 'PLN' ? 'zł' : '£';
  const formatted = (amount / 100).toFixed(2);
  return currency === 'PLN' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
}

export function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

// ── SLT Exchange ───────────────────────────────────────────────────

export interface SltExchangeResult {
  token: string
  user: {
    id:             string
    family_id:      string
    display_name:   string
    role:           'parent'
    parenting_role: 'LEAD_PARENT' | 'CO_PARENT'
    has_pin:        boolean
    has_password:   boolean
    google_picture: string | null
  }
}

export async function exchangeSlt(slt: string): Promise<SltExchangeResult> {
  return request('/auth/slt/exchange', {
    method: 'POST',
    body:   JSON.stringify({ slt }),
  })
}

// ----------------------------------------------------------------
// Learning Lab — Chat + Curriculum types and helpers
// ----------------------------------------------------------------

export interface ChatHistoryItem {
  id:          string
  message:     string
  reply:       string
  pillar:      string
  unlock_slug: string | null
  app_view:    'ORCHARD' | 'CLEAN'
  locale:      string
  created_at:  number
}

export interface ChatHistoryResponse {
  history: ChatHistoryItem[]
  limit:   number
  offset:  number
}

export interface ChatModuleItem {
  module_slug: string
  unlocked_at: number
}

export interface ChatModulesResponse {
  modules: ChatModuleItem[]
}

// Frontend mirror of worker/src/types.ts MentorResponse
export interface MentorResponse {
  reply:        string
  pillar:       string
  data_points:  Record<string, string | number | boolean>
  app_view:     'ORCHARD' | 'CLEAN'
  locale:       string
  unlock_slug?: string
}

export async function postChat(message: string): Promise<MentorResponse> {
  return request<MentorResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export async function getChatHistory(limit = 20, offset = 0): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>(`/api/chat/history?limit=${limit}&offset=${offset}`)
}

export async function getChatModules(): Promise<ChatModulesResponse> {
  return request<ChatModulesResponse>('/api/chat/modules')
}
