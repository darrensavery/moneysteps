/**
 * InsightsTab — Parent behavioural dashboard for each child.
 *
 * Layout order:
 *  1. Child selector (multi-child only)
 *  2. Period toggle
 *  3. Balance bar (available | allocated savings | lifetime)
 *  4. KPI gauges (Responsibility · Consistency · Savings)
 *  5. Effort preference tag
 *  6. PremiumMentorCard(s) — carousel when > 1 card
 *  7. Period breakdown stats
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChildRecord, InsightsData, TrendEntry, MentorBriefing } from '../../lib/api'
import { getInsights, formatCurrency } from '../../lib/api'
import { AvatarSVG } from '../../lib/avatars'

// ── Premium Shell CSS — injected once ────────────────────────────────────────
// Animated gradient border uses a pseudo-element trick via a wrapper div +
// a conic-gradient that rotates. Because Tailwind can't do this, we inject
// a <style> block on first render.

const PREMIUM_STYLES = `
@keyframes premiumBorderSpin {
  0%   { --border-angle: 0deg; }
  100% { --border-angle: 360deg; }
}
@property --border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.premium-shell {
  --border-angle: 0deg;
  animation: premiumBorderSpin 4s linear infinite;
  background:
    linear-gradient(#0f1a14, #0f1a14) padding-box,
    conic-gradient(
      from var(--border-angle),
      #0d9488 0%,
      #d4a017 30%,
      #0d9488 60%,
      #d4a017 80%,
      #0d9488 100%
    ) border-box;
  border: 1.5px solid transparent;
}
.premium-shell-static {
  background:
    linear-gradient(#0f1a14, #0f1a14) padding-box,
    linear-gradient(135deg, #0d9488 0%, #d4a017 50%, #0d9488 100%) border-box;
  border: 1.5px solid transparent;
}
@media (prefers-reduced-motion: reduce) {
  .premium-shell { animation: none; }
  .premium-shell { background:
    linear-gradient(#0f1a14, #0f1a14) padding-box,
    linear-gradient(135deg, #0d9488 0%, #d4a017 50%, #0d9488 100%) border-box;
  }
}
`

let stylesInjected = false
function injectPremiumStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = PREMIUM_STYLES
  document.head.appendChild(el)
  stylesInjected = true
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  familyId: string
  child:    ChildRecord
  children: ChildRecord[]
}

type Period = 'week' | 'month' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  week:  'This week',
  month: 'This month',
  all:   'All time',
}

// ── Root component ────────────────────────────────────────────────────────────

export function InsightsTab({ familyId, child, children }: Props) {
  const [selectedChild, setSelectedChild] = useState<ChildRecord>(child)
  const [period,        setPeriod]        = useState<Period>('week')
  const [data,          setData]          = useState<InsightsData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(false)

  useEffect(() => { injectPremiumStyles() }, [])
  useEffect(() => { setSelectedChild(child) }, [child.id])

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const d = await getInsights(familyId, selectedChild.id, period)
      setData(d)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [familyId, selectedChild.id, period])

  useEffect(() => { load() }, [load])

  const currency = 'GBP'

  return (
    <div className="space-y-4">

      {/* ── Child selector ── */}
      {children.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          {children.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedChild(c)}
              className={`
                shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold
                transition-colors duration-100 cursor-pointer border
                ${selectedChild.id === c.id
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:opacity-80'}
              `}
            >
              <AvatarSVG id={c.avatar_id ?? 'bot'} size={18} />
              {c.display_name}
            </button>
          ))}
        </div>
      )}

      {/* ── Period toggle ── */}
      <div className="flex gap-1.5 bg-[var(--color-surface-alt)] rounded-xl p-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`
              flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer
              ${period === p
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}
            `}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : data ? (
        <InsightsDashboard data={data} child={selectedChild} currency={currency} />
      ) : null}
    </div>
  )
}

// ── InsightsDashboard ─────────────────────────────────────────────────────────

function InsightsDashboard({
  data, child, currency,
}: { data: InsightsData; child: ChildRecord; currency: string }) {
  return (
    <div className="space-y-4">

      {/* 1. Balance bar */}
      <BalanceBar data={data} currency={currency} />

      {/* 2. KPI gauges — at-a-glance before the AI narrative */}
      <div className="grid grid-cols-3 gap-2.5">
        <GaugeCard
          label="Responsibility"
          sublabel="First-time pass rate"
          value={data.is_discovery_phase ? null : data.first_time_pass_rate}
          isDiscovery={data.is_discovery_phase}
          color="var(--brand-primary)"
          trend={data.trends?.responsibility ?? null}
        />
        <GaugeCard
          label="Consistency"
          sublabel="Weekly volume"
          value={data.is_discovery_phase ? null : data.consistency_score}
          isDiscovery={data.is_discovery_phase}
          color="#f59e0b"
          trend={data.trends?.consistency ?? null}
        />
        <GaugeCard
          label="Savings"
          sublabel="Of income saved"
          value={data.is_discovery_phase ? null : data.savings_consistency}
          isDiscovery={data.is_discovery_phase}
          color="#10b981"
          trend={data.trends?.horizon ?? null}
        />
      </div>

      {/* 3. Effort preference tag */}
      {!data.is_discovery_phase && data.effort_preference && (
        <EffortTag preference={data.effort_preference} child={child} />
      )}

      {/* 4. Premium Mentor section */}
      <MentorSection data={data} child={child} />

      {/* 5. Period stats */}
      <SupportingStats data={data} currency={currency} />
    </div>
  )
}

// ── Balance bar ───────────────────────────────────────────────────────────────

function BalanceBar({ data, currency }: { data: InsightsData; currency: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl px-4 py-3.5">
      <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
        <BalanceStat
          label="Available"
          value={formatCurrency(data.available_balance_pence, currency)}
          valueColor="text-[var(--brand-primary)]"
          position="left"
        />
        <BalanceStat
          label="Allocated Savings"
          value={formatCurrency(data.goals_locked_pence, currency)}
          valueColor="text-[#10b981]"
          position="center"
        />
        <BalanceStat
          label="Lifetime Earned"
          value={formatCurrency(data.lifetime_earned_pence, currency)}
          valueColor="text-[var(--color-text)]"
          position="right"
        />
      </div>
    </div>
  )
}

function BalanceStat({
  label, value, valueColor, position,
}: { label: string; value: string; valueColor: string; position: 'left' | 'center' | 'right' }) {
  const align = position === 'left' ? 'items-start' : position === 'right' ? 'items-end' : 'items-center'
  return (
    <div className={`flex flex-col gap-0.5 px-3 first:pl-0 last:pr-0 ${align}`}>
      <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</span>
      <span className={`text-[15px] font-extrabold tabular-nums leading-tight ${valueColor}`}>{value}</span>
    </div>
  )
}

// ── Mentor section — carousel when > 1 card ───────────────────────────────────

function MentorSection({ data, child }: { data: InsightsData; child: ChildRecord }) {
  const name = child.display_name.split(' ')[0]

  // Discovery phase: single initialisation card
  if (data.is_discovery_phase) {
    return <DiscoveryCard data={data} name={name} />
  }

  // Live phase: single briefing card (carousel-ready: wrap in array)
  const cards = data.mentor_briefing
    ? [{ id: 'coach', briefing: data.mentor_briefing, persona: 'coach' as const }]
    : []

  if (cards.length === 0) {
    return <PremiumShell><BriefingSkeleton /></PremiumShell>
  }

  // Single card — no carousel chrome
  if (cards.length === 1) {
    return (
      <LiveBriefingCard
        briefing={cards[0].briefing}
        child={child}
        name={name}
        persona="coach"
        isTeenMode={data.velocity_context?.mode === 'professional'}
      />
    )
  }

  // Multiple cards — horizontal carousel
  return <MentorCarousel cards={cards} child={child} name={name} data={data} />
}

// ── Carousel (for when multiple AI cards exist) ───────────────────────────────

function MentorCarousel({
  cards, child, name, data,
}: {
  cards: { id: string; briefing: MentorBriefing; persona: 'coach' | 'accountant' | 'analyst' }[]
  child: ChildRecord
  name:  string
  data:  InsightsData
}) {
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  function scrollTo(idx: number) {
    setActive(idx)
    trackRef.current?.children[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  return (
    <div className="space-y-2">
      {/* Scroll track */}
      <div
        ref={trackRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory"
        onScroll={e => {
          const el = e.currentTarget
          const idx = Math.round(el.scrollLeft / el.clientWidth)
          setActive(idx)
        }}
      >
        {cards.map(card => (
          <div key={card.id} className="snap-center shrink-0 w-full">
            <LiveBriefingCard
              briefing={card.briefing}
              child={child}
              name={name}
              persona={card.persona}
              isTeenMode={data.velocity_context?.mode === 'professional'}
            />
          </div>
        ))}
      </div>
      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5">
        {cards.map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            className={`rounded-full transition-all duration-200 cursor-pointer ${
              i === active ? 'w-4 h-1.5 bg-[var(--brand-primary)]' : 'w-1.5 h-1.5 bg-[var(--color-border)]'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ── Premium Shell wrapper ─────────────────────────────────────────────────────

function PremiumShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-2xl premium-shell overflow-hidden"
         style={{ boxShadow: '0 0 32px rgba(13,148,136,0.15), 0 4px 16px rgba(0,0,0,0.3)' }}>
      {/* Radial glow layer */}
      <div className="absolute inset-0 pointer-events-none"
           style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(13,148,136,0.12) 0%, transparent 70%)' }} />
      {children}
    </div>
  )
}

// ── Discovery card ────────────────────────────────────────────────────────────

function DiscoveryCard({ data, name }: { data: InsightsData; name: string }) {
  return (
    <PremiumShell>
      <div className="px-4 pt-5 pb-4 relative z-10">

        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {/* Mentor avatar */}
            <MentorAvatar />
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#9ca3af' }}>
                  Orchard Mentor
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              </div>
              <p className="text-[15px] font-extrabold tracking-tight" style={{ color: '#f0fdf4' }}>
                Getting to know {name}
              </p>
            </div>
          </div>
          <ProBadge />
        </div>

        {/* Body — advisor prose style */}
        <p className="text-[13px] leading-relaxed mb-4" style={{ color: '#a7c4b5' }}>
          I'm building a picture of how <span style={{ color: '#e2f5ee', fontWeight: 600 }}>{name}</span> approaches their responsibilities.
          Once I've seen a few more completed tasks, I'll have enough to give you genuinely useful, specific coaching — not generic tips.
        </p>
        <p className="text-[12px] leading-relaxed mb-4" style={{ color: '#6b9e87' }}>
          To speed this up, try these three things this week:
        </p>

        {/* Action list */}
        <div className="space-y-2.5 mb-4">
          <DiscoveryAction
            step="01"
            text={`Assign 2–3 small daily tasks so I can spot ${name}'s consistency patterns.`}
          />
          <DiscoveryAction
            step="02"
            text={`Help ${name} set a savings goal — even a small one — so I can track their planning instincts.`}
          />
          <DiscoveryAction
            step="03"
            text="Turn on photo check-in for one task, so I can measure follow-through accurately."
          />
        </div>

        {/* Baseline progress */}
        <div className="pt-3.5 border-t" style={{ borderColor: 'rgba(13,148,136,0.2)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold" style={{ color: '#6b9e87' }}>Baseline progress</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: '#a7c4b5' }}>
              {data.all_time_completed} / 3 tasks
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.round((data.all_time_completed / 3) * 100))}%`,
                background: 'linear-gradient(90deg, #0d9488, #d4a017)',
              }}
            />
          </div>
        </div>

      </div>
    </PremiumShell>
  )
}

function DiscoveryAction({ step, text }: { step: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 text-[9px] font-black tracking-wider tabular-nums mt-0.5"
            style={{ color: '#0d9488' }}>
        {step}
      </span>
      <p className="text-[12px] leading-relaxed" style={{ color: '#a7c4b5' }}>{text}</p>
    </div>
  )
}

// ── Live Briefing Card ────────────────────────────────────────────────────────

const PERSONA_CONFIG = {
  coach:      { label: 'Coach',      accent: '#0d9488', accentDim: 'rgba(13,148,136,0.15)'  },
  accountant: { label: 'Accountant', accent: '#d4a017', accentDim: 'rgba(212,160,23,0.15)'  },
  analyst:    { label: 'Analyst',    accent: '#8b5cf6', accentDim: 'rgba(139,92,246,0.15)'  },
}

function LiveBriefingCard({
  briefing, child, name, persona, isTeenMode,
}: {
  briefing:   MentorBriefing
  child:      ChildRecord
  name:       string
  persona:    'coach' | 'accountant' | 'analyst'
  isTeenMode: boolean
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const animate = briefing.source === 'ai'
  const p = PERSONA_CONFIG[persona]

  return (
    <>
      <PremiumShell>
        <div className="px-4 pt-5 pb-4 relative z-10 space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <MentorAvatar accent={p.accent} />
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#6b9e87' }}>
                    Orchard Mentor
                  </span>
                  {/* Persona lens pill */}
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: p.accentDim, color: p.accent }}>
                    {p.label}
                  </span>
                </div>
                <p className="text-[15px] font-extrabold tracking-tight" style={{ color: '#f0fdf4' }}>
                  This Week's Coaching Note
                </p>
              </div>
            </div>
            <ProBadge />
          </div>

          {/* Advisory prose — Problem → Insight → Action, no section headers */}
          <div className="space-y-2.5">
            <TypewriterText
              text={briefing.observation}
              animate={animate}
              delay={0}
              style={{ fontSize: 13, lineHeight: 1.65, color: '#c4ddd4', fontWeight: 500 }}
            />
            <TypewriterText
              text={briefing.behavioral_root}
              animate={animate}
              delay={animate ? briefing.observation.length * 18 + 300 : 0}
              style={{ fontSize: 13, lineHeight: 1.65, color: '#8ab8a4' }}
            />
          </div>

          {/* The Nudge — highlighted action block */}
          <div className="rounded-xl px-3.5 py-3"
               style={{ background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.2)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              {/* Sparkle icon */}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#0d9488' }}>
                Recommended action
              </span>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: '#e2f5ee' }}>
              {briefing.the_nudge}
            </p>
          </div>

          {/* CTA row */}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => setModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer transition-opacity hover:opacity-85 active:opacity-70"
              style={{ background: 'linear-gradient(135deg, #0d9488, #0a7c70)', color: '#fff' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <path d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49"/>
              </svg>
              Share with {name}
            </button>
            <button
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition-opacity hover:opacity-85"
              style={{ background: 'rgba(255,255,255,0.07)', color: '#a7c4b5', border: '1px solid rgba(255,255,255,0.1)' }}
              onClick={() => {/* future: deep-link to relevant tab */}}
            >
              View trends
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>

          {/* Pro attribution footer */}
          <p className="text-[10px] text-center" style={{ color: 'rgba(107,158,135,0.7)' }}>
            ✦ Orchard Pro · AI-generated coaching note
          </p>

        </div>
      </PremiumShell>

      {modalOpen && (
        <ShareNudgeModal
          briefing={briefing}
          child={child}
          isTeenMode={isTeenMode}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}

// ── Mentor Avatar ─────────────────────────────────────────────────────────────

function MentorAvatar({ accent = '#0d9488' }: { accent?: string }) {
  return (
    <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
         style={{
           background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15), transparent 60%), ${accent}22`,
           border: `1.5px solid ${accent}55`,
         }}>
      {/* Leaf / spark mark */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
      </svg>
    </div>
  )
}

// ── PRO badge ─────────────────────────────────────────────────────────────────

function ProBadge() {
  return (
    <span className="shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
          style={{
            background: 'rgba(212,160,23,0.15)',
            color:      '#d4a017',
            border:     '1px solid rgba(212,160,23,0.3)',
            letterSpacing: '0.1em',
          }}>
      ✦ Pro
    </span>
  )
}

// ── Typewriter text ───────────────────────────────────────────────────────────

function TypewriterText({
  text, animate, delay = 0, style,
}: { text: string; animate: boolean; delay?: number; style?: React.CSSProperties }) {
  const [displayed, setDisplayed] = useState(animate ? '' : text)
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!animate) { setDisplayed(text); return }
    setDisplayed('')
    let i = 0
    const CHAR_DELAY = 16

    const start = setTimeout(() => {
      const tick = () => {
        i++
        setDisplayed(text.slice(0, i))
        if (i < text.length) {
          frameRef.current = setTimeout(tick, CHAR_DELAY)
        }
      }
      frameRef.current = setTimeout(tick, CHAR_DELAY)
    }, delay)

    return () => {
      clearTimeout(start)
      if (frameRef.current) clearTimeout(frameRef.current)
    }
  }, [text, animate, delay])

  return <p style={style}>{displayed}<span style={{ opacity: 0 }}>.</span></p>
}

// ── Briefing skeleton ─────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="px-4 pt-5 pb-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="space-y-1.5">
          <div className="h-2 w-24 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-3.5 w-40 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="space-y-2">
        {[1, 0.8, 0.9, 0.6].map((w, i) => (
          <div key={i} className="h-2.5 rounded-full" style={{ width: `${w * 100}%`, background: 'rgba(255,255,255,0.06)' }} />
        ))}
      </div>
      <div className="h-16 rounded-xl" style={{ background: 'rgba(13,148,136,0.08)' }} />
      <div className="h-10 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

// ── Share Nudge Modal ─────────────────────────────────────────────────────────

function ShareNudgeModal({
  briefing, child, isTeenMode, onClose,
}: {
  briefing:   MentorBriefing
  child:      ChildRecord
  isTeenMode: boolean
  onClose:    () => void
}) {
  const name = child.display_name.split(' ')[0]
  const [copied, setCopied] = useState(false)

  const message = isTeenMode
    ? `Hey ${name}, your consistency this week is building real momentum. We're thinking of introducing a bonus for your next streak — it tracks first-time completions, which is the skill that matters most long-term. Worth a conversation? 🧭`
    : `Hey ${name}! Every task you finish is a step forward — you might not notice it day to day, but the effort is adding up. We spotted some great work this week. Keep going! 🌱`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* silent */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
          <div>
            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-0.5">Share coaching note</p>
            <p className="text-[15px] font-extrabold text-[var(--color-text)] tracking-tight">Message for {name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-4 py-3.5">
          <div
            className="rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-[var(--color-text)] border border-[var(--color-border)]"
            style={{ background: 'color-mix(in_srgb, var(--brand-primary) 4%, var(--color-surface))' }}
          >
            {message}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-2 text-center">
            Based on: "{briefing.the_nudge.length > 72 ? briefing.the_nudge.slice(0, 72) + '…' : briefing.the_nudge}"
          </p>
        </div>

        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold text-white cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: copied ? '#16a34a' : 'var(--brand-primary)' }}
          >
            {copied ? (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Copy Message</>
            )}
          </button>
          <p className="text-[10px] text-[var(--color-text-muted)] text-center">✦ Drafted by your Orchard Mentor</p>
        </div>
      </div>
    </div>
  )
}

// ── Gauge card ────────────────────────────────────────────────────────────────

function TrendIndicator({ trend }: { trend: TrendEntry | null }) {
  if (!trend || trend.direction === null) return null
  if (trend.direction === 'up') return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  )
  if (trend.direction === 'down') return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7"/>
    </svg>
  )
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/>
    </svg>
  )
}

function GaugeCard({
  label, sublabel, value, isDiscovery, color, trend,
}: {
  label: string; sublabel: string; value: number | null
  isDiscovery: boolean; color: string; trend: TrendEntry | null
}) {
  const size = 72, stroke = 7
  const r = (size - stroke) / 2
  const cx = size / 2, cy = size / 2
  const arcDeg = 220, startAngle = 160, endAngle = startAngle + arcDeg

  function polarToCartesian(angle: number) {
    const rad = (angle * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  function arcPath(fromDeg: number, toDeg: number) {
    const s = polarToCartesian(fromDeg), e = polarToCartesian(toDeg)
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${e.x} ${e.y}`
  }

  const filled   = isDiscovery || value === null ? 0 : value
  const fillEnd  = startAngle + (arcDeg * filled) / 100
  const trackPath = arcPath(startAngle, endAngle)
  const fillPath  = filled > 0 ? arcPath(startAngle, fillEnd) : null
  const displayText = value === null ? '—' : `${value}%`
  const subText = isDiscovery ? 'Establishing…' : value === null ? 'No data' : null

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-3 flex flex-col items-center gap-1.5">
      <div className="relative">
        <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
          <path d={trackPath} fill="none" stroke="var(--color-surface-alt)" strokeWidth={stroke} strokeLinecap="round" />
          {fillPath && !isDiscovery && (
            <path d={fillPath} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`text-[14px] font-extrabold tabular-nums leading-none ${isDiscovery ? 'text-[var(--color-text-muted)]' : ''}`}
            style={!isDiscovery && value !== null ? { color } : undefined}
          >
            {displayText}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-1">
          <p className="text-[11px] font-bold text-[var(--color-text)] leading-tight">{label}</p>
          {!isDiscovery && <TrendIndicator trend={trend} />}
        </div>
        <p className="text-[9.5px] text-[var(--color-text-muted)] leading-tight mt-0.5">{subText ?? sublabel}</p>
      </div>
    </div>
  )
}

// ── Effort preference tag ─────────────────────────────────────────────────────

function EffortTag({ preference, child }: { preference: 'high_yield' | 'steady'; child: ChildRecord }) {
  const name = child.display_name.split(' ')[0]
  const cfg = preference === 'high_yield'
    ? {
        label:       'High-Yield Preference',
        description: `${name} consistently picks higher-value tasks. Strong work ethic — keep an eye out for burnout during long streaks.`,
        bg:          'bg-[color-mix(in_srgb,#f59e0b_10%,transparent)]',
        border:      'border-[color-mix(in_srgb,#f59e0b_25%,transparent)]',
        text:        'text-amber-700 dark:text-amber-400',
        dot:         'bg-amber-400',
      }
    : {
        label:       'Steady Preference',
        description: `${name} gravitates toward routine tasks. Reliable and consistent — try introducing a stretch goal to build ambition.`,
        bg:          'bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]',
        border:      'border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)]',
        text:        'text-[var(--brand-primary)]',
        dot:         'bg-[var(--brand-primary)]',
      }

  return (
    <div className={`${cfg.bg} ${cfg.border} border rounded-2xl px-4 py-3 flex items-start gap-3`}>
      <div className={`shrink-0 w-2 h-2 rounded-full ${cfg.dot} mt-1.5`} />
      <div>
        <p className={`text-[12px] font-bold ${cfg.text} uppercase tracking-wide`}>{cfg.label}</p>
        <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{cfg.description}</p>
      </div>
    </div>
  )
}

// ── Supporting stats ──────────────────────────────────────────────────────────

function SupportingStats({ data, currency }: { data: InsightsData; currency: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Period breakdown</p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border)]">
        <StatCell label="Chores completed"  value={String(data.tasks_completed)} />
        <StatCell label="Needed revision"   value={String(data.tasks_revised)} />
        <StatCell label="Earned"            value={formatCurrency(data.total_earned_pence, currency)} />
        <StatCell label="Spent"             value={formatCurrency(data.total_spent_pence,  currency)} />
        <StatCell label="Saved to goals"    value={formatCurrency(data.total_saved_pence,  currency)} />
        <StatCell label="Planning horizon"  value={data.planning_horizon !== null ? `${data.planning_horizon}%` : '—'} />
      </div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{label}</p>
      <p className="text-[15px] font-bold text-[var(--color-text)] tabular-nums mt-0.5">{value}</p>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl h-16" />
      <div className="grid grid-cols-3 gap-2.5">
        {[0,1,2].map(i => <div key={i} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl h-28" />)}
      </div>
      <div className="rounded-2xl h-56" style={{ background: 'rgba(15,26,20,0.8)', border: '1.5px solid rgba(13,148,136,0.3)' }} />
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl h-40" />
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 text-center space-y-3">
      <p className="text-[14px] font-semibold text-[var(--color-text)]">Unable to load insights</p>
      <p className="text-[12px] text-[var(--color-text-muted)]">Check your connection and try again.</p>
      <button onClick={onRetry} className="text-[13px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
        Retry
      </button>
    </div>
  )
}
