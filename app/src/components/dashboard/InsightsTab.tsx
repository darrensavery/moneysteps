/**
 * InsightsTab — Parent behavioural dashboard for each child.
 *
 * Layout order:
 *  1. Family Audit card (monthly, family-wide AI rollup)
 *  2. Mentor section    — carousel when > 1 card (weekly, per-child AI briefing —
 *                          kept adjacent to the Family Audit card above)
 *  3. Balance bar (available | allocated savings | lifetime)
 *  4. Sparkline cards  (Responsibility · Consistency · Savings)
 *  5. Effort preference tag
 *  6. Learning Lab     (learning_lab_enabled only)
 *  7. Progress Summary stats
 *
 * The period toggle ("This week / This month / All time") is rendered as a
 * fixed bar in the thumb zone, just above the bottom nav — not part of the
 * scrolling content order above.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { ChildRecord, InsightsData, MentorBriefing, TrialStatus } from '../../lib/api'
import { getInsights, formatCurrency, getChildNudges } from '../../lib/api'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { PremiumShell, MentorAvatar, ProBadge, AiDisclosurePill, injectPremiumStyles, MENTOR_COLORS } from '../ui/PremiumShell'
import { StickyActionBar } from '../ui/StickyActionBar'
import { SparklineCard } from './SparklineCard'
import { SparklineExpanded } from './SparklineExpanded'
import { LabSection } from './LabSection'
import { LearningLabUpsellCard } from './LearningLabUpsellCard'
import { AnimatedStat } from './AnimatedStat'
import { FamilyAuditCard } from './FamilyAuditCard'
import { tick } from '../../lib/haptics'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  familyId:    string
  child:       ChildRecord
  children:    ChildRecord[]
  trialStatus: TrialStatus | null
  onUpgrade:   () => void
}

type Period = 'week' | 'month' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  week:  'This week',
  month: 'This month',
  all:   'All time',
}

// ── Root component ────────────────────────────────────────────────────────────

export function InsightsTab({ familyId, child, trialStatus, onUpgrade }: Props) {
  const [selectedChild, setSelectedChild] = useState<ChildRecord>(child)
  const [period,        setPeriod]        = useState<Period>('month')
  const [data,          setData]          = useState<InsightsData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(false)

  // In-memory cache of already-fetched child/period combos for this session —
  // switching between children or timeline horizons you've already viewed
  // shows instantly instead of re-hitting the API and flashing the skeleton.
  // Cleared naturally on full page reload; never persisted across sessions.
  const cache = useRef<Map<string, InsightsData>>(new Map())

  useEffect(() => { injectPremiumStyles() }, [])
  useEffect(() => { setSelectedChild(child) }, [child.id])

  const load = useCallback(async (force = false) => {
    const key = `${selectedChild.id}:${period}`
    const cached = cache.current.get(key)
    if (cached && !force) {
      setData(cached)
      setLoading(false)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const d = await getInsights(familyId, selectedChild.id, period)
      cache.current.set(key, d)
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
    <div className="flex flex-col gap-4 pb-48">

      <FamilyAuditCard familyId={familyId} />

      {/* ── Period toggle — fixed in the thumb zone, just above the bottom nav ── */}
      <StickyActionBar>
        <div className="flex h-11 gap-1.5 bg-[var(--color-surface-alt)] rounded-xl p-1 shadow-lg border border-[var(--color-border)]">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`
                tap-target-44 flex-1 flex items-center justify-center rounded-lg text-[0.75rem] font-semibold transition-all duration-150 cursor-pointer
                ${period === p
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}
              `}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </StickyActionBar>

      {loading ? (
        <LoadingSkeleton period={period} />
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : data ? (
        <InsightsDashboard data={data} child={selectedChild} currency={currency} period={period} trialStatus={trialStatus} onUpgrade={onUpgrade} />
      ) : null}
    </div>
  )
}

// ── InsightsDashboard ─────────────────────────────────────────────────────────

function InsightsDashboard({
  data, child, currency, period, trialStatus, onUpgrade,
}: { data: InsightsData; child: ChildRecord; currency: string; period: 'week' | 'month' | 'all'; trialStatus: TrialStatus | null; onUpgrade: () => void }) {
  const [expandedMetric, setExpandedMetric] = useState<'responsibility' | 'consistency' | 'savings' | null>(null)
  const [childNudgeSummary, setChildNudgeSummary] = useState<string | null>(null)
  const childFirstName = child.display_name.split(' ')[0]

  useEffect(() => {
    getChildNudges(child.id)
      .then(r => {
        const all = [r.nudges.earn, r.nudges.money, r.nudges.goals].filter(Boolean)
        const recent = all.sort((a, b) => b!.created_at - a!.created_at)[0]
        setChildNudgeSummary(recent?.parent_summary ?? null)
      })
      .catch(() => {})
  }, [child.id])

  return (
    <div className="space-y-4">

      {/* Demo account banner */}
      {data.is_demo && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border"
          style={{
            background:  'color-mix(in srgb, var(--brand-accent) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--brand-accent) 30%, transparent)',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <p className="text-[0.6875rem] font-semibold" style={{ color: 'var(--brand-accent)' }}>
            Demo account — showing all-time data snapshot
          </p>
        </div>
      )}

      {/* 1. Premium Mentor section — kept adjacent to FamilyAuditCard above */}
      <MentorSection data={data} child={child} period={period} onViewTrends={() => {
        // Open the metric with the largest absolute trend delta
        const t = data.trends
        if (!t) { setExpandedMetric('consistency'); return }
        const candidates: ['responsibility' | 'consistency' | 'savings', number][] = [
          ['responsibility', Math.abs(t.responsibility?.delta ?? 0)],
          ['consistency',    Math.abs(t.consistency?.delta    ?? 0)],
          ['savings',        Math.abs(t.horizon?.delta        ?? 0)],
        ]
        candidates.sort((a, b) => b[1] - a[1])
        setExpandedMetric(candidates[0][0])
      }} />

      {/* 2. Balance bar */}
      <BalanceBar data={data} currency={currency} />

      {/* 3. Sparkline cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <SparklineCard
          label="Responsibility"
          value={data.is_discovery_phase ? null : data.first_time_pass_rate}
          trend={data.trends?.responsibility ?? null}
          points={data.sparkline_points?.responsibility ?? []}
          isDiscovery={data.is_discovery_phase}
          onExpand={() => setExpandedMetric('responsibility')}
          milestones={(data.milestone_markers ?? []).filter(m => m.metric === 'responsibility')}
        />
        <SparklineCard
          label="Consistency"
          value={data.is_discovery_phase ? null : data.consistency_score}
          trend={data.trends?.consistency ?? null}
          points={data.sparkline_points?.consistency ?? []}
          isDiscovery={data.is_discovery_phase}
          onExpand={() => setExpandedMetric('consistency')}
          milestones={(data.milestone_markers ?? []).filter(m => m.metric === 'consistency')}
        />
        <SparklineCard
          label="Savings"
          value={data.is_discovery_phase ? null : data.savings_consistency}
          trend={data.trends?.horizon ?? null}
          points={data.sparkline_points?.savings ?? []}
          isDiscovery={data.is_discovery_phase}
          onExpand={() => setExpandedMetric('savings')}
          milestones={(data.milestone_markers ?? []).filter(m => m.metric === 'savings')}
        />
      </div>

      {/* 4. Effort preference tag */}
      {!data.is_discovery_phase && data.effort_preference && (
        <EffortTag preference={data.effort_preference} child={child} />
      )}

      {/* 5. Child nudge summary — what the AI sent to the child this week */}
      {childNudgeSummary && (
        <div
          className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl"
          style={{ background: 'rgba(13,148,136,0.07)', border: '1px solid rgba(13,148,136,0.15)' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke={MENTOR_COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className="shrink-0 mt-0.5">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
          </svg>
          <p className="text-[0.6875rem] leading-relaxed" style={{ color: MENTOR_COLORS.label }}>
            <span className="font-semibold" style={{ color: MENTOR_COLORS.accent }}>
              Sent to {childFirstName} this week:
            </span>{' '}
            {childNudgeSummary}
          </p>
        </div>
      )}

      {/* 6. Learning Lab section (paid add-on only) */}
      {data.learning_lab_enabled ? (
        <LabSection
          childName={child.display_name.split(' ')[0]}
          currentModule={data.current_module}
          labModuleProgress={data.lab_module_progress ?? []}
          labActsCompleted={data.lab_acts_completed ?? 0}
          labTimeInvestedMinutes={data.lab_time_invested_minutes ?? 0}
          labLastActiveAt={data.lab_last_active_at ?? null}
          retentionScore={data.retention_score}
          completedSlugs={data.completed_module_slugs}
        />
      ) : (
        trialStatus?.is_expired && !trialStatus.has_ai_mentor && !trialStatus.has_shield && (
          <LearningLabUpsellCard
            childName={child.display_name.split(' ')[0]}
            onUpgrade={onUpgrade}
          />
        )
      )}

      {/* 6. Period stats */}
      <SupportingStats data={data} currency={currency} />

      {/* Expand modal */}
      <AnimatePresence>
        {expandedMetric && (() => {
          const metricPoints = {
            responsibility: data.sparkline_points?.responsibility ?? [],
            consistency:    data.sparkline_points?.consistency ?? [],
            savings:        data.sparkline_points?.savings ?? [],
          }[expandedMetric]

          const metricValue = {
            responsibility: data.first_time_pass_rate,
            consistency:    data.consistency_score,
            savings:        data.savings_consistency,
          }[expandedMetric]

          const metricMarkers = (data.milestone_markers ?? []).filter(m => m.metric === expandedMetric)

          return (
            <SparklineExpanded
              key={expandedMetric}
              label={expandedMetric.charAt(0).toUpperCase() + expandedMetric.slice(1)}
              value={metricValue}
              points={metricPoints}
              milestones={metricMarkers}
              choreEvents={data.chore_events ?? []}
              hasLearningLab={data.learning_lab_enabled}
              nextModuleTitle={data.current_module?.title ?? null}
              onClose={() => setExpandedMetric(null)}
            />
          )
        })()}
      </AnimatePresence>
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
          valueColor="text-success"
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
      <span className="text-[0.625rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</span>
      <span className={`text-[0.9375rem] font-extrabold tabular-nums leading-tight ${valueColor}`}>{value}</span>
    </div>
  )
}

// ── Mentor section — carousel when > 1 card ───────────────────────────────────

function MentorSection({ data, child, period, onViewTrends }: { data: InsightsData; child: ChildRecord; period: 'week' | 'month' | 'all'; onViewTrends: () => void }) {
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
        period={period}
        onViewTrends={onViewTrends}
      />
    )
  }

  // Multiple cards — horizontal carousel
  return <MentorCarousel cards={cards} child={child} name={name} data={data} period={period} onViewTrends={onViewTrends} />
}

// ── Carousel (for when multiple AI cards exist) ───────────────────────────────

function MentorCarousel({
  cards, child, name, data, period, onViewTrends,
}: {
  cards: { id: string; briefing: MentorBriefing; persona: 'coach' | 'accountant' | 'analyst' }[]
  child: ChildRecord
  name:  string
  data:  InsightsData
  period: 'week' | 'month' | 'all'
  onViewTrends: () => void
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
              period={period}
              onViewTrends={onViewTrends}
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

// ── Discovery card ────────────────────────────────────────────────────────────

function DiscoveryCard({ data, name }: { data: InsightsData; name: string }) {
  const briefing = data.discovery_briefing

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
                <span className="text-[0.625rem] font-bold tracking-widest uppercase" style={{ color: MENTOR_COLORS.label }}>
                  Orchard Mentor
                </span>
                {briefing?.source === 'ai'
                  ? <AiDisclosurePill />
                  : <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
              </div>
              <p className="text-[0.9375rem] font-extrabold tracking-tight" style={{ color: MENTOR_COLORS.heading }}>
                Getting to know {name}
              </p>
            </div>
          </div>
          {/* Progress ring — discovery state */}
          <div className="relative w-9 h-9 shrink-0">
            <svg width={36} height={36} viewBox="0 0 36 36">
              <circle cx={18} cy={18} r={13} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={4}/>
              <circle cx={18} cy={18} r={13} fill="none" stroke={MENTOR_COLORS.accent} strokeWidth={4}
                strokeDasharray={`${Math.round((Math.min(data.all_time_completed, 3) / 3) * 82)} 82`}
                strokeLinecap="round"
                transform="rotate(-90 18 18)"
              />
              <text x={18} y={22} textAnchor="middle" fontSize={8} fontWeight={700} fill={MENTOR_COLORS.accent}>
                {data.all_time_completed}/3
              </text>
            </svg>
          </div>
          <ProBadge />
        </div>

        {/* Body — advisor prose style */}
        <p className="text-[0.8125rem] leading-relaxed mb-4" style={{ color: MENTOR_COLORS.body }}>
          {briefing
            ? briefing.intro
            : <>I'm building a picture of how <span style={{ color: '#e2f5ee', fontWeight: 600 }}>{name}</span> approaches their responsibilities.</>}
        </p>

        {/* Action list */}
        {briefing && briefing.actions.length > 0 && (
          <div className="space-y-2.5 mb-4">
            {briefing.actions.map((text, i) => (
              <DiscoveryAction key={i} step={String(i + 1).padStart(2, '0')} text={text} />
            ))}
          </div>
        )}

      </div>
    </PremiumShell>
  )
}

function DiscoveryAction({ step, text }: { step: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 text-[0.5625rem] font-black tracking-wider tabular-nums mt-0.5"
            style={{ color: MENTOR_COLORS.accent }}>
        {step}
      </span>
      <p className="text-[0.75rem] leading-relaxed" style={{ color: MENTOR_COLORS.body }}>{text}</p>
    </div>
  )
}

// ── Live Briefing Card ────────────────────────────────────────────────────────

const PERSONA_CONFIG = {
  coach:      { label: 'Coach',      accent: MENTOR_COLORS.accent, accentDim: 'rgba(13,148,136,0.15)'  },
  accountant: { label: 'Accountant', accent: '#d4a017', accentDim: 'rgba(212,160,23,0.15)'  },
  analyst:    { label: 'Analyst',    accent: '#8b5cf6', accentDim: 'rgba(139,92,246,0.15)'  },
}

const PERIOD_NOTE_LABEL: Record<'week' | 'month' | 'all', string> = {
  week:  "This Week's Coaching Note",
  month: "This Month's Coaching Note",
  all:   "All-Time Coaching Note",
}

function LiveBriefingCard({
  briefing, child, name, persona, isTeenMode, period, onViewTrends,
}: {
  briefing:      MentorBriefing
  child:         ChildRecord
  name:          string
  persona:       'coach' | 'accountant' | 'analyst'
  isTeenMode:    boolean
  period:        'week' | 'month' | 'all'
  onViewTrends:  () => void
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const animate = briefing.source === 'ai'
  const p = PERSONA_CONFIG[persona]

  if (dismissed) return null

  return (
    <>
      <PremiumShell>
        <div className="px-4 pt-5 pb-4 relative z-10 space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <MentorAvatar accent={p.accent} />
              <div>
                <div className="flex items-center flex-wrap gap-2 mb-0.5">
                  <span className="text-[0.625rem] font-bold tracking-widest uppercase shrink-0 whitespace-nowrap" style={{ color: MENTOR_COLORS.label }}>
                    Orchard Mentor
                  </span>
                  {/* Persona lens pill */}
                  <span className="text-[0.5625rem] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
                        style={{ background: p.accentDim, color: p.accent }}>
                    {p.label}
                  </span>
                  {/* EU AI Act Article 50 disclosure — visible on every AI-generated card */}
                  {briefing.source !== 'fallback' && <AiDisclosurePill />}
                </div>
                <p className="text-[0.9375rem] font-extrabold tracking-tight" style={{ color: MENTOR_COLORS.heading }}>
                  {PERIOD_NOTE_LABEL[period]}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ProBadge />
              <button
                onClick={() => { void tick(); setDismissed(true) }}
                aria-label="Dismiss"
                className="tap-target-44 w-6 h-6 flex items-center justify-center rounded-full text-white/30 hover:text-white/60 cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
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
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={MENTOR_COLORS.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span className="text-[0.5625rem] font-black uppercase tracking-wider" style={{ color: MENTOR_COLORS.accent }}>
                Recommended action
              </span>
            </div>
            <p className="text-[0.8125rem] leading-relaxed" style={{ color: '#e2f5ee' }}>
              {briefing.the_nudge}
            </p>
          </div>

          {/* CTA row */}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => setModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[0.8125rem] font-bold cursor-pointer transition-opacity hover:opacity-85 active:opacity-70"
              style={{ background: 'linear-gradient(135deg, #0d9488, #0a7c70)', color: '#fff' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <path d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49"/>
              </svg>
              Share with {name}
            </button>
            <button
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[0.8125rem] font-semibold cursor-pointer transition-opacity hover:opacity-85"
              style={{ background: 'rgba(255,255,255,0.07)', color: MENTOR_COLORS.body, border: '1px solid rgba(255,255,255,0.1)' }}
              onClick={onViewTrends}
            >
              View trends
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>

          {/* Pro attribution footer */}
          <p className="text-[0.625rem] text-center" style={{ color: 'rgba(107,158,135,0.7)' }}>
            ✦ Orchard Pro · {briefing.source !== 'fallback' ? 'AI-generated coaching note' : 'Coaching note'}
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

  useAndroidBack(true, onClose)

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
            <p className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-0.5">Share coaching note</p>
            <p className="text-[0.9375rem] font-extrabold text-[var(--color-text)] tracking-tight">Message for {name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-4 py-3.5">
          <div
            className="rounded-xl px-3.5 py-3 text-[0.8125rem] leading-relaxed text-[var(--color-text)] border border-[var(--color-border)]"
            style={{ background: 'color-mix(in_srgb, var(--brand-primary) 4%, var(--color-surface))' }}
          >
            {message}
          </div>
          <p className="text-[0.625rem] text-[var(--color-text-muted)] mt-2 text-center">
            Based on: "{briefing.the_nudge.length > 72 ? briefing.the_nudge.slice(0, 72) + '…' : briefing.the_nudge}"
          </p>
        </div>

        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[0.8125rem] font-semibold text-white cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: copied ? '#16a34a' : 'var(--brand-primary)' }}
          >
            {copied ? (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Copy Message</>
            )}
          </button>
          <p className="text-[0.625rem] text-[var(--color-text-muted)] text-center">✦ Drafted by your Orchard Mentor</p>
        </div>
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
        <p className={`text-[0.75rem] font-bold ${cfg.text} uppercase tracking-wide`}>{cfg.label}</p>
        <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{cfg.description}</p>
      </div>
    </div>
  )
}

// ── Supporting stats ──────────────────────────────────────────────────────────

function planningHorizonLabel(value: number | null): string {
  if (value === null || value === 0) return '—'
  if (value <= 33)  return 'Day-to-day'
  if (value <= 60)  return 'Short-term · Building stamina'
  if (value <= 80)  return 'Medium-term'
  return 'Long-term thinker'
}

function SupportingStats({ data, currency }: { data: InsightsData; currency: string }) {
  const choreDelta = data.trends?.consistency?.delta ?? null

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
          Progress Summary
        </p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border)]">
        <div className="px-4 py-3">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Chores done</p>
          <p className="text-[0.9375rem] font-bold text-[var(--color-text)] tabular-nums mt-0.5 flex items-baseline gap-1">
            <AnimatedStat value={String(data.tasks_completed)}/>
            {choreDelta !== null && choreDelta > 0 && (
              <span className="text-[0.625rem] font-bold text-success">↑ {choreDelta}</span>
            )}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Needed revision</p>
          <p className="text-[0.9375rem] font-bold text-[var(--color-text)] tabular-nums mt-0.5">
            <AnimatedStat value={String(data.tasks_revised)}/>
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Earned</p>
          <p className="text-[0.9375rem] font-bold text-[var(--color-text)] tabular-nums mt-0.5">
            <AnimatedStat value={formatCurrency(data.total_earned_pence, currency)}/>
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Saved to goals</p>
          <p className="text-[0.9375rem] font-bold text-[var(--color-text)] tabular-nums mt-0.5">
            <AnimatedStat value={formatCurrency(data.total_saved_pence, currency)}/>
          </p>
        </div>
        <div className="px-4 py-3 col-span-2">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] uppercase tracking-wide">Planning horizon</p>
          <p className="text-[0.8125rem] font-semibold text-[var(--color-text-muted)] mt-0.5">
            {planningHorizonLabel(data.planning_horizon)}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

const LOADING_COPY: Record<Period, string> = {
  week:  "Analyzing this week's chores…",
  month: "Analyzing this month's activity…",
  all:   'Analyzing all-time activity…',
}

function LoadingSkeleton({ period }: { period: Period }) {
  return (
    <div className="space-y-4 animate-pulse">
      {/* "Behind the Button": name what's actually happening (the AI
          briefing being generated/fetched) instead of a bare pulse. */}
      <p className="text-[0.75rem] font-medium text-[var(--color-text-muted)] text-center">
        {LOADING_COPY[period]}
      </p>
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
      <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">Unable to load insights</p>
      <p className="text-[0.75rem] text-[var(--color-text-muted)]">Check your connection and try again.</p>
      <button onClick={onRetry} className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
        Retry
      </button>
    </div>
  )
}
