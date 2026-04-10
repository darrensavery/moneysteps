/**
 * Invite code routes
 *
 * POST /auth/invite/generate   Parent generates a typed 6-char invite code
 * POST /auth/invite/redeem     Anyone redeems a code to join a family
 * POST /auth/child/add         Parent adds a child (display_name → child user + child invite code)
 */

import { Env, InviteRole } from '../types.js';
import { json, error, clientIp } from '../lib/response.js';
import { nanoid } from '../lib/nanoid.js';
import { hashPassword } from '../lib/crypto.js';
import { signJwt } from '../lib/jwt.js';
import { AuthedRequest } from './auth.js';

const INVITE_TTL = 72 * 60 * 60; // 72 hours in seconds
const CHILD_JWT_EXPIRY = 24 * 3600;
const PARENT_JWT_EXPIRY = 7 * 24 * 3600;

// ── Generates a cryptographically random 6-char uppercase code ──────────────
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  let code = '';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (const byte of arr) code += chars[byte % chars.length];
  return code;
}

// ── POST /auth/invite/generate ───────────────────────────────────────────────
// Requires parent JWT. Creates a typed, single-use code valid for 72h.
// Body: { role: 'child' | 'co-parent' }
export async function handleGenerateInvite(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller || caller.role !== 'parent') return error('Unauthorised', 401);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const role = body['role'] as InviteRole | undefined;
  if (role !== 'child' && role !== 'co-parent') return error('role must be "child" or "co-parent"');

  const now = Math.floor(Date.now() / 1000);

  // Generate a unique code (retry on collision — extremely rare)
  let code = generateCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await env.DB
      .prepare('SELECT code FROM invite_codes WHERE code = ? AND redeemed_at IS NULL AND expires_at > ?')
      .bind(code, now)
      .first();
    if (!existing) break;
    code = generateCode();
    attempts++;
  }

  await env.DB
    .prepare(`
      INSERT INTO invite_codes (code, family_id, created_by, role, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(code, caller.family_id, caller.sub, role, now + INVITE_TTL)
    .run();

  return json({ code, role, expires_at: now + INVITE_TTL });
}

// ── POST /auth/invite/peek ───────────────────────────────────────────────────
// Public route. Validates a code is active without redeeming it.
// Returns { role } so the client can render the correct details form.
export async function handlePeekInvite(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const code = (body['code'] as string | undefined)?.trim().toUpperCase();
  if (!code || code.length !== 6) return error('code must be 6 characters');

  const now = Math.floor(Date.now() / 1000);

  const invite = await env.DB
    .prepare(`
      SELECT role, redeemed_at, expires_at
      FROM invite_codes WHERE code = ?
    `)
    .bind(code)
    .first<{ role: InviteRole; redeemed_at: number | null; expires_at: number }>();

  if (!invite)              return error('Invalid invite code', 404);
  if (invite.redeemed_at)   return error('Invite code already used', 409);
  if (now > invite.expires_at) return error('Invite code has expired', 410);

  return json({ role: invite.role });
}

// ── POST /auth/invite/redeem ─────────────────────────────────────────────────
// Public route. Validates code, links the joiner to the family.
//
// For role='child': body must include display_name (no email required)
// For role='co-parent': body must include display_name + email + password
//
// Returns: JWT for the newly-joined user
export async function handleRedeemInvite(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const code = (body['code'] as string | undefined)?.trim().toUpperCase();
  if (!code || code.length !== 6) return error('code must be 6 characters');

  const now = Math.floor(Date.now() / 1000);

  const invite = await env.DB
    .prepare(`
      SELECT code, family_id, role, redeemed_at, expires_at, child_id
      FROM invite_codes WHERE code = ?
    `)
    .bind(code)
    .first<{ code: string; family_id: string; role: InviteRole; redeemed_at: number | null; expires_at: number; child_id: string | null }>();

  if (!invite)              return error('Invalid invite code', 404);
  if (invite.redeemed_at)   return error('Invite code already used', 409);
  if (now > invite.expires_at) return error('Invite code has expired', 410);

  const ip = clientIp(request);

  if (invite.role === 'child') {
    return redeemChildInvite(invite.code, invite.family_id, invite.child_id, body, now, ip, env);
  } else {
    return redeemCoParentInvite(invite.code, invite.family_id, body, now, ip, env);
  }
}

async function redeemChildInvite(
  code: string,
  familyId: string,
  preCreatedChildId: string | null,
  body: Record<string, unknown>,
  now: number,
  ip: string,
  env: Env,
): Promise<Response> {
  const display_name = (body['display_name'] as string | undefined)?.trim();
  if (!display_name) return error('display_name required');

  const jti = nanoid();

  let userId: string;

  if (preCreatedChildId) {
    // The parent pre-created this child via /auth/child/add.
    // Update the existing user record with the name the child chose
    // (the parent may have used a placeholder — the child's choice wins).
    userId = preCreatedChildId;
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET display_name = ? WHERE id = ?`)
        .bind(display_name, userId),

      env.DB.prepare(`UPDATE invite_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ?`)
        .bind(userId, now, code),

      env.DB.prepare(`
        INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
        VALUES (?, ?, ?, 'child', ?, ?)
      `).bind(jti, userId, familyId, now + CHILD_JWT_EXPIRY, ip),
    ]);
  } else {
    // Legacy path: invite was generated without a pre-created child
    // (e.g. from /auth/invite/generate). Create the user fresh.
    userId = nanoid();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, family_id, display_name, email, locale, email_verified)
        VALUES (?, ?, ?, ?, 'en', 0)
      `).bind(userId, familyId, display_name, `child-${userId}@internal`),

      env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role) VALUES (?, ?, 'child')`)
        .bind(userId, familyId),

      env.DB.prepare(`UPDATE invite_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ?`)
        .bind(userId, now, code),

      env.DB.prepare(`
        INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
        VALUES (?, ?, ?, 'child', ?, ?)
      `).bind(jti, userId, familyId, now + CHILD_JWT_EXPIRY, ip),
    ]);
  }

  const token = await signJwt(
    { sub: userId, jti, family_id: familyId, role: 'child', iat: now, exp: now + CHILD_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return json({ token, expires_in: CHILD_JWT_EXPIRY, role: 'child', user_id: userId, family_id: familyId }, 201);
}

async function redeemCoParentInvite(
  code: string,
  familyId: string,
  body: Record<string, unknown>,
  now: number,
  ip: string,
  env: Env,
): Promise<Response> {
  const display_name = (body['display_name'] as string | undefined)?.trim();
  const email        = (body['email'] as string | undefined)?.toLowerCase().trim();
  const password     = body['password'] as string | undefined;

  if (!display_name) return error('display_name required');
  if (!email)        return error('email required for co-parent join');
  if (!password || password.length < 8) return error('password must be at least 8 characters');

  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return error('Email already registered', 409);

  const userId       = nanoid();
  const jti          = nanoid();
  const passwordHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, password_hash, email_verified)
      VALUES (?, ?, ?, ?, 'en', ?, 0)
    `).bind(userId, familyId, display_name, email, passwordHash),

    env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?, ?, 'parent', 'co_parent')`)
      .bind(userId, familyId),

    env.DB.prepare(`UPDATE invite_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ?`)
      .bind(userId, now, code),

    env.DB.prepare(`
      INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
      VALUES (?, ?, ?, 'parent', ?, ?)
    `).bind(jti, userId, familyId, now + PARENT_JWT_EXPIRY, ip),
  ]);

  const token = await signJwt(
    { sub: userId, jti, family_id: familyId, role: 'parent', iat: now, exp: now + PARENT_JWT_EXPIRY },
    env.JWT_SECRET,
  );

  return json({ token, expires_in: PARENT_JWT_EXPIRY, role: 'co-parent', user_id: userId, family_id: familyId }, 201);
}

// ── POST /auth/child/add ─────────────────────────────────────────────────────
// Parent creates a child record + generates a child invite code in one step.
// Body: { display_name, age?, opening_balance_pence? }
// Returns: { child_id, invite_code, expires_at }
export async function handleAddChild(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller || caller.role !== 'parent') return error('Unauthorised', 401);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const display_name = (body['display_name'] as string | undefined)?.trim();
  if (!display_name) return error('display_name required');

  const VALID_MODES = ['ALLOWANCE', 'CHORES', 'HYBRID'];
  const earnings_mode = (body['earnings_mode'] as string | undefined) ?? 'HYBRID';
  if (!VALID_MODES.includes(earnings_mode)) return error('Invalid earnings_mode');

  const opening_balance_pence = typeof body['opening_balance_pence'] === 'number'
    ? Math.max(0, Math.floor(body['opening_balance_pence'] as number))
    : 0;

  const childId   = nanoid();
  const code      = generateCode();
  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = now + INVITE_TTL;

  const stmts = [
    env.DB.prepare(`
      INSERT INTO users (id, family_id, display_name, email, locale, email_verified, earnings_mode)
      VALUES (?, ?, ?, ?, 'en', 0, ?)
    `).bind(childId, caller.family_id, display_name, `child-${childId}@internal`, earnings_mode),

    env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role) VALUES (?, ?, 'child')`)
      .bind(childId, caller.family_id),

    env.DB.prepare(`
      INSERT INTO invite_codes (code, family_id, created_by, role, expires_at, child_id)
      VALUES (?, ?, ?, 'child', ?, ?)
    `).bind(code, caller.family_id, caller.sub, expiresAt, childId),
  ];

  await env.DB.batch(stmts);

  // If a non-zero opening balance is provided, record it as an immutable ledger entry.
  // Done after the batch so the child row exists before the FK reference.
  if (opening_balance_pence > 0) {
    const { computeRecordHash, GENESIS_HASH } = await import('../lib/hash.js');

    const family = await env.DB
      .prepare('SELECT base_currency, verify_mode FROM families WHERE id = ?')
      .bind(caller.family_id)
      .first<{ base_currency: string; verify_mode: string }>();

    const currency           = family?.base_currency ?? 'GBP';
    const verificationStatus = family?.verify_mode === 'standard' ? 'verified_manual' : 'verified_auto';
    const ip                 = clientIp(request);

    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(caller.family_id)
      .first<{ id: number; record_hash: string }>();

    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;

    const maxRow = await env.DB
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger WHERE family_id = ?')
      .bind(caller.family_id)
      .first<{ max_id: number }>();

    const newId = (maxRow?.max_id ?? 0) + 1;

    const recordHash = await computeRecordHash(
      newId, caller.family_id, childId,
      opening_balance_pence, currency, 'credit', previousHash,
    );

    await env.DB.prepare(`
      INSERT INTO ledger
        (id, family_id, child_id, entry_type, amount, currency,
         description, verification_status, previous_hash, record_hash, ip_address)
      VALUES (?, ?, ?, 'credit', ?, ?, 'Opening balance', ?, ?, ?, ?)
    `).bind(
      newId, caller.family_id, childId,
      opening_balance_pence, currency,
      verificationStatus, previousHash, recordHash, ip,
    ).run();
  }

  return json({ child_id: childId, invite_code: code, expires_at: expiresAt }, 201);
}

// ── POST /auth/registration/save-step ───────────────────────────────────────
// Upserts the in-progress registration state. Called after each stage.
// Body: { step: 1–4, data: { ... } }
export async function handleSaveRegistrationStep(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller || caller.role !== 'parent') return error('Unauthorised', 401);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const step = body['step'] as number | undefined;
  const data = (body['step_data'] ?? body['data']) as Record<string, unknown> | undefined;

  if (!step || step < 1 || step > 4) return error('step must be 1–4');
  if (!data || typeof data !== 'object') return error('data must be an object');

  const now = Math.floor(Date.now() / 1000);

  await env.DB
    .prepare(`
      INSERT INTO registration_progress (family_id, last_step, step_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET
        last_step  = excluded.last_step,
        step_data  = excluded.step_data,
        updated_at = excluded.updated_at
    `)
    .bind(caller.family_id, step, JSON.stringify(data), now)
    .run();

  return json({ ok: true });
}

// ── POST /auth/create-family (extended) ──────────────────────────────────────
// The Stage-1/2 call. Extends the existing handleCreateFamily to also accept
// parenting_mode, governance_mode, base_currency.
// This is wired separately in index.ts via the existing /auth/create-family route
// — the new fields are now persisted because the migration added the columns.

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}
