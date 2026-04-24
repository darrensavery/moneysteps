/**
 * Stripe integration — Morechard
 *
 * POST /api/stripe/create-checkout  — create a Stripe Checkout session (authenticated)
 * POST /api/stripe/webhook          — receive Stripe events (public, signature-verified)
 *
 * Products:
 *   LIFETIME_TRACKER  £34.99  — sets has_lifetime_license = TRUE permanently
 *   AI_COACH_ANNUAL   £19.99  — sets ai_subscription_expiry = NOW + 1 year
 *
 * Idempotency: webhook handler checks payment_audit_log for duplicate stripe_session_id
 * before writing. Stripe may deliver the same event more than once.
 *
 * Signature verification uses STRIPE_WEBHOOK_SECRET from env (never hardcoded).
 */

import { Env, PaymentType } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

// Referral rewards are tied to a licence purchase, not the AI add-on.
// AI_ANNUAL is an upgrade for an existing member — not a new family joining.
// SHIELD is also an add-on, not an acquisition event.
const REFERRAL_ELIGIBLE_PAYMENTS: string[] = ['LIFETIME', 'COMPLETE'];

// ----------------------------------------------------------------
// Referral conversion — fires only for licence-acquisition payments
// ----------------------------------------------------------------
async function recordReferralConversion(
  env: Env,
  familyId: string,
  paymentType: string,
  stripeSessionId: string,
  now: number,
): Promise<void> {
  if (!REFERRAL_ELIGIBLE_PAYMENTS.includes(paymentType)) return;

  const family = await env.DB
    .prepare('SELECT referred_by_code FROM families WHERE id = ?')
    .bind(familyId)
    .first<{ referred_by_code: string | null }>();

  if (!family?.referred_by_code) return;

  // INSERT OR IGNORE — stripe_session_id has UNIQUE constraint for idempotency
  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO referral_conversions
        (referral_code, referred_family, payment_type, stripe_session_id, converted_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(family.referred_by_code, familyId, paymentType, stripeSessionId, now)
    .run();
}

// ----------------------------------------------------------------
// Product catalogue — Stripe price IDs (test mode)
// Products created via API 2026-04-24. Switch to live price IDs before going live.
// ----------------------------------------------------------------
const PRICE_IDS: Record<PaymentType, string> = {
  COMPLETE:  'price_1TPqqZKGVFJVwtJFo37uEPPW',  // £44.99 one-off
  SHIELD:    'price_1TPqqcKGVFJVwtJF6cFgzWf9',  // £149.99 one-off
  AI_ANNUAL: 'price_1TPqqfKGVFJVwtJFpkbuPGCh',  // £19.99/year recurring
  LIFETIME:  '',  // legacy SKU — no Stripe product; kept for webhook backwards-compat
};

// AI_ANNUAL uses Stripe subscription mode; all others are one-time payments
const SUBSCRIPTION_TYPES: PaymentType[] = ['AI_ANNUAL'];

// Amounts kept for audit log only (price is authoritative in Stripe)
const AUDIT_AMOUNTS: Record<PaymentType, number> = {
  COMPLETE:  4499,
  SHIELD:    14999,
  AI_ANNUAL: 1999,
  LIFETIME:  3499,
};

// ----------------------------------------------------------------
// Create Checkout Session
// ----------------------------------------------------------------
export async function handleCreateCheckout(
  request: Request,
  env: Env,
  auth: JwtPayload,
): Promise<Response> {
  const body = await request.json() as { payment_type?: unknown };
  const payment_type = body.payment_type as PaymentType;

  if (!['COMPLETE', 'AI_ANNUAL', 'SHIELD'].includes(payment_type)) {
    return error('payment_type must be COMPLETE, AI_ANNUAL, or SHIELD', 400);
  }

  const priceId = PRICE_IDS[payment_type];
  const mode    = SUBSCRIPTION_TYPES.includes(payment_type) ? 'subscription' : 'payment';

  // Build Stripe Checkout session via REST API (no npm package — Workers-compatible)
  const params = new URLSearchParams({
    'payment_method_types[]':    'card',
    'line_items[0][price]':      priceId,
    'line_items[0][quantity]':   '1',
    'mode':                      mode,
    'metadata[family_id]':       auth.family_id,
    'metadata[payment_type]':    payment_type,
    'success_url':               `${env.APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url':                `${env.APP_URL}/paywall`,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.text();
    console.error('Stripe create-checkout error:', err);
    return error('Failed to create checkout session', 502);
  }

  const session = await stripeRes.json() as { url: string; id: string };
  return json({ url: session.url, session_id: session.id });
}

// ----------------------------------------------------------------
// Webhook Handler
// ----------------------------------------------------------------
export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return error('Missing stripe-signature header', 400);

  const rawBody = await request.text();

  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) return error('Invalid webhook signature', 401);

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return error('Invalid JSON in webhook body', 400);
  }

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event.data.object, env);
  }

  // Always return 200 to acknowledge receipt — Stripe will retry on non-2xx
  return json({ received: true });
}

// ----------------------------------------------------------------
// Checkout completion logic (idempotent)
// ----------------------------------------------------------------
async function handleCheckoutCompleted(session: StripeSession, env: Env): Promise<void> {
  const { family_id, payment_type } = session.metadata ?? {};

  if (!family_id || !(['LIFETIME', 'COMPLETE', 'AI_ANNUAL', 'SHIELD'] as string[]).includes(payment_type)) {
    console.error('Webhook: missing or invalid metadata', session.metadata);
    return;
  }

  // Idempotency guard — skip if already processed
  const existing = await env.DB
    .prepare('SELECT id FROM payment_audit_log WHERE stripe_session_id = ?')
    .bind(session.id)
    .first<{ id: number }>();

  if (existing) {
    console.log('Webhook: duplicate event for session', session.id, '— skipping');
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Write audit log first (Truth Engine: never lose the payment record)
  await env.DB
    .prepare(`
      INSERT INTO payment_audit_log (family_id, stripe_session_id, amount_paid_int, currency, payment_type)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(family_id, session.id, AUDIT_AMOUNTS[payment_type as PaymentType] ?? 0, 'GBP', payment_type)
    .run();

  // Record referral conversion if this family was referred
  await recordReferralConversion(env, family_id, payment_type, session.id, now);

  // Update license columns on families table
  if (payment_type === 'LIFETIME' || payment_type === 'COMPLETE') {
    await env.DB
      .prepare('UPDATE families SET has_lifetime_license = TRUE WHERE id = ?')
      .bind(family_id)
      .run();
  } else if (payment_type === 'AI_ANNUAL') {
    // AI_ANNUAL: extend from today or from existing expiry (whichever is later)
    const existing = await env.DB
      .prepare('SELECT ai_subscription_expiry FROM families WHERE id = ?')
      .bind(family_id)
      .first<{ ai_subscription_expiry: string | null }>();

    const base = existing?.ai_subscription_expiry
      ? Math.max(new Date(existing.ai_subscription_expiry).getTime(), Date.now())
      : Date.now();

    const newExpiry = new Date(base + 365 * 86_400_000).toISOString();

    await env.DB
      .prepare('UPDATE families SET ai_subscription_expiry = ? WHERE id = ?')
      .bind(newExpiry, family_id)
      .run();
  }

  if (payment_type === 'SHIELD') {
    await env.DB
      .prepare('UPDATE families SET has_shield = 1 WHERE id = ?')
      .bind(family_id)
      .run();
  }

  console.log(`Webhook: processed ${payment_type} for family ${family_id}`);
}

// ----------------------------------------------------------------
// Stripe webhook signature verification (Web Crypto — no npm required)
// ----------------------------------------------------------------
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  // stripe-signature format: t=timestamp,v1=hash[,v1=hash2...]
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => p.split('=')).map(([k, ...v]) => [k, v.join('=')])
  );

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  // Reject events older than 5 minutes to guard against replay attacks
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedPayload = `${timestamp}.${rawBody}`;

  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return hex === v1;
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
