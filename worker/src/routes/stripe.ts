/**
 * Payment integration — Morechard (Stripe, UK Phase 1)
 *
 * POST /api/stripe/create-checkout  — create a Checkout session (authenticated)
 * POST /api/stripe/webhook          — receive payment events (public, signature-verified)
 *
 * All products are one-time payments. No subscriptions are issued.
 *
 * SKU catalogue:
 *   COMPLETE     £44.99  — Morechard Core: base tracker; AI Mentor / Learning Lab locked after trial
 *   COMPLETE_AI  £64.99  — Morechard Core AI: Core + AI Mentor + Learning Lab permanently unlocked
 *   SHIELD_AI    £149.99 — Morechard Shield: Core AI + court-admissible hashed PDF exports
 *   AI_UPGRADE   £29.99  — AI Mentor + Learning Lab one-time upgrade (existing Core purchasers)
 *
 * Legacy SKUs (no longer sold; handled in webhook for idempotency only):
 *   LIFETIME     → treated as COMPLETE
 *   AI_ANNUAL    → treated as AI_UPGRADE (permanent unlock, not time-limited)
 *
 * Idempotency: webhook checks payment_audit_log for duplicate stripe_session_id
 * before writing. Stripe may deliver the same event more than once.
 *
 * Signature verification uses STRIPE_WEBHOOK_SECRET from env (never hardcoded).
 *
 * Provider abstraction: all Stripe-specific logic is contained in this file.
 * To migrate to a different payment provider, replace createCheckoutSession()
 * and verifyWebhookSignature() — the license-grant logic below them is provider-neutral.
 */

import { Env, PaymentType } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

// ----------------------------------------------------------------
// Product catalogue
// Price IDs are test-mode values. Swap for live IDs before go-live.
// All modes are 'payment' (one-time). No 'subscription' mode used.
// ----------------------------------------------------------------
const PRICE_IDS: Partial<Record<PaymentType, string>> = {
  COMPLETE:    'price_1TPqqZKGVFJVwtJFo37uEPPW',  // £44.99 one-time
  COMPLETE_AI: 'price_1TQVUFKGVFJVwtJFmYUryKw6',  // £64.99 one-time
  SHIELD_AI:   'price_1TQVVRKGVFJVwtJFbtozHn3b',  // £149.99 one-time
  AI_UPGRADE:  'price_1TQVViKGVFJVwtJFLhSnEuh7',  // £29.99 one-time
  // SHIELD legacy price retained so old sessions still resolve
  SHIELD:      'price_1TPqqcKGVFJVwtJF6cFgzWf9',  // legacy alias → SHIELD_AI
};

// Amounts in minor units (pence), for audit log only.
// Stripe is authoritative for the actual charge.
const AUDIT_AMOUNTS: Partial<Record<PaymentType, number>> = {
  COMPLETE:    4499,
  COMPLETE_AI: 6499,
  SHIELD_AI:   14999,
  AI_UPGRADE:  2999,
  LIFETIME:    4499,  // legacy: mapped to COMPLETE price
  AI_ANNUAL:   2999,  // legacy: mapped to AI_UPGRADE price
  SHIELD:      14999, // legacy alias
};

// SKUs accepted at checkout (legacy and alias SKUs not directly purchasable)
const PURCHASABLE: PaymentType[] = ['COMPLETE', 'COMPLETE_AI', 'SHIELD_AI', 'AI_UPGRADE'];

// ----------------------------------------------------------------
// Referral: only acquisition SKUs (not upgrades) earn referral credit
// ----------------------------------------------------------------
const REFERRAL_ELIGIBLE: PaymentType[] = ['COMPLETE', 'COMPLETE_AI', 'SHIELD_AI', 'LIFETIME'];

// ----------------------------------------------------------------
// Provider layer — Stripe-specific. Replace this section to migrate.
// ----------------------------------------------------------------

async function createCheckoutSession(
  priceId: string,
  familyId: string,
  paymentType: PaymentType,
  appUrl: string,
  stripeSecretKey: string,
): Promise<{ url: string; sessionId: string }> {
  const params = new URLSearchParams({
    'payment_method_types[]':  'card',
    'line_items[0][price]':    priceId,
    'line_items[0][quantity]': '1',
    'mode':                    'payment',
    'metadata[family_id]':     familyId,
    'metadata[payment_type]':  paymentType,
    'success_url':             `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url':              `${appUrl}/paywall`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const msg = await res.text();
    console.error('Stripe create-checkout error:', msg);
    throw new Error('Payment provider error');
  }

  const session = await res.json() as { url: string; id: string };
  return { url: session.url, sessionId: session.id };
}

async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => p.split('=')).map(([k, ...v]) => [k, v.join('=')])
  );

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  // Reject events older than 5 minutes (replay attack guard)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(`${timestamp}.${rawBody}`);

  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgData);
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  return hex === v1;
}

// ----------------------------------------------------------------
// Route: POST /api/stripe/create-checkout
// ----------------------------------------------------------------
export async function handleCreateCheckout(
  request: Request,
  env: Env,
  auth: JwtPayload,
): Promise<Response> {
  const body = await request.json() as { payment_type?: unknown };
  const payment_type = body.payment_type as PaymentType;

  if (!PURCHASABLE.includes(payment_type)) {
    return error(`payment_type must be one of: ${PURCHASABLE.join(', ')}`, 400);
  }

  const priceId = PRICE_IDS[payment_type];
  if (!priceId || priceId.startsWith('price_PLACEHOLDER')) {
    console.error(`No live price ID configured for ${payment_type}`);
    return error('This product is not yet available for purchase', 503);
  }

  try {
    const { url, sessionId } = await createCheckoutSession(
      priceId, auth.family_id, payment_type, env.APP_URL, env.STRIPE_SECRET_KEY,
    );
    return json({ url, session_id: sessionId });
  } catch {
    return error('Failed to create checkout session', 502);
  }
}

// ----------------------------------------------------------------
// Route: POST /api/stripe/webhook
// ----------------------------------------------------------------
export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return error('Missing stripe-signature header', 400);

  const rawBody = await request.text();

  const verified = await verifyWebhookSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) return error('Invalid webhook signature', 401);

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return error('Invalid JSON in webhook body', 400);
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await handleCheckoutCompleted(event.data.object, env);
    } catch (err) {
      console.error('handleCheckoutCompleted threw:', String(err), err instanceof Error ? err.stack : '');
      // Return 200 so Stripe stops retrying — we log the error for diagnosis
      return json({ received: true, error: String(err) });
    }
  }

  // Always 200 — Stripe retries on non-2xx
  return json({ received: true });
}

// ----------------------------------------------------------------
// License grant logic — provider-neutral
// ----------------------------------------------------------------
async function handleCheckoutCompleted(session: StripeSession, env: Env): Promise<void> {
  console.log('Webhook session object keys:', Object.keys(session).join(', '));
  console.log('Webhook session.metadata:', JSON.stringify(session.metadata));
  console.log('Webhook session.id:', session.id);

  const { family_id, payment_type: rawType } = session.metadata ?? {};

  const KNOWN: string[] = [...PURCHASABLE, 'LIFETIME', 'AI_ANNUAL', 'SHIELD'];
  if (!family_id || !KNOWN.includes(rawType)) {
    console.error('Webhook: missing or invalid metadata', JSON.stringify(session.metadata));
    return;
  }

  // Normalise legacy SKUs to current equivalents
  const payment_type = normaliseSku(rawType as PaymentType);

  // Idempotency guard
  const existing = await env.DB
    .prepare('SELECT id FROM payment_audit_log WHERE stripe_session_id = ?')
    .bind(session.id)
    .first<{ id: number }>();

  if (existing) {
    console.log('Webhook: duplicate event for session', session.id, '— skipping');
    return;
  }

  // Write audit record first — never lose the payment fact
  await env.DB
    .prepare(`
      INSERT INTO payment_audit_log (family_id, stripe_session_id, amount_paid_int, currency, payment_type)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(family_id, session.id, AUDIT_AMOUNTS[payment_type] ?? 0, 'GBP', payment_type)
    .run();

  // Grant license flags
  await grantLicense(env, family_id, payment_type);

  // Record referral conversion if applicable
  const now = Math.floor(Date.now() / 1000);
  await recordReferralConversion(env, family_id, payment_type, session.id, now);

  console.log(`Webhook: processed ${rawType} (normalised: ${payment_type}) for family ${family_id}`);
}

function normaliseSku(sku: PaymentType): PaymentType {
  if (sku === 'LIFETIME') return 'COMPLETE';
  if (sku === 'AI_ANNUAL') return 'AI_UPGRADE';
  if (sku === 'SHIELD') return 'SHIELD_AI';
  return sku;
}

async function grantLicense(env: Env, familyId: string, paymentType: PaymentType): Promise<void> {
  switch (paymentType) {
    case 'COMPLETE':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 1 WHERE id = ?')
        .bind(familyId)
        .run();
      break;

    case 'COMPLETE_AI':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 1, has_ai_mentor = 1 WHERE id = ?')
        .bind(familyId)
        .run();
      break;

    case 'SHIELD_AI':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 1, has_ai_mentor = 1, has_shield = 1 WHERE id = ?')
        .bind(familyId)
        .run();
      break;

    case 'AI_UPGRADE':
      // Only grant if family already holds a base license
      await env.DB
        .prepare('UPDATE families SET has_ai_mentor = 1 WHERE id = ? AND has_lifetime_license = 1')
        .bind(familyId)
        .run();
      break;
  }
}

// ----------------------------------------------------------------
// Referral conversion — cash-commission model
// Fires only for acquisition SKUs (not upgrades).
// Actual cash payout is handled externally (Rewardful or similar).
// This records the conversion fact so the affiliate dashboard can settle.
// ----------------------------------------------------------------
async function recordReferralConversion(
  env: Env,
  familyId: string,
  paymentType: PaymentType,
  stripeSessionId: string,
  now: number,
): Promise<void> {
  if (!REFERRAL_ELIGIBLE.includes(paymentType)) return;

  const family = await env.DB
    .prepare('SELECT referred_by_code FROM families WHERE id = ?')
    .bind(familyId)
    .first<{ referred_by_code: string | null }>();

  if (!family?.referred_by_code) return;

  const result = await env.DB
    .prepare(`
      INSERT OR IGNORE INTO referral_conversions
        (referral_code, referred_family, payment_type, stripe_session_id, converted_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(family.referred_by_code, familyId, paymentType, stripeSessionId, now)
    .run();

  if (!result.meta.changes) return;

  // Mark as pending cash settlement (no AI-time grants — cash affiliate model)
  await env.DB
    .prepare('UPDATE referral_conversions SET reward_granted = 1 WHERE stripe_session_id = ?')
    .bind(stripeSessionId)
    .run();
}

// ----------------------------------------------------------------
// Route: DELETE /api/billing/cancel  (14-day cooling-off refund)
// ----------------------------------------------------------------
export async function handleCancelPlan(
  request: Request,
  env: Env,
  auth: JwtPayload,
): Promise<Response> {
  // Only lead parent can cancel
  if (auth.role !== 'parent') return error('Forbidden', 403);

  // Find the most recent paid purchase for this family
  const purchase = await env.DB
    .prepare(`
      SELECT id, stripe_session_id, payment_type, created_at
      FROM payment_audit_log
      WHERE family_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .bind(auth.family_id)
    .first<{ id: number; stripe_session_id: string; payment_type: string; created_at: string }>();

  if (!purchase) return error('No purchase found', 404);

  // Enforce 14-day cooling-off window
  const purchasedAt = new Date(purchase.created_at).getTime();
  const daysSince = (Date.now() - purchasedAt) / (1000 * 60 * 60 * 24);
  if (daysSince > 14) {
    return error('The 14-day cooling-off period has expired', 403);
  }

  // Refuse if the family's trial had already expired before they purchased —
  // revoking the licence would leave them with no access at all.
  const family = await env.DB
    .prepare('SELECT trial_start_date, is_activated FROM families WHERE id = ?')
    .bind(auth.family_id)
    .first<{ trial_start_date: string | null; is_activated: number }>();

  if (family?.is_activated && family.trial_start_date) {
    const trialExpiry = new Date(family.trial_start_date).getTime() + 14 * 24 * 60 * 60 * 1000;
    if (Date.now() > trialExpiry) {
      return error(
        'Your free trial has already ended. Cancelling would leave you without access — please contact support for a manual refund.',
        403,
      );
    }
  }

  // Fetch the Stripe session to get the payment_intent
  const sessionRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${purchase.stripe_session_id}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
  );
  if (!sessionRes.ok) {
    console.error('Stripe session fetch failed:', await sessionRes.text());
    return error('Could not retrieve payment details', 502);
  }
  const session = await sessionRes.json() as { payment_intent?: string };
  if (!session.payment_intent) {
    return error('No payment intent found for this session', 400);
  }

  // Issue the refund
  const refundParams = new URLSearchParams({ payment_intent: session.payment_intent });
  const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: refundParams.toString(),
  });
  if (!refundRes.ok) {
    console.error('Stripe refund failed:', await refundRes.text());
    return error('Refund failed — please contact support', 502);
  }

  // Revoke licence flags
  await revokeLicense(env, auth.family_id, purchase.payment_type as PaymentType);

  // Mark the audit record as refunded
  await env.DB
    .prepare('UPDATE payment_audit_log SET refunded_at = datetime(\'now\') WHERE id = ?')
    .bind(purchase.id)
    .run();

  console.log(`Refund issued for family ${auth.family_id}, session ${purchase.stripe_session_id}`);
  return json({ refunded: true });
}

async function revokeLicense(env: Env, familyId: string, paymentType: PaymentType): Promise<void> {
  switch (normaliseSku(paymentType)) {
    case 'COMPLETE':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 0 WHERE id = ?')
        .bind(familyId).run();
      break;
    case 'COMPLETE_AI':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 0, has_ai_mentor = 0 WHERE id = ?')
        .bind(familyId).run();
      break;
    case 'SHIELD_AI':
      await env.DB
        .prepare('UPDATE families SET has_lifetime_license = 0, has_ai_mentor = 0, has_shield = 0 WHERE id = ?')
        .bind(familyId).run();
      break;
    case 'AI_UPGRADE':
      await env.DB
        .prepare('UPDATE families SET has_ai_mentor = 0 WHERE id = ?')
        .bind(familyId).run();
      break;
  }
}

// ----------------------------------------------------------------
// Minimal Stripe type stubs
// ----------------------------------------------------------------
interface StripeEvent {
  type: string;
  data: { object: StripeSession };
}

interface StripeSession {
  id: string;
  metadata?: Record<string, string>;
}
