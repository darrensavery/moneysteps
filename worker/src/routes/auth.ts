/**
 * Auth routes
 *
 * (trivial touch to test GitHub Actions push trigger)
 * POST /auth/register          Create parent account (email + optional password)
 * POST /auth/login             Email + password login → JWT
 * POST /auth/magic-link        Request magic link email
 * GET  /auth/verify            Consume magic link token → JWT
 * POST /auth/child/login       Child PIN login → scoped JWT
 * POST /auth/child/set-pin     Parent sets/resets child PIN
 * POST /auth/logout            Revoke session (server-side)
 * GET  /auth/me                Return current user from JWT
 */

import { Env } from '../types.js'
import { EmailService, buildVerifyEmailHtml, buildVerifyEmailText } from '../lib/email.js';
import { resolveReturnOrigin } from '../lib/appUrl.js';

import { json, error, clientIp } from '../lib/response.js';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword, timingSafeEqual } from '../lib/crypto.js';
import { signJwt } from '../lib/jwt.js';
import type { JwtPayload } from '../lib/jwt.js';
import { nanoid } from '../lib/nanoid.js';
import { sha256, computeRecordHash, GENESIS_HASH } from '../lib/hash.js';
import { setAuthCookie, clearAuthCookie, setSessionMarkerCookie, clearSessionMarkerCookie } from '../lib/cookies.js';
import { recordPinFailure, clearPinLockout } from '../lib/pinLockout.js';
import { z } from 'zod';
import { parseValidatedBody } from '../lib/validate.js';
import { verifyTurnstile } from '../lib/turnstile.js';

const MAGIC_LINK_EXPIRY  = 15 * 60;         // 15 minutes
const PARENT_JWT_EXPIRY  = 365 * 24 * 3600; // 1 year
const CHILD_JWT_EXPIRY   = 90 * 24 * 3600;  // 90 days

// ----------------------------------------------------------------
// POST /auth/register
// Creates a parent account. Does NOT log the user in — they must
// use /auth/login or /auth/magic-link after registering.
//
// Body: { family_id, display_name, email, password?, locale? }
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// POST /auth/create-family
// Creates a new family + first parent account atomically.
// Body: { display_name, email, password?, locale? }
// Returns: { family_id, user_id, email }
// ----------------------------------------------------------------
const createFamilySchema = z.object({
  display_name:     z.string().min(1, 'display_name required'),
  email:             z.string().min(1, 'email required'),
  password:          z.string().optional(),
  locale:            z.string().optional(),
  governance_mode:   z.string().optional(),
  base_currency:     z.string().optional(),
  parenting_mode:    z.string().optional(),
  referred_by_code:  z.string().optional(),
  turnstile_token:   z.string().optional(),
});

export async function handleCreateFamily(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, createFamilySchema);
  if (parsed instanceof Response) return parsed;
  const { display_name, email, password, locale } = parsed;

  const turnstileCheck = await verifyTurnstile(request, env, parsed.turnstile_token);
  if (turnstileCheck) return turnstileCheck;

  const normEmail = email.toLowerCase().trim();
  if (!isValidEmail(normEmail)) return error('Invalid email address');

  const existing = await env.DB
    .prepare('SELECT id, family_id, email_verified FROM users WHERE email = ?')
    .bind(normEmail)
    .first<{ id: string; family_id: string; email_verified: number }>();

  // If the user exists and has already verified their email, they have a valid account.
  // Re-send a magic link so they can sign in (handles the case where email was verified
  // but the auth flow failed before a session was established, e.g. due to a routing bug).
  // Uses the same rate-limiting table as handleMagicLinkRequest; returns a generic
  // acknowledgement with no internal identifiers to prevent user enumeration.
  if (existing && existing.email_verified === 1) {
    const nowSec = Math.floor(Date.now() / 1000);
    const mla = await env.DB
      .prepare('SELECT attempts, window_start FROM magic_link_attempts WHERE email = ?')
      .bind(normEmail)
      .first<{ attempts: number; window_start: number }>()
      .catch(() => null);

    const underLimit = !mla
      || nowSec - mla.window_start >= MAGIC_LINK_WINDOW
      || mla.attempts < MAGIC_LINK_MAX;

    if (underLimit) {
      if (!mla || nowSec - mla.window_start >= MAGIC_LINK_WINDOW) {
        await env.DB
          .prepare(`INSERT INTO magic_link_attempts (email, attempts, window_start)
                    VALUES (?, 1, ?)
                    ON CONFLICT(email) DO UPDATE SET attempts = 1, window_start = excluded.window_start`)
          .bind(normEmail, nowSec).run().catch(() => null);
      } else {
        await env.DB
          .prepare('UPDATE magic_link_attempts SET attempts = attempts + 1 WHERE email = ?')
          .bind(normEmail).run().catch(() => null);
      }
      const appUrl   = resolveReturnOrigin(request, env);
      const rawToken = nanoid(32);
      const tokenHash = await sha256(rawToken);
      const now = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare('INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, request_ip) VALUES (?,?,?,?)')
        .bind(tokenHash, existing.id, now + MAGIC_LINK_EXPIRY, clientIp(request))
        .run();
      const link = `${appUrl}/auth/verify?token=${rawToken}`;
      await sendMagicLinkEmail(normEmail, display_name, link, env).catch(() => null);
    }
    // Generic response — does not confirm or deny whether this email is registered
    return json({ sent: true }, 200);
  }

  // If the user exists but never verified (e.g. previous registration hit an error),
  // delete the orphaned record so they can start fresh cleanly.
  // Must delete all FK-dependent child rows before deleting families.
  if (existing && existing.email_verified === 0) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM family_roles        WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM magic_link_tokens   WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM slt_tokens          WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM sessions            WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM invite_codes        WHERE family_id = ?').bind(existing.family_id),
      env.DB.prepare('DELETE FROM registration_progress WHERE family_id = ?').bind(existing.family_id),
      env.DB.prepare('DELETE FROM users               WHERE id       = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM families            WHERE id       = ?').bind(existing.family_id),
    ]);
  }

  const familyId     = nanoid();
  const userId       = nanoid();
  const passwordHash = password ? await hashPassword(password) : null;
  const userLocale   = (locale === 'pl' ? 'pl' : 'en');

  // Accept new Stage-1/2 registration fields (default to safe values if absent)
  const governance_mode  = (parsed.governance_mode  === 'standard') ? 'standard'      : 'amicable';
  const base_currency    = (parsed.base_currency    === 'PLN')      ? 'PLN'           : 'GBP';
  const parenting_mode   = (parsed.parenting_mode   === 'co-parenting') ? 'co-parenting' : 'single';

  // Referral attribution — silently ignore unknown codes
  let referred_by_code: string | null = parsed.referred_by_code?.trim().toUpperCase() ?? null;
  if (referred_by_code) {
    const referrer = await env.DB
      .prepare('SELECT id FROM families WHERE referral_code = ?')
      .bind(referred_by_code)
      .first();
    if (!referrer) referred_by_code = null;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO families (id, name, currency, verify_mode, base_currency, parenting_mode, referred_by_code) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(familyId, display_name, base_currency, governance_mode, base_currency, parenting_mode, referred_by_code),
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, password_hash, email_verified)
      VALUES (?,?,?,?,?,?,0)
    `).bind(userId, familyId, display_name, normEmail, userLocale, passwordHash),
    env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?,?,'parent','lead')`)
      .bind(userId, familyId),
  ]);

  return json({ family_id: familyId, user_id: userId, email: normEmail }, 201);
}

// ----------------------------------------------------------------
// POST /auth/register
const registerSchema = z.object({
  family_id:    z.string().min(1, 'family_id required'),
  display_name: z.string().min(1, 'display_name required'),
  email:        z.string().min(1, 'email required'),
  password:     z.string().optional(),
  locale:       z.string().optional(),
});

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, registerSchema);
  if (parsed instanceof Response) return parsed;
  const { family_id, display_name, email, password, locale } = parsed;

  const normEmail = email.toLowerCase().trim();
  if (!isValidEmail(normEmail)) return error('Invalid email address');

  // Check family exists
  const family = await env.DB
    .prepare('SELECT id FROM families WHERE id = ?').bind(family_id).first();
  if (!family) return error('Family not found', 404);

  // Block a second lead registering on the same family
  const existingLead = await env.DB
    .prepare(`SELECT user_id FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead' LIMIT 1`)
    .bind(family_id).first();
  if (existingLead) return error('A lead parent is already registered for this family', 409);

  // Check email not already registered
  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first();
  if (existing) return error('Email already registered', 409);

  const userId       = nanoid();
  const passwordHash = password ? await hashPassword(password) : null;
  const userLocale   = (locale === 'pl' ? 'pl' : 'en');

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, password_hash, email_verified)
      VALUES (?,?,?,?,?,?,0)
    `).bind(userId, family_id, display_name, normEmail, userLocale, passwordHash),

    env.DB.prepare(`
      INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?,?,'parent','lead')
    `).bind(userId, family_id),
  ]);

  return json({ user_id: userId, email: normEmail }, 201);
}

// ----------------------------------------------------------------
// POST /auth/login
// Email + password login. Returns JWT.
// Body: { email, password }
// ----------------------------------------------------------------
const LOGIN_MAX_ATTEMPTS  = 10;
const LOGIN_WINDOW_SEC    = 600;   // 10-minute rolling window
const LOGIN_LOCKOUT_SEC   = 900;   // 15-minute lockout after exceeding limit

const MAGIC_LINK_MAX     = 3;
const MAGIC_LINK_WINDOW  = 600;   // 10-minute rolling window

const loginSchema = z.object({
  email:           z.string().min(1, 'email required'),
  password:        z.string().min(1, 'password required'),
  turnstile_token: z.string().optional(),
});

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, loginSchema);
  if (parsed instanceof Response) return parsed;
  const { email, password, turnstile_token } = parsed;

  const turnstileCheck = await verifyTurnstile(request, env, turnstile_token);
  if (turnstileCheck) return turnstileCheck;

  const normEmail = email.toLowerCase().trim();
  const nowSec    = Math.floor(Date.now() / 1000);

  // Check rate limit before touching the users table
  const rl = await env.DB
    .prepare('SELECT attempts, window_start, locked_until FROM login_attempts WHERE email = ?')
    .bind(normEmail)
    .first<{ attempts: number; window_start: number; locked_until: number }>()
    .catch(() => null);

  if (rl) {
    if (rl.locked_until > nowSec) {
      logger.warn('handleLogin', 'login blocked — account locked', {
        email_domain: normEmail.split('@')[1] ?? 'unknown', ip: clientIp(request),
      });
      return error('Too many failed attempts — please try again later.', 429);
    }
    if (nowSec - rl.window_start < LOGIN_WINDOW_SEC && rl.attempts >= LOGIN_MAX_ATTEMPTS) {
      await env.DB
        .prepare('UPDATE login_attempts SET locked_until = ? WHERE email = ?')
        .bind(nowSec + LOGIN_LOCKOUT_SEC, normEmail)
        .run()
        .catch(() => null);
      logger.warn('handleLogin', 'login rate limit — account locked now', {
        email_domain: normEmail.split('@')[1] ?? 'unknown', ip: clientIp(request), attempts: rl.attempts,
      });
      return error('Too many failed attempts — please try again later.', 429);
    }
  }

  const user = await env.DB
    .prepare('SELECT id, family_id, password_hash, email_verified FROM users WHERE email = ?')
    .bind(normEmail)
    .first<{ id: string; family_id: string; password_hash: string | null; email_verified: number }>();

  // Deliberate vague error — don't reveal whether email exists
  if (!user || !user.password_hash) {
    // Still increment attempts to prevent user-enumeration timing sidechannel
    await recordFailedLogin(env, normEmail, nowSec, rl).catch(() => null);
    logger.warn('handleLogin', 'login failed — unknown email', {
      email_domain: normEmail.split('@')[1] ?? 'unknown', ip: clientIp(request),
    });
    return error('Invalid credentials', 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await recordFailedLogin(env, normEmail, nowSec, rl).catch(() => null);
    logger.warn('handleLogin', 'login failed — wrong password', {
      email_domain: normEmail.split('@')[1] ?? 'unknown', ip: clientIp(request),
    });
    return error('Invalid credentials', 401);
  }

  // Success — clear rate limit record
  await env.DB
    .prepare('DELETE FROM login_attempts WHERE email = ?')
    .bind(normEmail)
    .run()
    .catch(() => null);

  return issueParentJwt(user.id, user.family_id, request, env);
}

async function recordFailedLogin(
  env: Env,
  normEmail: string,
  nowSec: number,
  existing: { attempts: number; window_start: number; locked_until: number } | null,
): Promise<void> {
  if (!existing || nowSec - existing.window_start >= LOGIN_WINDOW_SEC) {
    await env.DB
      .prepare(`INSERT INTO login_attempts (email, attempts, window_start, locked_until)
                VALUES (?, 1, ?, 0)
                ON CONFLICT(email) DO UPDATE SET attempts = 1, window_start = excluded.window_start, locked_until = 0`)
      .bind(normEmail, nowSec)
      .run();
  } else {
    await env.DB
      .prepare('UPDATE login_attempts SET attempts = attempts + 1 WHERE email = ?')
      .bind(normEmail)
      .run();
  }
}

// ----------------------------------------------------------------
// POST /auth/magic-link
// Generates a single-use token and sends it via Resend.
// Body: { email }
// ----------------------------------------------------------------
const magicLinkRequestSchema = z.object({
  email:           z.string().min(1, 'email required'),
  turnstile_token: z.string().optional(),
});

export async function handleMagicLinkRequest(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, magicLinkRequestSchema);
  if (parsed instanceof Response) return parsed;

  const turnstileCheck = await verifyTurnstile(request, env, parsed.turnstile_token);
  if (turnstileCheck) return turnstileCheck;

  const normEmail = parsed.email.toLowerCase().trim();

  // Rate-limit by email — prevents inbox flooding on known addresses.
  // Always returns 200 so the rate limit doesn't reveal email registration status.
  const nowSec = Math.floor(Date.now() / 1000);
  const mla = await env.DB
    .prepare('SELECT attempts, window_start FROM magic_link_attempts WHERE email = ?')
    .bind(normEmail)
    .first<{ attempts: number; window_start: number }>()
    .catch(() => null);

  if (mla && nowSec - mla.window_start < MAGIC_LINK_WINDOW && mla.attempts >= MAGIC_LINK_MAX) {
    return json({ sent: true }); // silent — don't reveal the limit
  }

  if (!mla || nowSec - mla.window_start >= MAGIC_LINK_WINDOW) {
    await env.DB
      .prepare(`INSERT INTO magic_link_attempts (email, attempts, window_start)
                VALUES (?, 1, ?)
                ON CONFLICT(email) DO UPDATE SET attempts = 1, window_start = excluded.window_start`)
      .bind(normEmail, nowSec).run().catch(() => null);
  } else {
    await env.DB
      .prepare('UPDATE magic_link_attempts SET attempts = attempts + 1 WHERE email = ?')
      .bind(normEmail).run().catch(() => null);
  }

  const user = await env.DB
    .prepare('SELECT id, family_id, display_name FROM users WHERE email = ?')
    .bind(normEmail)
    .first<{ id: string; family_id: string; display_name: string }>();

  // Always return 200 — don't reveal whether email is registered
  if (!user) return json({ sent: true });

  const ip       = clientIp(request);
  const rawToken = nanoid(32);
  const tokenHash = await sha256(rawToken);
  const now      = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(`
      INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, request_ip)
      VALUES (?,?,?,?)
    `)
    .bind(tokenHash, user.id, now + MAGIC_LINK_EXPIRY, ip)
    .run();

  // Send via Resend
  const appUrl  = resolveReturnOrigin(request, env);
  const link    = `${appUrl}/auth/verify?token=${rawToken}`;

  await sendMagicLinkEmail(normEmail, user.display_name, link, env);

  return json({ sent: true });
}

// ----------------------------------------------------------------
// GET /auth/verify?token=
// Consumes a magic link token. Returns JWT.
// ----------------------------------------------------------------
export async function handleMagicLinkVerify(request: Request, env: Env): Promise<Response> {
  const url    = new URL(request.url);
  const token  = url.searchParams.get('token');
  const appUrl = resolveReturnOrigin(request, env);

  const redirect = (reason: string) => new Response(null, {
    status: 302,
    headers: { 'Location': `${appUrl}/auth/verify?error=${encodeURIComponent(reason)}` },
  });

  if (!token) return redirect('missing');

  const tokenHash = await sha256(token);
  const now       = Math.floor(Date.now() / 1000);

  const row = await env.DB
    .prepare(`SELECT id, user_id, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<{ id: number; user_id: string; expires_at: number; used_at: number | null }>();

  if (!row)              return redirect('invalid');
  if (row.used_at)       return redirect('used');
  if (now > row.expires_at) return redirect('expired');

  // Mark token used + mark email verified — atomic
  const user = await env.DB
    .prepare('SELECT id, family_id FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ id: string; family_id: string }>();

  if (!user) return error('User not found', 404);

  const rawSlt    = nanoid(32);
  const sltHash   = await sha256(rawSlt);

  await env.DB.batch([
    env.DB.prepare('UPDATE magic_link_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(user.id),
    env.DB.prepare('INSERT INTO slt_tokens (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)')
      .bind(sltHash, user.id, now + 300, clientIp(request), request.headers.get('User-Agent') ?? ''),
  ]);

  return new Response(null, {
    status: 302,
    headers: { 'Location': `${appUrl}/auth/callback?slt=${rawSlt}` },
  });
}

// ----------------------------------------------------------------
// POST /auth/child/set-pin
// Parent sets or resets a child's PIN. Requires parent JWT.
// Body: { child_id, pin }  — pin must be exactly 4 digits
// ----------------------------------------------------------------
const setChildPinSchema = z.object({
  child_id: z.string().min(1, 'child_id required'),
  pin:      z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export async function handleSetChildPin(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, setChildPinSchema);
  if (parsed instanceof Response) return parsed;
  const { child_id, pin } = parsed;

  // Caller identity comes from the JWT (injected by middleware)
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Only parents can set child PINs', 403);

  // Verify child belongs to same family
  const child = await env.DB
    .prepare(`SELECT u.id FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(child_id, caller.family_id)
    .first<{ id: string }>();

  if (!child) return error('Child not found in your family', 404);

  const pinHash = await hashPassword(pin);
  await env.DB
    .prepare('UPDATE users SET pin_hash = ? WHERE id = ?')
    .bind(pinHash, child_id)
    .run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /auth/child/login
// Child logs in with family_id + child_id + PIN.
// Body: { family_id, child_id, pin }
// ----------------------------------------------------------------
const childLoginSchema = z.object({
  family_id: z.string().min(1, 'family_id required'),
  child_id:  z.string().min(1, 'child_id required'),
  pin:       z.string().min(1, 'pin required'),
});

export async function handleChildLogin(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, childLoginSchema);
  if (parsed instanceof Response) return parsed;
  const { family_id, child_id, pin } = parsed;

  const user = await env.DB
    .prepare(`SELECT u.id, u.pin_hash, u.pin_attempt_count, u.pin_locked_until, u.pin_lockout_tier
              FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(child_id, family_id)
    .first<{ id: string; pin_hash: string | null; pin_attempt_count: number; pin_locked_until: number | null; pin_lockout_tier: number }>();

  if (!user || !user.pin_hash) return error('Invalid credentials', 401);

  const now = Math.floor(Date.now() / 1000);

  // Lockout check — mirrors parent PIN behaviour
  if (user.pin_locked_until && user.pin_locked_until > now) {
    const seconds = user.pin_locked_until - now;
    logger.warn('handleChildLogin', 'child PIN blocked — locked out', {
      child_id, family_id, locked_until: user.pin_locked_until,
    });
    return error(`Too many attempts. Try again in ${seconds} seconds.`, 429);
  }

  const valid = await verifyPassword(pin, user.pin_hash);

  if (!valid) {
    await recordPinFailure(env, user.id, user.pin_attempt_count ?? 0, user.pin_lockout_tier ?? 0, now, 5);
    logger.warn('handleChildLogin', 'child PIN failed', {
      child_id, family_id, attempt: (user.pin_attempt_count ?? 0) + 1,
    });
    return error('Invalid credentials', 401);
  }

  // Correct — reset counters
  await clearPinLockout(env, user.id);

  // Fetch current app_view for this child
  const settingsRow = await env.DB
    .prepare(`SELECT app_view FROM user_settings WHERE user_id = ?`)
    .bind(user.id)
    .first<{ app_view: string }>()
  const appView = (settingsRow?.app_view ?? 'ORCHARD') as 'ORCHARD' | 'CLEAN'

  // Compare to previous login to detect ORCHARD → CLEAN graduation
  const prevLogin = await env.DB
    .prepare(`SELECT app_view FROM child_logins WHERE child_id = ? ORDER BY logged_at DESC LIMIT 1`)
    .bind(user.id)
    .first<{ app_view: string | null }>()
  const prevAppView = prevLogin?.app_view ?? 'ORCHARD'
  const graduationPending = prevAppView === 'ORCHARD' && appView === 'CLEAN'

  const { token, jti, ip, userAgent } = await createChildSession(user.id, family_id, request, env);

  await env.DB
    .prepare(`INSERT INTO child_logins (child_id, logged_at, ip_address, user_agent, session_jti, app_view)
              VALUES (?,?,?,?,?,?)`)
    .bind(user.id, now, ip, userAgent, jti, appView)
    .run();

  const response = json({ token, expires_in: CHILD_JWT_EXPIRY, graduation_pending: graduationPending });
  setAuthCookie(response.headers, token, CHILD_JWT_EXPIRY);
  setSessionMarkerCookie(response.headers, 'child', CHILD_JWT_EXPIRY);
  return response;
}

/**
 * Inserts the `sessions` row and signs the JWT for a child login — shared
 * by `handleChildLogin` (PIN) and the WebAuthn login/verify handler
 * (Task 5). Does NOT touch `child_logins`/graduation detection — that
 * bookkeeping is specific to the PIN login-history feature, not part of
 * session issuance itself.
 */
async function createChildSession(
  childId: string,
  familyId: string,
  request: Request,
  env: Env,
): Promise<{ token: string; jti: string; ip: string; userAgent: string | null }> {
  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const jti = nanoid();
  const userAgent = request.headers.get('User-Agent') ?? null;

  await env.DB
    .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, issued_at, expires_at, ip_address, user_agent)
              VALUES (?,?,?,'child',?,?,?,?)`)
    .bind(jti, childId, familyId, now, now + CHILD_JWT_EXPIRY, ip, userAgent)
    .run();

  const token = await signJwt(
    { sub: childId, jti, family_id: familyId, role: 'child', iat: now, exp: now + CHILD_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return { token, jti, ip, userAgent };
}

/**
 * Issues a full child session (cookie + marker cookie) for a non-PIN login
 * path (currently: WebAuthn). Mirrors `issueParentJwt`'s shape exactly —
 * no `child_logins`/graduation bookkeeping, that's PIN-specific.
 */
export async function issueChildJwt(
  childId: string,
  familyId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const { token } = await createChildSession(childId, familyId, request, env);
  const response = json({ token, expires_in: CHILD_JWT_EXPIRY });
  setAuthCookie(response.headers, token, CHILD_JWT_EXPIRY);
  setSessionMarkerCookie(response.headers, 'child', CHILD_JWT_EXPIRY);
  return response;
}

// ----------------------------------------------------------------
// POST /auth/logout
// Revokes the current session. Requires valid JWT.
// ----------------------------------------------------------------
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE jti = ?')
    .bind(now, caller.jti)
    .run();

  const response = json({ ok: true });
  clearAuthCookie(response.headers);
  clearSessionMarkerCookie(response.headers);
  return response;
}

// ----------------------------------------------------------------
// GET /auth/me
// Returns current user profile from JWT.
// ----------------------------------------------------------------
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);

  const user = await env.DB
    .prepare('SELECT id, display_name, email, locale, email_verified, email_pending, password_hash, parent_pin_hash FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{
      id: string; display_name: string; email: string | null; locale: string;
      email_verified: number; email_pending: string | null;
      password_hash: string | null; parent_pin_hash: string | null;
    }>();

  if (!user) return error('User not found', 404);

  const { password_hash, parent_pin_hash, ...safeUser } = user;
  return json({
    ...safeUser,
    family_id: caller.family_id,
    role: caller.role,
    has_password: password_hash !== null,
    has_pin: parent_pin_hash !== null,
  });
}

// ----------------------------------------------------------------
// PATCH /auth/me
// Update display name and/or email. Writes a system_note ledger
// entry for each field changed to maintain the audit trail.
// ----------------------------------------------------------------
export async function handleMePatch(request: Request, env: Env): Promise<Response> {
  const callerRaw = (request as AuthedRequest).auth;
  if (!callerRaw) return error('Unauthorised', 401);
  const caller = callerRaw;

  let body: { display_name?: string; email?: string };
  try {
    body = await request.json() as { display_name?: string; email?: string };
  } catch {
    return error('Invalid JSON', 400);
  }

  const { display_name, email } = body;

  if (!display_name && !email) {
    return error('Nothing to update', 400);
  }

  const ip = clientIp(request);

  // Fetch current user
  const user = await env.DB
    .prepare('SELECT id, display_name, email, locale, email_verified, email_pending FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ id: string; display_name: string; email: string | null; locale: string; email_verified: number; email_pending: string | null }>();
  if (!user) return error('User not found', 404);

  // Fetch family base_currency for ledger entries
  const family = await env.DB
    .prepare('SELECT base_currency FROM families WHERE id = ?')
    .bind(caller.family_id)
    .first<{ base_currency: string }>();
  const currency = family?.base_currency ?? 'GBP';

  // Helper: write a system_note ledger entry
  async function writeSystemNote(description: string): Promise<void> {
    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(caller.family_id)
      .first<{ id: number; record_hash: string }>();
    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;

    // `ledger.id` is a single AUTOINCREMENT sequence shared by every family, not
    // scoped per family — so the next id must be derived from the table's global
    // max, not this family's own last row. Using the family-scoped id here caused
    // a PRIMARY KEY collision (and an uncaught 500) for any family that wasn't the
    // most recent writer to the table, which happens easily for a rarely-used
    // audit path like a profile name/email change.
    const globalMax = await env.DB
      .prepare('SELECT MAX(id) AS max_id FROM ledger')
      .first<{ max_id: number | null }>();
    const newId = (globalMax?.max_id ?? 0) + 1;

    const recordHash = await computeRecordHash(
      newId,
      caller.family_id,
      'NULL',         // child_id is NULL for system notes — stringify for hash input
      0,              // amount
      currency,
      'system_note',
      previousHash,
    );

    await env.DB
      .prepare(`
        INSERT INTO ledger
          (id, family_id, child_id, chore_id, entry_type, amount, currency,
           description, verification_status, authorised_by,
           previous_hash, record_hash, ip_address)
        VALUES (?,?,NULL,NULL,'system_note',0,?,?,'verified_auto',?,?,?,?)
      `)
      .bind(newId, caller.family_id, currency, description, caller.sub, previousHash, recordHash, ip)
      .run();
  }

  // The audit-trail note is best-effort — it must never fail the profile
  // update it's describing.
  async function writeSystemNoteSafe(description: string): Promise<void> {
    try {
      await writeSystemNote(description);
    } catch (err) {
      logger.error('handleMePatch', 'writeSystemNote failed', { err: String(err) });
    }
  }

  // ── Display name update ──────────────────────────────────────
  if (display_name !== undefined) {
    const trimmed = display_name.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      return error('Display name must be 2–40 characters', 400);
    }
    await env.DB
      .prepare('UPDATE users SET display_name = ? WHERE id = ?')
      .bind(trimmed, caller.sub)
      .run();
    await writeSystemNoteSafe(`🌱 ${trimmed} updated their family name`);
  }

  // ── Email update — staged via email_pending; confirmed by verify link ────────
  if (email !== undefined) {
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return error('Please enter a valid email address', 400);
    }
    if (trimmedEmail === user.email) {
      return error('That is already your current email address', 400);
    }
    // Reject if another verified account already holds this address
    const conflict = await env.DB
      .prepare('SELECT id FROM users WHERE email = ? AND email_verified = 1 AND id != ?')
      .bind(trimmedEmail, caller.sub)
      .first<{ id: string }>();
    if (conflict) {
      return error('That email address is already registered', 409);
    }

    // Stage the new address and issue a verification token
    const rawToken   = crypto.randomUUID();
    const tokenHash  = await sha256(rawToken);
    const expiresAt  = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 h

    // Invalidate any prior unused tokens for this user
    await env.DB
      .prepare('DELETE FROM email_verify_tokens WHERE user_id = ? AND used_at IS NULL')
      .bind(caller.sub)
      .run();

    await env.DB
      .prepare('INSERT INTO email_verify_tokens (user_id, token, new_email, expires_at) VALUES (?,?,?,?)')
      .bind(caller.sub, tokenHash, trimmedEmail, expiresAt)
      .run();

    await env.DB
      .prepare('UPDATE users SET email_pending = ? WHERE id = ?')
      .bind(trimmedEmail, caller.sub)
      .run();

    const verifyUrl = `${env.APP_URL}/auth/verify-email?token=${rawToken}`;
    try {
      await new EmailService(env).sendTransactional({
        to:      trimmedEmail,
        subject: 'Confirm your new Morechard email address',
        html:    buildVerifyEmailHtml(verifyUrl, user.display_name),
        text:    buildVerifyEmailText(verifyUrl, user.display_name),
      });
    } catch (err) {
      logger.error('handleMePatch', 'verify email send failed', { err: String(err) });
      // Roll back staging so the user can try again
      await env.DB.prepare('UPDATE users SET email_pending = NULL WHERE id = ?').bind(caller.sub).run();
      await env.DB.prepare('DELETE FROM email_verify_tokens WHERE token = ?').bind(tokenHash).run();
      return error('Could not send verification email — please try again', 502);
    }

    await writeSystemNoteSafe('🌱 Email change requested — awaiting verification');
  }

  // Return updated profile
  const updated = await env.DB
    .prepare('SELECT id, display_name, email, locale, email_verified, email_pending FROM users WHERE id = ?')
    .bind(caller.sub)
    .first();
  if (!updated) return error('User not found', 404);

  return json({ ...updated, family_id: caller.family_id, role: caller.role });
}

// ----------------------------------------------------------------
// GET /auth/verify-email?token=...
// Confirms a pending email change. No auth required — token is the credential.
// On success redirects the user to /parent/settings?emailVerified=1.
// ----------------------------------------------------------------
export async function handleVerifyEmail(request: Request, env: Env): Promise<Response> {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  const incomingHash = await sha256(token);
  const row = await env.DB
    .prepare('SELECT id, user_id, new_email, expires_at, used_at FROM email_verify_tokens WHERE token = ?')
    .bind(incomingHash)
    .first<{ id: number; user_id: string; new_email: string; expires_at: number; used_at: number | null }>();

  if (!row)          return new Response('Invalid or expired link', { status: 400 });
  if (row.used_at)   return new Response('This link has already been used', { status: 400 });
  if (row.expires_at < now) return new Response('This link has expired — please request a new one from Account & Profile settings', { status: 400 });

  // Apply the change: promote email_pending → email, mark verified, clear pending
  await env.DB
    .prepare('UPDATE users SET email = ?, email_verified = 1, email_pending = NULL WHERE id = ?')
    .bind(row.new_email, row.user_id)
    .run();

  // Mark token as used
  await env.DB
    .prepare('UPDATE email_verify_tokens SET used_at = ? WHERE id = ?')
    .bind(now, row.id)
    .run();

  return Response.redirect(`${env.APP_URL}/parent/settings?emailVerified=1`, 302);
}

// ----------------------------------------------------------------
// GET /auth/family/leads
// Returns the count of lead parents in the calling user's family.
// Used by the frontend to decide between "Leave Family" and "Delete Account".
// Auth: any authenticated parent.
// ----------------------------------------------------------------
export async function handleFamilyLeads(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = (request as Request & { auth?: JwtPayload }).auth;
  if (!auth) return error('Authorisation required', 401);

  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS lead_count FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead'`)
    .bind(auth.family_id)
    .first<{ lead_count: number }>();

  return json({ lead_count: row?.lead_count ?? 0 });
}

// ----------------------------------------------------------------
// DELETE /auth/me/leave
// Removes the calling parent from the family.
//
// Safety gates:
//   1. Empty Orchard Guard — rejects if no other parent exists.
//   2. Succession Gate — if caller is the last lead but co_parents exist,
//      promotes one co_parent to lead before departing.
// ----------------------------------------------------------------
export async function handleLeaveFamily(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = (request as Request & { auth?: JwtPayload }).auth;
  if (!auth) return error('Authorisation required', 401);

  const userId   = auth.sub;
  const familyId = auth.family_id;
  const ip       = clientIp(request);

  // Fetch caller's current parent_role and display_name
  const caller = await env.DB
    .prepare(`SELECT u.display_name, fr.parent_role FROM users u JOIN family_roles fr ON fr.user_id = u.id WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'parent'`)
    .bind(userId, familyId)
    .first<{ display_name: string; parent_role: string | null }>();

  if (!caller) return error('Parent record not found', 404);

  // Count all other parents in the family (any parent_role)
  const others = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  // Empty Orchard Guard — must use Delete Account instead
  if ((others?.cnt ?? 0) === 0) {
    return error('Cannot leave an empty orchard. Use Delete Account instead.', 400);
  }

  // Succession Gate — if caller is a lead, check whether other leads exist
  const otherLeads = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  // Find a co_parent to promote if no other lead exists
  let promotionStmt: ReturnType<typeof env.DB.prepare> | null = null;
  if ((otherLeads?.cnt ?? 0) === 0) {
    const coParent = await env.DB
      .prepare(`SELECT user_id FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'co_parent' LIMIT 1`)
      .bind(familyId)
      .first<{ user_id: string }>();

    if (coParent) {
      promotionStmt = env.DB
        .prepare(`UPDATE family_roles SET parent_role = 'lead' WHERE user_id = ? AND family_id = ?`)
        .bind(coParent.user_id, familyId);
    }
  }

  // Ledger: compute hash chain
  const prevRow = await env.DB
    .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
    .bind(familyId)
    .first<{ id: number; record_hash: string }>();
  const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
  const newId        = (prevRow?.id ?? 0) + 1;
  const recordHash   = await computeRecordHash(newId, familyId, '', 0, 'GBP', 'system_note', previousHash);

  const capturedName = caller.display_name;

  const batch: ReturnType<typeof env.DB.prepare>[] = [
    // Anonymise caller
    env.DB.prepare(`UPDATE users SET display_name = 'Former Co-Parent', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE id = ?`)
      .bind(userId),
    // Revoke all sessions
    env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(userId),
    // Remove family_roles row
    env.DB.prepare(`DELETE FROM family_roles WHERE user_id = ? AND family_id = ?`)
      .bind(userId, familyId),
    // Audit note
    env.DB.prepare(`INSERT INTO ledger (id, family_id, child_id, entry_type, amount, currency, description, verification_status, previous_hash, record_hash, ip_address) VALUES (?,?,NULL,'system_note',0,'GBP',?,'verified_auto',?,?,?)`)
      .bind(newId, familyId, `🌱 ${capturedName} has left the orchard.`, previousHash, recordHash, ip),
  ];

  if (promotionStmt) batch.unshift(promotionStmt); // promote first, then remove

  // Void any pending shared expenses that can no longer be approved
  batch.push(
    env.DB.prepare(
      `UPDATE shared_expenses
       SET verification_status = 'voided'
       WHERE family_id = ? AND verification_status = 'pending'`,
    ).bind(familyId)
  );

  await env.DB.batch(batch);

  return json({ ok: true, action: 'left' });
}

// ----------------------------------------------------------------
// GET /auth/family/co-parents
// Returns the co-parents in the caller's family. Lead-only.
// ----------------------------------------------------------------
export async function handleGetCoParents(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (!auth) return error('Authorisation required', 401);
  if (auth.role !== 'parent') return error('Only parents can access this', 403);

  const { results } = await env.DB
    .prepare(`
      SELECT u.id AS user_id, u.display_name
      FROM users u
      JOIN family_roles fr ON fr.user_id = u.id
      WHERE fr.family_id = ? AND fr.role = 'parent' AND fr.parent_role = 'co_parent'
    `)
    .bind(auth.family_id)
    .all<{ user_id: string; display_name: string }>();

  return json({ co_parents: results });
}

// ----------------------------------------------------------------
// DELETE /auth/family/co-parent/:userId
// Lead removes a co-parent from the family.
//
// Effects:
//   - Anonymises the removed user's PII
//   - Revokes all their sessions (forces logout on their device)
//   - Removes their family_roles row
//   - Resets families.parenting_mode to 'single'
//   - Voids any pending shared expenses (no second parent to approve them)
//   - Writes a ledger audit note
// ----------------------------------------------------------------
export async function handleRemoveCoParent(request: Request & { auth?: JwtPayload }, env: Env, targetUserId: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (!auth) return error('Authorisation required', 401);

  const callerId = auth.sub;
  const familyId = auth.family_id;
  const ip       = clientIp(request);

  // Lead-only check
  const callerRole = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(callerId, familyId)
    .first<{ parent_role: string | null }>();
  if (!callerRole || callerRole.parent_role !== 'lead') {
    return error('Only a Lead parent can remove a co-parent.', 403);
  }

  // Cannot remove yourself via this route
  if (targetUserId === callerId) return error('Cannot remove yourself — use Leave Family instead.', 400);

  // Verify target is a co-parent in this family
  const target = await env.DB
    .prepare(`
      SELECT u.display_name, fr.parent_role
      FROM users u
      JOIN family_roles fr ON fr.user_id = u.id
      WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'parent'
    `)
    .bind(targetUserId, familyId)
    .first<{ display_name: string; parent_role: string | null }>();
  if (!target) return error('Co-parent not found in this family.', 404);
  if (target.parent_role !== 'co_parent') return error('Target user is not a co-parent.', 400);

  // Check whether other co-parents will remain after removal so we know whether
  // to revert parenting_mode and void shared expenses.
  const remainingCoParents = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'co_parent' AND user_id != ?`)
    .bind(familyId, targetUserId)
    .first<{ cnt: number }>();
  const isLastCoParent = (remainingCoParents?.cnt ?? 0) === 0;

  // Ledger audit note — hash chain
  const prevRow = await env.DB
    .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
    .bind(familyId)
    .first<{ id: number; record_hash: string }>();
  const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
  const newId        = (prevRow?.id ?? 0) + 1;
  const recordHash   = await computeRecordHash(newId, familyId, '', 0, 'GBP', 'system_note', previousHash);
  const capturedName = target.display_name;

  const batch = [
    // Anonymise removed user's PII
    env.DB.prepare(`
      UPDATE users
      SET display_name = 'Former Co-Parent', email = NULL, email_pending = NULL,
          password_hash = NULL, pin_hash = NULL
      WHERE id = ?
    `).bind(targetUserId),

    // Revoke all their active sessions (next request they make will 401)
    env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(targetUserId),

    // Remove the family membership
    env.DB.prepare(`DELETE FROM family_roles WHERE user_id = ? AND family_id = ?`)
      .bind(targetUserId, familyId),

    // Immutable audit trail
    env.DB.prepare(`
      INSERT INTO ledger
        (id, family_id, child_id, entry_type, amount, currency,
         description, verification_status, previous_hash, record_hash, ip_address)
      VALUES (?,?,NULL,'system_note',0,'GBP',?,'verified_auto',?,?,?)
    `).bind(newId, familyId, `🌿 ${capturedName} has been removed from the orchard.`, previousHash, recordHash, ip),
  ];

  if (isLastCoParent) {
    // No co-parents remain — revert to single-parent mode and void shared expenses
    batch.push(
      env.DB.prepare(`UPDATE families SET parenting_mode = 'single' WHERE id = ?`).bind(familyId),
      env.DB.prepare(`
        UPDATE shared_expenses SET verification_status = 'voided'
        WHERE family_id = ? AND verification_status = 'pending'
      `).bind(familyId),
    );
  }

  await env.DB.batch(batch);

  // Bust both caches — config (parenting_mode) and children list (parent list changes)
  await Promise.all([
    env.CACHE.delete(`family:config:${familyId}`),
    env.CACHE.delete(`family:children:${familyId}`),
  ]);

  return json({ ok: true });
}

// ----------------------------------------------------------------
// DELETE /auth/family
// Soft-deletes the entire family. Lead-only. Only callable when
// the caller is the last lead.
//
// Safety gates:
//   1. Lead-only — rejects if caller's parent_role != 'lead'.
//   2. Last Lead Guard — rejects if other leads exist in the family.
// ----------------------------------------------------------------
export async function handleDeleteFamily(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = (request as Request & { auth?: JwtPayload }).auth;
  if (!auth) return error('Authorisation required', 401);

  const userId   = auth.sub;
  const familyId = auth.family_id;

  // Lead-only check
  const callerRole = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(userId, familyId)
    .first<{ parent_role: string | null }>();

  if (!callerRole || callerRole.parent_role !== 'lead') {
    return error('Only a Lead parent can delete the family.', 403);
  }

  // Block deletion while any other parent (lead or co-parent) is still in the family
  const otherParents = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  if ((otherParents?.cnt ?? 0) > 0) {
    return error('All co-parents must leave before the orchard can be uprooted.', 403);
  }

  await env.DB.batch([
    // Soft-delete the family
    env.DB.prepare(`UPDATE families SET deleted_at = unixepoch() WHERE id = ?`)
      .bind(familyId),
    // Anonymise all users in the family
    env.DB.prepare(`UPDATE users SET display_name = 'Deleted User', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE family_id = ?`)
      .bind(familyId),
    // Revoke all sessions for all family users
    env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id IN (SELECT id FROM users WHERE family_id = ?) AND revoked_at IS NULL`)
      .bind(familyId),
    // Delete invite codes
    env.DB.prepare(`DELETE FROM invite_codes WHERE family_id = ?`)
      .bind(familyId),
    // Delete registration progress
    env.DB.prepare(`DELETE FROM registration_progress WHERE family_id = ?`)
      .bind(familyId),
    // Delete push device tokens for every user in the family. `device_tokens.user_id`
    // has no ON DELETE CASCADE, and users here are anonymised rather than deleted,
    // so nothing else would remove them — leaving live push endpoints pointing at
    // an erased account (data-erasure gap).
    env.DB.prepare(`DELETE FROM device_tokens WHERE user_id IN (SELECT id FROM users WHERE family_id = ?)`)
      .bind(familyId),
  ]);

  return json({ ok: true, action: 'uprooted' });
}

// ----------------------------------------------------------------
// POST /auth/pin/set  (also handles POST /auth/pin/reset-with-password)
// Set or change the parent's 4-digit PIN.
// Always requires email password as the master key.
// Body: { password: string, new_pin: string }
// ----------------------------------------------------------------
const pinSetSchema = z.object({
  password: z.string().optional(),
  new_pin:  z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export async function handlePinSet(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const parsed = await parseValidatedBody(request, pinSetSchema);
  if (parsed instanceof Response) return parsed;
  const { password, new_pin } = parsed;

  const user = await env.DB
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ password_hash: string | null }>();

  if (!user) return error('User not found', 404);

  // Google-only users have no password — JWT is sufficient proof of identity
  if (user.password_hash) {
    if (!password) return error('password required');
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return error('Incorrect password', 401);
  }

  const pinHash = await hashPassword(new_pin);
  await env.DB
    .prepare('UPDATE users SET parent_pin_hash = ?, pin_attempt_count = 0, pin_locked_until = NULL WHERE id = ?')
    .bind(pinHash, caller.sub)
    .run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /auth/verify-pin
// Verifies the parent's 4-digit PIN. Server-side lockout after 3 failures.
// Body: { pin: string }
// ----------------------------------------------------------------
const verifyPinSchema = z.object({
  pin: z.string().min(1, 'pin required'),
});

export async function handleVerifyPin(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const parsed = await parseValidatedBody(request, verifyPinSchema);
  if (parsed instanceof Response) return parsed;
  const { pin } = parsed;

  const now = Math.floor(Date.now() / 1000);

  const user = await env.DB
    .prepare('SELECT parent_pin_hash, pin_attempt_count, pin_locked_until, pin_lockout_tier FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ parent_pin_hash: string | null; pin_attempt_count: number; pin_locked_until: number | null; pin_lockout_tier: number }>();

  if (!user) return error('User not found', 404);
  if (!user.parent_pin_hash) return error('No PIN set', 400);

  // Lockout check
  if (user.pin_locked_until && user.pin_locked_until > now) {
    const seconds = user.pin_locked_until - now;
    return error(`Too many attempts. Try again in ${seconds} seconds.`, 429);
  }

  const valid = await verifyPassword(pin, user.parent_pin_hash);

  if (!valid) {
    await recordPinFailure(env, caller.sub, user.pin_attempt_count ?? 0, user.pin_lockout_tier ?? 0, now, 3);
    return error('Incorrect PIN', 401);
  }

  // Correct — reset counters
  await clearPinLockout(env, caller.sub);

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /auth/sessions
// Returns all active (non-revoked, non-expired) sessions for the caller.
// ----------------------------------------------------------------
export async function handleGetSessions(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const now = Math.floor(Date.now() / 1000);

  const { results } = await env.DB
    .prepare(`
      SELECT jti, issued_at, user_agent
      FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY issued_at DESC
    `)
    .bind(caller.sub, now)
    .all<{ jti: string; issued_at: number; user_agent: string | null }>();

  return json({ sessions: results });
}

// ----------------------------------------------------------------
// DELETE /auth/sessions/:jti
// Revoke a single session. Caller must own the session.
// ----------------------------------------------------------------
export async function handleRevokeSession(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const url = new URL(request.url);
  const jti = url.pathname.split('/').at(-1);
  if (!jti) return error('jti required', 400);

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE jti = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now, jti, caller.sub)
    .run();

  if (result.meta.changes === 0) return error('Session not found', 404);
  return json({ ok: true });
}

// ----------------------------------------------------------------
// DELETE /auth/sessions?others=true
// Revoke all sessions for this user except the current one.
// ----------------------------------------------------------------
export async function handleRevokeOtherSessions(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND jti != ? AND revoked_at IS NULL')
    .bind(now, caller.sub, caller.jti)
    .run();

  return json({ ok: true, revoked: result.meta.changes });
}

// ----------------------------------------------------------------
// GET /auth/google
// Initiates Google OAuth 2.0 flow. Sets CSRF state cookie and
// redirects to Google's authorisation endpoint.
// ----------------------------------------------------------------
export async function handleGoogleAuth(_request: Request, env: Env): Promise<Response> {
  const nonce       = nanoid(16);
  const sig         = await hmacSign(`oauth-state.${nonce}`, env.JWT_SECRET);
  const state       = `${nonce}.${sig}`;
  const redirectUri = `${env.WORKER_URL ?? 'https://api.morechard.com'}/auth/google/callback`;

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'offline',
    prompt:        'select_account',
  });

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    },
  });
}

// ----------------------------------------------------------------
// GET /auth/google/callback
// Receives the OAuth code, verifies CSRF, exchanges code for tokens,
// verifies the ID token, merges the user, issues SLT, redirects.
// ----------------------------------------------------------------
export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const appUrl = env.APP_URL ?? 'https://app.morechard.com';
  try {
    return await _handleGoogleCallback(request, env, appUrl);
  } catch (err) {
    logger.error('handleGoogleCallback', 'unhandled error', { err: String(err) });
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=google_exchange&detail=${encodeURIComponent(String(err).slice(0, 200))}` },
    });
  }
}

async function _handleGoogleCallback(request: Request, env: Env, appUrl: string): Promise<Response> {
  const url         = new URL(request.url);
  const code        = url.searchParams.get('code');
  const stateParam  = url.searchParams.get('state');
  const redirectUri = `${env.WORKER_URL ?? 'https://api.morechard.com'}/auth/google/callback`;

  // ── Step 1: CSRF validation (HMAC-signed state, no cookie needed) ──
  if (!stateParam || !code) {
    return new Response(null, { status: 302, headers: { 'Location': `${appUrl}/auth/login?error=csrf` } });
  }
  const dotIdx = stateParam.lastIndexOf('.');
  if (dotIdx === -1) {
    return new Response(null, { status: 302, headers: { 'Location': `${appUrl}/auth/login?error=csrf` } });
  }
  const nonce        = stateParam.slice(0, dotIdx);
  const receivedSig  = stateParam.slice(dotIdx + 1);
  const expectedSig  = await hmacSign(`oauth-state.${nonce}`, env.JWT_SECRET);
  const sigsMatch = timingSafeEqual(
    new TextEncoder().encode(receivedSig),
    new TextEncoder().encode(expectedSig),
  );
  if (!sigsMatch) {
    return new Response(null, { status: 302, headers: { 'Location': `${appUrl}/auth/login?error=csrf` } });
  }

  // ── Step 2: Token exchange ────────────────────────────────────
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=google_exchange&detail=${encodeURIComponent(errBody.slice(0, 100))}` },
    });
  }

  const tokenData = await tokenRes.json<{ id_token: string }>();

  // ── Step 3: Verify ID token ───────────────────────────────────
  let googlePayload: GoogleIdTokenPayload;
  try {
    googlePayload = await verifyGoogleIdToken(tokenData.id_token, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=google_exchange&detail=${encodeURIComponent(String(err).slice(0, 100))}` },
    });
  }

  if (!googlePayload.email_verified) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=unverified` },
    });
  }

  const { sub, email, picture } = googlePayload;
  const normEmail = email.toLowerCase().trim();

  // ── Step 4: Merge / bridge logic ─────────────────────────────
  const user = await env.DB
    .prepare('SELECT id, family_id, display_name FROM users WHERE email = ? LIMIT 1')
    .bind(normEmail)
    .first<{ id: string; family_id: string; display_name: string }>();

  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=no_account&hint=${encodeURIComponent(normEmail)}` },
    });
  }

  await env.DB
    .prepare('UPDATE users SET google_sub = ?, google_picture = ?, email_verified = 1 WHERE id = ?')
    .bind(sub, picture ?? null, user.id)
    .run();

  // ── Step 5: Issue SLT ─────────────────────────────────────────
  const rawSlt  = nanoid(32);
  const sltHash = await sha256(rawSlt);
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare('INSERT INTO slt_tokens (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(sltHash, user.id, now + 300, clientIp(request), request.headers.get('User-Agent') ?? '')
    .run();

  // ── Step 6: Redirect to frontend ─────────────────────────────
  return new Response(null, {
    status: 302,
    headers: { 'Location': `${appUrl}/auth/callback?slt=${rawSlt}` },
  });
}

// ----------------------------------------------------------------
// POST /auth/slt/exchange
// Consumes a Short-Lived Token, returns a long-lived JWT.
// Body: { slt: string }
// ----------------------------------------------------------------
const sltExchangeSchema = z.object({
  slt: z.string().min(1, 'slt required'),
});

export async function handleSltExchange(request: Request, env: Env): Promise<Response> {
  const parsed = await parseValidatedBody(request, sltExchangeSchema);
  if (parsed instanceof Response) return parsed;
  const { slt } = parsed;

  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);

  // ── Step 1: IP abuse check ────────────────────────────────────
  const attempt = await env.DB
    .prepare('SELECT attempts, blocked_until FROM slt_attempts WHERE ip = ?')
    .bind(ip)
    .first<{ attempts: number; blocked_until: number | null }>();

  if (attempt?.blocked_until && attempt.blocked_until > now) {
    return error('Too many attempts. Try again later.', 429);
  }

  // ── Step 2: SLT lookup — compare against stored hash ─────────
  const incomingSltHash = await sha256(slt as string);
  const tokenRow = await env.DB
    .prepare('SELECT user_id FROM slt_tokens WHERE token = ? AND expires_at > ?')
    .bind(incomingSltHash, now)
    .first<{ user_id: string }>();

  if (!tokenRow) {
    await env.DB
      .prepare(`
        INSERT INTO slt_attempts (ip, attempts, blocked_until)
        VALUES (?, 1, NULL)
        ON CONFLICT(ip) DO UPDATE SET
          attempts      = attempts + 1,
          blocked_until = CASE WHEN attempts + 1 >= 5
                          THEN unixepoch() + 3600
                          ELSE blocked_until END
      `)
      .bind(ip)
      .run();
    return error('Invalid or expired token', 401);
  }

  // ── Step 3: Consume token ─────────────────────────────────────
  await env.DB
    .prepare('DELETE FROM slt_tokens WHERE token = ?')
    .bind(incomingSltHash)
    .run();

  // ── Step 4: Load user ─────────────────────────────────────────
  const user = await env.DB
    .prepare(`
      SELECT u.id, u.display_name, u.google_picture,
             u.parent_pin_hash, u.password_hash,
             fr.family_id, fr.parent_role
      FROM users u
      JOIN family_roles fr ON fr.user_id = u.id AND fr.role = 'parent'
      WHERE u.id = ?
      LIMIT 1
    `)
    .bind(tokenRow.user_id)
    .first<{
      id:              string;
      display_name:    string;
      google_picture:  string | null;
      parent_pin_hash: string | null;
      password_hash:   string | null;
      family_id:       string;
      parent_role:     string | null;
    }>();

  if (!user) return error('User not found', 404);

  // ── Step 5: Issue JWT ─────────────────────────────────────────
  const jwtResponse = await issueParentJwt(user.id, user.family_id, request, env);
  const jwtData     = await jwtResponse.clone().json<{ token: string }>();

  // ── Step 6: Reset abuse counter on success ───────────────────
  await env.DB
    .prepare('DELETE FROM slt_attempts WHERE ip = ?')
    .bind(ip)
    .run();

  // ── Step 7: Respond ───────────────────────────────────────────
  const response = json({
    token: jwtData.token,
    user: {
      id:             user.id,
      family_id:      user.family_id,
      display_name:   user.display_name,
      role:           'parent',
      parenting_role: user.parent_role === 'lead' ? 'LEAD_PARENT' : 'CO_PARENT',
      has_pin:        user.parent_pin_hash !== null,
      has_password:   user.password_hash   !== null,
      google_picture: user.google_picture  ?? null,
    },
  });
  // issueParentJwt already set the auth + session-marker cookies on
  // jwtResponse — carry them over since we build a new response body here.
  for (const cookie of jwtResponse.headers.getAll('Set-Cookie')) {
    response.headers.append('Set-Cookie', cookie);
  }
  return response;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface GoogleIdTokenPayload {
  sub:            string;
  email:          string;
  email_verified: boolean;
  name:           string;
  picture:        string;
  exp:            number;
  aud:            string;
  iss:            string;
}

async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [headerB64, payloadB64, sigB64] = parts;

  function b64url(s: string): string {
    return s.replace(/-/g, '+').replace(/_/g, '/');
  }

  const header  = JSON.parse(atob(b64url(headerB64)))  as { kid: string; alg: string };
  const payload = JSON.parse(atob(b64url(payloadB64))) as GoogleIdTokenPayload;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now)                           throw new Error('Token expired');
  if (payload.aud !== expectedClientId)            throw new Error('Wrong audience');
  if (payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com')       throw new Error('Wrong issuer');

  // Fetch Google's public JWK set — cached for its Cache-Control max-age (~5 h).
  // caches.default respects the response's Cache-Control header automatically.
  const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
  const cache    = caches.default;
  let certsRes   = await cache.match(JWKS_URL);
  if (!certsRes) {
    certsRes = await fetch(JWKS_URL);
    if (certsRes.ok) await cache.put(JWKS_URL, certsRes.clone());
  }
  const certs = await certsRes.json<{ keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> }>();
  const jwk      = certs.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('JWK not found for kid: ' + header.kid);

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const sigBytes  = Uint8Array.from(atob(b64url(sigB64)),  c => c.charCodeAt(0));
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid     = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sigBytes, dataBytes);
  if (!valid) throw new Error('Invalid signature');

  return payload;
}

export async function issueParentJwt(userId: string, familyId: string, request: Request, env: Env): Promise<Response> {
  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const jti = nanoid();
  const ua = request.headers.get('User-Agent') ?? '';

  await env.DB
    .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, issued_at, expires_at, ip_address, user_agent)
              VALUES (?,?,?,'parent',?,?,?,?)`)
    .bind(jti, userId, familyId, now, now + PARENT_JWT_EXPIRY, ip, ua)
    .run();

  const token = await signJwt(
    { sub: userId, jti, family_id: familyId, role: 'parent', iat: now, exp: now + PARENT_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  const response = json({ token, expires_in: PARENT_JWT_EXPIRY });
  setAuthCookie(response.headers, token, PARENT_JWT_EXPIRY);
  setSessionMarkerCookie(response.headers, 'parent', PARENT_JWT_EXPIRY);
  return response;
}

async function sendMagicLinkEmail(
  to: string,
  name: string,
  link: string,
  env: Env,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Morechard <noreply@mail.morechard.com>',
      to,
      subject: 'Your Morechard sign-in link',
      html: buildMagicLinkHtml(escHtml(name), link),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

function buildMagicLinkHtml(name: string, link: string): string {
  const TEAL = '#00959c';
  const CREAM = '#f9f7f2';
  const LOGO_URL = 'https://app.morechard.com/icons/icon-192.png';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Morechard</title>
  <!--[if !mso]><!-->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${CREAM};font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:${CREAM};padding:40px 20px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table width="100%" id="email-card" border="0" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e2e8e2;border-radius:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);overflow:hidden;">

          <!-- Top Header Band -->
          <tr>
            <td style="background-color:${CREAM};padding:28px 24px;text-align:center;border-bottom:1px solid #e2e8e2;">
              <img src="${LOGO_URL}" width="36" height="36" alt="Morechard" style="display:inline-block;vertical-align:middle;margin-right:10px;border-radius:8px;">
              <span style="vertical-align:middle;font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.3px;color:#1b2d2e;">Morechard</span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:40px 32px;text-align:left;">
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1a202c;line-height:1.3;">Hello ${name},</h1>
              <p style="margin:0 0 28px 0;font-size:16px;line-height:1.6;color:#4a5568;">
                Click the button below to instantly sign in to your Morechard account. This link is secure and will sign you in automatically.
              </p>

              <!-- CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${link}"
                       target="_blank"
                       style="display:inline-block;background-color:${TEAL};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;box-shadow:0 2px 4px rgba(0,149,156,0.25);">
                      Sign in to Morechard
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback Link -->
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#718096;text-align:center;">
                Button not working? Copy and paste this URL into your browser:<br>
                <a href="${link}" style="color:${TEAL};text-decoration:underline;word-break:break-all;">
                  ${link}
                </a>
              </p>

              <hr style="border:0;border-top:1px solid #edf2f7;margin:24px 0;">

              <!-- Security Footer inside card -->
              <p style="margin:0;font-size:12px;line-height:1.5;color:#a0aec0;text-align:center;">
                This secure sign-in link expires in <strong>15 minutes</strong>.<br>
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

        <!-- Outside Footer -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:520px;margin-top:24px;">
          <tr>
            <td style="text-align:center;font-size:12px;color:#a0aec0;">
              <p style="margin:0 0 8px 0;">&copy; 2026 Morechard. Helping families grow financial confidence.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Augmented request type used by middleware + auth routes
export interface AuthedRequest extends Request {
  auth?: import('../lib/jwt.js').JwtPayload & { jti: string };
}

// Shared expense approval notification (pre-Phase 8 push bridge)
export async function sendApprovalEmail(
  to: string,
  recipientName: string,
  loggerName: string,
  totalAmount: number,
  currency: string,
  description: string,
  expenseId: number,
  env: { RESEND_API_KEY: string },
): Promise<void> {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';
  const formatted = `${symbol}${(totalAmount / 100).toFixed(2)}`;
  const appUrl = 'https://morechard.com/parent?tab=pool';

  const html = `
    <p>Hi ${escHtml(recipientName)},</p>
    <p><strong>${escHtml(loggerName)}</strong> has logged a shared expense that requires your approval:</p>
    <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">
      <strong>${escHtml(description)}</strong> — ${formatted}
    </blockquote>
    <p><a href="${appUrl}&expense=${expenseId}" style="background:#1a7a4a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">
      Review in Morechard →
    </a></p>
    <p style="color:#888;font-size:12px">If you weren't expecting this, you can safely ignore it.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Morechard <noreply@mail.morechard.com>',
      to,
      subject: `Shared expense of ${formatted} needs your approval`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error('sendApprovalEmail', 'Resend API error', { status: res.status, body });
    // Non-fatal: expense is already recorded; email failure should not roll back the row.
  }
}
