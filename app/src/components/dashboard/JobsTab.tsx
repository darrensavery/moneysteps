import { useState, useEffect, useCallback } from 'react'
import type { Chore, Suggestion, Plan, ChildRecord } from '../../lib/api'
import {
  getChores, archiveChore, restoreChore,
  getSuggestions, rejectSuggestion, getPlans, createPlan, deletePlan,
  formatCurrency, getMondayISO,
} from '../../lib/api'
import { CreateChoreSheet } from './CreateChoreSheet'
import { RateGuideSheet } from './RateGuideSheet'
import { PremiumShell, MentorAvatar, ProBadge, injectPremiumStyles } from '../ui/PremiumShell'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const CURRENCY = 'GBP'

// Maps UI label → D1 frequency value
const FREQUENCY_OPTIONS: { label: string; value: string; recurring: boolean }[] = [
  { label: 'One-off',          value: 'as_needed',   recurring: false },
  { label: 'Daily',            value: 'daily',        recurring: true  },
  { label: 'Weekly',           value: 'weekly',       recurring: true  },
  { label: 'Fortnightly',      value: 'bi_weekly',    recurring: true  },
  { label: 'Monthly',          value: 'monthly',      recurring: true  },
  { label: 'School Days',      value: 'school_days',  recurring: true  },
]

interface Props {
  familyId: string
  child: ChildRecord
  children: ChildRecord[]
}

export function ChoresTab({ familyId, child, children }: Props) {
  const [chores, setChores]           = useState<Chore[]>([])
  const [archived, setArchived]       = useState<Chore[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [plans, setPlans]             = useState<Plan[]>([])
  const [loading, setLoading]         = useState(true)
  const [showSheet, setShowSheet]         = useState(false)
  const [showArchived, setShowArchived]   = useState(false)
  const [rateGuideOpen, setRateGuideOpen] = useState(false)
  const [preFill, setPreFill]             = useState<{ title: string; reward_amount: number } | null>(null)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const weekStart = getMondayISO()

  useEffect(() => { injectPremiumStyles() }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [c, a, s, p] = await Promise.all([
      getChores({ family_id: familyId, child_id: child.id }).then(r => r.chores),
      getChores({ family_id: familyId, child_id: child.id, archived: true }).then(r => r.chores),
      getSuggestions(familyId, 'pending').then(r => r.suggestions.filter(s => s.child_id === child.id)),
      getPlans(familyId, child.id, weekStart).then(r => r.plans),
    ])
    setChores(c)
    setArchived(a)
    setSuggestions(s)
    setPlans(p)
    setLoading(false)
  }, [familyId, child.id, weekStart])

  useEffect(() => { load() }, [load])

  async function handleArchive(id: string) {
    await archiveChore(id)
    await load()
  }

  async function handleRestore(id: string) {
    await restoreChore(id)
    await load()
  }

  async function togglePlan(chore: Chore, dayIndex: number) {
    const dayOfWeek = dayIndex + 1
    const existing = plans.find(p => p.chore_id === chore.id && p.day_of_week === dayOfWeek)

    if (existing) {
      // Optimistic remove
      setPlans(prev => prev.filter(p => p.id !== existing.id))
      try {
        await deletePlan(existing.id)
      } catch {
        // Rollback on failure
        setPlans(prev => [...prev, existing])
      }
    } else {
      // Optimistic add — use a temp id until the real one comes back
      const tempId = `temp-${chore.id}-${dayOfWeek}`
      const tempPlan: Plan = {
        id: tempId,
        chore_id: chore.id,
        day_of_week: dayOfWeek,
        week_start: weekStart,
        chore_title: chore.title,
        reward_amount: chore.reward_amount,
        currency: chore.currency,
      }
      setPlans(prev => [...prev, tempPlan])
      try {
        const { id: realId } = await createPlan({ family_id: familyId, chore_id: chore.id, child_id: child.id, day_of_week: dayOfWeek, week_start: weekStart })
        setPlans(prev => prev.map(p => p.id === tempId ? { ...tempPlan, id: realId } : p))
      } catch {
        // Rollback on failure
        setPlans(prev => prev.filter(p => p.id !== tempId))
      }
    }
  }

  function handleSuggestionView(s: Suggestion) {
    setPreFill({ title: s.title, reward_amount: s.proposed_amount })
    setSuggestions(prev => prev.filter(x => x.id !== s.id))
    setShowSheet(true)
  }

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  return (
    <div className="space-y-4">
      {/* Suggestions banner */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map(s => {
            const hasModule = s.reason?.startsWith('module:') ?? false
            const moduleLabel = hasModule
              ? s.reason!.replace('module:', '').replace(/-/g, ' ').replace(/^\d+\s*/, '')
              : null
            return (
              <div key={s.id} className="bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] rounded-xl p-3.5">
                <p className="text-[13px] text-[var(--color-text)] mb-2">
                  {hasModule ? (
                    <>
                      <span className="font-semibold">{child.display_name}</span> just finished a lesson on{' '}
                      <span className="capitalize">{moduleLabel}</span> and wants to put it into practice!
                      They'd like to try <span className="font-semibold">{s.title}</span> for{' '}
                      {formatCurrency(s.proposed_amount, CURRENCY)}.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">{child.display_name}</span> wants to earn{' '}
                      {formatCurrency(s.proposed_amount, CURRENCY)} by{' '}
                      <span className="font-semibold">{s.title}</span>.
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSuggestionView(s)}
                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      hasModule
                        ? 'border border-[var(--brand-primary)] text-[var(--brand-primary)]'
                        : 'bg-[var(--brand-primary)] text-white'
                    }`}
                  >
                    {hasModule && <span>🌱</span>}
                    {hasModule ? 'Accept' : 'View'}
                  </button>
                  <button
                    onClick={() => { rejectSuggestion(s.id); setSuggestions(prev => prev.filter(x => x.id !== s.id)) }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Check Going Rates — ghost button */}
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setRateGuideOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[12px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
          </svg>
          Check Going Rates
        </button>
      </div>

      {/* Active chores */}
      {chores.length === 0 ? (
        <EmptyChoresState childName={child.display_name} onAdd={() => setShowSheet(true)} />
      ) : (
        <div className="space-y-2.5">
          {chores.map(chore => (
            <ChoreCard
              key={chore.id}
              chore={chore}
              plans={plans.filter(p => p.chore_id === chore.id)}
              expanded={expandedId === chore.id}
              onToggle={() => setExpandedId(expandedId === chore.id ? null : chore.id)}
              onArchive={() => handleArchive(chore.id)}
              onTogglePlan={(day) => togglePlan(chore, day)}
            />
          ))}
        </div>
      )}

      {/* Add chore button — dashed when list has chores, FAB-style hint when empty handled above */}
      {chores.length > 0 && (
        <button
          onClick={() => setShowSheet(true)}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
        >
          + Add chore
        </button>
      )}

      {/* Create chore sheet */}
      {showSheet && (
        <CreateChoreSheet
          familyId={familyId}
          children={children}
          currency={CURRENCY}
          initialTitle={preFill?.title}
          initialRewardAmount={preFill?.reward_amount}
          onCreated={() => { setShowSheet(false); setPreFill(null); load() }}
          onClose={() => { setShowSheet(false); setPreFill(null) }}
        />
      )}


      {/* Archived toggle */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            {showArchived ? '▲' : '▼'} Archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map(chore => (
                <div key={chore.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center justify-between opacity-60">
                  <div>
                    <p className="text-[14px] font-semibold text-[var(--color-text)]">{chore.title}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)]">{formatCurrency(chore.reward_amount, chore.currency)}</p>
                  </div>
                  <button onClick={() => handleRestore(chore.id)} className="text-[13px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Rate Guide Sheet */}
      <RateGuideSheet
        open={rateGuideOpen}
        onClose={() => setRateGuideOpen(false)}
        currency={CURRENCY}
        onUse={(title, amount) => {
          setPreFill({ title, reward_amount: amount })
          setRateGuideOpen(false)
          setShowSheet(true)
        }}
      />
    </div>
  )
}

// ── Category icons — mirrors CreateChoreSheet TILE_ICONS ─────────────────────

function ChoreIcon({ title, size = 20 }: { title: string; size?: number }) {
  const s = `${size}px`
  const t = title.toLowerCase()

  if (t.includes('tidy') || t.includes('room') || t.includes('clean room'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  if (t.includes('dish') || t.includes('wash up'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 1 0 20"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/></svg>
  if (t.includes('vacuum') || t.includes('hoover'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 9V3"/><path d="M6.6 6.6 4.5 4.5"/><path d="M9 12H3"/><path d="M6.6 17.4l-2.1 2.1"/><path d="M12 15v6"/><path d="M17.4 17.4l2.1 2.1"/><path d="M15 12h6"/><path d="M17.4 6.6l2.1-2.1"/></svg>
  if (t.includes('bin') || t.includes('rubbish') || t.includes('trash'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
  if (t.includes('dog') || t.includes('walk') || t.includes('pet'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 2.115"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 2.115"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444c0-1.084-.22-2.2-.682-3.31"/></svg>
  if (t.includes('car') || t.includes('wash car'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h10l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  if (t.includes('homework') || t.includes('reading') || t.includes('study') || t.includes('book'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  if (t.includes('bed') || t.includes('bedroom'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16"/><path d="M22 4v16"/><path d="M2 8h20"/><path d="M2 20h20"/><path d="M2 12h6a2 2 0 0 1 2 2v4H2v-6z"/><path d="M16 12h6v8h-8v-4a2 2 0 0 1 2-2z"/></svg>
  if (t.includes('lawn') || t.includes('garden') || t.includes('grass') || t.includes('mow'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M9 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M15 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M7 21v-9"/><path d="M13 21v-9"/><path d="M17 21v-6c0-2-1-3-3-3"/></svg>
  if (t.includes('cook') || t.includes('dinner') || t.includes('lunch') || t.includes('meal'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11v6"/><path d="M9 11v2a3 3 0 0 0 6 0v-2"/><path d="M3 11h18"/><path d="M12 2v3"/><path d="M8 2c0 2.5 4 2.5 4 5"/><path d="M16 2c0 2.5-4 2.5-4 5"/></svg>
  if (t.includes('laundry') || t.includes('washing') || t.includes('clothes'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="4"/><circle cx="8" cy="7" r="1"/></svg>
  // fallback — generic task circle
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>
}

function RecurringIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-70">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}

// ── Mini week dots — read-only at-a-glance schedule ──────────────────────────

function MiniScheduleDots({ plannedDays }: { plannedDays: number[] }) {
  const days = ['M','T','W','T','F','S','S']
  return (
    <div className="flex items-center gap-[3px] mt-1.5">
      {days.map((d, i) => (
        <div
          key={i}
          title={['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}
          className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold transition-colors
            ${plannedDays.includes(i)
              ? 'bg-[var(--brand-primary)] text-white'
              : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]/50'
            }`}
        >
          {d}
        </div>
      ))}
    </div>
  )
}

// ── Empty state with AI Mentor flavour ───────────────────────────────────────

function EmptyChoresState({ childName, onAdd }: { childName: string; onAdd: () => void }) {
  return (
    <div className="space-y-4">
      {/* Mentor card */}
      <PremiumShell>
        <div className="relative z-10 px-4 pt-5 pb-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <MentorAvatar />
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#6b9e87' }}>
                    Orchard Mentor
                  </span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                </div>
                <p className="text-[15px] font-extrabold tracking-tight" style={{ color: '#f0fdf4' }}>
                  No chores yet for <span style={{ color: '#4ade80' }}>{childName}</span>
                </p>
              </div>
            </div>
            <ProBadge />
          </div>
          {/* Body */}
          <p className="text-[13px] leading-relaxed" style={{ color: '#a7c4b5' }}>
            Once you add chores I can track {childName}'s consistency, spot patterns, and give you genuinely useful coaching — not generic tips.
          </p>
          {/* Action list */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>Get started</p>
            {[
              `Add 2–3 small daily chores so I can spot ${childName}'s consistency patterns.`,
              'Try "Check Going Rates" above to set fair rewards instantly.',
              `Plan the week once a chore is added — so ${childName} knows what's expected.`,
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="shrink-0 text-[9px] font-black tracking-wider tabular-nums mt-0.5" style={{ color: '#0d9488' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-[12px] leading-relaxed" style={{ color: '#a7c4b5' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </PremiumShell>

      {/* Add chore CTA */}
      <button
        onClick={onAdd}
        className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
      >
        + Add first chore
      </button>
    </div>
  )
}

function ChoreCard({ chore, plans, expanded, onToggle, onArchive, onTogglePlan }: {
  chore: Chore
  plans: Plan[]
  expanded: boolean
  onToggle: () => void
  onArchive: () => void
  onTogglePlan: (dayIndex: number) => void
}) {
  const dueDateObj = chore.due_date && /^\d{4}-\d{2}-\d{2}$/.test(chore.due_date) ? new Date(chore.due_date) : null
  const isOverdue = dueDateObj && dueDateObj < new Date()
  const plannedDays = plans.map(p => p.day_of_week - 1)

  const borderClass = chore.is_flash
    ? 'border-red-500 border-l-4'
    : chore.is_priority
    ? 'border-amber-500 border-l-4'
    : isOverdue
    ? 'border-red-300 border-l-4'
    : ''

  const bgClass = isOverdue && !chore.is_flash
    ? 'bg-red-50 dark:bg-red-950/30'
    : chore.is_priority && !chore.is_flash
    ? 'bg-amber-50 dark:bg-amber-950/30'
    : 'bg-[var(--color-surface)]'

  return (
    <div className={`${bgClass} border border-[var(--color-border)] ${borderClass} rounded-xl overflow-hidden`}>
      <button
        className="w-full px-4 py-3 flex items-start gap-3 cursor-pointer"
        onClick={onToggle}
      >
        {/* Category icon */}
        <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--brand-primary)] mt-0.5">
          <ChoreIcon title={chore.title} size={18} />
        </div>

        {/* Title + mini dots */}
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {!!chore.is_flash && <span className="text-[11px] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>}
            {!!chore.is_priority && !chore.is_flash && <span className="text-[11px] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">PRIORITY</span>}
            <span className="text-[15px] font-semibold text-[var(--color-text)]">{chore.title}</span>
          </div>
          {/* Mini read-only schedule dots */}
          {plannedDays.length > 0 && !expanded && (
            <MiniScheduleDots plannedDays={plannedDays} />
          )}
        </div>

        {/* Price + chevron */}
        <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
          <span className="text-[14px] font-bold text-[var(--color-text)] tabular-nums">
            {formatCurrency(chore.reward_amount, chore.currency)}
          </span>
          {chore.frequency !== 'as_needed' && chore.frequency !== 'one-off' && (
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-0.5">
              <RecurringIcon />
              {FREQUENCY_OPTIONS.find(o => o.value === chore.frequency)?.label ?? chore.frequency}
            </span>
          )}
          {dueDateObj && (
            <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${isOverdue ? 'text-red-500' : 'text-[var(--color-text-muted)]'}`}>
              Due {dueDateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {/* Chevron */}
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-[var(--color-text-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
          {chore.description && (
            <p className="text-[13px] text-[var(--color-text-muted)]">{chore.description}</p>
          )}

          {/* Weekly planner strip — larger tap targets */}
          <div>
            <p className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-2">Plan this week</p>
            <div className="flex gap-2">
              {DAYS.map((day, i) => (
                <button
                  key={`${day}-${i}`}
                  onClick={e => { e.stopPropagation(); onTogglePlan(i) }}
                  className={`flex-1 h-9 rounded-xl text-[12px] font-bold transition-all duration-150 cursor-pointer active:scale-95
                    ${plannedDays.includes(i)
                      ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Archive — bottom right, with folder icon */}
          <div className="flex justify-end pt-1">
            <button
              onClick={onArchive}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
              Archive chore
            </button>
          </div>
        </div>
      )}
    </div>
  )
}