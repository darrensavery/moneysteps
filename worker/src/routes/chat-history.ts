// worker/src/routes/chat-history.ts
// GET /api/chat/history?limit=20&offset=0
// Returns paginated chat history for the authenticated child.

import type { Env } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'

type AuthedRequest = Request & { auth: JwtPayload }

export async function handleChatHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth

  if (auth.role !== 'child') {
    return json({ error: 'Child auth required' }, 403)
  }

  const url    = new URL(request.url)
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit')  ?? '20', 10), 1), 50)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0)

  const rows = await env.DB.prepare(
    `SELECT id, message, reply, pillar, unlock_slug, app_view, locale, created_at
     FROM chat_history
     WHERE child_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(auth.sub, limit, offset).all()

  return json({ history: rows.results, limit, offset })
}
