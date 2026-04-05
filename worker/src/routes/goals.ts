/**
 * Goals routes
 *
 * GET    /api/goals?family_id=&child_id=   List goals for a child
 * POST   /api/goals                         Create a goal
 * PATCH  /api/goals/:id                     Edit a goal
 * DELETE /api/goals/:id                     Archive a goal
 * POST   /api/goals/:id/reorder             Move goal up/down
 * POST   /api/goals/:id/purchase            Mark goal reached + deduct balance
 * POST   /api/goals/:id/contribute          Parent gifts a fixed amount to a goal
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { nanoid } from '../lib/nanoid.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

const MAX_GOALS = 5;

export async function handleGoalList(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const child_id  = auth.role === 'child' ? auth.sub : url.searchParams.get('child_id');

  if (!family_id) return error('family_id required');
  if (family_id !== auth.family_id) return error('Forbidden', 403);
  if (!child_id) return error('child_id required');

  const { results } = await env.DB.prepare(
    `SELECT * FROM goals WHERE family_id = ? AND child_id = ? AND archived = 0
     ORDER BY sort_order ASC, created_at ASC`
  ).bind(family_id, child_id).all();

  return json({ goals: results });
}

export async function handleGoalCreate(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const {
    family_id, child_id, title, target_amount, currency, category, deadline,
    alloc_pct, match_rate, product_url, parent_match_pct, parent_fixed_contribution,
  } = body;
  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (!child_id  || typeof child_id !== 'string') return error('child_id required');
  if (!title     || typeof title    !== 'string') return error('title required');
  if (!Number.isInteger(target_amount) || (target_amount as number) <= 0)
    return error('target_amount must be a positive integer');
  if (!currency || !['GBP','PLN'].includes(currency as string)) return error('Invalid currency');

  // Enforce 5-goal limit
  const count = await env.DB
    .prepare('SELECT COUNT(*) as n FROM goals WHERE child_id = ? AND archived = 0')
    .bind(child_id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_GOALS) return error('Maximum of 5 goals per child', 409);

  const maxOrder = await env.DB
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM goals WHERE child_id = ?')
    .bind(child_id).first<{ m: number }>();

  const id  = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO goals
      (id, family_id, child_id, title, target_amount, currency, category,
       deadline, alloc_pct, match_rate, sort_order, created_at, updated_at,
       product_url, parent_match_pct, parent_fixed_contribution, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id, family_id, child_id as string,
    (title as string).trim(),
    target_amount, currency,
    category ?? 'other',
    deadline ?? null,
    alloc_pct ?? 0,
    match_rate ?? 0,
    (maxOrder?.m ?? -1) + 1,
    now, now,
    product_url ? String(product_url).trim() : null,
    Number.isInteger(parent_match_pct) ? parent_match_pct : 0,
    Number.isInteger(parent_fixed_contribution) ? parent_fixed_contribution : 0,
    'ACTIVE',
  ).run();

  const goal = await env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(id).first();
  return json(goal, 201);
}

export async function handleGoalUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const goal = await env.DB
    .prepare('SELECT family_id FROM goals WHERE id = ?')
    .bind(id).first<{ family_id: string }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);

  const allowed = [
    'title','target_amount','currency','category','deadline','alloc_pct','match_rate',
    'product_url','parent_match_pct','parent_fixed_contribution','status',
  ];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      values.push(body[key] ?? null);
    }
  }
  if (updates.length === 0) return error('No valid fields to update');
  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(id);

  await env.DB.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return json(await env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(id).first());
}

export async function handleGoalDelete(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const goal = await env.DB
    .prepare('SELECT family_id FROM goals WHERE id = ?')
    .bind(id).first<{ family_id: string }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);

  await env.DB
    .prepare('UPDATE goals SET archived = 1, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), id).run();
  return json({ ok: true });
}

export async function handleGoalReorder(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await parseBody(request);
  const dir  = body?.dir;
  if (dir !== 'up' && dir !== 'down') return error('dir must be "up" or "down"');

  const goal = await env.DB
    .prepare('SELECT family_id, child_id, sort_order FROM goals WHERE id = ? AND archived = 0')
    .bind(id).first<{ family_id: string; child_id: string; sort_order: number }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);

  const neighbor = await env.DB.prepare(
    dir === 'up'
      ? `SELECT id, sort_order FROM goals WHERE child_id = ? AND archived = 0 AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`
      : `SELECT id, sort_order FROM goals WHERE child_id = ? AND archived = 0 AND sort_order > ? ORDER BY sort_order ASC  LIMIT 1`
  ).bind(goal.child_id, goal.sort_order).first<{ id: string; sort_order: number }>();

  if (!neighbor) return json({ ok: true }); // already at boundary

  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('UPDATE goals SET sort_order = ?, updated_at = ? WHERE id = ?')
      .bind(neighbor.sort_order, now, id),
    env.DB.prepare('UPDATE goals SET sort_order = ?, updated_at = ? WHERE id = ?')
      .bind(goal.sort_order, now, neighbor.id),
  ]);
  return json({ ok: true });
}

// POST /api/goals/:id/purchase
// Child marks goal as Reached. Deducts target_amount from balance via a spending record.
export async function handleGoalPurchase(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const goal = await env.DB
    .prepare('SELECT * FROM goals WHERE id = ? AND archived = 0')
    .bind(id).first<{
      family_id: string; child_id: string; title: string;
      target_amount: number; currency: string; status: string;
    }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && goal.child_id !== auth.sub) return error('Forbidden', 403);
  if (goal.status === 'REACHED') return error('Goal already reached', 409);

  const now = Math.floor(Date.now() / 1000);
  const spendId = nanoid();

  // Insert spending record to deduct balance
  await env.DB.prepare(`
    INSERT INTO spending (id, family_id, child_id, title, amount, currency, note, goal_id, spent_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    spendId, goal.family_id, goal.child_id,
    `Purchased: ${goal.title}`,
    goal.target_amount, goal.currency,
    'Goal reached — item purchased', id, now,
  ).run();

  // Mark goal as REACHED
  await env.DB
    .prepare(`UPDATE goals SET status = 'REACHED', updated_at = ? WHERE id = ?`)
    .bind(now, id).run();

  return json({ ok: true, spend_id: spendId });
}

// POST /api/goals/:id/contribute
// Parent makes a one-time fixed contribution to a child goal.
// Body: { amount_pence: number }
// Increments current_saved_pence on the goal.
export async function handleGoalContribute(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can contribute to goals', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const { amount_pence } = body;
  if (!Number.isInteger(amount_pence) || (amount_pence as number) <= 0)
    return error('amount_pence must be a positive integer');

  const goal = await env.DB
    .prepare('SELECT * FROM goals WHERE id = ? AND archived = 0')
    .bind(id).first<{ family_id: string; status: string }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);
  if (goal.status === 'REACHED') return error('Goal already reached', 409);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    UPDATE goals
    SET current_saved_pence = current_saved_pence + ?,
        parent_fixed_contribution = parent_fixed_contribution + ?,
        updated_at = ?
    WHERE id = ?
  `).bind(amount_pence, amount_pence, now, id).run();

  const updated = await env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(id).first();
  return json(updated);
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}
