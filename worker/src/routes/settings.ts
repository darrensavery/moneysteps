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

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// GET /api/settings[?user_id=<child_id>]
// Without user_id: returns caller's own settings.
// With user_id:    parent fetches a child's settings (same family, role=parent required).
// ----------------------------------------------------------------
export async function handleSettingsGet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);
  const targetId = resolveTargetUserId(url, auth);
  if (!targetId) return error('user_id required or must be a parent', 403);

  const settings = await env.DB
    .prepare('SELECT user_id, avatar_id, theme, locale, app_view FROM user_settings WHERE user_id = ?')
    .bind(targetId).first();

  if (!settings) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, updated_at)
                VALUES (?,?,?,?,'ORCHARD',?) ON CONFLICT(user_id) DO NOTHING`)
      .bind(targetId, 'bottts:spark', 'system', 'en', now).run();
    return json({ user_id: targetId, avatar_id: 'bottts:spark', theme: 'system', locale: 'en', app_view: 'ORCHARD' });
  }
  return json(settings);
}

// ----------------------------------------------------------------
// PATCH /api/settings[?user_id=<child_id>]
// Body: { avatar_id?, theme?, locale?, teen_mode? }
// teen_mode can only be set by a parent (for a child in same family).
// ----------------------------------------------------------------
export async function handleSettingsUpdate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url  = new URL(request.url);
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const targetId = resolveTargetUserId(url, auth);
  if (!targetId) return error('user_id required or must be a parent', 403);

  // app_view can only be changed by a parent
  if ('app_view' in body && auth.role !== 'parent') {
    return error('Only parents can change the view mode', 403);
  }

  const VALID_THEMES  = ['light','dark','system'];
  const VALID_LOCALES = ['en','pl'];
  const VALID_AVATARS = [
    'adventurer:felix','adventurer:luna','adventurer:jasper','adventurer:nova','adventurer:orion','adventurer:sage',
    'bottts:spark','bottts:volt','bottts:byte','bottts:nano','bottts:pixel','bottts:core',
    'croodles:wisp','croodles:fern','croodles:mossy','croodles:dune','croodles:ember','croodles:cove',
    'fun-emoji:bliss','fun-emoji:zest','fun-emoji:glee','fun-emoji:whim','fun-emoji:fizz','fun-emoji:hype',
    'shapes:prism','shapes:arc','shapes:delta','shapes:grid','shapes:wave','shapes:facet',
    'thumbs:scout','thumbs:ivy','thumbs:echo','thumbs:vale','thumbs:rook','thumbs:flint',
    'lorelei-neutral:mara','lorelei-neutral:reed','lorelei-neutral:quinn','lorelei-neutral:sable','lorelei-neutral:lark','lorelei-neutral:wren',
    'personas:juno','personas:atlas','personas:sol','personas:cleo','personas:rex','personas:vera',
    'pixel-art-neutral:ash','pixel-art-neutral:birch','pixel-art-neutral:cedar','pixel-art-neutral:elm','pixel-art-neutral:hazel','pixel-art-neutral:oak',
    'icons:bolt','icons:gem','icons:star','icons:leaf','icons:drop','icons:moon',
    'big-ears-neutral:beau','big-ears-neutral:cade','big-ears-neutral:drew','big-ears-neutral:finn','big-ears-neutral:gray','big-ears-neutral:hope',
  ];

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('avatar_id' in body) {
    if (!VALID_AVATARS.includes(body.avatar_id as string)) return error('Invalid avatar_id');
    updates.push('avatar_id = ?'); values.push(body.avatar_id);
  }
  if ('theme' in body) {
    if (!VALID_THEMES.includes(body.theme as string)) return error('Invalid theme');
    updates.push('theme = ?'); values.push(body.theme);
  }
  if ('locale' in body) {
    if (!VALID_LOCALES.includes(body.locale as string)) return error('Invalid locale');
    updates.push('locale = ?'); values.push(body.locale);
    await env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?')
      .bind(body.locale, targetId).run();
  }
  if ('app_view' in body) {
    const val = (body.app_view as string) === 'CLEAN' ? 'CLEAN' : 'ORCHARD';
    updates.push('app_view = ?'); values.push(val);
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
        .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, updated_at)
                  VALUES (?,?,?,?,'ORCHARD',?) ON CONFLICT(user_id) DO NOTHING`)
        .bind(targetId, 'bottts:spark', 'system', 'en', now).run();
      await env.DB
        .prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`)
        .bind(...values).run();
    });

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /api/family
// ----------------------------------------------------------------
export async function handleFamilyGet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const family = await env.DB
    .prepare('SELECT * FROM families WHERE id = ?')
    .bind(auth.family_id).first();
  if (!family) return error('Family not found', 404);
  return json(family);
}

// ----------------------------------------------------------------
// PATCH /api/family
// Body: { name?, base_currency?, parenting_mode?, verify_mode? }
// ----------------------------------------------------------------
export async function handleFamilyUpdate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can update family settings', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('base_currency' in body) {
    if (!['GBP','PLN'].includes(body.base_currency as string)) return error('Invalid base_currency');
    updates.push('base_currency = ?'); values.push(body.base_currency);
  }
  if ('parenting_mode' in body) {
    if (!['single','co-parenting'].includes(body.parenting_mode as string)) return error('Invalid parenting_mode');
    updates.push('parenting_mode = ?'); values.push(body.parenting_mode);
  }
  if ('verify_mode' in body) {
    if (!['amicable','standard'].includes(body.verify_mode as string)) return error('Invalid verify_mode');
    updates.push('verify_mode = ?'); values.push(body.verify_mode);
  }
  if ('fast_track_enabled' in body) {
    const val = body.fast_track_enabled;
    if (val !== 0 && val !== 1 && val !== true && val !== false)
      return error('fast_track_enabled must be a boolean');
    updates.push('fast_track_enabled = ?');
    values.push(val ? 1 : 0);
  }

  if (updates.length === 0) return error('No valid fields to update');
  values.push(auth.family_id);

  await env.DB
    .prepare(`UPDATE families SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /api/children
// ----------------------------------------------------------------
export async function handleChildrenList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

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

  return json({ children: results });
}

// ----------------------------------------------------------------
// POST /api/account-lock
// Body: { child_id, duration_seconds }
// ----------------------------------------------------------------
export async function handleAccountLock(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can lock accounts', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const { child_id, duration_seconds } = body;
  if (!child_id || typeof child_id !== 'string') return error('child_id required');
  if (!Number.isInteger(duration_seconds) || (duration_seconds as number) <= 0)
    return error('duration_seconds must be a positive integer');

  // Max 1 week
  const maxDuration = 7 * 24 * 3600;
  const duration = Math.min(duration_seconds as number, maxDuration);

  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO account_locks (user_id, locked_by, locked_until, created_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET locked_by = ?, locked_until = ?, created_at = ?
  `).bind(child_id, auth.sub, now + duration, now, auth.sub, now + duration, now).run();

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
  return json({ ok: true });
}

// ----------------------------------------------------------------
// POST /api/parent-message
// Body: { child_id, message }
// ----------------------------------------------------------------
export async function handleParentMessageSet(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can send messages', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const { child_id, message } = body;
  if (!child_id || typeof child_id !== 'string') return error('child_id required');
  if (!message  || typeof message  !== 'string') return error('message required');
  if ((message as string).trim().length > 280) return error('Message too long (max 280 chars)');

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 7 * 24 * 3600; // 7 days

  await env.DB.prepare(`
    INSERT INTO parent_messages (family_id, from_user, to_child, message, expires_at, created_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(from_user, to_child) DO UPDATE
    SET message = ?, expires_at = ?, created_at = ?
  `).bind(
    auth.family_id, auth.sub, child_id,
    (message as string).trim(), expiresAt, now,
    (message as string).trim(), expiresAt, now,
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

export async function handleChildGrowthUpdate(
  request: Request, env: Env, childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can update child growth settings', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  // Verify child belongs to this family
  const child = await env.DB.prepare(`
    SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
    WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'
  `).bind(childId, auth.family_id).first();
  if (!child) return error('Child not found', 404);

  const VALID_MODES  = ['ALLOWANCE', 'CHORES', 'HYBRID'];
  const VALID_FREQS  = ['WEEKLY', 'BI_WEEKLY', 'MONTHLY'];

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('earnings_mode' in body) {
    if (!VALID_MODES.includes(body.earnings_mode as string)) return error('Invalid earnings_mode');
    updates.push('earnings_mode = ?'); values.push(body.earnings_mode);
  }
  if ('allowance_amount' in body) {
    if (!Number.isInteger(body.allowance_amount) || (body.allowance_amount as number) < 0)
      return error('allowance_amount must be a non-negative integer');
    updates.push('allowance_amount = ?'); values.push(body.allowance_amount);
  }
  if ('allowance_frequency' in body) {
    if (!VALID_FREQS.includes(body.allowance_frequency as string)) return error('Invalid allowance_frequency');
    updates.push('allowance_frequency = ?'); values.push(body.allowance_frequency);
  }

  if (updates.length === 0) return error('No valid fields to update');
  values.push(childId);

  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  return json({ ok: true });
}

// Returns the user_id to act on.
// - No query param → caller's own ID.
// - user_id param present → only allowed if caller is a parent.
function resolveTargetUserId(url: URL, auth: JwtPayload): string | null {
  const requested = url.searchParams.get('user_id');
  if (!requested) return auth.sub;
  if (auth.role !== 'parent') return null;  // children cannot target other users
  return requested;
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
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
