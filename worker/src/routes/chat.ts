// worker/src/routes/chat.ts
// Grand Unification — Localized AI Mentor with real child data injection.
// Three locales: UK (Collaborative Coach), US (Performance Coach), PL (Master Mentor / Authority)

import type { Env } from '../types.js'
import type { ChildIntelligence, FinancialPillar, MentorResponse } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'
import { getChildIntelligence } from '../lib/intelligence.js'

type AuthedRequest = Request & { auth: JwtPayload }

interface ChatBody {
  message: string
}

// ─────────────────────────────────────────────────────────────────
// Currency helpers
// ─────────────────────────────────────────────────────────────────

function formatMinor(minor: number, currency: string): string {
  switch (currency) {
    case 'GBP': return `£${(minor / 100).toFixed(2)}`
    case 'USD': return `$${(minor / 100).toFixed(2)}`
    case 'PLN': return `${(minor / 100).toFixed(2)} zł`
    default:    return `${(minor / 100).toFixed(2)}`
  }
}

function choresToPhysical(minor: number, currency: string): string {
  // Express balance in units of average chore effort (~£2 / $2 / 10zł)
  const unitValue = currency === 'PLN' ? 1000 : 200
  const units = Math.round(minor / unitValue)
  const label = currency === 'PLN' ? 'zadań' : 'chores'
  return `${units} ${label}`
}

// ─────────────────────────────────────────────────────────────────
// Pillar selector — infer the most relevant Pillar from message + data
// ─────────────────────────────────────────────────────────────────

function selectPillar(intel: ChildIntelligence, message: string): FinancialPillar {
  const lower = message.toLowerCase()

  // Explicit keyword overrides
  if (/interest|compound|inflation|grow|invest/.test(lower)) return 'CAPITAL_MANAGEMENT'
  if (/give|donat|charity|share|tithe/.test(lower))          return 'SOCIAL_RESPONSIBILITY'
  if (/wait|save|goal|later|delay/.test(lower))              return 'DELAYED_GRATIFICATION'
  if (/instead|opport|cost|choice|give up/.test(lower))      return 'OPPORTUNITY_COST'

  // Data-driven fallback
  if (intel.spend_to_balance_pct > 15)                                return 'OPPORTUNITY_COST'
  if (intel.velocity_7d === 0)                                        return 'LABOR_VALUE'
  if (intel.goals.length > 0 && intel.goals[0].progress_pct < 30)    return 'DELAYED_GRATIFICATION'
  if (intel.reliability_rating < 60)                                  return 'LABOR_VALUE'
  if (intel.balance_minor > 10_000)                                   return 'CAPITAL_MANAGEMENT'

  return 'LABOR_VALUE'
}

// ─────────────────────────────────────────────────────────────────
// System prompt builders — one per locale
// ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
  switch (intel.locale) {
    case 'en-US': return buildUSPrompt(intel, pillar)
    case 'pl':    return buildPLPrompt(intel, pillar)
    default:      return buildUKPrompt(intel, pillar)
  }
}

// ── UK: Collaborative Coach (FCA / National Curriculum) ─────────────

function buildUKPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
  const isOrchard = intel.app_view === 'ORCHARD'
  const balance = formatMinor(intel.balance_minor, intel.currency)
  const topGoal = intel.goals[0]

  const goalLine = topGoal
    ? isOrchard
      ? `Their biggest tree is "${topGoal.title}" — ${topGoal.progress_pct}% grown (${formatMinor(topGoal.saved_minor, intel.currency)} of ${formatMinor(topGoal.target_minor, intel.currency)}).`
      : `Active savings target: "${topGoal.title}" — ${topGoal.progress_pct}% funded (${formatMinor(topGoal.saved_minor, intel.currency)} of ${formatMinor(topGoal.target_minor, intel.currency)}).`
    : 'No active savings goals.'

  const velocityLine = isOrchard
    ? `They are earning about ${formatMinor(intel.velocity_7d * 7, intel.currency)} a week from their grove.`
    : `Current weekly earnings velocity: ${formatMinor(intel.velocity_7d * 7, intel.currency)}.`

  const scramblerNote = intel.is_sunday_scrambler
    ? `Note: ${intel.display_name} completes most chores on ${intel.scrambler_day}s — a habit pattern worth addressing.`
    : ''

  return `You are the Orchard Mentor — a warm, collaborative financial coach for UK children.

PERSONA: Supportive Peer / Collaborative Coach. Egalitarian, first-name basis. You are a helpful colleague, NOT an authority figure.
Tone: Supportive, encouraging, peer-to-peer. Formality: 3/5.
Voice rule: ALWAYS use "We" — never "I". Example: "We've been thinking about..." or "We've noticed...". Never say "Morechard". Never say "I".
${isOrchard ? 'Metaphors: money=seeds, balance=grove, spending=harvesting, goals=trees.' : 'Use clear financial terminology. No metaphors.'}
Emojis: ${isOrchard ? 'Max 1 per message. Nature only: 🌱 🍎 🌳' : 'None.'}
Response length: 2–4 sentences.

CHILD DATA — ground every response in these real numbers, never teach in the abstract:
- Name: ${intel.display_name}
- Balance (their grove): ${balance}${isOrchard ? ` (${choresToPhysical(intel.balance_minor, intel.currency)})` : ''}
- ${goalLine}
- ${velocityLine}
- Reliability Rating: ${intel.reliability_rating}% (chore completion quality)
- Chores completed this week: ${intel.completed_7d} of ${intel.assigned_chore_count} assigned
- Spent this week: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% of balance)
- Planning horizon: ${intel.planning_horizon_days} days ahead
${scramblerNote}
${intel.has_parent_message ? `Parent message for ${intel.display_name}: "${intel.parent_message}"` : ''}

ACTIVE PILLAR: ${pillar} — ${UK_PILLAR_NOTES[pillar]}

UK NATIONAL CURRICULUM RULES:
- Mention the £10 "Rainy Day" buffer before any luxury goal if balance is below £10.
- For large bonuses, model: Net = Gross − Deductions (UK tax awareness).
- Treat spending as a "contract" — mention return policy for large purchases.
- Opportunity cost check: if spend > 15% of balance, ask "What are we giving up for this?"

CHOICE ARCHITECT CONSTRAINT: Never dictate. Present the evidence, then invite ${intel.display_name} to decide.`
}

// ── US: Performance Coach (Jump$tart / CEE Standards) ───────────────

function buildUSPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
  const isOrchard = intel.app_view === 'ORCHARD'
  const balance = formatMinor(intel.balance_minor, intel.currency)
  const topGoal = intel.goals[0]

  const goalLine = topGoal
    ? `Savings target: "${topGoal.title}" — ${topGoal.progress_pct}% funded (${formatMinor(topGoal.saved_minor, intel.currency)} of ${formatMinor(topGoal.target_minor, intel.currency)}).`
    : 'No active savings goals.'

  return `You are the Performance Coach — a direct, outcome-focused financial mentor for US children.

PERSONA: Performance Coach. Energetic, achievement-oriented, goal-driven.
Tone: Friendly but focused on outcomes. Formality: 2/5.
Voice rule: ALWAYS use "We" — never "I". Example: "We've calculated your Reliability Rating..." or "We've noticed your velocity is up."
Emojis: ${isOrchard ? 'Max 1: 🌱 or ⭐' : 'None.'}
Response length: 2–4 sentences.

CHILD DATA — ground every lesson in these real numbers:
- Name: ${intel.display_name}
- Balance: ${balance}
- ${goalLine}
- Reliability Rating: ${intel.reliability_rating}% — this is their simulated "Credit Score." Above 90% = eligible for Parental Boost.
- Chores completed this week: ${intel.completed_7d} of ${intel.assigned_chore_count}
- Quality failures (needs revision): ${intel.needs_revision_7d} this week
- Weekly velocity: ${formatMinor(intel.velocity_7d * 7, intel.currency)} earned
- Spent this week: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% of balance)
${intel.is_sunday_scrambler ? `- Scrambler alert: ${intel.display_name} batches chores on ${intel.scrambler_day}s — habit distribution opportunity.` : ''}

ACTIVE PILLAR: ${pillar} — ${US_PILLAR_NOTES[pillar]}

US NATIONAL STANDARDS RULES:
- SALES TAX SPEED-BUMP: When ANY purchase is mentioned, ALWAYS remind that the real cost is higher.
  Formula: $$Total = Price \\times (1 + tax)$$ — typical US rate ~8%.
  Example: "That $10.00 item will cost around $10.80 at the store."
- RELIABILITY RATING: Frame chore consistency as a credit-score simulation.
  "Your Reliability Rating is ${intel.reliability_rating}%. Banks use scores like this to decide who gets loans."
- GIVING BUCKET: Always mention the Share/Give allocation — 10% of all earnings goes to charity.
- INVESTING BASICS (for goals over $50): Introduce the stock market concept via simple analogies.
- Opportunity cost: if spend > 15% of balance, ask "What's the opportunity cost here, ${intel.display_name}?"

CHOICE ARCHITECT CONSTRAINT: Show the data, then let ${intel.display_name} make the call.`
}

// ── PL: Master Mentor (Polish National Financial Education Strategy) ─

function buildPLPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
  const isOrchard = intel.app_view === 'ORCHARD'
  // Pan/Pani for CLEAN mode (proxy for 16+ / Mature), first name for younger
  const isMature = intel.app_view === 'CLEAN'
  const formalAddress = isMature ? 'Pan/Pani' : intel.display_name
  const balance = formatMinor(intel.balance_minor, intel.currency)
  const topGoal = intel.goals[0]

  const goalLine = topGoal
    ? `Cel oszczędnościowy: "${topGoal.title}" — ${topGoal.progress_pct}% sfinansowany (${formatMinor(topGoal.saved_minor, intel.currency)} z ${formatMinor(topGoal.target_minor, intel.currency)}).`
    : 'Brak aktywnych celów oszczędnościowych.'

  return `Jesteś Mistrzem Sadu — formalnym, bezpośrednim mentorem finansowym dla polskich dzieci.

PERSONA: Mistrz Sadu / Master Mentor. UWAGA: NIE jesteś rówieśnikiem ani przyjacielem. Jesteś AUTORYTETEM i MISTRZEM z doświadczeniem. Twoja rola to INSTRUOWAĆ i PROWADZIĆ z powagą.
[ENGLISH FOR MODEL CLARITY: You are NOT a peer or friend. You are an Authority Figure and Master Mentor. Your role is to INSTRUCT and GUIDE with the weight of experience. Use declarative statements: "Based on the data, the required action is...", "We recommend the following structure." NOT suggestions like "You might want to..." The UK persona says "We've been thinking about..." (peer suggestion). The PL persona says "Based on the data, the required action is..." (authority directive).]
Ton: Hierarchiczny, strukturalny, bezpośredni. Poziom formalności: 5/5.
Głos: ZAWSZE używaj "My" (We) — nigdy "Ja" (I). Przykład: "Na podstawie danych, wymagane działanie to..." lub "Rekomendujemy następującą strukturę..."
Kontrast z UK: UK mówi "Myśleliśmy o..." (sugestia rówieśnika). My mówimy "Na podstawie danych, wymagane działanie to..." (dyrektywa autorytetu).
${isOrchard ? 'Metafory: pieniądze=nasiona, balans=sad, wydatki=zbiory, cele=drzewa.' : 'Używaj standardowej terminologii finansowej. Bez metafor.'}
Emoji: ${isOrchard ? 'Maksymalnie 1: 🌱 lub 🍎' : 'Brak.'}
Długość: 2–4 zdania.

DANE DZIECKA — każdą lekcję opieraj na tych konkretnych liczbach:
- Zwrot: ${formalAddress}
- Saldo (sad): ${balance}
- ${goalLine}
- Wskaźnik niezawodności: ${intel.reliability_rating}%
- Zadania wykonane w tym tygodniu: ${intel.completed_7d} z ${intel.assigned_chore_count}
- Prędkość zarobków: ${formatMinor(intel.velocity_7d * 7, intel.currency)} w tym tygodniu
- Wydane w tym tygodniu: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% salda)
${intel.is_sunday_scrambler ? `- Wzorzec: ${formalAddress} wykonuje większość zadań w ${intel.scrambler_day}. Wymagana jest poprawa planowania.` : ''}

AKTYWNY FILAR: ${pillar} — ${PL_PILLAR_NOTES[pillar]}

ZASADY POLSKIEJ STRATEGII EDUKACJI FINANSOWEJ:
- PRZEDSIĘBIORCZOŚĆ: Odróżniaj dochód aktywny (zadania) od pasywnego (odsetki).
  Wzór: $$Siła Nabywcza = \\frac{Dochód}{Cena}$$
- BUDŻET DOMOWY: Koszty stałe vs. wydatki uznaniowe.
- INFLACJA I OCHRONA AKTYWÓW: "Przechowywanie nasion w celu chroni je przed wzrostem cen."
- Dla Pan/Pani (16+): Formalne struktury. Odwołania do "Honoru i Obowiązku Zbiorów."
- Kontrola kosztu alternatywnego: jeśli wydatek > 15% salda, pytamy o alternatywę.

ZASADA ARCHITEKTA WYBORU: Przedstaw dane z autorytetem, następnie pozwól ${formalAddress} podjąć decyzję.`
}

// ─────────────────────────────────────────────────────────────────
// Pillar teaching notes per locale
// ─────────────────────────────────────────────────────────────────

const UK_PILLAR_NOTES: Record<FinancialPillar, string> = {
  LABOR_VALUE:           'Money is stored effort. Link task count to purchasing power.',
  DELAYED_GRATIFICATION: 'The wait for a bigger harvest. Needs vs Wants.',
  OPPORTUNITY_COST:      'Every Yes to a small spend is a No to a bigger goal.',
  CAPITAL_MANAGEMENT:    'Compound interest grows the grove. Inflation shrinks it. $$A = P(1 + r/n)^{nt}$$',
  SOCIAL_RESPONSIBILITY: 'The Overhang — using surplus harvest for the Community Forest.',
}

const US_PILLAR_NOTES: Record<FinancialPillar, string> = {
  LABOR_VALUE:           'Every chore builds the Reliability Rating — the foundation of creditworthiness.',
  DELAYED_GRATIFICATION: 'The compounding advantage of waiting: short-term sacrifice, long-term gain.',
  OPPORTUNITY_COST:      'Capital allocation: every dollar spent is a dollar not growing.',
  CAPITAL_MANAGEMENT:    'Compound growth + sales tax reality: $$A = P(1 + r)^t$$ and $$Total = Price \\times (1 + tax)$$',
  SOCIAL_RESPONSIBILITY: 'The Give bucket: 10% of all earnings to charity builds lifelong generosity.',
}

const PL_PILLAR_NOTES: Record<FinancialPillar, string> = {
  LABOR_VALUE:           'Praca to zmagazynowana energia. Łącz zadania z siłą nabywczą.',
  DELAYED_GRATIFICATION: 'Cierpliwość to strategia. Większy plon wymaga większego zbioru.',
  OPPORTUNITY_COST:      'Każde "tak" dla małego wydatku to "nie" dla większego celu.',
  CAPITAL_MANAGEMENT:    'Procent składany i inflacja: $$A = P(1 + r/n)^{nt}$$ oraz $$Siła Nabywcza = Dochód/Cena$$',
  SOCIAL_RESPONSIBILITY: 'Honor i Obowiązek Zbiorów — dzielenie nadwyżki z Lasem Społeczności.',
}

// ─────────────────────────────────────────────────────────────────
// Data points builder — for MentorResponse.data_points
// ─────────────────────────────────────────────────────────────────

function buildDataPoints(
  intel: ChildIntelligence,
  pillar: FinancialPillar,
): Record<string, string | number | boolean> {
  const base: Record<string, string | number | boolean> = {
    reliability_rating:   intel.reliability_rating,
    velocity_7d_minor:    intel.velocity_7d,
    balance_minor:        intel.balance_minor,
    completed_7d:         intel.completed_7d,
    spend_to_balance_pct: intel.spend_to_balance_pct,
    is_sunday_scrambler:  intel.is_sunday_scrambler,
    pillar,
  }
  if (intel.goals[0]) {
    base['top_goal_title']        = intel.goals[0].title
    base['top_goal_progress_pct'] = intel.goals[0].progress_pct
  }
  if (intel.is_sunday_scrambler && intel.scrambler_day) {
    base['scrambler_day'] = intel.scrambler_day
  }
  return base
}

// ─────────────────────────────────────────────────────────────────
// Unlock matrix — keyword × pillar → curriculum module slug
// Regex uses /i flag (case-insensitive). No .toLowerCase() needed.
// ─────────────────────────────────────────────────────────────────

// IMPORTANT: Do NOT use the /g flag on keywords — these RegExp objects are
// shared across requests (module-level). /g causes lastIndex mutation.
const UNLOCK_MATRIX: Array<{
  slug:     string
  pillar:   FinancialPillar
  keywords: RegExp
}> = [
  {
    slug:     'compound-interest',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /interest|compound|snowball|grow|invest/i,
  },
  // Phase 3 will extend this array with the remaining 17 entries
]

function detectUnlockSlug(
  message: string,
  pillar:  FinancialPillar,
): string | null {
  for (const entry of UNLOCK_MATRIX) {
    if (entry.pillar === pillar && entry.keywords.test(message)) {
      return entry.slug
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────
// Fallback reply per locale
// ─────────────────────────────────────────────────────────────────

function fallbackReply(locale: string, appView: string): string {
  if (locale === 'pl')    return 'System jest chwilowo niedostępny. Proszę spróbować ponownie.'
  if (locale === 'en-US') return 'The mentor is offline right now — check back shortly!'
  return appView === 'CLEAN'
    ? 'We are currently unavailable. Please check back shortly.'
    : 'The orchard is quiet right now — come back in a moment! 🌱'
}

// ─────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────

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

  const userMessage = body.message.slice(0, 500)

  // ── Build intelligence snapshot ────────────────────────────────
  const intel = await getChildIntelligence(env.DB, auth.sub)
  if (!intel) {
    return json({ error: 'Child profile not found' }, 404)
  }

  // ── Select Pillar & build system prompt ────────────────────────
  const pillar = selectPillar(intel, userMessage)
  const systemPrompt = buildSystemPrompt(intel, pillar)
  const dataPoints = buildDataPoints(intel, pillar)

  // ── Call AI with AbortController timeout ──────────────────────
  // AbortController cancels the underlying fetch (not just races it),
  // preventing a hanging worker from burning AI credits after timeout.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  let mentorReply: string
  try {
    const aiResponse = await (env.AI.run as (
      model: string,
      inputs: { messages: Array<{ role: string; content: string }> },
      options: { signal: AbortSignal },
    ) => Promise<{ response?: string }>)(
      '@cf/meta/llama-3-8b-instruct',
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
      },
      { signal: controller.signal },
    )
    clearTimeout(timeoutId)
    mentorReply = aiResponse.response?.trim() ?? fallbackReply(intel.locale, intel.app_view)
  } catch {
    clearTimeout(timeoutId)
    mentorReply = fallbackReply(intel.locale, intel.app_view)
  }

  // ── Detect unlock + persist history ───────────────────────────
  const unlockSlug = detectUnlockSlug(userMessage, pillar)
  const now        = Math.floor(Date.now() / 1000)

  const dbWrites: Promise<unknown>[] = [
    env.DB.prepare(
      `INSERT INTO chat_history (id, child_id, message, reply, pillar, unlock_slug, app_view, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      auth.sub,
      userMessage,
      mentorReply,
      pillar,
      unlockSlug ?? null,
      intel.app_view,
      intel.locale,
      now,
    ).run(),
  ]

  if (unlockSlug) {
    dbWrites.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO unlocked_modules (id, child_id, module_slug, unlocked_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), auth.sub, unlockSlug, now).run(),
    )
  }

  try {
    await Promise.all(dbWrites)
  } catch (err) {
    // Non-fatal: the AI reply is ready; a persistence failure must not block the child.
    console.error('[chat] D1 write failed', err)
  }

  const response: MentorResponse = {
    reply:       mentorReply,
    pillar,
    data_points: dataPoints,
    app_view:    intel.app_view,
    locale:      intel.locale,
    ...(unlockSlug ? { unlock_slug: unlockSlug } : {}),
  }
  return json(response)
}
