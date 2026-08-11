import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';
import { getJarBalances } from '../lib/jar-balance.js';
import { sendPushNotification } from '../lib/push/send.js';
import { getParentPendingCount } from '../lib/push/pendingCount.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// POST /api/give-requests
// Body: { family_id, child_id, cause, amount }
// Child only. Reserves Give jar balance.
// ----------------------------------------------------------------
export async function handlePostGiveRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can submit give requests', 403);

  const body = await request.json<{
    family_id: string; child_id: string; cause: string; amount: number;
  }>();
  const { family_id, child_id, cause, amount } = body;
  if (!family_id || !child_id || !cause || !amount) return error('Missing required fields', 400);
  if (family_id !== auth.family_id || child_id !== auth.sub) return error('Forbidden', 403);
  if (cause.trim().length === 0 || cause.length > 60) return error('Cause must be 1–60 characters', 400);
  // BUG-039 fix: require integer pence — floats are silently truncated by SQLite,
  // which creates a mismatch between the stored amount and the jar debit.
  if (!Number.isInteger(amount) || amount <= 0) return error('Amount must be a positive integer (pence)', 400);

  // Verify Give jar has sufficient balance.
  // jar_movements already records a -amount debit at submission time (atomic batch below),
  // so balances.give is the post-debit available balance. No secondary pendingRow subtraction
  // is needed — it would double-count and block valid requests.
  const balances = await getJarBalances(env.DB, family_id, child_id);
  if (!balances.enabled) return error('Jars are not enabled', 400);
  if (balances.give < amount) return error('Insufficient Give jar balance', 400);

  const now = Math.floor(Date.now() / 1000);
  const currencyRow = await env.DB
    .prepare('SELECT base_currency FROM families WHERE id=?')
    .bind(family_id)
    .first<{ base_currency: string }>();
  const currency = currencyRow?.base_currency ?? 'GBP';

  // Atomic batch: both inserts execute or neither does.
  // ref_id on jar_movement is set via give_requests.jar_movement_id after the batch.
  const [giveReqResult, movResult] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO give_requests (family_id,child_id,cause,amount,currency,status,requested_at)
       VALUES (?,?,?,?,?,'requested',?) RETURNING id`
    ).bind(family_id, child_id, cause.trim(), amount, currency, now),
    env.DB.prepare(
      `INSERT INTO jar_movements (family_id,child_id,jar,delta,kind,ref_id,created_at)
       VALUES (?,?,'give',?,'give_request',NULL,?)`
    ).bind(family_id, child_id, -amount, now),
  ]);

  const giveReqId = (giveReqResult.results[0] as any).id as number;
  const movId = movResult.meta.last_row_id;

  // Link give_request → jar_movement (non-critical, convenience only)
  await env.DB.prepare(
    `UPDATE give_requests SET jar_movement_id=? WHERE id=?`
  ).bind(movId, giveReqId).run();

  // Push notification — notify every parent that a give request is awaiting
  // review. Non-critical, fire-and-forget.
  const currencySymbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';
  const formattedAmount = `${currencySymbol}${(amount / 100).toFixed(2)}`;
  ctx.waitUntil((async () => {
    const childRow = await env.DB
      .prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(child_id)
      .first<{ display_name: string }>();
    const childName = childRow?.display_name ?? 'Your child';

    // Note: 'role' lives on family_roles, not users — users has no role column.
    const parents = await env.DB
      .prepare(`SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
                WHERE fr.family_id = ? AND fr.role = 'parent'`)
      .bind(family_id)
      .all<{ id: string }>();
    const pendingCount = await getParentPendingCount(env.DB, family_id);
    await Promise.allSettled(
      (parents.results ?? []).map(p =>
        sendPushNotification(env, p.id, {
          title: 'Give request received',
          body: `${childName} wants to give ${formattedAmount} to ${cause.trim()}`,
          route: `/give-requests/${giveReqId}`,
          badgeCount: pendingCount,
        }),
      ),
    );
  })());

  return json({ ok: true, id: giveReqId }, 201);
}

// ----------------------------------------------------------------
// GET /api/give-requests?family_id=&status=requested
// Parent only — lists pending give requests for all children.
// ----------------------------------------------------------------
export async function handleGetGiveRequests(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Parents only', 403);

  const url       = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const status    = url.searchParams.get('status') ?? 'requested';
  if (!family_id) return error('family_id required', 400);
  if (family_id !== auth.family_id) return error('Forbidden', 403);

  const rows = status === 'all'
    ? await env.DB
        .prepare(`
          SELECT gr.*, u.display_name AS child_name
          FROM give_requests gr
          JOIN users u ON u.id = gr.child_id
          WHERE gr.family_id=?
          ORDER BY gr.requested_at DESC
        `)
        .bind(family_id)
        .all()
    : await env.DB
        .prepare(`
          SELECT gr.*, u.display_name AS child_name
          FROM give_requests gr
          JOIN users u ON u.id = gr.child_id
          WHERE gr.family_id=? AND gr.status=?
          ORDER BY gr.requested_at DESC
        `)
        .bind(family_id, status)
        .all();

  return json({ give_requests: rows.results });
}

// ----------------------------------------------------------------
// PATCH /api/give-requests/:id
// Body: { action: 'fulfil' | 'decline', parent_note? }
// Parent only.
// ----------------------------------------------------------------
export async function handlePatchGiveRequest(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Parents only', 403);

  const body = await request.json<{ action: 'fulfil' | 'decline'; parent_note?: string }>();
  if (!body.action) return error('action required', 400);

  const req = await env.DB
    .prepare('SELECT * FROM give_requests WHERE id=?')
    .bind(id)
    .first<{ id: number; family_id: string; child_id: string; amount: number; status: string }>();

  if (!req) return error('Give request not found', 404);
  if (req.family_id !== auth.family_id) return error('Forbidden', 403);
  if (req.status !== 'requested') return error('Request already resolved', 400);

  const now  = Math.floor(Date.now() / 1000);
  const newStatus = body.action === 'fulfil' ? 'fulfilled' : 'declined';

  await env.DB.batch([
    env.DB.prepare(`UPDATE give_requests SET status=?,fulfilled_at=?,parent_note=? WHERE id=?`)
      .bind(newStatus, now, body.parent_note ?? null, id),
    // If declined: restore Give jar balance
    ...(body.action === 'decline' ? [
      env.DB.prepare(`INSERT INTO jar_movements (family_id,child_id,jar,delta,kind,ref_id,created_at) VALUES (?,?,'give',?,'give_declined',?,?)`)
        .bind(req.family_id, req.child_id, req.amount, id, now),
    ] : [
      // If fulfilled: record finalisation (delta=0, just an audit event)
      env.DB.prepare(`INSERT INTO jar_movements (family_id,child_id,jar,delta,kind,ref_id,created_at) VALUES (?,?,'give',0,'give_fulfilled',?,?)`)
        .bind(req.family_id, req.child_id, id, now),
    ]),
  ]);

  return json({ ok: true, status: newStatus });
}
