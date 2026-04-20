import { useState, useEffect, useCallback } from 'react'
import type { Chore, Suggestion, Plan, ChildRecord } from '../../lib/api'
import {
  getChores, archiveChore, restoreChore,
  getSuggestions, rejectSuggestion, getPlans, createPlan, deletePlan,
  formatCurrency, getMondayISO,
} from '../../lib/api'
import { CreateChoreSheet } from './CreateChoreSheet'
import { RateGuideSheet } from './RateGuideSheet'

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
}

export function ChoresTab({ familyId, child }: Props) {
  const [chores, setChores]           = useState<Chore[]>([])
  const [archived, setArchived]       = useState<Chore[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [plans, setPlans]             = useState<Plan[]>([])
  const [loading, setLoading]         = useState(true)
  const [showSheet, setShowSheet]         = useState(false)
  const [showArchived, setShowArchived]   = useState(false)
  const [rateGuideOpen, setRateGuideOpen] = useState(false)
  const [preFill, setPreFill]             = useState<{ title: string; reward_amount: number } | null>(null)
  const [showFastTrackPrompt, setShowFastTrackPrompt] = useState(false)
  const weekStart = getMondayISO()

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
    const existing = plans.find(p => p.chore_id === chore.id && p.day_of_week === dayIndex + 1)
    if (existing) {
      await deletePlan(existing.id)
    } else {
      await createPlan({ family_id: familyId, chore_id: chore.id, child_id: child.id, day_of_week: dayIndex + 1, week_start: weekStart })
    }
    await load()
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

      {/* Check Going Rates */}
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setRateGuideOpen(true)}
          className="text-xs font-medium text-[var(--brand-primary)] hover:underline underline-offset-2"
        >
          Check Going Rates
        </button>
      </div>

      {/* Active chores */}
      {chores.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 text-center">
          <p className="text-[14px] text-[var(--color-text-muted)]">No active jobs for {child.display_name}.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {chores.map(chore => (
            <ChoreCard
              key={chore.id}
              chore={chore}
              plans={plans.filter(p => p.chore_id === chore.id)}
              onArchive={() => handleArchive(chore.id)}
              onTogglePlan={(day) => togglePlan(chore, day)}
            />
          ))}
        </div>
      )}

      {/* Add job button */}
      <button
        onClick={() => setShowSheet(true)}
        className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
      >
        + Add task
      </button>

      {/* Create chore sheet */}
      {showSheet && (
        <CreateChoreSheet
          familyId={familyId}
          child={child}
          currency={CURRENCY}
          initialTitle={preFill?.title}
          initialRewardAmount={preFill?.reward_amount}
          onCreated={() => { setShowSheet(false); setPreFill(null); setShowFastTrackPrompt(true); load() }}
          onClose={() => { setShowSheet(false); setPreFill(null) }}
        />
      )}

      {/* Fast-Track prompt */}
      {showFastTrackPrompt && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3 flex items-center justify-between gap-2 text-xs">
          <span className="text-[var(--color-text-muted)]">That was easy! Want to skip this step next time?</span>
          <button
            onClick={() => setShowFastTrackPrompt(false)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
          >
            ✕
          </button>
        </div>
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
      <RateGuideSheet open={rateGuideOpen} onClose={() => setRateGuideOpen(false)} />
    </div>
  )
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

function ChoreCard({ chore, plans, onArchive, onTogglePlan }: {
  chore: Chore
  plans: Plan[]
  onArchive: () => void
  onTogglePlan: (dayIndex: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isOverdue = chore.due_date && new Date(chore.due_date) < new Date()
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
        className="w-full px-4 py-3 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="text-left">
          <div className="flex items-center gap-2">
            {chore.is_flash && <span className="text-[11px] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>}
            {chore.is_priority && !chore.is_flash && <span className="text-[11px] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">PRIORITY</span>}
            <span className="text-[15px] font-semibold text-[var(--color-text)]">{chore.title}</span>
          </div>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1.5">
            {formatCurrency(chore.reward_amount, chore.currency)}
            {chore.frequency !== 'as_needed' && chore.frequency !== 'one-off' && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <RecurringIcon />
                  {FREQUENCY_OPTIONS.find(o => o.value === chore.frequency)?.label ?? chore.frequency}
                </span>
              </>
            )}
          </p>
        </div>
        <span className="text-[var(--color-text-muted)] text-[18px] leading-none">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
          {chore.description && (
            <p className="text-[13px] text-[var(--color-text-muted)]">{chore.description}</p>
          )}

          {/* Weekly planner strip */}
          <div>
            <p className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-1.5">Plan this week</p>
            <div className="flex gap-1.5">
              {DAYS.map((day, i) => (
                <button
                  key={`${day}-${i}`}
                  onClick={() => onTogglePlan(i)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer
                    ${plannedDays.includes(i)
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:opacity-80'
                    }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={onArchive}
            className="text-[13px] font-semibold text-red-600 hover:underline cursor-pointer"
          >
            Archive job
          </button>
        </div>
      )}
    </div>
  )
}