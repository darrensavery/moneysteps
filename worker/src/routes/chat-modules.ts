// worker/src/routes/chat-modules.ts
// GET /api/chat/modules
// Returns all unlocked curriculum module slugs for the authenticated child.

import type { Env } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'

type AuthedRequest = Request & { auth: JwtPayload }

export async function handleChatModules(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth

  if (auth.role !== 'child') {
    return json({ error: 'Child auth required' }, 403)
  }

  const rows = await env.DB.prepare(
    `SELECT module_slug, unlocked_at
     FROM unlocked_modules
     WHERE child_id = ?
     ORDER BY unlocked_at ASC`,
  ).bind(auth.sub).all()

  return json({ modules: rows.results })
}
