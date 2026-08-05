import { error, json, parseBody } from '../lib/response.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

function isPlausibleBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dob = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return ageYears >= 5 && ageYears <= 19;
}

export async function handleSetChildBirthDate(request: Request, env: Env, childId: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Forbidden', 403);

  const body = await parseBody(request);
  const birthDate = body?.birth_date;
  if (typeof birthDate !== 'string' || !isPlausibleBirthDate(birthDate)) {
    return error('birth_date must be a plausible ISO date (YYYY-MM-DD)', 400);
  }

  const child = await env.DB
    .prepare(`SELECT u.id FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(childId, auth.family_id)
    .first<{ id: string }>();
  if (!child) return error('Forbidden', 403);

  await env.DB.prepare('UPDATE users SET birth_date = ? WHERE id = ?')
    .bind(birthDate, childId).run();

  return json({ birth_date: birthDate });
}
