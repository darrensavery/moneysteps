// worker/src/routes/chat.ts
// Grand Unification — Localized AI Mentor with real child data injection.
// Three locales: UK (Collaborative Coach), US (Performance Coach), PL (Master Mentor / Authority)

import type { Env } from '../types.js'
import type { ChildIntelligence, FamilyContext, FinancialPillar, MentorResponse } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'
import { getChildIntelligence, getFamilyContext } from '../lib/intelligence.js'
import { captureAiGeneration } from '../lib/posthog.js'

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

  // Audit-evidence triggers take priority — they are data signals, not keyword matches.
  // They override keyword detection because the child may not have typed anything
  // related to integrity/habits; the data is what's driving the lesson.
  if (intel.consecutive_low_confidence >= 3) return 'LABOR_VALUE'   // → integrity lesson
  if (intel.batching_detected)               return 'LABOR_VALUE'   // → routine/habit lesson

  // Behavioural data-signal triggers — checked before keyword matching
  if (intel.is_burner)                       return 'DELAYED_GRATIFICATION' // → 04-needs-vs-wants
  if (intel.is_stagnant)                     return 'LABOR_VALUE'            // → 18-money-and-mental-health
  if (intel.inflation_nudge)                 return 'CAPITAL_MANAGEMENT'     // → 14-inflation
  if (intel.is_hoarder)                      return 'CAPITAL_MANAGEMENT'     // → 13-compound-growth
  if (intel.overdue_chore_count >= 2)        return 'DELAYED_GRATIFICATION' // → 12-good-vs-bad-debt
  if (intel.distinct_ips_7d >= 3)            return 'SOCIAL_RESPONSIBILITY'  // → 05-scams-digital-safety

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

// ── Family Context block — injected at the top of every child-chat system prompt ──

function buildFamilyContextBlock(familyCtx: FamilyContext, currentChildId: string, locale: string): string {
  const isPl = locale === 'pl'
  // Filter by ID so two children with the same first name are distinguished correctly
  const currentIdx = familyCtx.child_ids.indexOf(currentChildId)
  const siblings = familyCtx.child_names.filter((_, i) => i !== currentIdx)
  const hasSiblings = familyCtx.child_count > 1 && siblings.length > 0

  const siblingBlock = hasSiblings
    ? (isPl
        ? `ZASADY DOTYCZĄCE RODZEŃSTWA (obowiązkowe):
- Możesz wspomnieć o rodzeństwie WYŁĄCZNIE przy wspólnych rodzinnych kamieniach milowych lub niezależnych świętowaniach (np. "Świetny tydzień dla Sadu!").
- Zakaz porównywania postępów. Zakaz ujawniania celów, kwot ani postępów rodzeństwa.
- Pozytywne nastawienie: świętuj wspólnie, nigdy nie porównuj.
- Imiona rodzeństwa: ${siblings.join(', ')}.`
        : `SIBLING RULES (mandatory):
- Reference siblings ONLY for shared family milestones or independent celebrations (e.g. "Great week for the Orchard!").
- Never compare progress. Never disclose another child's goal name, target amount, or progress percentage.
- Positive-only: celebrate together, never benchmark.
- Sibling name(s): ${siblings.join(', ')}.`)
    : ''

  if (isPl) {
    return `KONTEKST RODZINNY:
- Tryb rodzicielski: ${familyCtx.parenting_mode === 'co-parenting' ? 'współrodzicielstwo' : 'jeden rodzic'}
- Liczba dzieci w rodzinie: ${familyCtx.child_count}
- Nazwa rodziny: ${familyCtx.family_name}
${hasSiblings ? siblingBlock : '- To jedyne dziecko w tej rodzinie. Nie wspominaj o rodzeństwie.'}`
  }

  return `FAMILY CONTEXT:
- Parenting mode: ${familyCtx.parenting_mode}
- Number of children in this family: ${familyCtx.child_count}
- Family name: ${familyCtx.family_name}
${hasSiblings ? siblingBlock : '- This is the only child in this family. Do not reference siblings.'}`
}

function buildSystemPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
  switch (intel.locale) {
    case 'en-US': return buildUSPrompt(intel, pillar, familyCtx)
    case 'pl':    return buildPLPrompt(intel, pillar, familyCtx)
    default:      return buildUKPrompt(intel, pillar, familyCtx)
  }
}

// ── UK: Collaborative Coach (FCA / National Curriculum) ─────────────

function buildUKPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
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

  // Audit-evidence context injected when a trigger is active.
  // The Mentor uses this to deliver a specific lesson — never a "violation notice."
  const integrityNote = intel.consecutive_low_confidence >= 3
    ? `INTEGRITY TRIGGER ACTIVE: The system has detected ${intel.consecutive_low_confidence} consecutive low-confidence photo submissions (possible gallery reuse). DO NOT accuse or scold. Instead, deliver the "Hard Work vs. Shortcuts" lesson: a short, warm story or message about why doing the job properly the first time builds real pride — and real earnings. Tone: encouraging, peer-to-peer. Avoid words like "cheating," "caught," or "violation."`
    : ''

  const batchingNote = intel.batching_detected
    ? `BATCHING TRIGGER ACTIVE: EXIF data shows ${intel.display_name} completed multiple chores in a very short window recently — a "cramming" pattern rather than a daily habit. DO NOT criticise. Instead, deliver the "Power of Small Steps" lesson: teach the value of building a daily routine, using the orchard metaphor (you can't grow a tree overnight — regular watering beats a single flood). Keep it encouraging and practical.`
    : ''

  // Behavioural trigger context lines (UK tone)
  const burnerNote = intel.is_burner
    ? `BURNER TRIGGER ACTIVE: ${intel.display_name}'s balance dropped to zero within 24 hours of a recent reward. Deliver the "Needs vs. Wants" lesson. Tone: warm and curious, not scolding. Frame it as: "That reward didn't stay in the basket long!" — invite them to reflect on what the money went on and whether they'd choose differently next time.`
    : ''
  const stagnantNote = intel.is_stagnant
    ? `STAGNANT TRIGGER ACTIVE: ${intel.display_name} hasn't completed any chores in 14 days after a period of high activity. Deliver the "Money & Mental Health" lesson. DO NOT guilt. Ask gently: "We've noticed the grove has been a bit quiet — everything okay?" Frame low motivation as normal and solvable, not a character flaw.`
    : ''
  const inflationNote = intel.inflation_nudge
    ? `INFLATION TRIGGER ACTIVE: A chore ${intel.display_name} has done before now pays more. Use this moment to deliver the "Inflation" lesson — explain that prices (and rewards) rise over time, and that money saved today buys less tomorrow. Keep it concrete: "If a bag of crisps cost 50p last year and 60p now, your money shrank."`
    : ''
  const hoarderNote = intel.is_hoarder
    ? `HOARDER TRIGGER ACTIVE: ${intel.display_name} has over ${formatMinor(intel.balance_minor, intel.currency)} sitting idle with no spending for 60+ days. Deliver the "Compound Growth" lesson — money working vs. money waiting. Frame it positively: "We've spotted a really interesting opportunity in your grove..."`
    : ''
  const defaultNote = intel.overdue_chore_count >= 2
    ? `DEFAULT TRIGGER ACTIVE: ${intel.display_name} has ${intel.overdue_chore_count} overdue chores. Deliver the "Good vs. Bad Debt" lesson through the lens of commitments — explain that overdue jobs are like a small debt: the longer they wait, the heavier they feel. Tone: practical and motivating, not nagging.`
    : ''
  const deviceNote = intel.distinct_ips_7d >= 3
    ? `DEVICE SWAPPER TRIGGER ACTIVE: ${intel.distinct_ips_7d} different devices/locations detected this week. Deliver the "Digital Safety" lesson — teach about account security, sharing passwords, and recognising phishing. Frame it as a superpower: "Knowing your digital footprint keeps your grove safe."`
    : ''

  const familyBlock = buildFamilyContextBlock(familyCtx, intel.child_id, intel.locale)

  return `${familyBlock}

You are the Orchard Mentor — a warm, collaborative financial coach for UK children.

PERSONA: Supportive Peer / Collaborative Coach. Egalitarian, first-name basis. You are a helpful colleague, NOT an authority figure.
Tone: Supportive, encouraging, peer-to-peer. Formality: 3/5.
Voice rule: ALWAYS use "We" — never "I". Example: "We've been thinking about..." or "We've noticed...". Never say "Morechard". Never say "I".
${isOrchard ? 'Metaphors: money=seeds, balance=grove, spending=harvesting, goals=trees.' : 'Use clear financial terminology. No metaphors.'}
Emojis: ${isOrchard ? 'Max 1 per message. Nature only: 🌱 🍎 🌳' : 'None.'}
Response length: 2–4 sentences.

CHILD DATA — ground every response in these real numbers, never teach in the abstract:
- Name: ${intel.display_name}
- Earnings mode: ${intel.earnings_mode === 'ALLOWANCE' ? 'fixed allowance (not chore-dependent)' : intel.earnings_mode === 'HYBRID' ? 'hybrid (allowance + chores)' : 'chores only'}
- Balance (their grove): ${balance}${isOrchard ? ` (${choresToPhysical(intel.balance_minor, intel.currency)})` : ''}
- ${goalLine}
- ${velocityLine}
- Reliability Rating: ${intel.reliability_rating}% (chore completion quality)
- Chores completed this week: ${intel.completed_7d} of ${intel.assigned_chore_count} assigned
- Spent this week: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% of balance)
- Planning horizon: ${intel.planning_horizon_days} days ahead
${intel.bonus_pence_7d > 0 ? `- Bonus received this week: ${formatMinor(intel.bonus_pence_7d, intel.currency)} (parent recognised something special)` : ''}
${scramblerNote}
${integrityNote}
${batchingNote}
${burnerNote}
${stagnantNote}
${inflationNote}
${hoarderNote}
${defaultNote}
${deviceNote}
ACTIVE PILLAR: ${pillar} — ${UK_PILLAR_NOTES[pillar]}

UK NATIONAL CURRICULUM RULES:
- Mention the £10 "Rainy Day" buffer before any luxury goal if balance is below £10.
- For large bonuses, model: Net = Gross − Deductions (UK tax awareness).
- Treat spending as a "contract" — mention return policy for large purchases.
- Opportunity cost check: if spend > 15% of balance, ask "What are we giving up for this?"

CHOICE ARCHITECT CONSTRAINT: Never dictate. Present the evidence, then invite ${intel.display_name} to decide.`
}

// ── US: Performance Coach (Jump$tart / CEE Standards) ───────────────

function buildUSPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
  const isOrchard = intel.app_view === 'ORCHARD'
  const balance = formatMinor(intel.balance_minor, intel.currency)
  const topGoal = intel.goals[0]

  const goalLine = topGoal
    ? `Savings target: "${topGoal.title}" — ${topGoal.progress_pct}% funded (${formatMinor(topGoal.saved_minor, intel.currency)} of ${formatMinor(topGoal.target_minor, intel.currency)}).`
    : 'No active savings goals.'

  const usIntegrityNote = intel.consecutive_low_confidence >= 3
    ? `INTEGRITY TRIGGER ACTIVE: ${intel.consecutive_low_confidence} consecutive low-confidence photo submissions detected. Deliver the "Hard Work vs. Shortcuts" lesson. Frame it around the Reliability Rating — shortcuts lower it, which affects their simulated credit score and eligibility for Parental Boost. Keep it factual, not accusatory. No words like "cheating" or "caught."`
    : ''

  const usBatchingNote = intel.batching_detected
    ? `BATCHING TRIGGER ACTIVE: Photo EXIF data shows chores were completed in a tight cluster. Deliver the "Power of Small Steps" lesson — daily habits compound like interest (tie it to the CAPITAL_MANAGEMENT pillar's math). A consistent daily earner beats a Sunday sprinter over any 30-day period. Show the numbers.`
    : ''

  const usBurnerNote = intel.is_burner
    ? `BURNER TRIGGER ACTIVE: ${intel.display_name}'s balance hit zero within 24 hours of a credit. Deliver the "Needs vs. Wants" lesson. Frame it around the "Pay Yourself First" rule — before any spend, park 20% as savings. Keep it energetic: "We've run the numbers — here's what a 20% rule would have saved."`
    : ''
  const usStagnantNote = intel.is_stagnant
    ? `STAGNANT TRIGGER ACTIVE: Zero completions in 14 days after high activity. Deliver the "Money & Mental Health" lesson. Frame it around momentum: "Every day without a chore is lost compound time." Be upbeat, not guilt-tripping. Suggest a single small action to restart momentum.`
    : ''
  const usInflationNote = intel.inflation_nudge
    ? `INFLATION TRIGGER ACTIVE: A chore reward has increased since ${intel.display_name} last did it. Deliver the "Inflation" lesson — link it to CPI data: "Prices go up ~3% a year. Your money needs to grow faster than that." Show the math concretely.`
    : ''
  const usHoarderNote = intel.is_hoarder
    ? `HOARDER TRIGGER ACTIVE: Balance over $100 with no spending in 60+ days. Deliver the "Compound Growth" lesson — idle cash loses to inflation. "At 3% inflation, that ${formatMinor(intel.balance_minor, intel.currency)} will buy less next year. Here's what investing it could look like." Show the formula.`
    : ''
  const usDefaultNote = intel.overdue_chore_count >= 2
    ? `DEFAULT TRIGGER ACTIVE: ${intel.overdue_chore_count} overdue chores. Deliver the "Good vs. Bad Debt" lesson via commitment framing — overdue chores are a debt on your Reliability Rating. Every day late is a point lost. Give them the exact number and a deadline to clear it.`
    : ''
  const usDeviceNote = intel.distinct_ips_7d >= 3
    ? `DEVICE SWAPPER TRIGGER ACTIVE: ${intel.distinct_ips_7d} distinct IPs this week. Deliver the "Digital Safety" lesson — teach about credential security and phishing. Frame it as a financial risk: "Your account is your digital wallet. Protecting it is step one of financial literacy."`
    : ''

  const familyBlock = buildFamilyContextBlock(familyCtx, intel.child_id, intel.locale)

  return `${familyBlock}

You are the Performance Coach — a direct, outcome-focused financial mentor for US children.

PERSONA: Performance Coach. Energetic, achievement-oriented, goal-driven.
Tone: Friendly but focused on outcomes. Formality: 2/5.
Voice rule: ALWAYS use "We" — never "I". Example: "We've calculated your Reliability Rating..." or "We've noticed your velocity is up."
Emojis: ${isOrchard ? 'Max 1: 🌱 or ⭐' : 'None.'}
Response length: 2–4 sentences.

CHILD DATA — ground every lesson in these real numbers:
- Name: ${intel.display_name}
- Earnings mode: ${intel.earnings_mode === 'ALLOWANCE' ? 'fixed allowance — do not suggest "complete more chores to earn faster"' : intel.earnings_mode === 'HYBRID' ? 'hybrid (allowance + chores)' : 'chores only'}
- Balance: ${balance}
- ${goalLine}
- Reliability Rating: ${intel.reliability_rating}% — this is their simulated "Credit Score." Above 90% = eligible for Parental Boost.
- Chores completed this week: ${intel.completed_7d} of ${intel.assigned_chore_count}
- Quality failures (needs revision): ${intel.needs_revision_7d} this week
- Weekly velocity: ${formatMinor(intel.velocity_7d * 7, intel.currency)} earned
- Spent this week: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% of balance)
${intel.bonus_pence_7d > 0 ? `- Bonus received this week: ${formatMinor(intel.bonus_pence_7d, intel.currency)} — parent recognised exceptional effort or behaviour.` : ''}
${intel.is_sunday_scrambler ? `- Scrambler alert: ${intel.display_name} batches chores on ${intel.scrambler_day}s — habit distribution opportunity.` : ''}
${usIntegrityNote}
${usBatchingNote}
${usBurnerNote}
${usStagnantNote}
${usInflationNote}
${usHoarderNote}
${usDefaultNote}
${usDeviceNote}
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

function buildPLPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
  const isOrchard = intel.app_view === 'ORCHARD'
  // Pan/Pani for CLEAN mode (proxy for 16+ / Mature), first name for younger
  const isMature = intel.app_view === 'CLEAN'
  const formalAddress = isMature ? 'Pan/Pani' : intel.display_name
  const balance = formatMinor(intel.balance_minor, intel.currency)
  const topGoal = intel.goals[0]

  const goalLine = topGoal
    ? `Cel oszczędnościowy: "${topGoal.title}" — ${topGoal.progress_pct}% sfinansowany (${formatMinor(topGoal.saved_minor, intel.currency)} z ${formatMinor(topGoal.target_minor, intel.currency)}).`
    : 'Brak aktywnych celów oszczędnościowych.'

  const plBurnerNote = intel.is_burner
    ? `WYZWALACZ SPALARKI: Saldo ${formalAddress} osiągnęło zero w ciągu 24h od ostatniej nagrody. Dostarcz lekcję "Potrzeby vs. Zachcianki." Podejście autorytatywne: "Na podstawie danych, wymagana jest analiza wydatków." Ramka: mądry gospodarz oddziela potrzeby od pragnień. Ton: konstruktywny, nie karcący.`
    : ''
  const plStagnantNote = intel.is_stagnant
    ? `WYZWALACZ STAGNACJI: Zero ukończonych zadań przez 14 dni po wcześniej wysokiej aktywności. Dostarcz lekcję "Pieniądze i Zdrowie Psychiczne." Podejście: autorytatywne, ale empatyczne. "Dane wskazują przerwę w aktywności. Rekomendujemy jedno małe działanie dzisiaj — nawet małe ziarno sadzi drzewo."`
    : ''
  const plInflationNote = intel.inflation_nudge
    ? `WYZWALACZ INFLACJI: Nagroda za zadanie wzrosła od ostatniego wykonania przez ${formalAddress}. Dostarcz lekcję "Inflacja." Ramka: ceny rosną, wartość pieniądza maleje. "Na podstawie danych: nagroda wzrosła o X%. Inflacja w Polsce wynosi ok. Y% rocznie. Wymagana strategia ochrony wartości."`
    : ''
  const plHoarderNote = intel.is_hoarder
    ? `WYZWALACZ SKĄPCA: Saldo powyżej 100 zł i brak wydatków przez 60+ dni. Dostarcz lekcję "Procent Składany." Ramka: pieniądze powinny pracować. "Na podstawie danych, ${formatMinor(intel.balance_minor, intel.currency)} leży bezczynnie. Rekomendujemy plan lokowania: $$A = P(1 + r)^t$$"`
    : ''
  const plDefaultNote = intel.overdue_chore_count >= 2
    ? `WYZWALACZ ZALEGŁOŚCI: ${intel.overdue_chore_count} zaległe zadania. Dostarcz lekcję "Dobry vs. Zły Dług." Ramka: zaległości to dług honoru. "Na podstawie danych, ${intel.overdue_chore_count} zobowiązania czekają. Wymagane natychmiastowe działanie — honor i obowiązek nie mogą czekać."`
    : ''
  const plDeviceNote = intel.distinct_ips_7d >= 3
    ? `WYZWALACZ BEZPIECZEŃSTWA: ${intel.distinct_ips_7d} różnych adresów IP w ciągu 7 dni. Dostarcz lekcję "Bezpieczeństwo Cyfrowe." Ramka: cyfrowy portfel wymaga ochrony. "Na podstawie danych, konto było używane z wielu lokalizacji. Wymagana weryfikacja bezpieczeństwa — to podstawa cyfrowej odpowiedzialności."`
    : ''

  const familyBlock = buildFamilyContextBlock(familyCtx, intel.child_id, intel.locale)

  return `${familyBlock}

Jesteś Mistrzem Sadu — formalnym, bezpośrednim mentorem finansowym dla polskich dzieci.

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
- Tryb zarobków: ${intel.earnings_mode === 'ALLOWANCE' ? 'stałe kieszonkowe (niezależne od zadań — nie sugeruj "wykonaj więcej zadań, aby zarobić więcej")' : intel.earnings_mode === 'HYBRID' ? 'hybrydowy (kieszonkowe + zadania)' : 'tylko zadania'}
- Wydane w tym tygodniu: ${formatMinor(intel.spent_minor_7d, intel.currency)} (${intel.spend_to_balance_pct}% salda)
${intel.bonus_pence_7d > 0 ? `- Premia otrzymana w tym tygodniu: ${formatMinor(intel.bonus_pence_7d, intel.currency)} (rodzic wyróżnił coś wyjątkowego — warto to uznać)` : ''}
${intel.is_sunday_scrambler ? `- Wzorzec: ${formalAddress} wykonuje większość zadań w ${intel.scrambler_day}. Wymagana jest poprawa planowania.` : ''}
${intel.consecutive_low_confidence >= 3 ? `WYZWALACZ INTEGRALNOŚCI: Wykryto ${intel.consecutive_low_confidence} kolejne przesłania zdjęć o niskiej wiarygodności. Dostarcz lekcję "Ciężka Praca vs. Skróty." Podejście: autorytatywne, ale konstruktywne. Rama: honor i jakość pracy są fundamentem wiarygodności. NIE używaj słów "oszustwo" ani "złapany." Powiedz: "Dane wskazują, że ostatnie dowody wymagają uwagi."` : ''}
${intel.batching_detected ? `WYZWALACZ GRUPOWANIA: Dane EXIF wskazują wykonanie wielu zadań w krótkim czasie. Dostarcz lekcję "Moc Małych Kroków." Rama: regularna praca buduje nawyki i wartość. Użyj analogii sadu — regularne podlewanie vs. jednorazowa powódź. Podejście autorytatywne: "Na podstawie danych, zalecana struktura to codzienna rutyna."` : ''}
${plBurnerNote}
${plStagnantNote}
${plInflationNote}
${plHoarderNote}
${plDefaultNote}
${plDeviceNote}
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
    reliability_rating:          intel.reliability_rating,
    velocity_7d_minor:           intel.velocity_7d,
    balance_minor:               intel.balance_minor,
    completed_7d:                intel.completed_7d,
    spend_to_balance_pct:        intel.spend_to_balance_pct,
    is_sunday_scrambler:         intel.is_sunday_scrambler,
    consecutive_low_confidence:  intel.consecutive_low_confidence,
    batching_detected:           intel.batching_detected,
    is_burner:                   intel.is_burner,
    is_stagnant:                 intel.is_stagnant,
    inflation_nudge:             intel.inflation_nudge,
    is_hoarder:                  intel.is_hoarder,
    overdue_chore_count:         intel.overdue_chore_count,
    distinct_ips_7d:             intel.distinct_ips_7d,
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
  {
    // Triggered when the child messages about effort, shortcuts, or fairness
    // while the integrity trigger is also active. Unlocks the effort-vs-reward module.
    slug:     '01-effort-vs-reward',
    pillar:   'LABOR_VALUE',
    keywords: /effort|shortcut|fair|worth it|cheat|lazy|hard work|deserve/i,
  },
  {
    // Triggered when the child messages about habits, routines, or cramming
    // while the batching trigger is active. Unlocks the patience/routine module.
    slug:     '07-the-patience-tree',
    pillar:   'LABOR_VALUE',
    keywords: /habit|routine|every day|daily|practice|batch|cram|all at once|consistent/i,
  },
  {
    // The Burner: balance-hit-zero → needs vs. wants lesson
    slug:     '04-needs-vs-wants',
    pillar:   'DELAYED_GRATIFICATION',
    keywords: /spend|spent|bought|buy|waste|gone|zero|empty|want|need|impulse/i,
  },
  {
    // The Default: overdue chores → good vs. bad debt lesson
    slug:     '12-good-vs-bad-debt',
    pillar:   'DELAYED_GRATIFICATION',
    keywords: /late|overdue|behind|owe|debt|missed|forget|procrastinat/i,
  },
  {
    // The Hoarder + Inflation Nudge: compound growth and inflation lessons share a pillar
    slug:     '13-compound-growth',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /compound|snowball|grow|interest|invest|save more|build up/i,
  },
  {
    slug:     '14-inflation',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /inflation|price|cost more|expensive|going up|shrink|worth less/i,
  },
  {
    // Device Swapper: digital safety lesson — social responsibility pillar (community/trust)
    slug:     '05-scams-digital-safety',
    pillar:   'SOCIAL_RESPONSIBILITY',
    keywords: /scam|hack|password|device|login|account|phish|steal|safe|secure/i,
  },
  {
    // Crypto Curious: keyword-only — no data signal needed
    slug:     '20-cryptocurrency',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /robux|skins|nft|crypto|bitcoin|ethereum|token|coin|digital money/i,
  },
  {
    // Social Pinger: keyword-only — social comparison trigger
    slug:     '18b-social-comparison',
    pillar:   'SOCIAL_RESPONSIBILITY',
    keywords: /how much did|how much does|earn more|earn less|compare|jealous|unfair|they get|why do they/i,
  },
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
  const [intel, familyCtx] = await Promise.all([
    getChildIntelligence(env.DB, auth.sub),
    getFamilyContext(env.DB, auth.family_id).catch(() => null),
  ])
  if (!intel) {
    return json({ error: 'Child profile not found' }, 404)
  }
  // Safe defaults if DB query failed
  const resolvedFamilyCtx: FamilyContext = familyCtx ?? {
    parenting_mode:   'single',
    child_count:      1,
    child_names:      [intel.display_name.split(' ')[0]],
    child_ids:        [intel.child_id],
    parent_names:     [],
    family_name:      'the family',
    co_parent_active: false,
    approval_skew:    null,
    has_shield:       false,
  }

  // ── Select Pillar & build system prompt ────────────────────────
  const pillar = selectPillar(intel, userMessage)
  const systemPrompt = buildSystemPrompt(intel, pillar, resolvedFamilyCtx)
  const dataPoints = buildDataPoints(intel, pillar)

  // ── Call GPT-4o-mini ───────────────────────────────────────────
  // Parent message is injected as a separate user-role turn (not embedded in
  // the system prompt) to isolate parent-supplied data from instructions and
  // prevent prompt injection via crafted message text.
  const chatMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]
  if (intel.has_parent_message && intel.parent_message) {
    const locale = intel.locale
    const prefix = locale === 'pl'
      ? 'Wiadomość od rodzica (priorytet — odnieś się do niej przed tematami finansowymi):'
      : 'Parent message (priority — acknowledge before any financial topic):'
    chatMessages.push({ role: 'user', content: `${prefix} ${intel.parent_message}` })
    chatMessages.push({ role: 'assistant', content: locale === 'pl' ? 'Rozumiem. Odpowiem na wiadomość rodzica.' : 'Understood. I will address the parent message first.' })
  }
  chatMessages.push({ role: 'user', content: userMessage })
  const traceId = crypto.randomUUID()
  const t0      = Date.now()

  let mentorReply: string
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:      'gpt-4o-mini',
        messages:   chatMessages,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`OpenAI ${res.status}`)

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
    }
    const latency = (Date.now() - t0) / 1000
    mentorReply   = data.choices[0]?.message?.content?.trim() ?? fallbackReply(intel.locale, intel.app_view)

    captureAiGeneration(env, {
      distinctId:     auth.sub,
      traceId,
      spanName:       'mentor_chat',
      model:          'gpt-4o-mini',
      provider:       'openai',
      input:          chatMessages,
      outputText:     mentorReply,
      latencySeconds: latency,
    })
  } catch (err) {
    const latency = (Date.now() - t0) / 1000
    captureAiGeneration(env, {
      distinctId:     auth.sub,
      traceId,
      spanName:       'mentor_chat',
      model:          'gpt-4o-mini',
      provider:       'openai',
      input:          chatMessages,
      latencySeconds: latency,
      isError:        true,
      errorMessage:   err instanceof Error ? err.message : String(err),
    })
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
