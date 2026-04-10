/**
 * Auth middleware for Cloudflare Workers.
 *
 * Usage in route handlers:
 *   const auth = await requireAuth(request, env);
 *   if (auth instanceof Response) return auth;  // 401 short-circuit
 *   // auth.sub, auth.family_id, auth.role are now available
 *
 *   const parentCheck = requireRole(auth, 'parent');
 *   if (parentCheck) return parentCheck;  // 403 short-circuit
 */

import { Env } from '../types.js';
import { verifyJwt, JwtPayload } from './jwt.js';
import { error } from './response.js';

export async function requireAuth(request: Request, env: Env): Promise<JwtPayload | Response> {
  const token = extractToken(request);
  if (!token) return error('Authorisation required', 401);

  let payload: JwtPayload;
  try {
    payload = await verifyJwt(token, env.JWT_SECRET);
  } catch {
    return error('Invalid or expired token', 401);
  }

  // Check session has not been revoked
  const session = await env.DB
    .prepare('SELECT revoked_at FROM sessions WHERE jti = ?')
    .bind(payload.jti)
    .first<{ revoked_at: number | null }>();

  if (!session)             return error('Session not found', 401);
  if (session.revoked_at)   return error('Session revoked — please log in again', 401);

  // Check the family has not been soft-deleted
  const family = await env.DB
    .prepare('SELECT deleted_at FROM families WHERE id = ?')
    .bind(payload.family_id)
    .first<{ deleted_at: number | null }>();

  if (!family || family.deleted_at !== null) {
    return error('This family has been deleted.', 403);
  }

  return payload;
}

export function requireRole(auth: JwtPayload, role: 'parent' | 'child'): Response | null {
  if (auth.role !== role) {
    return error(`This action requires the '${role}' role`, 403);
  }
  return null;
}

/** Require auth AND that the family_id in the request matches the token. */
export function requireFamilyMatch(auth: JwtPayload, family_id: string): Response | null {
  if (auth.family_id !== family_id) {
    return error('Access denied — family mismatch', 403);
  }
  return null;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function extractToken(request: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Cookie: token=<token>  (for browser PWA clients)
  const cookie = request.headers.get('Cookie');
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) return match[1];
  }

  return null;
}
