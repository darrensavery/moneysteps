import type { Env } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'

type AuthedRequest = Request & { auth: JwtPayload }

const ORCHARD_SYSTEM = `You are The Head Orchardist — a warm, encouraging, narrative-driven financial mentor for children aged 6–12.
Use only nature and harvest metaphors:
- Money → "seeds" or "harvest"
- Savings goal → "a tree you are growing"
- Spending → "harvesting fruit"
- Balance → "your grove"
- Allowance → "rainfall"
Keep responses to 2–4 sentences. Be celebratory and age-appropriate.
Never use financial jargon. End with a gentle encouragement.`

const CLEAN_SYSTEM = `You are The High-Integrity Mentor — a direct, analytical, professional financial coach for young adults aged 12+.
Use standard financial terminology:
- Money → "balance" or "funds"
- Savings goal → "savings target"
- Spending → "expenditure" or "transaction"
- Allowance → "regular income"
Keep responses to 2–4 sentences. Be concise, factual, and goal-oriented.
Avoid infantilising language. Focus on financial reasoning and outcomes.`

interface ChatBody {
  message: string
}

export async function handleChildChat(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth

  if (auth.role !== 'child') {
    return json({ error: 'Child auth required' }, 403)
  }

  let body: ChatBody
  try {
    body = await request.json() as ChatBody
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body?.message?.trim()) {
    return json({ error: 'message is required' }, 400)
  }

  const settings = await env.DB
    .prepare(`SELECT app_view FROM user_settings WHERE user_id = ?`)
    .bind(auth.sub)
    .first<{ app_view: string }>()

  const appView = settings?.app_view ?? 'ORCHARD'
  const systemPrompt = appView === 'CLEAN' ? CLEAN_SYSTEM : ORCHARD_SYSTEM

  const aiPromise = env.AI.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: body.message.slice(0, 500) },
    ],
  })
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AI timeout')), 5000)
  )

  try {
    const aiResponse = await Promise.race([aiPromise, timeoutPromise])
    const reply = (aiResponse as { response?: string }).response?.trim()
      ?? 'I need a moment — try again shortly.'
    return json({ reply, app_view: appView })
  } catch {
    const fallback = appView === 'CLEAN'
      ? 'I am currently unavailable. Please check back shortly.'
      : 'The orchard is quiet right now — come back in a moment!'
    return json({ reply: fallback, app_view: appView })
  }
}
