import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getChores, submitChore, getBalance, getGoals,
  getCompletions, getSettings, getFamilyId, getUserId,
  formatCurrency,
} from '../lib/api'
import type { Chore, BalanceSummary, Goal, Completion } from '../lib/api'
import { useTone } from '../lib/useTone'
import { ThemePicker } from '../lib/theme'

// ─── localStorage grove planner ──────────────────────────────────────────────
// Key: `grove_plans_${userId}`
// Value: Record<chore_id, number[]>  — array of day_of_week (1=Mon … 7=Sun)

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

function loadGrovePlans(userId: string): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(`grove_plans_${userId}`)
    return raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
  } catch { return {} }
}

function saveGrovePlans(userId: string, plans: Record<string, number[]>) {
  localStorage.setItem(`grove_plans_${userId}`, JSON.stringify(plans))
}

// Which days a chore auto-plants based on its frequency
function autoPlantDays(frequency: string): number[] {
  switch (frequency) {
    case 'daily':       return [1, 2, 3, 4, 5, 6, 7]
    case 'school_days': return [1, 2, 3, 4, 5]
    default:            return []
  }
}

function isAutoPlant(frequency: string): boolean {
  return frequency === 'daily' || frequency === 'school_days'
}

// Get the weekly day encoded in due_date for 'weekly' chores (parent sets this)
function weeklyDayFromChore(chore: Chore): number | null {
  if (chore.frequency !== 'weekly') return null
  const n = parseInt(chore.due_date ?? '', 10)
  return n >= 1 && n <= 7 ? n : null
}

// All days this chore appears on (auto + manual grove plans)
function effectiveDays(chore: Chore, grovePlans: Record<string, number[]>): number[] {
  const auto = autoPlantDays(chore.frequency)
  if (auto.length) return auto

  const weeklyDay = weeklyDayFromChore(chore)
  if (weeklyDay) return [weeklyDay]

  return grovePlans[chore.id] ?? []
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChildDashboard() {
  const navigate   = useNavigate()
  const familyId   = getFamilyId()
  const userId     = getUserId()

  const [activeDay,  setActiveDay]  = useState<number>(() => {
    const d = new Date().getDay()           // 0=Sun … 6=Sat
    return d === 0 ? 7 : d                  // convert to 1=Mon … 7=Sun
  })

  const [chores,     setChores]     = useState<Chore[]>([])
  const [balance,    setBalance]    = useState<BalanceSummary | null>(null)
  const [goals,      setGoals]      = useState<Goal[]>([])
  const [pending,    setPending]    = useState<Completion[]>([])
  const [grovePlans, setGrovePlans] = useState<Record<string, number[]>>(() =>
    loadGrovePlans(userId)
  )
  const [loading,      setLoading]      = useState(true)
  const [teenMode,     setTeenMode]     = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [goalBarPct, setGoalBarPct] = useState(0)   // starts at 0 so the CSS transition has room to grow
  const goalBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Per-chore submission state
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [submitted,  setSubmitted]  = useState<Set<string>>(new Set())
  const [noteChore,  setNoteChore]  = useState<string | null>(null)
  const [noteText,   setNoteText]   = useState('')
  const [submitErr,  setSubmitErr]  = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId || !userId) { navigate('/'); return }
    setLoading(true)
    try {
      const [c, b, g, p, s] = await Promise.all([
        getChores({ family_id: familyId, child_id: userId }).then(r => r.chores),
        getBalance(familyId, userId),
        getGoals(familyId, userId).then(r => r.goals.filter(g => !g.archived)),
        getCompletions({ family_id: familyId, child_id: userId, status: 'pending' }).then(r => r.completions),
        getSettings(),
      ])
      setChores(c)
      setBalance(b)
      setGoals(g)
      setPending(p)
      const tm = s.teen_mode ?? 0
      setTeenMode(tm)
      // Keep localStorage in sync so the anti-flicker script and ThemeProvider
      // both see the latest value on the next cold start.
      try { localStorage.setItem('mc_teen_mode', String(tm)) } catch { /* ignore */ }
      // Pre-mark chores that already have a pending submission today
      const pendingChoreIds = new Set(p.map(cp => cp.chore_id))
      setSubmitted(pendingChoreIds)
      // Animate goal bar after a short delay so transition plays from 0
      const topGoal = g[0]
      if (topGoal && b.available > 0) {
        if (goalBarTimer.current) clearTimeout(goalBarTimer.current)
        setGoalBarPct(0)
        goalBarTimer.current = setTimeout(() => {
          setGoalBarPct(Math.min(100, Math.round((b.available / topGoal.target_amount) * 100)))
        }, 80)
      }
    } catch {
      navigate('/')
    } finally {
      setLoading(false)
    }
  }, [familyId, userId, navigate])

  useEffect(() => { load() }, [load])

  // ── Grove planner helpers ──────────────────────────────────────────────────

  function togglePlant(chore: Chore, day: number) {
    if (isAutoPlant(chore.frequency)) return   // auto-planted, not togglable
    if (weeklyDayFromChore(chore) !== null) return  // fixed by parent
    const updated = { ...grovePlans }
    const days = updated[chore.id] ? [...updated[chore.id]] : []
    const idx = days.indexOf(day)
    if (idx === -1) days.push(day)
    else days.splice(idx, 1)
    updated[chore.id] = days
    setGrovePlans(updated)
    saveGrovePlans(userId, updated)
  }

  function isPlanted(chore: Chore): boolean {
    const days = effectiveDays(chore, grovePlans)
    return days.length > 0
  }

  // ── Submission ─────────────────────────────────────────────────────────────

  async function handleDone(choreId: string, note?: string) {
    setSubmitting(choreId)
    setSubmitErr(null)
    try {
      await submitChore(choreId, note)
      setSubmitted(prev => new Set(prev).add(choreId))
      setNoteChore(null)
      setNoteText('')
      await load()
    } catch (err: unknown) {
      setSubmitErr((err as Error).message)
    } finally {
      setSubmitting(null)
    }
  }

  // ── Filtered chores for active day ────────────────────────────────────────

  const dayChores = chores.filter(c => {
    const days = effectiveDays(c, grovePlans)
    return days.includes(activeDay)
  })

  const unplannedChores = chores.filter(c => effectiveDays(c, grovePlans).length === 0)

  const activeTopGoal = goals[0] ?? null
  const tone = useTone(teenMode)

  // ── Render ─────────────────────────────────────────────────────────────────

  // Teen mode uses flatter shadows and sharper borders for a fintech feel
  const cardClass = tone.isChild
    ? 'bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden'
    : 'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden'

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)]">
        <div className="max-w-[560px] mx-auto px-3.5 py-3 flex items-center justify-between">
          <span className="text-[17px] font-extrabold text-[var(--color-text)] tracking-tight">Morechard</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              title="Settings"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              title="Lock"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Settings bottom sheet */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowSettings(false)}
          />
          {/* Sheet */}
          <div className="relative bg-[var(--color-surface)] rounded-t-2xl shadow-xl max-w-[560px] w-full mx-auto px-4 pt-4 pb-8 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[16px] font-extrabold text-[var(--color-text)]">Settings</p>
              <button
                onClick={() => setShowSettings(false)}
                className="w-8 h-8 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[20px] leading-none cursor-pointer"
              >
                ×
              </button>
            </div>
            <ThemePicker />
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[560px] mx-auto w-full px-3.5 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="py-16 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>
        ) : (
          <>
            {/* ── Balance card ────────────────────────────────────────── */}
            <div className={`${tone.isChild ? 'rounded-2xl shadow-sm' : 'rounded-xl'} bg-[var(--color-surface)] border-t-[3px] border-t-[var(--brand-primary)] border border-[var(--color-border)] p-4`}>
              <div className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{tone.balance}</div>
              <div className="text-[46px] font-extrabold text-[var(--color-text)] leading-none tracking-tight tabular-nums">
                {balance ? formatCurrency(balance.available, 'GBP') : '£—'}
              </div>
              <div className="flex gap-4 mt-2">
                <span className="text-[13px] text-[var(--color-text-muted)]">
                  Earned: <strong className="text-[var(--color-text)] tabular-nums">
                    {balance ? formatCurrency(balance.earned, 'GBP') : '—'}
                  </strong>
                </span>
                {(balance?.pending ?? 0) > 0 && (
                  <span className="text-[13px] text-[var(--color-text-muted)]">
                    Pending approval: <strong className="text-amber-500 tabular-nums">
                      {formatCurrency(balance!.pending, 'GBP')}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* ── Pending approvals nudge ─────────────────────────────── */}
            {pending.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
                {tone.isChild && <span className="text-[20px]">⏳</span>}
                <p className="text-[13px] text-amber-800 font-semibold">
                  {pending.length === 1
                    ? `1 ${tone.isChild ? 'job' : 'task'} is waiting for your parent to check`
                    : `${pending.length} ${tone.isChild ? 'jobs' : 'tasks'} are waiting for your parent to check`}
                </p>
              </div>
            )}

            {/* ── Weekly tracker ──────────────────────────────────────── */}
            <div className={cardClass}>
              <div className="px-4 pt-4 pb-1">
                <h2 className="text-[15px] font-bold text-[var(--color-text)]">{tone.weekSection}</h2>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{tone.weekSubtitle}</p>
              </div>

              {/* Day strip */}
              <div className="flex gap-1.5 px-4 pb-3 mt-2 overflow-x-auto scrollbar-hide">
                {DAYS.map((day, i) => {
                  const dayNum = i + 1
                  const isToday = activeDay === dayNum
                  const hasChores = chores.some(c => effectiveDays(c, grovePlans).includes(dayNum))
                  return (
                    <button
                      key={day}
                      onClick={() => setActiveDay(dayNum)}
                      className={`
                        shrink-0 flex flex-col items-center ${tone.isChild ? 'rounded-xl' : 'rounded-lg'} px-2.5 py-2 min-w-[44px]
                        transition-colors duration-100 cursor-pointer
                        ${isToday
                          ? 'bg-[var(--brand-primary)] text-white'
                          : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'}
                      `}
                    >
                      <span className="text-[11px] font-semibold">{day}</span>
                      <span className={`mt-1.5 rounded-full w-1.5 h-1.5 ${
                        hasChores
                          ? isToday ? 'bg-white/50' : 'bg-[var(--brand-primary)]'
                          : 'bg-transparent'
                      }`} />
                    </button>
                  )
                })}
              </div>

              {/* Chores for selected day */}
              <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                {dayChores.length === 0 ? (
                  <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)] text-center">
                    {tone.nothingToday} {DAYS[activeDay - 1]} yet
                  </p>
                ) : (
                  dayChores.map(chore => (
                    <ChoreRow
                      key={chore.id}
                      chore={chore}
                      tone={tone}
                      submitted={submitted.has(chore.id)}
                      submitting={submitting === chore.id}
                      noteOpen={noteChore === chore.id}
                      noteText={noteChore === chore.id ? noteText : ''}
                      submitErr={submitErr}
                      onDone={() => {
                        if (chore.description) {
                          setNoteChore(chore.id)
                        } else {
                          handleDone(chore.id)
                        }
                      }}
                      onNoteChange={setNoteText}
                      onNoteSubmit={() => handleDone(chore.id, noteText || undefined)}
                      onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
                      showPlantButton={false}
                      planted={true}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── All tasks ───────────────────────────────────────────── */}
            {chores.length > 0 && (
              <div className={cardClass}>
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <h2 className="text-[15px] font-bold text-[var(--color-text)]">{tone.allChores}</h2>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {chores.map(chore => (
                    <ChoreRow
                      key={chore.id}
                      chore={chore}
                      tone={tone}
                      submitted={submitted.has(chore.id)}
                      submitting={submitting === chore.id}
                      noteOpen={noteChore === chore.id}
                      noteText={noteChore === chore.id ? noteText : ''}
                      submitErr={submitErr}
                      onDone={() => {
                        setNoteChore(chore.id)
                        setNoteText('')
                      }}
                      onNoteChange={setNoteText}
                      onNoteSubmit={() => handleDone(chore.id, noteText || undefined)}
                      onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
                      showPlantButton={!isAutoPlant(chore.frequency) && weeklyDayFromChore(chore) === null}
                      planted={isPlanted(chore)}
                      onTogglePlant={() => togglePlant(chore, activeDay)}
                    />
                  ))}
                </div>
              </div>
            )}

            {chores.length === 0 && (
              <div className={`${tone.isChild ? 'rounded-2xl shadow-sm' : 'rounded-xl'} bg-[var(--color-surface)] border border-[var(--color-border)] p-8 text-center`}>
                {tone.isChild && <p className="text-[28px] mb-2">🌱</p>}
                <p className="text-[15px] font-semibold text-[var(--color-text)]">{tone.emptyGrove}</p>
                <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{tone.emptyGroveSub}</p>
              </div>
            )}

            {/* ── Top savings goal ────────────────────────────────────── */}
            {activeTopGoal && (
              <div className={`${tone.isChild ? 'rounded-2xl shadow-sm' : 'rounded-xl'} bg-[var(--color-surface)] border border-[var(--color-border)] p-4`}>
                <h2 className="text-[15px] font-bold text-[var(--color-text)] mb-3">Saving up for</h2>
                <div className="flex items-center gap-3 mb-3">
                  {tone.isChild && <span className="text-2xl">🎯</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-[var(--color-text)] truncate">{activeTopGoal.title}</div>
                    <div className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
                      {formatCurrency(balance?.available ?? 0, activeTopGoal.currency)} of {formatCurrency(activeTopGoal.target_amount, activeTopGoal.currency)}
                    </div>
                  </div>
                </div>
                <div className="w-full h-3 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--brand-primary)] rounded-full"
                    style={{
                      width: `${goalBarPct}%`,
                      transition: 'width 1.1s cubic-bezier(0.25, 1, 0.5, 1)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
                    {formatCurrency(balance?.available ?? 0, activeTopGoal.currency)}
                  </span>
                  <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
                    {formatCurrency(activeTopGoal.target_amount, activeTopGoal.currency)}
                  </span>
                </div>
              </div>
            )}

            {/* Unplanned nudge */}
            {unplannedChores.length > 0 && (
              <p className="text-center text-[12px] text-[var(--color-text-muted)]">
                {unplannedChores.length} {tone.isChild ? `job${unplannedChores.length > 1 ? 's' : ''} not in your week yet` : `task${unplannedChores.length > 1 ? 's' : ''} not scheduled`} — tap{' '}
                {tone.isChild ? <PlantIcon inline /> : <CalendarIcon inline />} to {tone.isChild ? 'add them' : 'schedule'}.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ─── ChoreRow ────────────────────────────────────────────────────────────────

interface ChoreRowProps {
  chore: Chore
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  submitted: boolean
  submitting: boolean
  noteOpen: boolean
  noteText: string
  submitErr: string | null
  planted: boolean
  showPlantButton: boolean
  onDone: () => void
  onNoteChange: (v: string) => void
  onNoteSubmit: () => void
  onNoteCancel: () => void
  onTogglePlant?: () => void
}

function ChoreRow({
  chore, tone, submitted, submitting, noteOpen, noteText,
  submitErr, planted, showPlantButton,
  onDone, onNoteChange, onNoteSubmit, onNoteCancel, onTogglePlant,
}: ChoreRowProps) {
  const isRecurring = chore.frequency !== 'as_needed' && chore.frequency !== 'one-off'

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {chore.is_flash && (
              <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>
            )}
            {isRecurring && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] rounded px-1.5 py-0.5">
                <RecurringIcon /> Repeating
              </span>
            )}
            <span className="text-[14px] font-semibold text-[var(--color-text)] truncate">{chore.title}</span>
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 tabular-nums">
            {formatCurrency(chore.reward_amount, chore.currency)}
          </p>
        </div>

        {/* Schedule button — plant icon for children, calendar icon for teens */}
        {showPlantButton && (
          <button
            onClick={onTogglePlant}
            title={tone.addToSchedule}
            className={`
              w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer
              ${planted
                ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)] text-white'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'}
            `}
          >
            {tone.isChild ? <PlantIcon /> : <CalendarIcon />}
          </button>
        )}

        {/* Primary action button */}
        {submitted ? (
          <span className="shrink-0 text-[12px] font-bold text-amber-700 bg-amber-100 rounded-full px-2.5 py-1">
            {tone.waitingBadge}
          </span>
        ) : (
          <button
            onClick={onDone}
            disabled={submitting}
            className={`shrink-0 h-9 px-3.5 bg-[var(--brand-primary)] text-white text-[13px] font-bold ${tone.isChild ? 'rounded-xl' : 'rounded-lg'} hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer active:scale-95`}
          >
            {submitting ? '…' : tone.doneButton}
          </button>
        )}
      </div>

      {/* Note drawer */}
      {noteOpen && (
        <div className="mt-3 space-y-2">
          {submitErr && <p className="text-[12px] text-red-600">{submitErr}</p>}
          <textarea
            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] placeholder:text-[var(--color-text-muted)]"
            placeholder="Add a note for your parent (optional)"
            rows={2}
            value={noteText}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onNoteCancel}
              className="flex-1 border border-[var(--color-border)] rounded-lg py-2 text-[13px] font-semibold text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-surface-alt)]"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              disabled={submitting}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-lg py-2 text-[13px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? '…' : tone.submitButton}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlantIcon({ inline }: { inline?: boolean }) {
  return (
    <svg
      width={inline ? 12 : 14}
      height={inline ? 12 : 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={inline ? 'inline-block align-middle' : ''}
    >
      <path d="M12 22V12"/>
      <path d="M12 12C12 12 7 10 7 5a5 5 0 0 1 10 0c0 5-5 7-5 7z"/>
      <path d="M12 12c0 0-2-3-2-6"/>
    </svg>
  )
}

// Shown on the schedule button in teen/mature mode instead of the plant sprout
function CalendarIcon({ inline }: { inline?: boolean }) {
  return (
    <svg
      width={inline ? 12 : 14}
      height={inline ? 12 : 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={inline ? 'inline-block align-middle' : ''}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function RecurringIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}
