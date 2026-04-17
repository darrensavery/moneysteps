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
import { signJwt } from '../lib/jwt.js';
import type { JwtPayload } from '../lib/jwt.js';
import { nanoid } from '../lib/nanoid.js';
import { sha256, computeRecordHash, GENESIS_HASH } from '../lib/hash.js';

const MAGIC_LINK_EXPIRY  = 15 * 60;       // 15 minutes
const PARENT_JWT_EXPIRY  = 7 * 24 * 3600; // 7 days
const CHILD_JWT_EXPIRY   = 24 * 3600;     // 24 hours

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
    .prepare('SELECT id, family_id, email_verified FROM users WHERE email = ?')
    .bind(normEmail)
    .first<{ id: string; family_id: string; email_verified: number }>();

  // If the user exists and has already verified their email, block re-registration
  if (existing && existing.email_verified === 1) return error('Email already registered', 409);

  // If the user exists but never verified (e.g. previous registration hit an error),
  // delete the orphaned record so they can start fresh cleanly.
  // Must delete all FK-dependent child rows before deleting families.
  if (existing && existing.email_verified === 0) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM family_roles        WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM magic_link_tokens   WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM sessions            WHERE user_id  = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM invite_codes        WHERE family_id = ?').bind(existing.family_id),
      env.DB.prepare('DELETE FROM registration_progress WHERE family_id = ?').bind(existing.family_id),
      env.DB.prepare('DELETE FROM users               WHERE id       = ?').bind(existing.id),
      env.DB.prepare('DELETE FROM families            WHERE id       = ?').bind(existing.family_id),
    ]);
  }

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
    env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?,?,'parent','lead')`)
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

  const ip  = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const jti = nanoid();

  const ua = request.headers.get('User-Agent') ?? null;

  await env.DB.batch([
    env.DB
      .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, issued_at, expires_at, ip_address, user_agent)
                VALUES (?,?,?,'child',?,?,?,?)`)
      .bind(jti, user.id, family_id, now, now + CHILD_JWT_EXPIRY, ip, ua),
    env.DB
      .prepare(`INSERT INTO child_logins (child_id, logged_at, ip_address, user_agent, session_jti, app_view)
                VALUES (?,?,?,?,?,?)`)
      .bind(user.id, now, ip, ua, jti, appView),
  ]);

  const token = await signJwt(
    { sub: user.id, jti, family_id, role: 'child', iat: now, exp: now + CHILD_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return json({ token, expires_in: CHILD_JWT_EXPIRY, graduation_pending: graduationPending });
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

  // Fetch family default_currency for ledger entries
  const family = await env.DB
    .prepare('SELECT default_currency FROM families WHERE id = ?')
    .bind(caller.family_id)
    .first<{ default_currency: string }>();
  const currency = family?.default_currency ?? 'GBP';

  // Helper: write a system_note ledger entry
  async function writeSystemNote(description: string): Promise<void> {
    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(caller.family_id)
      .first<{ id: number; record_hash: string }>();
    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;

    const maxRow = await env.DB
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger')
      .first<{ max_id: number }>();
    const newId = (maxRow?.max_id ?? 0) + 1;

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
    await writeSystemNote(`🌱 ${trimmed} updated their family name`);
  }

  // ── Email update ─────────────────────────────────────────────
  if (email !== undefined) {
    const trimmedEmail = email.trim().toLowerCase();
    // Basic RFC-ish format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return error('Please enter a valid email address', 400);
    }
    // Uniqueness check — reject if another verified account has this address
    const conflict = await env.DB
      .prepare('SELECT id FROM users WHERE email = ? AND email_verified = 1 AND id != ?')
      .bind(trimmedEmail, caller.sub)
      .first<{ id: string }>();
    if (conflict) {
      return error('That email address is already registered', 409);
    }
    await env.DB
      .prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?')
      .bind(trimmedEmail, caller.sub)
      .run();
    await writeSystemNote('🌱 Contact email was updated');
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
  const maxRow = await env.DB
    .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger WHERE family_id = ?')
    .bind(familyId)
    .first<{ max_id: number }>();
  const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
  const newId        = (maxRow?.max_id ?? 0) + 1;
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

  await env.DB.batch(batch);

  return json({ ok: true, action: 'left' });
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

  // Last Lead Guard
  const leadCount = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead'`)
    .bind(familyId)
    .first<{ cnt: number }>();

  if ((leadCount?.cnt ?? 0) > 1) {
    return error('An orchard cannot be uprooted while another guardian is present.', 403);
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
  ]);

  return json({ ok: true, action: 'uprooted' });
}

// ----------------------------------------------------------------
// POST /auth/pin/set  (also handles POST /auth/pin/reset-with-password)
// Set or change the parent's 4-digit PIN.
// Always requires email password as the master key.
// Body: { password: string, new_pin: string }
// ----------------------------------------------------------------
export async function handlePinSet(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { password, new_pin } = body;
  if (!new_pin  || typeof new_pin  !== 'string') return error('new_pin required');
  if (!/^\d{4}$/.test(new_pin as string)) return error('PIN must be exactly 4 digits');

  const user = await env.DB
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ password_hash: string | null }>();

  if (!user) return error('User not found', 404);

  // Google-only users have no password — JWT is sufficient proof of identity
  if (user.password_hash) {
    if (!password || typeof password !== 'string') return error('password required');
    const valid = await verifyPassword(password as string, user.password_hash);
    if (!valid) return error('Incorrect password', 401);
  }

  const pinHash = await hashPassword(new_pin as string);
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
export async function handleVerifyPin(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { pin } = body;
  if (!pin || typeof pin !== 'string') return error('pin required');

  const now = Math.floor(Date.now() / 1000);

  const user = await env.DB
    .prepare('SELECT parent_pin_hash, pin_attempt_count, pin_locked_until FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ parent_pin_hash: string | null; pin_attempt_count: number; pin_locked_until: number | null }>();

  if (!user) return error('User not found', 404);
  if (!user.parent_pin_hash) return error('No PIN set', 400);

  // Lockout check
  if (user.pin_locked_until && user.pin_locked_until > now) {
    const seconds = user.pin_locked_until - now;
    return error(`Too many attempts. Try again in ${seconds} seconds.`, 429);
  }

  const valid = await verifyPassword(pin as string, user.parent_pin_hash);

  if (!valid) {
    const newCount = (user.pin_attempt_count ?? 0) + 1;
    if (newCount >= 3) {
      // Lock for 30 seconds, reset counter
      await env.DB
        .prepare('UPDATE users SET pin_attempt_count = 0, pin_locked_until = ? WHERE id = ?')
        .bind(now + 30, caller.sub)
        .run();
    } else {
      await env.DB
        .prepare('UPDATE users SET pin_attempt_count = ? WHERE id = ?')
        .bind(newCount, caller.sub)
        .run();
    }
    return error('Incorrect PIN', 401);
  }

  // Correct — reset counters
  await env.DB
    .prepare('UPDATE users SET pin_attempt_count = 0, pin_locked_until = NULL WHERE id = ?')
    .bind(caller.sub)
    .run();

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
  const sig         = await hmacSign(nonce, env.JWT_SECRET);
  const state       = `${nonce}.${sig}`;
  const redirectUri = 'https://api.morechard.com/auth/google/callback';

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
  const appUrl = 'https://app.morechard.com';
  try {
    return await _handleGoogleCallback(request, env, appUrl);
  } catch (err) {
    console.error('handleGoogleCallback unhandled error:', err);
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
  const redirectUri = 'https://api.morechard.com/auth/google/callback';

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
  const expectedSig  = await hmacSign(nonce, env.JWT_SECRET);
  if (receivedSig !== expectedSig) {
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
  const slt = nanoid(32);
  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare('INSERT INTO slt_tokens (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(slt, user.id, now + 300, clientIp(request), request.headers.get('User-Agent') ?? '')
    .run();

  // ── Step 6: Redirect to frontend ─────────────────────────────
  return new Response(null, {
    status: 302,
    headers: { 'Location': `${appUrl}/auth/callback?slt=${slt}` },
  });
}

// ----------------------------------------------------------------
// POST /auth/slt/exchange
// Consumes a Short-Lived Token, returns a long-lived JWT.
// Body: { slt: string }
// ----------------------------------------------------------------
export async function handleSltExchange(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { slt } = body;
  if (!slt || typeof slt !== 'string') return error('slt required');

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

  // ── Step 2: SLT lookup ────────────────────────────────────────
  const tokenRow = await env.DB
    .prepare('SELECT user_id FROM slt_tokens WHERE token = ? AND expires_at > ?')
    .bind(slt, now)
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
    .bind(slt)
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
  return json({
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

  // Fetch Google's public JWK set
  const certsRes = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const certs    = await certsRes.json<{ keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> }>();
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

async function issueParentJwt(userId: string, familyId: string, request: Request, env: Env): Promise<Response> {
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
      from: 'Morechard <noreply@mail.morechard.com>',
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
