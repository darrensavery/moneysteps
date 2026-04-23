/**
 * Trial & License middleware — Morechard
 *
 * checkTrialStatus  — called on every authenticated write request.
 *   1. If first ledger entry has occurred and trial not yet activated:
 *      set is_activated = TRUE, trial_start_date = NOW().
 *   2. If trial is expired and no license: block non-GET requests, redirect to /paywall.
 *
 * getTrialStatus    — returns a TrialStatus object for the frontend.
 *
 * Both functions read/write the `families` table only (no family_governance table).
 */

import { Env, FamilyLicenseRow, TrialStatus } from '../types.js';
import { json } from './response.js';

const TRIAL_DAYS = 14;

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Call this AFTER requireAuth on every authenticated request.
 * Returns a 402 Response if the family is paywalled, null otherwise.
 */
export async function checkTrialStatus(
  request: Request,
  env: Env,
  family_id: string,
): Promise<Response | null> {
  const row = await getFamilyRow(env, family_id);
  if (!row) return null; // Unrecognised family — let route handlers surface the 404

  // If already licensed, nothing to do
  if (row.has_lifetime_license || hasActiveAiSub(row)) return null;

  // Activation: first ledger entry has occurred but trial not yet started
  if (!row.is_activated) {
    const entryCount = await getLedgerEntryCount(env, family_id);
    if (entryCount > 0) {
      await activateTrial(env, family_id);
      // Row is now activated — don't block this request; it was the trigger
      return null;
    }
    // No entries yet — trial dormant, allow all requests
    return null;
  }

  // Trial is active — check expiry
  if (isTrialExpired(row)) {
    // Allow GETs (read-only export for data portability) but block writes
    if (request.method.toUpperCase() !== 'GET') {
      return paywallResponse();
    }
  }

  return null;
}

/**
 * Returns the current trial/license state for the TrialCountdown UI component.
 */
export async function getTrialStatus(env: Env, family_id: string): Promise<TrialStatus> {
  const row = await getFamilyRow(env, family_id);

  if (!row) {
    return {
      is_activated: false,
      days_remaining: null,
      is_expired: false,
      has_lifetime_license: false,
      ai_subscription_active: false,
      has_shield: false,
    };
  }

  const activated      = Boolean(row.is_activated);
  const lifetimeLicense = Boolean(row.has_lifetime_license);
  const aiActive       = hasActiveAiSub(row);
  const expired        = activated ? isTrialExpired(row) : false;

  let days_remaining: number | null = null;
  if (activated && row.trial_start_date && !lifetimeLicense) {
    const start = new Date(row.trial_start_date).getTime();
    const msLeft = start + TRIAL_DAYS * 86_400_000 - Date.now();
    days_remaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
  }

  return {
    is_activated: activated,
    days_remaining,
    is_expired: expired,
    has_lifetime_license: lifetimeLicense,
    ai_subscription_active: aiActive,
    has_shield: Boolean(row.has_shield),
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

async function getFamilyRow(env: Env, family_id: string): Promise<FamilyLicenseRow | null> {
  return env.DB
    .prepare(`
      SELECT id, trial_start_date, is_activated, has_lifetime_license,
             ai_subscription_expiry, has_shield
      FROM families WHERE id = ?
    `)
    .bind(family_id)
    .first<FamilyLicenseRow>();
}

async function getLedgerEntryCount(env: Env, family_id: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) as cnt FROM ledger WHERE family_id = ?')
    .bind(family_id)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

async function activateTrial(env: Env, family_id: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB
    .prepare(`
      UPDATE families
      SET is_activated = TRUE, trial_start_date = ?
      WHERE id = ? AND is_activated = FALSE
    `)
    .bind(now, family_id)
    .run();
}

function isTrialExpired(row: FamilyLicenseRow): boolean {
  if (!row.trial_start_date) return false;
  const expiry = new Date(row.trial_start_date).getTime() + TRIAL_DAYS * 86_400_000;
  return Date.now() > expiry;
}

function hasActiveAiSub(row: FamilyLicenseRow): boolean {
  if (!row.ai_subscription_expiry) return false;
  return new Date(row.ai_subscription_expiry).getTime() > Date.now();
}

function paywallResponse(): Response {
  return json({ error: 'Trial expired', redirect: '/paywall' }, 402);
}
