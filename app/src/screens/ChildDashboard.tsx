import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getChores, submitChore, getBalance, getGoals,
  getCompletions, getSettings, getFamilyId, getUserId,
  formatCurrency, purchaseGoal, effectiveTarget,
} from '../lib/api'
import type { Chore, BalanceSummary, Goal, Completion } from '../lib/api'
import { useAppView } from '../lib/useTone'
import { ThemePicker } from '../lib/theme'
import { SavingsGrove } from '../components/dashboard/SavingsGrove'
import { FullLogo } from '../components/ui/Logo'
import { EarnTab } from '../components/dashboard/EarnTab'
import { LabTab } from '../components/dashboard/LabTab'
import { MilestoneOverlay, consumeMilestonePending } from '../components/celebration'
import type { MilestoneEvent } from '../components/celebration'

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
  const [appView,      setAppView]      = useState<'ORCHARD' | 'CLEAN'>('ORCHARD')
  const [milestone, setMilestone] = useState<MilestoneEvent | null>(() =>
    consumeMilestonePending('GRADUATION')
      ? { type: 'GRADUATION', appView: (localStorage.getItem('mc_app_view') ?? 'ORCHARD') as 'ORCHARD' | 'CLEAN' }
      : null
  )
  const [showSettings, setShowSettings] = useState(false)
  const [showGrove,    setShowGrove]    = useState(false)
  const [weeklyAllowancePence, setWeeklyAllowancePence] = useState(0)
  const [currency, setCurrency] = useState('GBP')
  const [purchasing,   setPurchasing]   = useState<string | null>(null)
  const [goalBarPct, setGoalBarPct] = useState(0)   // starts at 0 so the CSS transition has room to grow
  const goalBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Per-chore submission state
  const [childTab,   setChildTab]   = useState<'home' | 'earn' | 'lab'>('home')
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [submitted,  setSubmitted]  = useState<Set<string>>(new Set())
  const [noteChore,  setNoteChore]  = useState<string | null>(null)
  const [noteText,   setNoteText]   = useState('')
  const [submitErr,  setSubmitErr]  = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId || !userId) { navigate('/lock'); return }
    setLoading(true)
    try {
      const [c, b, g, p, s] = await Promise.all([
        getChores({ family_id: familyId, child_id: userId }).then(r => r.chores),
        getBalance(familyId, userId),
        getGoals(familyId, userId).then(r => r.goals.filter(g => !g.archived)),
        getCompletions({ family_id: familyId, child_id: userId, status: 'awaiting_review' }).then(r => r.completions),
        getSettings(),
      ])
      setChores(c)
      if (c.length > 0) setCurrency(c[0].currency)
      setBalance(b)
      setGoals(g)
      setPending(p)
      const av = (s.app_view ?? 'ORCHARD') as 'ORCHARD' | 'CLEAN'
      setAppView(av)
      // Estimate weekly allowance as sum of all weekly/daily chore rewards
      const weekly = c.reduce((sum, chore) => {
        if (chore.frequency === 'weekly') return sum + chore.reward_amount
        if (chore.frequency === 'daily')  return sum + chore.reward_amount * 5
        if (chore.frequency === 'school_days') return sum + chore.reward_amount * 5
        return sum
      }, 0)
      setWeeklyAllowancePence(weekly)
      // Keep localStorage in sync so the anti-flicker script and ThemeProvider
      // both see the latest value on the next cold start.
      try { localStorage.setItem('mc_app_view', av) } catch { /* ignore */ }
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
      navigate('/lock')
    } finally {
      setLoading(false)
    }
  }, [familyId, userId, navigate])

  useEffect(() => { load() }, [load])

  // Clean up goal bar timer on unmount
  useEffect(() => () => { if (goalBarTimer.current) clearTimeout(goalBarTimer.current) }, [])

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

  // ── Goal purchase ──────────────────────────────────────────────────────────

  async function handlePurchase(goalId: string) {
    setPurchasing(goalId)
    try {
      await purchaseGoal(goalId)
      await load()
    } catch { /* ignore — goal already reached */ }
    finally { setPurchasing(null) }
  }

  // ── Filtered chores for active day ────────────────────────────────────────

  const dayChores = chores.filter(c => {
    const days = effectiveDays(c, grovePlans)
    return days.includes(activeDay)
  })

  const unplannedChores = chores.filter(c => effectiveDays(c, grovePlans).length === 0)

  const activeTopGoal = goals[0] ?? null
  const tone = useAppView(appView)

  // ── Render ─────────────────────────────────────────────────────────────────

  // Teen mode uses flatter shadows and sharper borders for a fintech feel
  const cardClass = tone.isChild
    ? 'bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden'
    : 'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden'

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      {milestone && (
        <MilestoneOverlay event={milestone} onComplete={() => setMilestone(null)} />
      )}
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)]">
        <div className="max-w-[560px] mx-auto px-3.5 py-3 flex items-center justify-between">
          <FullLogo iconSize={26} />
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
              onClick={() => navigate('/lock')}
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

        {/* Tab bar */}
        <div className="max-w-[560px] mx-auto border-t border-[var(--color-border)] flex">
          {([['home', 'Home'], ['earn', 'Tasks'], ['lab', 'Lab']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setChildTab(id)}
              className={`flex-1 py-2.5 text-[13px] font-semibold relative transition-colors cursor-pointer
                ${childTab === id ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              {label}
              {childTab === id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-[var(--brand-primary)] rounded-t-full" />
              )}
            </button>
          ))}
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
        {childTab === 'earn' ? (
          <EarnTab familyId={familyId} childId={userId} currency={chores[0]?.currency ?? 'GBP'} />
        ) : childTab === 'lab' ? (
          <LabTab childId={userId} appView={appView} />
        ) : loading ? (
          <div className="py-16 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>
        ) : tone.isChild ? (
          /* ═══════════════════════════════════════════════════════════
             ORCHARD VIEW — card-based, metaphorical, playful
             ══════════════════════════════════════════════════════════ */
          <OrchardView
            balance={balance}
            chores={chores}
            pending={pending}
            goals={goals}
            tone={tone}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
            grovePlans={grovePlans}
            dayChores={dayChores}
            unplannedChores={unplannedChores}
            activeTopGoal={activeTopGoal}
            goalBarPct={goalBarPct}
            submitted={submitted}
            submitting={submitting}
            purchasing={purchasing}
            noteChore={noteChore}
            noteText={noteText}
            submitErr={submitErr}
            cardClass={cardClass}
            currency={currency}
            weeklyAllowancePence={weeklyAllowancePence}
            isPlanted={isPlanted}
            togglePlant={togglePlant}
            handleDone={handleDone}
            handlePurchase={handlePurchase}
            setNoteChore={setNoteChore}
            setNoteText={setNoteText}
            onPlantGoal={() => setShowGrove(true)}
          />
        ) : (
          /* ═══════════════════════════════════════════════════════════
             PROFESSIONAL VIEW — compact table/list, financial language
             All colours via CSS variables — inherits Light/Dark theme
             ══════════════════════════════════════════════════════════ */
          <ProfessionalView
            balance={balance}
            chores={chores}
            pending={pending}
            goals={goals}
            tone={tone}
            currency={currency}
            submitted={submitted}
            submitting={submitting}
            noteChore={noteChore}
            noteText={noteText}
            submitErr={submitErr}
            handleDone={handleDone}
            setNoteChore={setNoteChore}
            setNoteText={setNoteText}
          />
        )}

      </main>

      {/* Savings Grove — goal creation sheet */}
      {showGrove && (
        <SavingsGrove
          familyId={familyId}
          childId={userId}
          currency={balance ? (chores[0]?.currency ?? 'GBP') : 'GBP'}
          chores={chores}
          appView={appView}
          weeklyAllowancePence={weeklyAllowancePence}
          onCreated={() => { setShowGrove(false); load() }}
          onClose={() => setShowGrove(false)}
        />
      )}
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

// ─── OrchardView ─────────────────────────────────────────────────────────────
// Card-based, metaphorical layout for younger children.
// ─────────────────────────────────────────────────────────────────────────────

interface OrchardViewProps {
  balance: BalanceSummary | null
  chores: Chore[]
  pending: Completion[]
  goals: Goal[]
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  activeDay: number
  setActiveDay: (d: number) => void
  grovePlans: Record<string, number[]>
  dayChores: Chore[]
  unplannedChores: Chore[]
  activeTopGoal: Goal | null
  goalBarPct: number
  submitted: Set<string>
  submitting: string | null
  purchasing: string | null
  noteChore: string | null
  noteText: string
  submitErr: string | null
  cardClass: string
  currency: string
  weeklyAllowancePence: number
  isPlanted: (c: Chore) => boolean
  togglePlant: (c: Chore, day: number) => void
  handleDone: (id: string, note?: string) => Promise<void>
  handlePurchase: (id: string) => Promise<void>
  setNoteChore: (id: string | null) => void
  setNoteText: (t: string) => void
  onPlantGoal: () => void
}

function OrchardView({
  balance, chores, pending, goals, tone,
  activeDay, setActiveDay, grovePlans, dayChores, unplannedChores,
  activeTopGoal, goalBarPct, submitted, submitting, purchasing,
  noteChore, noteText, submitErr, cardClass, currency, weeklyAllowancePence,
  isPlanted, togglePlant, handleDone, handlePurchase,
  setNoteChore, setNoteText, onPlantGoal,
}: OrchardViewProps) {
  // Best chore for effort calc
  const bestChore = useMemo(() => {
    const active = chores.filter(c => !c.archived)
    if (!active.length) return null
    return active.reduce((a, b) => a.reward_amount >= b.reward_amount ? a : b)
  }, [chores])

  function effortLabel(targetPence: number): string {
    if (bestChore && bestChore.reward_amount > 0) {
      const n = Math.ceil(targetPence / bestChore.reward_amount)
      return `${n} × ${bestChore.title}`
    }
    if (weeklyAllowancePence > 0) {
      const weeks = Math.ceil(targetPence / weeklyAllowancePence)
      return `${weeks} week${weeks !== 1 ? 's' : ''} of Harvest`
    }
    return formatCurrency(targetPence, currency)
  }

  const activeGoals = goals.filter(g => g.status === 'ACTIVE' || !g.status)
  return (
    <>
      {/* Balance card */}
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border-t-[3px] border-t-[var(--brand-primary)] border border-[var(--color-border)] p-4">
        <div className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{tone.balance}</div>
        <div className="text-[46px] font-extrabold text-[var(--color-text)] leading-none tracking-tight tabular-nums">
          {balance ? formatCurrency(balance.available, currency) : '£—'}
        </div>
        <div className="flex gap-4 mt-2">
          <span className="text-[13px] text-[var(--color-text-muted)]">
            Earned: <strong className="text-[var(--color-text)] tabular-nums">
              {balance ? formatCurrency(balance.earned, currency) : '—'}
            </strong>
          </span>
          {(balance?.pending ?? 0) > 0 && (
            <span className="text-[13px] text-[var(--color-text-muted)]">
              Pending: <strong className="text-amber-500 tabular-nums">
                {formatCurrency(balance!.pending, currency)}
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Pending nudge */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-[20px]">⏳</span>
          <p className="text-[13px] text-amber-800 font-semibold">
            {pending.length === 1
              ? `1 chore is waiting for your parent to check`
              : `${pending.length} chores are waiting for your parent to check`}
          </p>
        </div>
      )}

      {/* Weekly tracker */}
      <div className={cardClass}>
        <div className="px-4 pt-4 pb-1">
          <h2 className="text-[15px] font-bold text-[var(--color-text)]">{tone.weekSection}</h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{tone.weekSubtitle}</p>
        </div>
        <div className="flex gap-1.5 px-4 pb-3 mt-2 overflow-x-auto scrollbar-hide">
          {DAYS.map((day, i) => {
            const dayNum = i + 1
            const isToday = activeDay === dayNum
            const hasChores = chores.some(c => effectiveDays(c, grovePlans).includes(dayNum))
            return (
              <button
                key={day}
                onClick={() => setActiveDay(dayNum)}
                className={`shrink-0 flex flex-col items-center rounded-xl px-2.5 py-2 min-w-[44px] transition-colors duration-100 cursor-pointer
                  ${isToday ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'}`}
              >
                <span className="text-[11px] font-semibold">{day}</span>
                <span className={`mt-1.5 rounded-full w-1.5 h-1.5 ${hasChores ? (isToday ? 'bg-white/50' : 'bg-[var(--brand-primary)]') : 'bg-transparent'}`} />
              </button>
            )
          })}
        </div>
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
                onDone={() => chore.description ? setNoteChore(chore.id) : handleDone(chore.id)}
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

      {/* All jobs */}
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
                onDone={() => { setNoteChore(chore.id); setNoteText('') }}
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
        <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] p-8 text-center">
          <p className="text-[28px] mb-2">🌱</p>
          <p className="text-[15px] font-semibold text-[var(--color-text)]">{tone.emptyGrove}</p>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{tone.emptyGroveSub}</p>
        </div>
      )}

      {/* ── Savings Grove: Effort-to-Earn Mentor ──────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[var(--color-text)]">🌳 Savings Grove</h2>
          <button
            onClick={onPlantGoal}
            className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--brand-primary)] border border-[var(--brand-primary)] rounded-lg px-2.5 py-1 hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
          >
            <span>+</span> Plant Goal
          </button>
        </div>

        {activeGoals.length === 0 ? (
          <div className="px-4 pb-5 text-center">
            <p className="text-[28px] mb-1">🌱</p>
            <p className="text-[13px] font-semibold text-[var(--color-text)]">No goals yet</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">Tap "Plant Goal" to start saving for something exciting!</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {/* Primary goal — full effort mentor card */}
            {activeTopGoal && (() => {
              const avail = balance?.available ?? 0
              const effTarget = effectiveTarget(activeTopGoal)
              const pct = Math.min(100, Math.round((avail / effTarget) * 100))
              const remaining = Math.max(0, effTarget - avail)
              const isReady = avail >= effTarget

              // Velocity: weeks until reached
              const weeklyIncome = weeklyAllowancePence || (bestChore ? bestChore.reward_amount * 4 : 0)
              const weeksLeft = weeklyIncome > 0 && remaining > 0
                ? Math.ceil(remaining / weeklyIncome)
                : null
              const arrivalDate = weeksLeft
                ? new Date(Date.now() + weeksLeft * 7 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : null

              return (
                <div className="px-4 py-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">🎯</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-[var(--color-text)] truncate">{activeTopGoal.title}</div>
                      {activeTopGoal.parent_match_pct > 0 && (
                        <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                          🤝 Parent matches {activeTopGoal.parent_match_pct}% — you only need {formatCurrency(effTarget, activeTopGoal.currency)}!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="w-full h-4 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--brand-primary)] rounded-full"
                        style={{ width: `${goalBarPct}%`, transition: 'width 1.1s cubic-bezier(0.25, 1, 0.5, 1)' }}
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(avail, activeTopGoal.currency)} saved</span>
                      <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{pct}% • {formatCurrency(effTarget, activeTopGoal.currency)}</span>
                    </div>
                  </div>

                  {/* Effort labels */}
                  <div className="rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3.5 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span>💪</span>
                      <span className="text-[var(--color-text-muted)]">Total cost:</span>
                      <span className="font-semibold text-[var(--color-text)]">{effortLabel(activeTopGoal.target_amount)}</span>
                    </div>
                    {remaining > 0 && (
                      <div className="flex items-center gap-2 text-[12px]">
                        <span>🌿</span>
                        <span className="text-[var(--color-text-muted)]">Still need:</span>
                        <span className="font-semibold text-[var(--color-text)]">{effortLabel(remaining)}</span>
                      </div>
                    )}
                    {arrivalDate && (
                      <div className="flex items-center gap-2 text-[12px]">
                        <span>📅</span>
                        <span className="text-[var(--color-text-muted)]">Estimated arrival:</span>
                        <span className="font-semibold text-emerald-600">{arrivalDate}</span>
                      </div>
                    )}
                  </div>

                  {/* Purchase button when funded */}
                  {isReady && (
                    <button
                      onClick={() => handlePurchase(activeTopGoal.id)}
                      disabled={purchasing === activeTopGoal.id}
                      className="w-full rounded-xl bg-emerald-500 text-white font-bold py-2.5 text-[13px] hover:bg-emerald-600 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {purchasing === activeTopGoal.id ? '🌸 Blossoming…' : '🌸 Mark as Purchased!'}
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Trade-off tool: secondary goals in same effort unit */}
            {activeGoals.length > 1 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">All goals — effort comparison</p>
                <div className="grid grid-cols-1 gap-2">
                  {activeGoals.map((g, i) => (
                    <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${i === 0 ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)]' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
                      <span className="text-base">{i === 0 ? '🎯' : '🌱'}</span>
                      <span className="flex-1 text-[12px] font-semibold text-[var(--color-text)] truncate">{g.title}</span>
                      <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{effortLabel(g.target_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {unplannedChores.length > 0 && (
        <p className="text-center text-[12px] text-[var(--color-text-muted)]">
          {unplannedChores.length} chore{unplannedChores.length > 1 ? 's' : ''} not in your week yet — tap <PlantIcon inline /> to add them.
        </p>
      )}
    </>
  )
}

// ─── ProfessionalView ─────────────────────────────────────────────────────────
// Compact table/list layout with financial terminology.
// Strictly consumes CSS variables — inherits Light/Dark theme automatically.
// ─────────────────────────────────────────────────────────────────────────────

interface ProfessionalViewProps {
  balance: BalanceSummary | null
  chores: Chore[]
  pending: Completion[]
  goals: Goal[]
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  currency: string
  submitted: Set<string>
  submitting: string | null
  noteChore: string | null
  noteText: string
  submitErr: string | null
  handleDone: (id: string, note?: string) => Promise<void>
  setNoteChore: (id: string | null) => void
  setNoteText: (t: string) => void
}

function ProfessionalView({
  balance, chores, pending, goals,
  tone, currency, submitted, submitting,
  noteChore, noteText, submitErr,
  handleDone, setNoteChore, setNoteText,
}: ProfessionalViewProps) {
  return (
    <>
      {/* Account summary — dense stat row */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{tone.balance}</p>
          <p className="text-[36px] font-extrabold text-[var(--color-text)] leading-none tabular-nums mt-0.5">
            {balance ? formatCurrency(balance.available, currency) : '£—'}
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
          {[
            { label: 'Earned',  value: balance?.earned    ?? 0 },
            { label: 'Pending', value: balance?.pending   ?? 0 },
            { label: 'Spent',   value: balance?.spent     ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</p>
              <p className="text-[13px] font-bold text-[var(--color-text)] tabular-nums mt-0.5">
                {formatCurrency(value, currency)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Pending transactions alert */}
      {pending.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-amber-300 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-[var(--color-text)]">
            {pending.length} pending transaction{pending.length > 1 ? 's' : ''}
          </p>
          <span className="text-[11px] font-bold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">AWAITING APPROVAL</span>
        </div>
      )}

      {/* Tasks table */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <p className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{tone.allChores}</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">{chores.length} task{chores.length !== 1 ? 's' : ''}</p>
        </div>

        {chores.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-[var(--color-text-muted)] text-center">{tone.emptyGrove}</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Task</th>
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Frequency</th>
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Value</th>
                <th className="px-2 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {chores.map(chore => {
                const isSubmitted = submitted.has(chore.id)
                const isSubmitting = submitting === chore.id
                const isNoteOpen = noteChore === chore.id
                return (
                  <tr key={chore.id} className="group">
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        {chore.is_flash && <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1">FLASH</span>}
                        <span className="text-[13px] font-semibold text-[var(--color-text)]">{chore.title}</span>
                      </div>
                      {isNoteOpen && (
                        <div className="mt-2 space-y-1.5">
                          {submitErr && <p className="text-[11px] text-red-600">{submitErr}</p>}
                          <textarea
                            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded px-2 py-1.5 text-[12px] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)] placeholder:text-[var(--color-text-muted)]"
                            placeholder="Add a note (optional)"
                            rows={2}
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <button onClick={() => { setNoteChore(null); setNoteText('') }}
                              className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-[12px] font-semibold text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-surface-alt)]">
                              Cancel
                            </button>
                            <button onClick={() => handleDone(chore.id, noteText || undefined)} disabled={isSubmitting}
                              className="flex-1 bg-[var(--brand-primary)] text-white rounded px-2 py-1 text-[12px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                              {isSubmitting ? '…' : tone.submitButton}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className="text-[12px] text-[var(--color-text-muted)] capitalize">{chore.frequency.replace('_', ' ')}</span>
                    </td>
                    <td className="px-4 py-2.5 align-top text-right">
                      <span className="text-[13px] font-semibold text-[var(--color-text)] tabular-nums">{formatCurrency(chore.reward_amount, chore.currency)}</span>
                    </td>
                    <td className="px-2 py-2.5 align-top text-right">
                      {isSubmitted ? (
                        <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">{tone.waitingBadge}</span>
                      ) : (
                        <button
                          onClick={() => { setNoteChore(chore.id); setNoteText('') }}
                          disabled={isSubmitting}
                          className="text-[12px] font-bold text-[var(--brand-primary)] hover:underline disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {isSubmitting ? '…' : tone.doneButton}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Savings goals — compact list */}
      {goals.length > 0 && (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <p className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Savings Goals</p>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Goal</th>
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Target</th>
                <th className="px-4 py-2 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {goals.map(goal => {
                const pct = Math.min(100, Math.round(((balance?.available ?? 0) / goal.target_amount) * 100))
                return (
                  <tr key={goal.id}>
                    <td className="px-4 py-2.5">
                      <span className="text-[13px] font-semibold text-[var(--color-text)]">{goal.title}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(goal.target_amount, goal.currency)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--brand-primary)] rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-[var(--color-text-muted)] tabular-nums w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
