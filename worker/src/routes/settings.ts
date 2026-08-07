/**
 * Settings routes
 *
 * GET    /api/settings               Get user settings (avatar, theme, locale)
 * PATCH  /api/settings               Update settings
 * GET    /api/family                 Get family config (children list, currency, mode)
 * PATCH  /api/family                 Update family config
 * GET    /api/children               List children in the family
 * POST   /api/account-lock           Parent locks a child's account
 * DELETE /api/account-lock/:child_id Parent unlocks
 * POST   /api/parent-message         Parent sends a message to child
 * GET    /api/parent-message?child_id=  Get active message for a child
 */

import { Env } from '../types.js';

import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';
import { z } from 'zod';
import { parseValidatedBody } from '../lib/validate.js';

type AuthedRequest = Request & { auth: JwtPayload };

const VALID_THEMES  = ['light', 'dark', 'system'] as const;
const VALID_LOCALES = ['en', 'en-GB', 'en-US', 'pl'] as const;
const VALID_AVATARS = [
  'adventurer:felix', 'adventurer:luna', 'adventurer:jasper', 'adventurer:nova', 'adventurer:orion', 'adventurer:sage',
  'bottts:spark', 'bottts:volt', 'bottts:byte', 'bottts:nano', 'bottts:pixel', 'bottts:core',
  'croodles:wisp', 'croodles:fern', 'croodles:mossy', 'croodles:dune', 'croodles:ember', 'croodles:cove',
  'fun-emoji:bliss', 'fun-emoji:zest', 'fun-emoji:glee', 'fun-emoji:whim', 'fun-emoji:fizz', 'fun-emoji:hype',
  'shapes:prism', 'shapes:arc', 'shapes:delta', 'shapes:grid', 'shapes:wave', 'shapes:facet',
  'thumbs:scout', 'thumbs:ivy', 'thumbs:echo', 'thumbs:vale', 'thumbs:rook', 'thumbs:flint',
  'lorelei-neutral:mara', 'lorelei-neutral:reed', 'lorelei-neutral:quinn', 'lorelei-neutral:sable', 'lorelei-neutral:lark', 'lorelei-neutral:wren',
  'personas:juno', 'personas:atlas', 'personas:sol', 'personas:cleo', 'personas:rex', 'personas:vera',
  'pixel-art-neutral:ash', 'pixel-art-neutral:birch', 'pixel-art-neutral:cedar', 'pixel-art-neutral:elm', 'pixel-art-neutral:hazel', 'pixel-art-neutral:oak',
  'icons:bolt', 'icons:gem', 'icons:star', 'icons:leaf', 'icons:drop', 'icons:moon',
  'big-ears-neutral:beau', 'big-ears-neutral:cade', 'big-ears-neutral:drew', 'big-ears-neutral:finn', 'big-ears-neutral:gray', 'big-ears-neutral:hope',
] as const;

// ----------------------------------------------------------------
// PATCH /api/settings body schema
// app_view is intentionally left loose (z.any()) — invalid values are
// silently coerced to 'ORCHARD' by the handler, not rejected.
// ----------------------------------------------------------------
const settingsUpdateSchema = z.object({
  avatar_id:      z.enum(VALID_AVATARS, { message: 'Invalid avatar_id' }).optional(),
  theme:          z.enum(VALID_THEMES,  { message: 'Invalid theme' }).optional(),
  locale:         z.enum(VALID_LOCALES, { message: 'Invalid locale' }).optional(),
  app_view:       z.any().optional(),
  high_contrast:  z.any().optional().refine(
    v => v === undefined || v === 0 || v === 1 || v === true || v === false,
    'high_contrast must be a boolean',
  ),
});

// ----------------------------------------------------------------
// GET /api/settings[?user_id=<child_id>]
// Without user_id: returns caller's own settings.
// With user_id:    parent fetches a child's settings (same family, role=parent required).
// ----------------------------------------------------------------
export async function handleSettingsGet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);
  const targetId = await resolveTargetUserId(url, auth, env.DB);
  if (!targetId) return error('user_id required or must be a parent', 403);

  const cacheKey = `user:settings:${targetId}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json' } });

  const settings = await env.DB
    .prepare(`
      SELECT us.user_id, us.avatar_id, us.theme, us.locale, us.app_view, us.high_contrast,
             u.earnings_mode, u.allowance_amount, u.allowance_frequency
      FROM user_settings us
      JOIN users u ON u.id = us.user_id
      WHERE us.user_id = ?
    `)
    .bind(targetId).first();

  if (!settings) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, high_contrast, updated_at)
                VALUES (?,?,?,?,'ORCHARD',0,?) ON CONFLICT(user_id) DO NOTHING`)
      .bind(targetId, 'bottts:spark', 'system', 'en', now).run();
    const userRow = await env.DB
      .prepare('SELECT earnings_mode, allowance_amount, allowance_frequency FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ earnings_mode: string; allowance_amount: number; allowance_frequency: string }>();
    return json({
      user_id: targetId, avatar_id: 'bottts:spark', theme: 'system', locale: 'en', app_view: 'ORCHARD',
      high_contrast: 0,
      earnings_mode: userRow?.earnings_mode ?? 'CHORES',
      allowance_amount: userRow?.allowance_amount ?? 0,
      allowance_frequency: userRow?.allowance_frequency ?? 'WEEKLY',
    });
  }

  const body = JSON.stringify(settings);
  await env.CACHE.put(cacheKey, body, { expirationTtl: 60 });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------------------
// PATCH /api/settings[?user_id=<child_id>]
// Body: { avatar_id?, theme?, locale?, teen_mode? }
// teen_mode can only be set by a parent (for a child in same family).
// ----------------------------------------------------------------
export async function handleSettingsUpdate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);
  const parsed = await parseValidatedBody(request, settingsUpdateSchema);
  if (parsed instanceof Response) return parsed;

  const targetId = await resolveTargetUserId(url, auth, env.DB);
  if (!targetId) return error('user_id required or must be a parent', 403);

  // app_view can only be changed by a parent
  if ('app_view' in parsed && auth.role !== 'parent') {
    return error('Only parents can change the view mode', 403);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('avatar_id' in parsed) {
    updates.push('avatar_id = ?'); values.push(parsed.avatar_id);
  }
  if ('theme' in parsed) {
    updates.push('theme = ?'); values.push(parsed.theme);
  }
  if ('locale' in parsed) {
    updates.push('locale = ?'); values.push(parsed.locale);
    await env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?')
      .bind(parsed.locale, targetId).run();
  }
  if ('app_view' in parsed) {
    const val = (parsed.app_view as string) === 'CLEAN' ? 'CLEAN' : 'ORCHARD';
    updates.push('app_view = ?'); values.push(val);
  }
  if ('high_contrast' in parsed) {
    updates.push('high_contrast = ?'); values.push(parsed.high_contrast ? 1 : 0);
  }

  if (updates.length === 0) return error('No valid fields to update');

  const now = Math.floor(Date.now() / 1000);
  updates.push('updated_at = ?'); values.push(now);
  values.push(targetId);

  await env.DB
    .prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`)
    .bind(...values).run()
    .catch(async () => {
      // Row may not exist yet — insert with defaults then retry
      await env.DB
        .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, high_contrast, updated_at)
                  VALUES (?,?,?,?,'ORCHARD',0,?) ON CONFLICT(user_id) DO NOTHING`)
        .bind(targetId, 'bottts:spark', 'system', 'en', now).run();
      await env.DB
        .prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`)
        .bind(...values).run();
    });

  await Promise.all([
    env.CACHE.delete(`user:settings:${targetId}`),
    env.CACHE.delete(`family:children:${auth.family_id}`),
  ]);

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /api/family
// ----------------------------------------------------------------
export async function handleFamilyGet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const cacheKey = `family:config:${auth.family_id}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json' } });

  const family = await env.DB
    .prepare('SELECT * FROM families WHERE id = ?')
    .bind(auth.family_id).first();
  if (!family) return error('Family not found', 404);

  const body = JSON.stringify(family);
  await env.CACHE.put(cacheKey, body, { expirationTtl: 3600 });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------------------
// PATCH /api/family
// Body: { name?, base_currency?, parenting_mode?, verify_mode? }
// verify_mode is intentionally left loose (z.any()) — its enum check is
// performed inline below, after a DB read that must run first (mutual
// consent gating for co-parenting families).
// ----------------------------------------------------------------
const familyUpdateSchema = z.object({
  base_currency:  z.enum(['GBP', 'PLN', 'USD'], { message: 'Invalid base_currency' }).optional(),
  parenting_mode: z.enum(['single', 'co-parenting'], { message: 'Invalid parenting_mode' }).optional(),
  verify_mode:    z.any().optional(),
  fast_track_enabled: z.any().optional().refine(
    v => v === undefined || v === 0 || v === 1 || v === true || v === false,
    'fast_track_enabled must be a boolean',
  ),
  pocket_money_day: z.any().optional().refine(
    v => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 6),
    'pocket_money_day must be an integer 0–6',
  ),
  overdraft_enabled: z.any().optional().refine(
    v => v === undefined || v === 0 || v === 1 || v === true || v === false,
    'overdraft_enabled must be a boolean',
  ),
  overdraft_limit_pence: z.any().optional().refine(
    v => v === undefined || (Number.isInteger(v) && v >= 0),
    'overdraft_limit_pence must be a non-negative integer',
  ),
});

export async function handleFamilyUpdate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can update family settings', 403);

  const parsed = await parseValidatedBody(request, familyUpdateSchema);
  if (parsed instanceof Response) return parsed;

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('base_currency' in parsed) {
    updates.push('base_currency = ?'); values.push(parsed.base_currency);
  }
  if ('parenting_mode' in parsed) {
    updates.push('parenting_mode = ?'); values.push(parsed.parenting_mode);
  }
  if ('verify_mode' in parsed) {
    // BUG-019 fix: verify_mode changes in co-parenting mode require mutual consent
    // via POST /api/governance/request — direct update is blocked to prevent one
    // parent unilaterally changing the approval model without the other's consent.
    const family = await env.DB
      .prepare('SELECT parenting_mode FROM families WHERE id = ?')
      .bind(auth.family_id)
      .first<{ parenting_mode: string }>();
    if (family?.parenting_mode === 'co-parenting') {
      return error(
        'verify_mode changes require mutual consent in co-parenting mode — use POST /api/governance/request',
        403,
      );
    }
    if (!['amicable','standard'].includes(parsed.verify_mode as string)) return error('Invalid verify_mode');
    updates.push('verify_mode = ?'); values.push(parsed.verify_mode);
  }
  if ('fast_track_enabled' in parsed) {
    const val = parsed.fast_track_enabled;
    updates.push('fast_track_enabled = ?');
    values.push(val ? 1 : 0);
  }
  if ('pocket_money_day' in parsed) {
    updates.push('pocket_money_day = ?');
    values.push(parsed.pocket_money_day as number);
  }
  if ('overdraft_enabled' in parsed) {
    const val = parsed.overdraft_enabled;
    updates.push('overdraft_enabled = ?');
    values.push(val ? 1 : 0);
  }
  if ('overdraft_limit_pence' in parsed) {
    updates.push('overdraft_limit_pence = ?');
    values.push(parsed.overdraft_limit_pence as number);
  }

  if (updates.length === 0) return error('No valid fields to update');
  values.push(auth.family_id);

  await env.DB
    .prepare(`UPDATE families SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  await env.CACHE.delete(`family:config:${auth.family_id}`);

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /api/children
// ----------------------------------------------------------------
export async function handleChildrenList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const cacheKey = `family:children:${auth.family_id}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json' } });

  const { results } = await env.DB.prepare(`
    SELECT u.id, u.display_name, u.created_at,
           us.avatar_id,
           al.locked_until
    FROM users u
    JOIN family_roles fr ON fr.user_id = u.id
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN account_locks al ON al.user_id = u.id AND al.locked_until > ?
    WHERE fr.family_id = ? AND fr.role = 'child'
    ORDER BY u.created_at ASC
  `).bind(Math.floor(Date.now() / 1000), auth.family_id).all();

  const body = JSON.stringify({ children: results });
  await env.CACHE.put(cacheKey, body, { expirationTtl: 900 }); // 15 min — shorter due to time-based lock expiry
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------------------
// POST /api/account-lock
// Body: { child_id, duration_seconds }
// ----------------------------------------------------------------
const accountLockSchema = z.object({
  child_id: z.string().min(1, 'child_id required'),
  duration_seconds: z.any().refine(
    v => Number.isInteger(v) && v > 0,
    'duration_seconds must be a positive integer',
  ),
});

export async function handleAccountLock(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can lock accounts', 403);

  const parsed = await parseValidatedBody(request, accountLockSchema);
  if (parsed instanceof Response) return parsed;
  const { child_id, duration_seconds } = parsed;

  // Verify child belongs to this family
  const childCheck = await env.DB
    .prepare(`SELECT user_id FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'child'`)
    .bind(child_id, auth.family_id)
    .first<{ user_id: string }>();
  if (!childCheck) return error('Child not found', 404);

  // Max 1 week
  const maxDuration = 7 * 24 * 3600;
  const duration = Math.min(duration_seconds as number, maxDuration);

  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO account_locks (user_id, locked_by, locked_until, created_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET locked_by = ?, locked_until = ?, created_at = ?
  `).bind(child_id, auth.sub, now + duration, now, auth.sub, now + duration, now).run();

  await env.CACHE.delete(`family:children:${auth.family_id}`);

  return json({ ok: true, locked_until: now + duration });
}

// ----------------------------------------------------------------
// DELETE /api/account-lock/:child_id
// ----------------------------------------------------------------
export async function handleAccountUnlock(
  request: Request, env: Env, childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can unlock accounts', 403);

  const lock = await env.DB
    .prepare(`SELECT al.user_id FROM account_locks al
              JOIN family_roles fr ON fr.user_id = al.user_id
              WHERE al.user_id = ? AND fr.family_id = ?`)
    .bind(childId, auth.family_id).first();
  if (!lock) return error('No lock found', 404);

  await env.DB.prepare('DELETE FROM account_locks WHERE user_id = ?').bind(childId).run();
  await env.CACHE.delete(`family:children:${auth.family_id}`);
  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /api/parent-message
// Body: { child_id, message }
// ----------------------------------------------------------------
const parentMessageSchema = z.object({
  child_id: z.string().min(1, 'child_id required'),
  message: z.string().min(1, 'message required')
    .refine(m => m.trim().length <= 280, 'Message too long (max 280 chars)'),
});

export async function handleParentMessageSet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can send messages', 403);

  const parsed = await parseValidatedBody(request, parentMessageSchema);
  if (parsed instanceof Response) return parsed;
  const { child_id, message } = parsed;

  // Verify child belongs to this family
  const childCheck = await env.DB
    .prepare(`SELECT user_id FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'child'`)
    .bind(child_id, auth.family_id)
    .first<{ user_id: string }>();
  if (!childCheck) return error('Child not found', 404);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 7 * 24 * 3600; // 7 days

  await env.DB.prepare(`
    INSERT INTO parent_messages (family_id, from_user, to_child, message, expires_at, created_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(from_user, to_child) DO UPDATE
    SET message = ?, expires_at = ?, created_at = ?
  `).bind(
    auth.family_id, auth.sub, child_id,
    message.trim(), expiresAt, now,
    message.trim(), expiresAt, now,
  ).run();

  return json({ ok: true, expires_at: expiresAt });
}

// ----------------------------------------------------------------
// GET /api/parent-message?child_id=
// ----------------------------------------------------------------
export async function handleParentMessageGet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const child_id = auth.role === 'child' ? auth.sub : url.searchParams.get('child_id');
  if (!child_id) return error('child_id required');

  const now = Math.floor(Date.now() / 1000);
  const msg = await env.DB.prepare(`
    SELECT pm.*, u.display_name AS from_name
    FROM parent_messages pm JOIN users u ON u.id = pm.from_user
    WHERE pm.family_id = ? AND pm.to_child = ? AND pm.expires_at > ?
    ORDER BY pm.created_at DESC LIMIT 2
  `).bind(auth.family_id, child_id, now).all();

  return json({ messages: msg.results });
}

// ----------------------------------------------------------------
// GET  /api/child-growth/:child_id   — parent reads a child's earnings config
// PATCH /api/child-growth/:child_id  — parent updates earnings config
// Body: { earnings_mode?, allowance_amount?, allowance_frequency? }
// ----------------------------------------------------------------
export async function handleChildGrowthGet(
  request: Request, env: Env, childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can read child growth settings', 403);

  const child = await env.DB.prepare(`
    SELECT u.id, u.display_name, u.earnings_mode, u.allowance_amount, u.allowance_frequency
    FROM users u JOIN family_roles fr ON fr.user_id = u.id
    WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'
  `).bind(childId, auth.family_id).first();
  if (!child) return error('Child not found', 404);

  return json(child);
}

const childGrowthUpdateSchema = z.object({
  earnings_mode: z.enum(['ALLOWANCE', 'CHORES', 'HYBRID'], { message: 'Invalid earnings_mode' }).optional(),
  allowance_amount: z.any().optional().refine(
    v => v === undefined || (Number.isInteger(v) && v >= 0),
    'allowance_amount must be a non-negative integer',
  ),
  allowance_frequency: z.enum(['WEEKLY', 'BI_WEEKLY', 'MONTHLY'], { message: 'Invalid allowance_frequency' }).optional(),
});

export async function handleChildGrowthUpdate(
  request: Request, env: Env, childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can update child growth settings', 403);

  const parsed = await parseValidatedBody(request, childGrowthUpdateSchema);
  if (parsed instanceof Response) return parsed;

  // Verify child belongs to this family
  const child = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
    WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'
  `).bind(childId, auth.family_id).first();
  if (!child) return error('Child not found', 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('earnings_mode' in parsed) {
    updates.push('earnings_mode = ?'); values.push(parsed.earnings_mode);
  }
  if ('allowance_amount' in parsed) {
    updates.push('allowance_amount = ?'); values.push(parsed.allowance_amount);
  }
  if ('allowance_frequency' in parsed) {
    updates.push('allowance_frequency = ?'); values.push(parsed.allowance_frequency);
  }

  if (updates.length === 0) return error('No valid fields to update');
  values.push(childId);

  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  // BUG-036 fix: invalidate the child's settings cache — handleSettingsGet JOINs
  // the users table, so stale earnings_mode/allowance_amount would persist for 60s
  // without this delete.
  await env.CACHE.delete(`user:settings:${childId}`);

  return json({ ok: true });
}

// Returns the user_id to act on, or null when the caller is not permitted.
// - No query param → caller's own ID (always allowed).
// - user_id param present → only parents may target another user, and the
//   target must be a member of the caller's family.
// NOTE: async because it needs a DB lookup for the family membership check.
async function resolveTargetUserId(
  url: URL,
  auth: JwtPayload,
  db: Env['DB'],
): Promise<string | null> {
  const requested = url.searchParams.get('user_id');
  if (!requested) return auth.sub;
  if (auth.role !== 'parent') return null;  // children cannot target other users
  // Verify the requested user belongs to the caller's family
  const member = await db
    .prepare('SELECT user_id FROM family_roles WHERE user_id = ? AND family_id = ?')
    .bind(requested, auth.family_id)
    .first<{ user_id: string }>();
  return member ? requested : null;
}

// ----------------------------------------------------------------
// PATCH /api/child/:child_id/display-name
// Parent renames a child. Caller must share the same family_id.
// Body: { display_name: string }
// ----------------------------------------------------------------
export async function handleChildRename(
  request: Request,
  env: Env,
  childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can rename children', 403);

  let body: { display_name?: unknown };
  try { body = await request.json() as { display_name?: unknown }; }
  catch { return error('Invalid JSON body'); }

  const raw = body.display_name;
  if (!raw || typeof raw !== 'string') return error('display_name required');
  const display_name = raw.trim();
  if (!display_name)            return error('display_name cannot be empty');
  if (display_name.length > 40) return error('display_name too long (max 40 chars)');

  // Verify child belongs to the same family as caller
  const child = await env.DB
    .prepare(`SELECT u.id FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(childId, auth.family_id)
    .first<{ id: string }>();
  if (!child) return error('Child not found', 404);

  await env.DB
    .prepare('UPDATE users SET display_name = ? WHERE id = ?')
    .bind(display_name, childId)
    .run();

  await env.CACHE.delete(`family:children:${auth.family_id}`);

  return json({ ok: true, display_name });
}

// ----------------------------------------------------------------
// UA parsing — pure string matching, no library dependency
// Returns { device_label, device_type }
// device_type: 'mobile' | 'tablet' | 'desktop'
// ----------------------------------------------------------------
function parseUserAgent(ua: string | null): { device_label: string; device_type: 'mobile' | 'tablet' | 'desktop' } {
  if (!ua) return { device_label: 'Unknown Device', device_type: 'desktop' };

  const s = ua.toLowerCase();

  // Detect device base
  let base: string;
  let type: 'mobile' | 'tablet' | 'desktop';

  if (s.includes('ipad')) {
    base = 'iPad'; type = 'tablet';
  } else if (s.includes('android') && (s.includes('tablet') || s.includes('tab'))) {
    base = 'Android Tablet'; type = 'tablet';
  } else if (s.includes('iphone')) {
    base = 'iPhone'; type = 'mobile';
  } else if (s.includes('android')) {
    base = 'Android Phone'; type = 'mobile';
  } else if (s.includes('cros')) {
    base = 'Chromebook'; type = 'desktop';
  } else if (s.includes('windows')) {
    base = 'Windows PC'; type = 'desktop';
  } else if (s.includes('macintosh') || s.includes('mac os x')) {
    base = 'Mac'; type = 'desktop';
  } else if (s.includes('linux')) {
    base = 'Linux PC'; type = 'desktop';
  } else {
    return { device_label: 'Unknown Device', device_type: 'desktop' };
  }

  // Detect browser — order matters (Edge contains "chrome", so check Edge first)
  let browser: string | null = null;
  if (s.includes('edg/') || s.includes('edge/'))  browser = 'Edge';
  else if (s.includes('firefox/'))                 browser = 'Firefox';
  else if (s.includes('chrome/'))                  browser = 'Chrome';
  else if (s.includes('safari/'))                  browser = 'Safari';

  const device_label = browser ? `${base} · ${browser}` : base;
  return { device_label, device_type: type };
}

// ----------------------------------------------------------------
// GET /api/child/:child_id/login-history
// Parent views a child's recent logins. Returns last 50, newest first.
// Response: { logins: LoginEntry[] }
// ----------------------------------------------------------------
export async function handleChildLoginHistory(
  request: Request,
  env: Env,
  childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can view login history', 403);

  // Verify child belongs to same family
  const child = await env.DB
    .prepare(`SELECT u.id FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(childId, auth.family_id)
    .first<{ id: string }>();
  if (!child) return error('Child not found', 404);

  // Fetch last 50 logins; LEFT JOIN sessions to determine is_current
  const { results } = await env.DB
    .prepare(`
      SELECT
        cl.rowid          AS id,
        cl.logged_at,
        cl.ip_address,
        cl.user_agent,
        CASE WHEN s.jti IS NOT NULL THEN 1 ELSE 0 END AS is_current
      FROM child_logins cl
      LEFT JOIN sessions s
        ON cl.session_jti IS NOT NULL
       AND s.jti = cl.session_jti
       AND s.user_id = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > strftime('%s','now')
      WHERE cl.child_id = ?
      ORDER BY cl.logged_at DESC
      LIMIT 50
    `)
    .bind(childId, childId)
    .all<{
      id: number;
      logged_at: number;
      ip_address: string | null;
      user_agent: string | null;
      is_current: number;
    }>();

  const logins = results.map(row => {
    const { device_label, device_type } = parseUserAgent(row.user_agent);
    return {
      id:           row.id,
      logged_at:    row.logged_at,
      ip_address:   row.ip_address ?? 'Unknown',
      device_label,
      device_type,
      is_current:   row.is_current === 1,
    };
  });

  return json({ logins });
}

// ----------------------------------------------------------------
// GET /api/account-lock/me
// Child-facing: returns the caller's own active lock (if any).
// Safe to call even when locked — it is a GET so middleware permits it.
// ----------------------------------------------------------------
export async function handleAccountLockStatusMe(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return json({ locked: false, locked_until: null });

  const now = Math.floor(Date.now() / 1000);
  const lock = await env.DB
    .prepare('SELECT locked_until FROM account_locks WHERE user_id = ? AND locked_until > ?')
    .bind(auth.sub, now)
    .first<{ locked_until: number }>();

  return json({ locked: lock !== null, locked_until: lock?.locked_until ?? null });
}
