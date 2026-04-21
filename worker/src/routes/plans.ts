/**
 * Plans routes — weekly job planner
 *
 * GET    /api/plans?family_id=&child_id=&week_start=
 * POST   /api/plans                   Assign a job to a day
 * DELETE /api/plans/:id               Remove a plan entry
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { nanoid } from '../lib/nanoid.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

export async function handlePlanList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id  = url.searchParams.get('family_id');
  const child_id   = auth.role === 'child' ? auth.sub : url.searchParams.get('child_id');
  const week_start = url.searchParams.get('week_start'); // ISO date of Monday

  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (!child_id) return error('child_id required');

  let stmt;
  if (week_start) {
    stmt = env.DB.prepare(
      `SELECT p.*, c.title AS chore_title, c.reward_amount, c.currency
       FROM plans p JOIN chores c ON c.id = p.chore_id
       WHERE p.family_id = ? AND p.child_id = ? AND p.week_start = ?
       ORDER BY p.day_of_week ASC`
    ).bind(family_id, child_id, week_start);
  } else {
    // Current week
    const monday = getMondayISO();
    stmt = env.DB.prepare(
      `SELECT p.*, c.title AS chore_title, c.reward_amount, c.currency
       FROM plans p JOIN chores c ON c.id = p.chore_id
       WHERE p.family_id = ? AND p.child_id = ? AND p.week_start = ?
       ORDER BY p.day_of_week ASC`
    ).bind(family_id, child_id, monday);
  }

  const { results } = await stmt.all();
  return json({ plans: results });
}

export async function handlePlanCreate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const { family_id, chore_id, child_id, day_of_week, week_start } = body;
  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (!chore_id  || typeof chore_id !== 'string') return error('chore_id required');
  if (!child_id  || typeof child_id !== 'string') return error('child_id required');
  if (!Number.isInteger(day_of_week) || (day_of_week as number) < 1 || (day_of_week as number) > 7)
    return error('day_of_week must be 1–7 (Mon=1, Sun=7)');

  // Child can only plan their own chores
  if (auth.role === 'child' && child_id !== auth.sub) return error('Forbidden', 403);

  const effectiveWeekStart = week_start ?? getMondayISO();

  // Prevent duplicate
  const existing = await env.DB
    .prepare('SELECT id FROM plans WHERE chore_id = ? AND child_id = ? AND day_of_week = ? AND week_start = ?')
    .bind(chore_id, child_id, day_of_week, effectiveWeekStart)
    .first();
  if (existing) return json({ ok: true, already_planned: true });

  const id  = nanoid();
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(
      `INSERT INTO plans (id, family_id, chore_id, child_id, day_of_week, week_start, added_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(id, family_id as string, chore_id as string, child_id as string,
      day_of_week, effectiveWeekStart, now).run();
  } catch (e: unknown) {
    // Unique constraint — another request beat us to it; treat as success
    const msg = e instanceof Error ? e.message : '';
    if (!msg.includes('UNIQUE') && !msg.includes('unique')) throw e;
    const dupe = await env.DB
      .prepare('SELECT id FROM plans WHERE chore_id = ? AND child_id = ? AND day_of_week = ? AND week_start = ?')
      .bind(chore_id, child_id, day_of_week, effectiveWeekStart)
      .first<{ id: string }>();
    return json({ id: dupe?.id ?? id, ok: true }, 200);
  }

  return json({ id, ok: true }, 201);
}

export async function handlePlanDelete(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const plan = await env.DB
    .prepare('SELECT family_id, child_id FROM plans WHERE id = ?')
    .bind(id).first<{ family_id: string; child_id: string }>();
  if (!plan) return error('Plan not found', 404);
  if (plan.family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && plan.child_id !== auth.sub) return error('Forbidden', 403);

  await env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}
