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
import {
  evaluateOnGoalCreate,
  evaluateOnGoalCancel,
  evaluateOnGoalPurchase,
} from '../lib/labTriggers.js';
import { getJarConfig, getJarBalances } from '../lib/jar-balance.js';
import { generateChildNudge, generateOnceChildNudge } from './child-nudges.js';
import { z } from 'zod';
import { parseValidatedBody } from '../lib/validate.js';
import { notifyChild } from '../lib/push/notify.js';

type AuthedRequest = Request & { auth: JwtPayload };

const MAX_GOALS = 5;

const goalCreateSchema = z.object({
  family_id: z.string().optional(),
  child_id:  z.string().min(1, 'child_id required'),
  title:     z.string().min(1, 'title required'),
  target_amount: z.number().refine(
    (v) => Number.isInteger(v) && v > 0,
    { message: 'target_amount must be a positive integer' },
  ),
  currency:  z.enum(['GBP', 'PLN'], { message: 'Invalid currency' }),
  category:  z.string().nullable().optional(),
  deadline:  z.string().nullable().optional(),
  alloc_pct: z.number().nullable().optional(),
  match_rate: z.number().nullable().optional(),
  product_url: z.string().nullable().optional(),
  parent_match_pct: z.number().nullable().optional(),
  parent_fixed_contribution: z.number().nullable().optional(),
});

// No per-field validation existed on the original update/reorder/contribute
// handlers beyond "is this valid JSON" — goalUpdateSchema mirrors that with
// a permissive record so the dynamic allow-listed-field loop keeps working
// unchanged off the now-typed `parsed` object.
const goalUpdateSchema = z.record(z.string(), z.unknown());

const goalReorderSchema = z.object({
  dir: z.enum(['up', 'down'], { message: 'dir must be "up" or "down"' }),
});

const goalContributeSchema = z.object({
  amount_pence: z.number().refine(
    (v) => Number.isInteger(v) && v > 0,
    { message: 'amount_pence must be a positive integer' },
  ),
});

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
  const parsed = await parseValidatedBody(request, goalCreateSchema);
  if (parsed instanceof Response) return parsed;

  const {
    family_id, child_id, title, target_amount, currency, category, deadline,
    alloc_pct, match_rate, product_url, parent_match_pct, parent_fixed_contribution,
  } = parsed;
  if (!family_id || family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && child_id !== auth.sub) return error('Forbidden', 403);

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

  // Lab triggers — fire-and-forget
  evaluateOnGoalCreate(env.DB, child_id as string, (category as string) ?? 'other', (deadline as string | null) ?? null).catch(() => {})

  // Child nudge — encourage the child for setting a new goal
  generateChildNudge(env.DB, child_id as string, auth.family_id, 'goal_created').catch(() => {})

  // Gaming goal — digital currency awareness (once ever)
  if (String(category ?? 'other') === 'gaming') {
    generateOnceChildNudge(env.DB, child_id as string, auth.family_id, 'gaming_goal_created').catch(() => {})
  }

  // Portfolio milestone — fire once when child reaches 3+ active goals
  const postCreateCount = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM goals WHERE child_id=? AND archived=0 AND status='ACTIVE'`)
    .bind(child_id).first<{ cnt: number }>()
  if ((postCreateCount?.cnt ?? 0) >= 3) {
    generateOnceChildNudge(env.DB, child_id as string, auth.family_id, 'multi_goal_portfolio').catch(() => {})
  }

  return json(goal, 201);
}

// The goal belongs to the child who created it — a parent can only adjust
// their own match percentage, never rewrite the child's title/target/deadline
// unilaterally. current_saved_pence/parent_fixed_contribution are write-only
// via /contribute; status is write-only via /purchase — neither is editable here.
const PARENT_UPDATABLE_FIELDS = ['parent_match_pct'];
const CHILD_UPDATABLE_FIELDS = [
  'title', 'target_amount', 'currency', 'category', 'deadline', 'alloc_pct',
  'match_rate', 'product_url',
];

export async function handleGoalUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const parsed = await parseValidatedBody(request, goalUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const body = parsed;

  const goal = await env.DB
    .prepare('SELECT family_id, child_id, current_saved_pence FROM goals WHERE id = ?')
    .bind(id).first<{ family_id: string; child_id: string; current_saved_pence: number }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && goal.child_id !== auth.sub) return error('Forbidden', 403);

  const allowed = auth.role === 'parent' ? PARENT_UPDATABLE_FIELDS : CHILD_UPDATABLE_FIELDS;
  const disallowed = Object.keys(body).filter(key => !allowed.includes(key));
  if (disallowed.length > 0) {
    return error(
      auth.role === 'parent'
        ? 'Parents can only adjust the parental match percentage — the goal itself belongs to your child'
        : `Cannot update field(s): ${disallowed.join(', ')}`,
      403,
    );
  }

  // A child can lower their own target, but not below what's already been
  // gifted toward it — that would leave the contribution stranded above 100%.
  if ('target_amount' in body) {
    const newTarget = Number(body.target_amount);
    if (!Number.isInteger(newTarget) || newTarget <= 0) return error('target_amount must be a positive integer');
    if (newTarget < goal.current_saved_pence) {
      return error(
        `Target can't be lower than the ${(goal.current_saved_pence / 100).toFixed(2)} already contributed toward this goal`,
        422,
      );
    }
  }

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
    .prepare('SELECT family_id, child_id, created_at, current_saved_pence FROM goals WHERE id = ?')
    .bind(id).first<{ family_id: string; child_id: string; created_at: number; current_saved_pence: number }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && goal.child_id !== auth.sub) return error('Forbidden', 403);

  await env.DB
    .prepare('UPDATE goals SET archived = 1, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), id).run();

  // Deallocate earmarked Save balance back to unallocated when goal is archived
  try {
    const jarCfg = await getJarConfig(env.DB, goal.family_id, goal.child_id);
    if (jarCfg.enabled && goal.current_saved_pence > 0) {
      const now = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare(`INSERT INTO jar_movements (family_id,child_id,jar,delta,earmark_pence,kind,goal_id,created_at) VALUES (?,?,'save',0,?,'goal_deallocate',?,?)`)
        .bind(goal.family_id, goal.child_id, goal.current_saved_pence, id, now)
        .run();
    }
  } catch (e) {
    console.error('[goal_deallocate] non-critical:', e);
  }

  // Lab trigger — fire-and-forget
  evaluateOnGoalCancel(env.DB, goal.child_id, goal.created_at).catch(() => {})

  return json({ ok: true });
}

export async function handleGoalReorder(request: Request, env: Env, id: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const parsed = await parseValidatedBody(request, goalReorderSchema);
  if (parsed instanceof Response) return parsed;
  const dir = parsed.dir;

  const goal = await env.DB
    .prepare('SELECT family_id, child_id, sort_order FROM goals WHERE id = ? AND archived = 0')
    .bind(id).first<{ family_id: string; child_id: string; sort_order: number }>();
  if (!goal) return error('Goal not found', 404);
  if (goal.family_id !== auth.family_id) return error('Forbidden', 403);
  if (auth.role === 'child' && goal.child_id !== auth.sub) return error('Forbidden', 403);

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

  // Draw from Save jar when jars enabled — check BEFORE any writes
  const jarCfg = await getJarConfig(env.DB, goal.family_id, goal.child_id);
  if (jarCfg.enabled) {
    const balances = await getJarBalances(env.DB, goal.family_id, goal.child_id);
    if (balances.save < goal.target_amount) {
      return error('Insufficient Save jar balance', 422);
    }
  }

  // BUG-028 fix: include spending INSERT in the batch so goal REACHED + jar debit
  // + spending record are all atomic — no orphaned spend on partial failure.
  const batchStatements = [
    env.DB.prepare(`UPDATE goals SET status = 'REACHED', updated_at = ? WHERE id = ? AND family_id = ?`)
      .bind(now, id, goal.family_id),
    env.DB.prepare(`INSERT INTO spending (id, family_id, child_id, title, amount, currency, note, goal_id, spent_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(spendId, goal.family_id, goal.child_id, `Purchased: ${goal.title}`, goal.target_amount, goal.currency, 'Goal reached — item purchased', id, now),
  ];
  if (jarCfg.enabled) {
    batchStatements.push(
      env.DB.prepare(
        `INSERT INTO jar_movements (family_id, child_id, jar, delta, kind, goal_id, created_at)
         VALUES (?, ?, 'save', ?, 'goal_purchase', ?, ?)`
      ).bind(goal.family_id, goal.child_id, -goal.target_amount, id, now)
    );
  }
  await env.DB.batch(batchStatements);

  // Lab trigger — fire-and-forget
  evaluateOnGoalPurchase(env.DB, goal.child_id).catch(() => {})

  // Child nudge — celebrate the goal being reached
  generateChildNudge(env.DB, goal.child_id, goal.family_id, 'goal_funded').catch(() => {})

  return json({ ok: true, spend_id: spendId });
}

// POST /api/goals/:id/contribute
// Parent makes a one-time fixed contribution to a child goal.
// Body: { amount_pence: number }
// Increments current_saved_pence on the goal.
export async function handleGoalContribute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can contribute to goals', 403);

  const parsed = await parseValidatedBody(request, goalContributeSchema);
  if (parsed instanceof Response) return parsed;
  const { amount_pence } = parsed;

  const goal = await env.DB
    .prepare('SELECT * FROM goals WHERE id = ? AND archived = 0')
    .bind(id).first<{ family_id: string; child_id: string; status: string }>();
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

  // BUG-027 fix: use delta=amount_pence so the parent's gift actually enters the
  // Save jar (SUM(delta) balance). delta=0 was earmark-only — purchase guard
  // (balances.save < target_amount) would then fail even with a full contribution.
  try {
    const jarCfg = await getJarConfig(env.DB, goal.family_id, goal.child_id);
    if (jarCfg.enabled) {
      const jarNow = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare(`INSERT INTO jar_movements (family_id,child_id,jar,delta,earmark_pence,kind,goal_id,created_at) VALUES (?,?,'save',?,?,'goal_allocate',?,?)`)
        .bind(goal.family_id, goal.child_id, amount_pence, amount_pence, id, jarNow)
        .run();
    }
  } catch (e) {
    console.error('[goal_allocate] non-critical:', e);
  }

  const updated = await env.DB.prepare('SELECT * FROM goals WHERE id = ?').bind(id)
    .first<{ title: string; current_saved_pence: number; target_amount: number }>();

  if (updated) {
    ctx.waitUntil(
      notifyChild(env, goal.child_id, goal.family_id, {
        title: `${updated.title} got a boost!`,
        body: `Now ${Math.round((updated.current_saved_pence / updated.target_amount) * 100)}% there`,
        route: '/child?tab=goals',
      }),
    );
  }

  return json(updated);
}
