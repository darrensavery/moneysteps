/**
 * Morechard API client
 * All requests go through the Cloudflare Worker at /api or /auth.
 *
 * Web: the JWT lives in an HttpOnly cookie the browser attaches automatically
 * (see worker/src/lib/cookies.ts) — this client never reads or stores it.
 * Native (Capacitor): no reliable cookie story in a cross-origin WebView, so
 * the JWT is kept in Keychain/Keystore-backed secure storage and sent as a
 * Bearer header.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { clearCachedAuthState } from './authState.js';

const SECURE_STORAGE_KEY = 'mc_token';

// On Cloudflare Pages, relative URLs work because Pages Functions proxy
// /auth/* and /api/* to the Worker. Inside Capacitor (Android/iOS), the app
// loads from http://localhost/ with no proxy, so we need an absolute URL.
const BASE = Capacitor.isNativePlatform()
  ? ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'https://api.morechard.com')
  : '';

/** Build an absolute API URL. Pass the relative path (e.g. '/api/foo'); returns
 *  the same string on web and a fully-qualified worker URL on native. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/** Native-only: reads the Bearer token from Keychain/Keystore. Resolves null on web
 *  (the cookie is HttpOnly and invisible to JS by design) or on any storage error. */
export async function getToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { value } = await SecureStoragePlugin.get({ key: SECURE_STORAGE_KEY });
    return value ?? null;
  } catch {
    return null; // corrupted/inaccessible keychain — treat as logged out, never throw
  }
}

/** Native-only: writes the Bearer token to Keychain/Keystore. No-op on web. */
export async function setToken(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await SecureStoragePlugin.set({ key: SECURE_STORAGE_KEY, value: token });
}

/** Native-only: clears the Bearer token from Keychain/Keystore. No-op on web
 *  (there the server-side clearAuthCookie() on /auth/logout is what matters). */
export async function clearToken(): Promise<void> {
  clearCachedAuthState();
  if (!Capacitor.isNativePlatform()) return;
  await SecureStoragePlugin.remove({ key: SECURE_STORAGE_KEY }).catch(() => null);
}

/** Standard auth + content-type headers for callers that bypass request() (native only —
 *  used by the proof-upload/receipt-upload raw fetch() calls further down this file). */
export async function authHeaders(contentType?: string): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (contentType) h['Content-Type'] = contentType;
  if (Capacitor.isNativePlatform()) {
    const token = await getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
}

export function getFamilyId(): string {
  // Read exclusively from device identity — avoids exposing a separate localStorage key.
  try {
    const raw = localStorage.getItem('mc_device_identity');
    if (raw) return (JSON.parse(raw) as { family_id?: string }).family_id ?? '';
  } catch { /* ignore */ }
  return '';
}

export function getUserId(): string {
  try {
    const raw = localStorage.getItem('mc_device_identity');
    if (raw) return (JSON.parse(raw) as { user_id?: string }).user_id ?? '';
  } catch { /* ignore */ }
  return '';
}

export function getRole(): 'parent' | 'child' | null {
  try {
    const raw = localStorage.getItem('mc_device_identity');
    if (raw) return ((JSON.parse(raw) as { role?: string }).role ?? null) as 'parent' | 'child' | null;
  } catch { /* ignore */ }
  return null;
}

async function request<T>(path: string, options: RequestInit = {}, _retries = 2, skip402 = false): Promise<T> {
  const isNative = Capacitor.isNativePlatform();
  const isWrite  = !['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (isNative) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (isWrite) {
    // CSRF defense — see worker/src/lib/middleware.ts requireCsrfHeader().
    // Cross-site attacks can't set custom headers, so this alone blocks them.
    headers['X-Morechard-Client'] = '1';
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    // Web only: makes the browser send/receive the HttpOnly mc_token cookie.
    // Harmless to set on native too (native uses an absolute cross-origin URL
    // and doesn't rely on cookies either way).
    credentials: isNative ? 'omit' : 'include',
  });

  // D1 transient reset — retry up to twice with a short delay
  if (res.status === 503 && _retries > 0) {
    await new Promise(r => setTimeout(r, 800));
    return request<T>(path, options, _retries - 1, skip402);
  }

  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
  } catch {
    if (!res.ok) throw new Error('Something went wrong — please try again.');
    throw new Error('Unexpected response from server. Please try again.');
  }

  // Token expired or revoked — clear the token but NOT the device identity.
  // Device identity is set during join and is independent of the JWT lifetime.
  // Clearing it would force the child through the full re-join flow (6-digit code),
  // which is wrong — only the token needs refreshing.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    await clearToken();
    window.location.href = '/';
    throw new Error((data as Record<string, unknown>).error as string ?? 'Session expired');
  }

  // Trial expired — worker sends 402 with { redirect: '/paywall' }
  if (res.status === 402 && !skip402) {
    window.location.href = '/paywall';
    throw new Error('Trial expired');
  }

  // Account locked by parent — throw with a recognisable code so UI can show a lock state
  if (res.status === 423) {
    const msg = (data as Record<string, unknown>).error as string ?? 'Account temporarily restricted';
    throw Object.assign(new Error(msg), { code: 'ACCOUNT_LOCKED' });
  }

  if (!res.ok) {
    throw new Error((data as Record<string, unknown>).error as string ?? 'Something went wrong — please try again.');
  }
  return data;
}

// ----------------------------------------------------------------
// Auth
// ----------------------------------------------------------------
// sent:true = existing verified account — magic link already sent server-side
export type CreateFamilyResult =
  | { family_id: string; user_id: string; email: string; sent?: never }
  | { sent: true; family_id?: never; user_id?: never }

export async function createFamily(body: {
  display_name: string; email: string; password?: string;
  governance_mode?: string; base_currency?: string; parenting_mode?: string; locale?: string;
  referred_by_code?: string; turnstile_token?: string;
}): Promise<CreateFamilyResult> {
  return request('/auth/create-family', { method: 'POST', body: JSON.stringify(body) });
}

export interface LoginResult { token: string; expires_in: number }
export interface ChildLoginResult extends LoginResult { graduation_pending?: boolean }
export async function login(email: string, password: string): Promise<LoginResult> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export async function requestMagicLink(email: string, turnstileToken?: string): Promise<{ sent: boolean }> {
  return request('/auth/magic-link', { method: 'POST', body: JSON.stringify({ email, turnstile_token: turnstileToken }) });
}

export async function verifyMagicLink(token: string): Promise<LoginResult & { family_id: string; user_id: string; role: string }> {
  return request(`/api/auth/verify?token=${encodeURIComponent(token)}`);
}

export async function childLogin(family_id: string, child_id: string, pin: string): Promise<ChildLoginResult> {
  return request('/auth/child/login', { method: 'POST', body: JSON.stringify({ family_id, child_id, pin }) });
}

export type WebauthnRegisterOptionsResult =
  | { platform: 'native'; challenge: string }
  | { platform: 'web'; options: Record<string, unknown> };

export async function webauthnRegisterOptions(
  platform: 'web' | 'native',
  displayName?: string,
): Promise<WebauthnRegisterOptionsResult> {
  return request('/auth/webauthn/register/options', { method: 'POST', body: JSON.stringify({ platform, displayName }) });
}

export type WebauthnRegisterVerifyBody =
  | { platform: 'web'; response: Record<string, unknown> }
  | { platform: 'native'; publicKey: string };

export async function webauthnRegisterVerify(body: WebauthnRegisterVerifyBody): Promise<{ ok: true }> {
  return request('/auth/webauthn/register/verify', { method: 'POST', body: JSON.stringify(body) });
}

export type WebauthnLoginOptionsResult =
  | { platform: 'native'; challenge: string }
  | { platform: 'web'; options: Record<string, unknown> };

export async function webauthnLoginOptions(
  userId: string,
  role: 'parent' | 'child',
  platform: 'web' | 'native',
): Promise<WebauthnLoginOptionsResult> {
  return request('/auth/webauthn/login/options', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role, platform }),
  });
}

export type WebauthnLoginVerifyBody =
  | { platform: 'web'; user_id: string; role: 'parent' | 'child'; response: Record<string, unknown> }
  | { platform: 'native'; user_id: string; role: 'parent' | 'child'; public_key: string; signature: string };

export async function webauthnLoginVerify(body: WebauthnLoginVerifyBody): Promise<{ token: string; expires_in: number }> {
  return request('/auth/webauthn/login/verify', { method: 'POST', body: JSON.stringify(body) });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
  await clearToken();
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

export async function getCoParents(): Promise<{ co_parents: { user_id: string; display_name: string }[] }> {
  return request('/auth/family/co-parents');
}

export async function removeCoParent(userId: string): Promise<{ ok: boolean }> {
  return request(`/auth/family/co-parent/${userId}`, { method: 'DELETE' });
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
  has_ai_mentor:        boolean  // AI Mentor + Learning Lab permanently unlocked
  has_shield:           boolean  // Morechard Shield AI — includes AI Mentor + PDF exports
}

export async function getTrialStatus(): Promise<TrialStatus> {
  return request('/api/trial/status', {}, 2, true)
}

export type PaymentTypeSku =
  | 'COMPLETE'
  | 'COMPLETE_AI'
  | 'SHIELD_AI'
  | 'AI_UPGRADE'
  | 'LIFETIME'    // legacy — appears in history only
  | 'AI_ANNUAL'   // legacy — appears in history only
  | 'SHIELD'      // legacy — appears in history only

export interface PaymentRecord {
  payment_type:    PaymentTypeSku
  amount_paid_int: number
  currency:        string
  created_at:      string
}

export async function getBillingHistory(): Promise<{ payments: PaymentRecord[] }> {
  return request('/api/billing/history')
}

export async function createCheckoutSession(
  payment_type: 'COMPLETE' | 'COMPLETE_AI' | 'SHIELD_AI' | 'AI_UPGRADE',
): Promise<{ url: string }> {
  return request('/api/stripe/create-checkout', {
    method: 'POST',
    body: JSON.stringify({ payment_type }),
  })
}

export interface ShieldUpgradePrice {
  full_price:   number   // pence
  already_paid: number   // pence
  delta:        number   // pence — amount that will be charged
  currency:     string
}

export async function getShieldUpgradePrice(): Promise<ShieldUpgradePrice> {
  return request('/api/stripe/shield-upgrade-price')
}

export async function cancelPlan(): Promise<{ refunded: boolean }> {
  return request('/api/billing/cancel', { method: 'DELETE' })
}

export async function updateFamily(body: Record<string, unknown>): Promise<void> {
  await request('/api/family', { method: 'PATCH', body: JSON.stringify(body) });
}

export interface ChildRecord {
  id: string; display_name: string; avatar_id: string | null; locked_until: number | null;
  monzo_handle: string | null;
  revolut_handle: string | null;
  paypal_handle: string | null;
  venmo_handle: string | null;
}
export async function getChildren(): Promise<{ children: ChildRecord[] }> {
  return request('/api/children');
}

// ----------------------------------------------------------------
// Settings
// ----------------------------------------------------------------
export async function getSettings(): Promise<{
  avatar_id: string; theme: string; locale: string; app_view: string;
  earnings_mode: string; allowance_amount: number; allowance_frequency: string;
}> {
  return request('/api/settings');
}

export async function getMyLockStatus(): Promise<{ locked: boolean; locked_until: number | null }> {
  return request('/api/account-lock/me');
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

export async function getChores(params: { family_id: string; child_id?: string; archived?: boolean; assigned_to?: string }): Promise<{ chores: Chore[] }> {
  const q = new URLSearchParams({ family_id: params.family_id });
  if (params.child_id) q.set('child_id', params.child_id);
  if (params.archived) q.set('archived', '1');
  if (params.assigned_to) q.set('assigned_to', params.assigned_to);
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

export async function claimChore(id: string): Promise<Chore> {
  return request(`/api/chores/${id}/claim`, { method: 'POST' });
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
  proof_exif: Record<string, unknown> | null;  // EXIF metadata; null when pruned or not captured
  system_verify: Record<string, unknown> | null; // GPS/device verification data; null when pruned
  attempt_count: number;         // > 1 means resubmission
  status: 'awaiting_review' | 'completed' | 'needs_revision' | 'rejected' | 'pending';
  rating: number; submitted_at: number; resolved_at: number | null;
  paid_out_at: number | null;
  pruned_at?: number | null;     // set by migration 0039 when evidence is archived (2+ years old)
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

export async function approveCompletion(id: string): Promise<{
  ledger_id:          number;
  amount:             number;
  currency:           string;
  show_review_prompt: boolean;
}> {
  return request(`/api/completions/${id}/approve`, { method: 'POST' });
}

export async function reviseCompletion(id: string, parent_notes: string): Promise<void> {
  await request(`/api/completions/${id}/revise`, { method: 'POST', body: JSON.stringify({ parent_notes }) });
}

export async function rejectCompletion(id: string, parent_notes?: string): Promise<void> {
  await request(`/api/completions/${id}/reject`, { method: 'POST', body: JSON.stringify({ parent_notes: parent_notes ?? '' }) });
}

export async function postReviewOutcome(outcome: 'prompted' | 'dismissed' | 'maybe_later'): Promise<void> {
  await request('/api/review-prompt/outcome', {
    method: 'POST',
    body: JSON.stringify({ outcome }),
  });
}

export async function postReviewFeedback(payload: {
  message:     string;
  platform:    'android' | 'ios' | 'web';
  app_version: string;
}): Promise<void> {
  await request('/api/review-prompt/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Upload photo evidence for a completion. Returns the R2 object key. */
export async function uploadProof(completionId: string, file: Blob): Promise<{ proof_url: string }> {
  const res = await fetch(apiUrl(`/api/completions/${completionId}/proof`), {
    method: 'POST',
    headers: await authHeaders(file.type || 'application/octet-stream'),
    credentials: Capacitor.isNativePlatform() ? 'omit' : 'include',
    body: file,
  });
  const data = await res.json() as { proof_url?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong — please try again.');
  return { proof_url: data.proof_url ?? '' };
}

/** Fetch proof photo from the Worker and return a local blob URL for use in <img>. */
export async function getProofUrl(completionId: string): Promise<{ url: string }> {
  const res = await fetch(apiUrl(`/api/completions/${completionId}/proof`), {
    headers: await authHeaders(),
    credentials: Capacitor.isNativePlatform() ? 'omit' : 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(data.message ?? 'Something went wrong — please try again.');
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob) };
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

export interface SparklinePoints {
  responsibility: number[];
  consistency:    number[];
  savings:        number[];
}

export interface MilestoneMarker {
  metric:       'responsibility' | 'consistency' | 'savings';
  point_index:  number;
  module_title: string;
  delta_after:  number;
}

export interface CurrentModule {
  slug:         string;
  title:        string;
  progress_pct: number;
  pillar:       string;
}

export interface LabModuleProgress {
  slug:           string;
  title:          string;
  pillar:         string;
  level:          number;
  unlocked_at:    number;
  completed_acts: number[];
  total_minutes:  number;
  minutes_done:   number;
}

export interface InsightsData {
  period: string;
  period_start_epoch: number | null;
  child_id: string;
  is_demo?: boolean;
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
  discovery_briefing: { intro: string; actions: string[]; source: 'ai' | 'rule_based' } | null;
  // New additive fields
  sparkline_points:       SparklinePoints | null;
  learning_lab_enabled:   boolean;
  current_module:         CurrentModule | null;
  completed_module_slugs: string[];
  retention_score:        number | null;
  milestone_markers:      MilestoneMarker[];
  chore_events?:          { point_index: number; first_pass: boolean }[];
  // Richer Learning Lab data
  lab_module_progress:       LabModuleProgress[];
  lab_acts_completed:        number;
  lab_time_invested_minutes: number;
  lab_last_active_at:        number | null;
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
export interface BalanceStreak {
  current: number
  longest: number
  grace_remaining: number
  last_kept_date: string | null
}

export interface BalanceSummary {
  earned: number; pending: number; reversals: number;
  paid_out: number; spent: number; available: number;
  streak?: BalanceStreak
  pending_celebrations?: string[]
  jars?: { enabled: boolean; spend?: number; save?: number; give?: number };
}
export async function getBalance(family_id: string, child_id: string): Promise<BalanceSummary> {
  return request(`/api/balance?family_id=${family_id}&child_id=${child_id}`);
}

// ----------------------------------------------------------------
// Jars
// ----------------------------------------------------------------
export interface JarConfig {
  enabled: number;
  spend_pct: number;
  save_pct: number;
  give_pct: number;
  updated_at: number;
}

export interface JarBalances {
  enabled: boolean;
  spend: number;
  save: number;
  give: number;
  save_earmarked: number;
  save_unallocated: number;
}

export interface JarMovement {
  id: number;
  jar: 'spend' | 'save' | 'give';
  delta: number;
  earmark_pence: number | null;
  kind: string;
  ref_id: string | null;
  goal_id: number | null;
  note: string | null;
  created_at: number;
}

export interface GiveRequest {
  id: number;
  family_id: string;
  child_id: string;
  child_name?: string;
  cause: string;
  amount: number;
  currency: string;
  status: 'requested' | 'fulfilled' | 'declined';
  requested_at: number;
  fulfilled_at: number | null;
  parent_note: string | null;
}

export async function getJars(family_id: string, child_id: string): Promise<{ config: JarConfig; balances: JarBalances }> {
  return request(`/api/jars?family_id=${family_id}&child_id=${child_id}`);
}

export async function putJarConfig(body: {
  family_id: string; child_id: string;
  enabled?: number; spend_pct?: number; save_pct?: number; give_pct?: number;
  initial_seed?: { spend: number; save: number; give: number };
}): Promise<{ ok: boolean; balances: JarBalances }> {
  return request('/api/jars/config', { method: 'PUT', body: JSON.stringify(body) });
}

export async function postJarMove(body: {
  family_id: string; child_id: string;
  from_jar: 'spend' | 'save' | 'give'; to_jar: 'spend' | 'save' | 'give'; amount: number;
}): Promise<{ ok: boolean; balances: JarBalances }> {
  return request('/api/jars/move', { method: 'POST', body: JSON.stringify(body) });
}

export async function getJarMovements(family_id: string, child_id: string, limit = 20): Promise<{ movements: JarMovement[] }> {
  return request(`/api/jars/movements?family_id=${family_id}&child_id=${child_id}&limit=${limit}`);
}

export async function postGiveRequest(body: {
  family_id: string; child_id: string; cause: string; amount: number;
}): Promise<{ ok: boolean; id: number }> {
  return request('/api/give-requests', { method: 'POST', body: JSON.stringify(body) });
}

export async function getGiveRequests(family_id: string, status = 'requested'): Promise<{ give_requests: GiveRequest[] }> {
  return request(`/api/give-requests?family_id=${family_id}&status=${status}`);
}

export async function patchGiveRequest(id: number, action: 'fulfil' | 'decline', parent_note?: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/give-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ action, parent_note }) });
}

// ----------------------------------------------------------------
// Governance — mutual consent handshake for verify_mode changes
// ----------------------------------------------------------------
export interface GovernanceLogRow {
  id:           number;
  family_id:    string;
  requested_by: string;
  old_mode:     string;
  new_mode:     string;
  status:       'pending' | 'confirmed' | 'rejected' | 'expired';
  requested_at: number;
  expires_at:   number;
  confirmed_by: string | null;
  confirmed_at: number | null;
  action_taken: string;
}

export async function getGovernanceLog(familyId: string): Promise<{ log: GovernanceLogRow[] }> {
  return request(`/api/governance?family_id=${encodeURIComponent(familyId)}`);
}

export async function requestGovernanceChange(newMode: 'amicable' | 'standard'): Promise<{ governance_request_id: number; expires_at: number }> {
  return request('/api/governance/request', { method: 'POST', body: JSON.stringify({ new_mode: newMode }) });
}

export async function confirmGovernanceRequest(id: number): Promise<{ status: string; new_mode: string }> {
  return request(`/api/governance/${id}/confirm`, { method: 'POST' });
}

export async function rejectGovernanceRequest(id: number): Promise<{ status: string }> {
  return request(`/api/governance/${id}/reject`, { method: 'POST' });
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
  frequency: string | null; proposed_amount: number; reason: string | null;
  due_date: string | null; status: string; rejection_note: string | null;
  submitted_at: number; resolved_at: number | null;
}
export async function getSuggestions(family_id: string, status?: string): Promise<{ suggestions: Suggestion[] }> {
  const q = new URLSearchParams({ family_id });
  if (status) q.set('status', status);
  return request(`/api/suggestions?${q}`);
}
export async function createSuggestion(body: {
  family_id: string; title: string; proposed_amount: number;
  frequency?: string; reason?: string; due_date?: string;
}): Promise<{ id: string }> {
  return request('/api/suggestions', { method: 'POST', body: JSON.stringify(body) });
}
export async function approveSuggestion(id: string, overrides?: {
  title?: string; proposed_amount?: number; frequency?: string; due_date?: string | null;
}): Promise<{ ok: boolean; chore_id: string }> {
  return request(`/api/suggestions/${id}/approve`, { method: 'POST', body: JSON.stringify(overrides ?? {}) });
}
export async function rejectSuggestion(id: string, rejectionNote: string): Promise<void> {
  await request(`/api/suggestions/${id}/reject`, { method: 'POST', body: JSON.stringify({ rejection_note: rejectionNote }) });
}

// ----------------------------------------------------------------
// Finance
// ----------------------------------------------------------------
export async function getSpending(family_id: string, child_id: string) {
  return request<{ spending: SpendingRecord[] }>(`/api/spending?family_id=${family_id}&child_id=${child_id}`);
}
export async function logSpend(body: { family_id: string; title: string; amount: number; currency: string; note?: string; goal_id?: string; category?: string }) {
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

export interface SpendingRecord { id: string; title: string; amount: number; currency: string; note: string | null; category: string | null; spent_at: number }
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
export async function regenerateChildInvite(childId: string): Promise<{ invite_code: string; expires_at: number }> {
  return request(`/auth/child/${encodeURIComponent(childId)}/invite`, {
    method: 'POST',
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
  const formatted = (amount / 100).toFixed(2);
  if (currency === 'PLN') return `${formatted} zł`;
  if (currency === 'USD') return `$${formatted}`;
  return `£${formatted}`;
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
// Learning Lab
// ----------------------------------------------------------------

export interface LabChildData {
  currency:                string
  currentBalancePence:     number
  lifetimeEarningsPence:   number
  choreRateMedianPence:    number
  savingsStreakWeeks:       number
  balance4wkAgoPence:      number
  consecutiveWeeklyGrowth: number
  activeGoalsCount:        number
  reliabilityRating:       number
  distinctChoreTypes:      number
}

export interface LabModuleStatus {
  unlocked_at:    number
  completed_acts: number[]
}

export interface LabModulesResponse {
  modules:   Record<string, LabModuleStatus>
  childData: LabChildData
  ageLevel:  number
}

export async function getLabModules(): Promise<LabModulesResponse> {
  return request<LabModulesResponse>('/api/lab/modules')
}

export async function completeLabAct(moduleSlug: string, actNum: 1 | 2 | 3 | 4): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/lab/modules/${moduleSlug}/acts/${actNum}/complete`, { method: 'POST' })
}

// ----------------------------------------------------------------
// Market Rates
// ----------------------------------------------------------------
export interface MarketRate {
  id: string;
  canonical_name: string;
  category: string;
  synonyms: string[];
  median_amount: number | null;
  median_is_local: boolean;
  value_tier: 'seeds' | 'saplings' | 'oaks' | 'discoverable';
  value_tier_label: string;
  is_orchard_8: boolean;
  sort_order: number;
  data_source: string;
  sample_count: number;
}

export interface MarketRatesResponse {
  tile_source: 'hardcoded_defaults' | 'locale_frequent' | 'user_frequent';
  rates: MarketRate[];
}

export async function getMarketRates(locale?: string): Promise<MarketRatesResponse> {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return request<MarketRatesResponse>(`/api/market-rates${q}`);
}

export async function suggestChore(body: {
  canonical_name: string;
  median_amount: number;
  currency: string;
  context: string | null;
}): Promise<{ status: string }> {
  return request('/api/market-rates/suggest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Payment Bridge ─────────────────────────────────────────────────

export type MarkPaidResult = {
  completion_id: string;
  paid_out_at: number | null;
  was_already_paid: boolean;
};

export async function markPaid(completionId: string): Promise<MarkPaidResult> {
  return request(`/api/completions/${completionId}/mark-paid`, { method: 'POST' });
}

export async function markPaidBatch(
  familyId: string,
  completionIds: string[],
): Promise<{ stamped: number; paid_out_at: number | null }> {
  return request('/api/completions/mark-paid-batch', {
    method: 'POST',
    body: JSON.stringify({ family_id: familyId, completion_ids: completionIds }),
  });
}

export type UnpaidSummaryRow = {
  child_id: string;
  unpaid_total: number;
  unpaid_count: number;
  currency: string;
};

export async function getUnpaidSummary(
  familyId: string,
): Promise<{ children: UnpaidSummaryRow[] }> {
  return request(`/api/completions/unpaid-summary?family_id=${encodeURIComponent(familyId)}`);
}

export async function setPaymentHandles(
  childId: string,
  handles: Partial<{
    monzo_handle: string | null;
    revolut_handle: string | null;
    paypal_handle: string | null;
    venmo_handle: string | null;
  }>,
): Promise<{ child_id: string; updated: string[] }> {
  return request(`/api/child/${childId}/payment-handles`, {
    method: 'PATCH',
    body: JSON.stringify(handles),
  });
}

// ── Referrals ─────────────────────────────────────────────────────────────────

export async function getReferralCode(): Promise<{ code: string; share_url: string }> {
  return request('/api/referrals/me');
}

export async function getReferralStats(): Promise<{
  clicks: number;
  sign_ups: number;
  conversions: number;
  rewards_pending: number;
}> {
  return request('/api/referrals/stats');
}

export async function trackReferralClick(code: string): Promise<void> {
  await request('/api/referrals/click', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function postMarketingConsent(consented: boolean): Promise<void> {
  await request<{ ok: boolean }>('/api/consent/marketing', {
    method: 'POST',
    body: JSON.stringify({ consented }),
  });
}

export async function getMarketingConsent(): Promise<{ consented: boolean | null; consent_version: string | null }> {
  return request<{ consented: boolean | null; consent_version: string | null }>(
    '/api/consent/marketing',
  );
}

/** Record this parent's analytics choice. Server recomputes the family-effective child flag. */
export async function postAnalyticsConsent(consented: boolean): Promise<{ child_analytics: boolean }> {
  return request<{ ok: boolean; child_analytics: boolean }>('/api/consent/analytics', {
    method: 'POST',
    body: JSON.stringify({ consented }),
  });
}

/** Family-effective child analytics flag (veto model). Any family member may read it. */
export async function getAnalyticsEffective(): Promise<{ child_analytics: boolean }> {
  return request<{ child_analytics: boolean }>('/api/consent/analytics/effective');
}

// ----------------------------------------------------------------
// Shared Expenses
// ----------------------------------------------------------------
export interface SharedExpense {
  id: number;
  logged_by: string;
  logged_by_name: string | null;
  authorised_by: string | null;
  authorised_by_name: string | null;
  description: string;
  category: string;
  total_amount: number;
  split_bp: number;
  currency: string;
  verification_status: 'committed_auto' | 'committed_manual' | 'pending' | 'rejected' | 'voided' | 'reversed';
  expense_date: string | null;
  note: string | null;
  receipt_r2_key: string | null;
  receipt_uploaded_at: number | null;
  voided_at: number | null;
  voided_by: string | null;
  voids_id: number | null;
  attachment_key: string | null;
  settlement_period: string | null;
  reconciled_at: number | null;
  created_at: number;
  deleted_at: number | null;
}

export async function getSharedExpenses(): Promise<{ expenses: SharedExpense[] }> {
  return request('/api/shared-expenses');
}

export async function createSharedExpense(body: {
  description: string;
  category: string;
  total_amount: number;
  split_bp?: number;
  expense_date?: string;
  note?: string;
}): Promise<{ id: number; verification_status: string }> {
  return request('/api/shared-expenses', { method: 'POST', body: JSON.stringify(body) });
}

export async function uploadReceipt(expenseId: number, file: File): Promise<{ id: number; receipt_uploaded_at: number }> {
  const res = await fetch(apiUrl(`/api/shared-expenses/${expenseId}/receipt`), {
    method: 'POST',
    headers: await authHeaders(file.type || 'application/octet-stream'),
    credentials: Capacitor.isNativePlatform() ? 'omit' : 'include',
    body: file,
  });
  const data = await res.json() as { id?: number; receipt_uploaded_at?: number; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong — please try again.');
  return { id: data.id!, receipt_uploaded_at: data.receipt_uploaded_at! };
}

export async function getReceiptUrl(expenseId: number): Promise<{ url: string }> {
  return request(`/api/shared-expenses/${expenseId}/receipt`);
}

export async function deleteReceipt(expenseId: number): Promise<{ id: number; deleted: boolean }> {
  return request(`/api/shared-expenses/${expenseId}/receipt`, { method: 'DELETE' });
}

export async function voidExpense(expenseId: number, body: {
  reason: string;
  replacement?: {
    description: string;
    category: string;
    total_amount: number;
    split_bp?: number;
    expense_date?: string;
    note?: string;
  };
}): Promise<{ voided_id: number; replacement_id: number | null }> {
  return request(`/api/shared-expenses/${expenseId}/void`, { method: 'POST', body: JSON.stringify(body) });
}

// ----------------------------------------------------------------
// Child Nudges — AI Mentor inline coaching cards
// ----------------------------------------------------------------

export interface ChildNudge {
  id:             number;
  trigger_type:   string;
  screen_context: string;
  orchard_text:   string;
  clean_text:     string;
  pillar:         string;
  tone:           'encouraging' | 'celebratory' | 'honest' | 'accountability';
  source:         'rule_based' | 'ai';
  parent_summary: string;
  created_at:     number;
}

export interface ChildNudgesResponse {
  nudges: {
    earn:  ChildNudge | null;
    money: ChildNudge | null;
    goals: ChildNudge | null;
  };
}

export async function getChildNudges(childId: string): Promise<ChildNudgesResponse> {
  return request(`/api/child-nudges?child_id=${childId}`);
}

export async function dismissChildNudge(nudgeId: number): Promise<{ ok: boolean }> {
  return request('/api/child-nudges/dismiss', {
    method: 'POST',
    body: JSON.stringify({ nudge_id: nudgeId }),
  });
}

export async function logImpulseOutcome(body: {
  family_id: string; child_id: string;
  amount_pence: number; balance_pence: number;
  outcome: 'waited' | 'proceeded';
}): Promise<{ ok: boolean }> {
  return request('/api/child-nudges/impulse-outcome', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ----------------------------------------------------------------
// Family Audit
// ----------------------------------------------------------------

export interface FamilyAuditData {
  month:             string;
  is_empty?:         boolean;
  totals?: {
    total_earned_pence: number;
    total_spent_pence:  number;
    total_saved_pence:  number;
    total_given_pence:  number;
  };
  flagged_child_id?:   string;
  flagged_pillar?:     string;
  observation?:        string;
  behavioral_root?:    string;
  the_action?:         string;
  source?:             'ai' | 'rule_based';
}

export async function getFamilyAudit(family_id: string): Promise<FamilyAuditData> {
  return request(`/api/family-audit?family_id=${family_id}`);
}
