import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';
import { json, error } from '../lib/response.js';
import { upsertDeviceToken, deleteDeviceToken } from '../lib/push/tokens.js';
import { getParentPendingCount, getChildPendingCount } from '../lib/push/pendingCount.js';

type AuthedRequest = Request & { auth: JwtPayload };

interface RegisterBody {
  token: string;
  platform: string;
  environment: string;
}

export async function handleRegisterDeviceToken(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await request.json<Partial<RegisterBody>>().catch(() => null);

  if (!body?.token) return error('token required', 400);
  if (body.platform !== 'ios' && body.platform !== 'android') return error("platform must be 'ios' or 'android'", 400);
  if (body.environment !== 'sandbox' && body.environment !== 'production') return error("environment must be 'sandbox' or 'production'", 400);

  await upsertDeviceToken(env.DB, {
    token: body.token,
    user_id: auth.sub,
    platform: body.platform,
    environment: body.environment,
  });

  return json({ ok: true });
}

export async function handleUnregisterDeviceToken(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await request.json<{ token?: string }>().catch(() => null);
  if (!body?.token) return error('token required', 400);

  await deleteDeviceToken(env.DB, body.token, auth.sub);
  return json({ ok: true });
}

// ----------------------------------------------------------------
// GET /api/push/pending-count
// Role-aware badge count for the resume-time self-heal: parents get
// getParentPendingCount (awaiting-review completions + give requests,
// mirrors handleCompletionCount), children get getChildPendingCount
// (new chores assigned + needs-redo completions). Reuses the same
// helpers the push-send paths already use, so the badge always matches
// what a push notification would have set it to.
// ----------------------------------------------------------------
export async function handleGetPendingCount(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const count = auth.role === 'child'
    ? await getChildPendingCount(env.DB, auth.family_id, auth.sub)
    : await getParentPendingCount(env.DB, auth.family_id);

  return json({ pending_count: count });
}
