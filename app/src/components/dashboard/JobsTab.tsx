import { useState, useEffect, useCallback } from 'react'
import type { Chore, Suggestion, Plan, ChildRecord } from '../../lib/api'
import {
  getChores, createChore, archiveChore, restoreChore,
  getSuggestions, getPlans, createPlan, deletePlan,
  formatCurrency, getMondayISO,
} from '../../lib/api'

declare const posthog: { capture: (event: string, props?: Record<string, unknown>) => void } | undefined

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
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

interface NewChoreForm {
  title: string
  reward_amount: string
  frequency: string
  weekly_day: number   // 1=Mon … 7=Sun, used only when frequency=weekly
  description: string
  is_priority: boolean
  is_flash: boolean
  flash_deadline: string
  due_date: string
}

const BLANK_FORM: NewChoreForm = {
  title: '', reward_amount: '', frequency: 'as_needed', weekly_day: 1,
  description: '', is_priority: false, is_flash: false,
  flash_deadline: '', due_date: '',
}

export function JobsTab({ familyId, child }: Props) {
  const [chores, setChores]           = useState<Chore[]>([])
  const [archived, setArchived]       = useState<Chore[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [plans, setPlans]             = useState<Plan[]>([])
  const [loading, setLoading]         = useState(true)
  const [showForm, setShowForm]       = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm]               = useState<NewChoreForm>(BLANK_FORM)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.reward_amount) return
    setSaving(true)
    setError(null)
    try {
      const isRecurring = FREQUENCY_OPTIONS.find(o => o.value === form.frequency)?.recurring ?? false

      // For weekly, encode the chosen day into due_date as a sentinel day-name
      // The child grove planner reads this to auto-plant on the right day.
      const weeklyDay = form.frequency === 'weekly' ? String(form.weekly_day) : undefined

      await createChore({
        family_id: familyId,
        assigned_to: child.id,
        title: form.title.trim(),
        reward_amount: Math.round(parseFloat(form.reward_amount) * 100),
        currency: CURRENCY,
        frequency: form.frequency,
        description: form.description || undefined,
        is_priority: form.is_priority,
        is_flash: form.is_flash,
        flash_deadline: form.flash_deadline || undefined,
        due_date: weeklyDay ?? (form.due_date || undefined),
      })

      if (isRecurring) {
        try {
          typeof posthog !== 'undefined' && posthog?.capture('recurring_chore_created', {
            frequency: form.frequency,
            child_id: child.id,
          })
        } catch { /* analytics must never break the flow */ }
      }

      setForm(BLANK_FORM)
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

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

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  return (
    <div className="space-y-4">
      {/* Suggestions banner */}
      {suggestions.length > 0 && (
        <div className="bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] rounded-xl p-3.5">
          <p className="text-[13px] font-semibold text-[var(--brand-primary)] mb-2">
            {suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''} from {child.display_name}
          </p>
          {suggestions.map(s => (
            <div key={s.id} className="flex items-center justify-between py-1.5">
              <span className="text-[13px] text-[var(--color-text)]">{s.title}</span>
              <span className="text-[13px] font-semibold text-[var(--brand-primary)]">{formatCurrency(s.proposed_amount, CURRENCY)}</span>
            </div>
          ))}
        </div>
      )}

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
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
        >
          + Add job
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
          <p className="text-[15px] font-bold text-[var(--color-text)]">New job</p>

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          <input
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            placeholder="Job title"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required
          />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">£</span>
              <input
                className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="0.00"
                type="number" min="0.01" step="0.01"
                value={form.reward_amount}
                onChange={e => setForm(f => ({ ...f, reward_amount: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[130px]">
              <select
                className="border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                aria-label="How often?"
              >
                {FREQUENCY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {/* Day-picker — only for Weekly */}
              {form.frequency === 'weekly' && (
                <div className="flex gap-0.5 mt-0.5">
                  {DAYS_SHORT.map((day, i) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, weekly_day: i + 1 }))}
                      className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer
                        ${form.weekly_day === i + 1
                          ? 'bg-[var(--brand-primary)] text-white'
                          : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:opacity-80'
                        }`}
                    >
                      {day[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <textarea
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] resize-none"
            placeholder="Description (optional)"
            rows={2}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)] cursor-pointer select-none">
              <input type="checkbox" checked={form.is_priority} onChange={e => setForm(f => ({ ...f, is_priority: e.target.checked }))} className="w-4 h-4 accent-amber-600" />
              Priority
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)] cursor-pointer select-none">
              <input type="checkbox" checked={form.is_flash} onChange={e => setForm(f => ({ ...f, is_flash: e.target.checked }))} className="w-4 h-4 accent-red-600" />
              Flash job
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(BLANK_FORM); setError(null) }}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[14px] font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving…' : 'Add job'}
            </button>
          </div>
        </form>
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