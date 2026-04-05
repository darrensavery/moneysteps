/**
 * Auth routes
 *
 * POST /auth/register          Create parent account (email + optional password)
 * POST /auth/login             Email + password login → JWT
 * POST /auth/magic-link        Request magic link email
 * GET  /auth/verify            Consume magic link token → JWT
 * POST /auth/child/login       Child PIN login → scoped JWT
 * POST /auth/child/set-pin     Parent sets/resets child PIN
 * POST /auth/logout            Revoke session (server-side)
 * GET  /auth/me                Return current user from JWT
 */

import { Env } from '../types.js';
import { json, error, clientIp } from '../lib/response.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { signJwt, verifyJwt } from '../lib/jwt.js';
import { nanoid } from '../lib/nanoid.js';
import { sha256 } from '../lib/hash.js';

const MAGIC_LINK_EXPIRY  = 15 * 60;       // 15 minutes
const PARENT_JWT_EXPIRY  = 7 * 24 * 3600; // 7 days
const CHILD_JWT_EXPIRY   = 24 * 3600;     // 24 hours
const PIN_LENGTH         = 4;

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
export async function handleCreateFamily(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { display_name, email, password, locale } = body;
  if (!display_name || typeof display_name !== 'string') return error('display_name required');
  if (!email        || typeof email        !== 'string') return error('email required');

  const normEmail = (email as string).toLowerCase().trim();
  if (!isValidEmail(normEmail)) return error('Invalid email address');

  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first();
  if (existing) return error('Email already registered', 409);

  const familyId     = nanoid();
  const userId       = nanoid();
  const passwordHash = password ? await hashPassword(password as string) : null;
  const userLocale   = (locale === 'pl' ? 'pl' : 'en');

  // Accept new Stage-1/2 registration fields (default to safe values if absent)
  const governance_mode  = (body['governance_mode']  === 'standard') ? 'standard'      : 'amicable';
  const base_currency    = (body['base_currency']    === 'PLN')      ? 'PLN'           : 'GBP';
  const parenting_mode   = (body['parenting_mode']   === 'co-parenting') ? 'co-parenting' : 'single';

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO families (id, name, currency, verify_mode, base_currency, parenting_mode) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(familyId, display_name, base_currency, governance_mode, base_currency, parenting_mode),
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, password_hash, email_verified)
      VALUES (?,?,?,?,?,?,0)
    `).bind(userId, familyId, display_name, normEmail, userLocale, passwordHash),
    env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role) VALUES (?,?,'parent')`)
      .bind(userId, familyId),
  ]);

  return json({ family_id: familyId, user_id: userId, email: normEmail }, 201);
}

// ----------------------------------------------------------------
// POST /auth/register
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { family_id, display_name, email, password, locale } = body;
  if (!family_id    || typeof family_id    !== 'string') return error('family_id required');
  if (!display_name || typeof display_name !== 'string') return error('display_name required');
  if (!email        || typeof email        !== 'string') return error('email required');

  const normEmail = (email as string).toLowerCase().trim();
  if (!isValidEmail(normEmail)) return error('Invalid email address');

  // Check family exists
  const family = await env.DB
    .prepare('SELECT id FROM families WHERE id = ?').bind(family_id).first();
  if (!family) return error('Family not found', 404);

  // Check email not already registered
  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first();
  if (existing) return error('Email already registered', 409);

  const userId       = nanoid();
  const passwordHash = password ? await hashPassword(password as string) : null;
  const userLocale   = (locale === 'pl' ? 'pl' : 'en');

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, password_hash, email_verified)
      VALUES (?,?,?,?,?,?,0)
    `).bind(userId, family_id, display_name, normEmail, userLocale, passwordHash),

    env.DB.prepare(`
      INSERT INTO family_roles (user_id, family_id, role) VALUES (?,?,'parent')
    `).bind(userId, family_id),
  ]);

  return json({ user_id: userId, email: normEmail }, 201);
}

// ----------------------------------------------------------------
// POST /auth/login
// Email + password login. Returns JWT.
// Body: { email, password }
// ----------------------------------------------------------------
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { email, password } = body;
  if (!email    || typeof email    !== 'string') return error('email required');
  if (!password || typeof password !== 'string') return error('password required');

  const normEmail = (email as string).toLowerCase().trim();

  const user = await env.DB
    .prepare('SELECT id, family_id, password_hash, email_verified FROM users WHERE email = ?')
    .bind(normEmail)
    .first<{ id: string; family_id: string; password_hash: string | null; email_verified: number }>();

  // Deliberate vague error — don't reveal whether email exists
  if (!user || !user.password_hash) return error('Invalid credentials', 401);

  const valid = await verifyPassword(password as string, user.password_hash);
  if (!valid) return error('Invalid credentials', 401);

  return issueParentJwt(user.id, user.family_id, request, env);
}

// ----------------------------------------------------------------
// POST /auth/magic-link
// Generates a single-use token and sends it via Resend.
// Body: { email }
// ----------------------------------------------------------------
export async function handleMagicLinkRequest(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { email } = body;
  if (!email || typeof email !== 'string') return error('email required');
  const normEmail = (email as string).toLowerCase().trim();

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
  const appUrl  = env.APP_URL ?? 'https://app.morechard.com';
  const link    = `${appUrl}/auth/verify?token=${rawToken}`;

  await sendMagicLinkEmail(normEmail, user.display_name, link, env);

  return json({ sent: true });
}

// ----------------------------------------------------------------
// GET /auth/verify?token=
// Consumes a magic link token. Returns JWT.
// ----------------------------------------------------------------
export async function handleMagicLinkVerify(request: Request, env: Env): Promise<Response> {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return error('token required');

  const tokenHash = await sha256(token);
  const now       = Math.floor(Date.now() / 1000);

  const row = await env.DB
    .prepare(`SELECT id, user_id, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<{ id: number; user_id: string; expires_at: number; used_at: number | null }>();

  if (!row)           return error('Invalid or unknown token', 401);
  if (row.used_at)    return error('Token already used', 401);
  if (now > row.expires_at) return error('Token expired', 401);

  // Mark token used + mark email verified — atomic
  const user = await env.DB
    .prepare('SELECT id, family_id FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ id: string; family_id: string }>();

  if (!user) return error('User not found', 404);

  await env.DB.batch([
    env.DB.prepare('UPDATE magic_link_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(user.id),
  ]);

  return issueParentJwt(user.id, user.family_id, request, env);
}

// ----------------------------------------------------------------
// POST /auth/child/set-pin
// Parent sets or resets a child's PIN. Requires parent JWT.
// Body: { child_id, pin }  — pin must be exactly 4 digits
// ----------------------------------------------------------------
export async function handleSetChildPin(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { child_id, pin } = body;
  if (!child_id || typeof child_id !== 'string') return error('child_id required');
  if (!pin      || typeof pin      !== 'string') return error('pin required');
  if (!/^\d{4}$/.test(pin as string))            return error('PIN must be exactly 4 digits');

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

  const pinHash = await hashPassword(pin as string);
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
export async function handleChildLogin(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { family_id, child_id, pin } = body;
  if (!family_id || typeof family_id !== 'string') return error('family_id required');
  if (!child_id  || typeof child_id  !== 'string') return error('child_id required');
  if (!pin       || typeof pin       !== 'string') return error('pin required');

  const user = await env.DB
    .prepare(`SELECT u.id, u.pin_hash FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(child_id, family_id)
    .first<{ id: string; pin_hash: string | null }>();

  if (!user || !user.pin_hash) return error('Invalid credentials', 401);

  const valid = await verifyPassword(pin as string, user.pin_hash);
  if (!valid) return error('Invalid credentials', 401);

  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const jti = nanoid();

  await env.DB
    .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
              VALUES (?,?,?,'child',?,?)`)
    .bind(jti, user.id, family_id, now + CHILD_JWT_EXPIRY, ip)
    .run();

  const token = await signJwt(
    { sub: user.id, jti, family_id, role: 'child', iat: now, exp: now + CHILD_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return json({ token, expires_in: CHILD_JWT_EXPIRY });
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

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /auth/me
// Returns current user profile from JWT.
// ----------------------------------------------------------------
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);

  const user = await env.DB
    .prepare('SELECT id, display_name, email, locale, email_verified FROM users WHERE id = ?')
    .bind(caller.sub)
    .first();

  if (!user) return error('User not found', 404);
  return json({ ...user, family_id: caller.family_id, role: caller.role });
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

async function issueParentJwt(userId: string, familyId: string, request: Request, env: Env): Promise<Response> {
  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const jti = nanoid();

  await env.DB
    .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
              VALUES (?,?,?,'parent',?,?)`)
    .bind(jti, userId, familyId, now + PARENT_JWT_EXPIRY, ip)
    .run();

  const token = await signJwt(
    { sub: userId, jti, family_id: familyId, role: 'parent', iat: now, exp: now + PARENT_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return json({ token, expires_in: PARENT_JWT_EXPIRY });
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
      from: 'Morechard <onboarding@resend.dev>',
      to,
      subject: 'Your Morechard sign-in link',
      html: `
        <p>Hi ${escHtml(name)},</p>
        <p>Click the link below to sign in to Morechard. This link expires in 15 minutes and can only be used once.</p>
        <p><a href="${link}" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Sign in to Morechard</a></p>
        <p style="color:#666;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#666;font-size:12px;">Link: ${link}</p>
      `,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Augmented request type used by middleware + auth routes
export interface AuthedRequest extends Request {
  auth?: import('../lib/jwt.js').JwtPayload & { jti: string };
}
