import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { updateDeviceIdentity } from '../lib/deviceIdentity'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  getChores, submitChore, uploadProof, getBalance, getGoals,
  getCompletions, getSettings, updateSettings, getMyLockStatus, getFamilyId, getUserId,
  formatCurrency, purchaseGoal, effectiveTarget,
  apiUrl, authHeaders, getChildNudges,
} from '../lib/api'
import type { Chore, BalanceSummary, Goal, Completion, ChildNudge } from '../lib/api'
import { ChildNudgeBanner } from '../components/child/ChildNudgeBanner'
import { useAppView } from '../lib/useTone'
import { ThemePicker, HighContrastToggle } from '../lib/theme'
import { AvatarSVG, AVATAR_CATEGORIES, avatarsForCategory } from '../lib/avatars'
import type { AvatarCategory } from '../lib/avatars'
import { SavingsGrove } from '../components/dashboard/SavingsGrove'
import { BadgeAlmanac } from '../components/dashboard/BadgeAlmanac'
import { FullLogo } from '../components/ui/Logo'
import { GrowingTree } from '../components/ui/GrowingTree'
import { EarnTab } from '../components/dashboard/EarnTab'
import { LabTab } from '../components/dashboard/LabTab'
import { ChildMoneyTab } from '../components/dashboard/ChildMoneyTab'
import { ChildGoalsTab } from '../components/dashboard/ChildGoalsTab'
import { ChildBottomNav } from '../components/navigation/ChildBottomNav'
import { ChoreIcon } from '../components/dashboard/ChoreIcon'
import { MilestoneOverlay, consumeMilestonePending, queueCelebration, consumeNextCelebration } from '../components/celebration'
import type { MilestoneEvent, MilestoneEventType } from '../components/celebration'
import { MicroToast } from '../components/celebration/MicroToast'
import { CONFIGS } from '../components/celebration/registry'
import { ErrorBox } from '../components/ui/ErrorBox'
import { DevTriggerPanel } from '../components/dev/DevTriggerPanel'
import { requestPushPermission, hasPromptedForPushPermission } from '../lib/push.js'

// ─── localStorage grove planner ──────────────────────────────────────────────
// Key: `grove_plans_${userId}`
// Value: Record<chore_id, number[]>  — array of day_of_week (1=Mon … 7=Sun)

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

function triggerHaptic() {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(1) } catch { /* unsupported */ }
  }
}

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

// ─── Celebration queue helpers ────────────────────────────────────────────────

function enqueuePendingCelebrations(pending: string[], av: 'ORCHARD' | 'CLEAN') {
  for (const raw of pending) {
    const [type, prevStr, nextStr] = raw.split(':')
    // Fix B: skip unknown event types so they don't wedge the queue
    if (!CONFIGS[type as MilestoneEventType]) continue
    const event: MilestoneEvent = {
      type: type as MilestoneEventType,
      appView: av,
      meta: {
        previousStreak: prevStr ? Number(prevStr) : undefined,
        newStreak:      nextStr ? Number(nextStr) : undefined,
      },
    }
    queueCelebration(event)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChildDashboard() {
  const navigate   = useNavigate()
  const familyId   = getFamilyId()
  const userId     = getUserId()
  const [searchParams] = useSearchParams()

  const [activeDay,  setActiveDay]  = useState<number>(() => {
    const d = new Date().getDay()           // 0=Sun … 6=Sat
    return d === 0 ? 7 : d                  // convert to 1=Mon … 7=Sun
  })

  const [chores,     setChores]     = useState<Chore[]>([])
  const [balance,    setBalance]    = useState<BalanceSummary | null>(null)
  const [goals,      setGoals]      = useState<Goal[]>([])
  const [_pending,   setPending]    = useState<Completion[]>([])
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
  const [activeCelebration, setActiveCelebration] = useState<MilestoneEvent | null>(null)
  const [showSettings,     setShowSettings]     = useState(false)
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(settingsPanelRef, showSettings)
  useEffect(() => {
    if (!showSettings) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowSettings(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showSettings])
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [avatarId,         setAvatarId]         = useState<string>('bottts:spark')
  const [savingAvatar,     setSavingAvatar]      = useState(false)
  const [showGrove,        setShowGrove]         = useState(false)
  const [weeklyAllowancePence, setWeeklyAllowancePence] = useState(0)
  const [earningsMode, setEarningsMode] = useState<'ALLOWANCE' | 'CHORES' | 'HYBRID'>('CHORES')
  const [allowanceAmountPence, setAllowanceAmountPence] = useState(0)
  const [currency, setCurrency] = useState('GBP')
  const [_purchasing,  setPurchasing]   = useState<string | null>(null)
  const [goalBarPct, setGoalBarPct] = useState(0)   // starts at 0 so the CSS transition has room to grow
  const goalBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [streakData, setStreakData] = useState<{
    current_streak:        number
    longest_streak:        number
    earned_badge_keys:     string[]
    total_approved_chores: number
    total_goals_completed: number
    total_saved_pence:     number
  } | null>(null)

  // AI Mentor nudges — one per screen context, fetched once on mount
  const [childNudges, setChildNudges] = useState<{
    earn:  ChildNudge | null
    money: ChildNudge | null
    goals: ChildNudge | null
  }>({ earn: null, money: null, goals: null })

  // Per-chore submission state
  const [childTab,      setChildTab]      = useState<'home' | 'chores' | 'money' | 'goals' | 'lab'>(() => {
    const valid: Array<'home' | 'chores' | 'money' | 'goals' | 'lab'> = ['home', 'chores', 'money', 'goals', 'lab']
    const fromQuery = searchParams.get('tab')
    return valid.includes(fromQuery as typeof valid[number]) ? (fromQuery as typeof valid[number]) : 'home'
  })
  // Warm start: the initializer above only runs on first mount, so navigating
  // to /child?tab=chores while this screen is ALREADY mounted (a push-
  // notification deep-link tap with the app open/backgrounded) would otherwise
  // do nothing. Re-apply a valid ?tab= whenever the query param changes.
  const queryTab = searchParams.get('tab')
  useEffect(() => {
    const valid: Array<'home' | 'chores' | 'money' | 'goals' | 'lab'> = ['home', 'chores', 'money', 'goals', 'lab']
    if (valid.includes(queryTab as typeof valid[number])) setChildTab(queryTab as typeof valid[number])
  }, [queryTab])
  const [labUnread,     setLabUnread]     = useState(0)
  const [submitting,    setSubmitting]    = useState<string | null>(null)
  const [submitted,     setSubmitted]     = useState<Set<string>>(new Set())
  const [noteChore,     setNoteChore]     = useState<string | null>(null)
  const [noteText,      setNoteText]      = useState('')
  const [submitErr,     setSubmitErr]     = useState<string | null>(null)
  const [proofChoreId,  setProofChoreId]  = useState<string | null>(null)
  const proofFileRef = useRef<HTMLInputElement>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!familyId || !userId) { navigate('/lock'); return }
    if (!silent) setLoading(true)
    try {
      const [c, b, g, p, s, lockStatus] = await Promise.all([
        getChores({ family_id: familyId, child_id: userId }).then(r => r.chores),
        getBalance(familyId, userId),
        getGoals(familyId, userId).then(r => r.goals.filter(g => !g.archived)),
        getCompletions({ family_id: familyId, child_id: userId, status: 'awaiting_review' }).then(r => r.completions),
        getSettings(),
        getMyLockStatus().catch(() => ({ locked: false, locked_until: null })),
      ])
      setLockedUntil(lockStatus.locked_until)
      setChores(c)
      if (c.length > 0) setCurrency(c[0].currency)
      setBalance(b)
      setGoals(g)
      setPending(p)
      const av = (s.app_view ?? 'ORCHARD') as 'ORCHARD' | 'CLEAN'
      setAppView(av)
      if (s.avatar_id) {
        setAvatarId(s.avatar_id)
        updateDeviceIdentity({ avatar_id: s.avatar_id })
      }
      // Count modules unlocked in the last 7 days with no acts started yet
      try {
        const { getLabModules } = await import('../lib/api')
        const labData = await getLabModules()
        const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
        const unread = Object.values(labData.modules).filter(
          m => m.unlocked_at > sevenDaysAgo && m.completed_acts.length === 0
        ).length
        setLabUnread(unread)
      } catch { /* non-critical — badge silently absent */ }
      // Estimate weekly income: chore rewards + fixed allowance (ALLOWANCE/HYBRID)
      const choreWeekly = c.reduce((sum, chore) => {
        if (chore.frequency === 'weekly') return sum + chore.reward_amount
        if (chore.frequency === 'daily')  return sum + chore.reward_amount * 5
        if (chore.frequency === 'school_days') return sum + chore.reward_amount * 5
        return sum
      }, 0)
      const em = (s.earnings_mode ?? 'CHORES') as 'ALLOWANCE' | 'CHORES' | 'HYBRID'
      const aa = s.allowance_amount ?? 0
      const af = (s.allowance_frequency ?? 'WEEKLY') as 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY'
      const allowanceWeekly = (em === 'ALLOWANCE' || em === 'HYBRID')
        ? (af === 'WEEKLY' ? aa : af === 'BI_WEEKLY' ? Math.round(aa / 2) : Math.round(aa / 4))
        : 0
      setWeeklyAllowancePence(choreWeekly + allowanceWeekly)
      setEarningsMode(em)
      setAllowanceAmountPence(aa)
      // Keep localStorage in sync so the anti-flicker script and ThemeProvider
      // both see the latest value on the next cold start.
      try { localStorage.setItem('mc_app_view', av) } catch { /* ignore */ }
      // Pre-mark chores that already have a pending submission today
      const pendingChoreIds = new Set(p.map(cp => cp.chore_id))
      setSubmitted(pendingChoreIds)
      // Animate goal bar after a short delay so transition plays from 0
      const topGoal = g[0]
      if (topGoal) {
        // BUG-026 fix: when jars are enabled the purchase draws from Save jar only.
        const progressBalance = (b.jars?.enabled && b.jars.save != null) ? b.jars.save : b.available
        if (progressBalance > 0) {
          if (goalBarTimer.current) clearTimeout(goalBarTimer.current)
          setGoalBarPct(0)
          goalBarTimer.current = setTimeout(() => {
            setGoalBarPct(Math.min(100, Math.round((progressBalance / topGoal.target_amount) * 100)))
          }, 80)
        }
      }
    } catch {
      navigate('/lock')
    } finally {
      setLoading(false)
    }
  }, [familyId, userId, navigate])

  useEffect(() => { load() }, [load])

  // Contextual push-permission prompt: first dashboard load with ≥1 assigned
  // chore. `chores` is populated by `load()` above (`setChores(c)`).
  useEffect(() => {
    if (chores.length > 0 && !hasPromptedForPushPermission()) {
      requestPushPermission().catch(() => {})
    }
  }, [chores.length])

  // Refresh chores + balance when app regains visibility or every 30s
  // so newly assigned chores appear without requiring a re-login
  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  // Fetch streak + badge data on mount
  useEffect(() => {
    if (!userId) return
    authHeaders()
      .then(headers => fetch(apiUrl(`/api/streaks/${userId}`), { headers }))
      .then(r => r.ok ? r.json() : null)
      .then((data: { current_streak: number; longest_streak: number; earned_badge_keys: string[]; total_approved_chores: number; total_goals_completed: number; total_saved_pence: number } | null) => {
        if (data) setStreakData(data)
      })
      .catch(() => { /* non-critical — badges silently absent */ })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch AI Mentor nudges on mount — one request covers all three screen contexts
  useEffect(() => {
    if (!userId) return
    getChildNudges(userId)
      .then(r => setChildNudges(r.nudges))
      .catch(() => { /* non-critical — nudges silently absent */ })
  }, [userId])

  // Drain the celebration queue whenever balance data changes
  useEffect(() => {
    if (balance?.pending_celebrations) {
      enqueuePendingCelebrations(balance.pending_celebrations, appView)
    }
    if (!activeCelebration) {
      const next = consumeNextCelebration()
      if (next) setActiveCelebration(next)
    }
  }, [balance, appView]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fix A: drain the next queued celebration when the active one is dismissed
  useEffect(() => {
    if (activeCelebration !== null) return
    const next = consumeNextCelebration()
    if (next) setActiveCelebration(next)
  }, [activeCelebration])

  // Clean up goal bar timer on unmount
  useEffect(() => () => { if (goalBarTimer.current) clearTimeout(goalBarTimer.current) }, [])

  // ── Grove planner helpers ──────────────────────────────────────────────────

  function togglePlant(chore: Chore, day: number) {
    if (isAutoPlant(chore.frequency)) return   // auto-planted, not togglable
    if (weeklyDayFromChore(chore) !== null) return  // fixed by parent
    const updated = { ...grovePlans }
    const days = updated[chore.id] ? [...updated[chore.id]] : []
    if (chore.frequency === 'one-off') {
      // Radio: selecting the same day deselects; otherwise replace with the new day
      updated[chore.id] = days[0] === day ? [] : [day]
    } else {
      const idx = days.indexOf(day)
      if (idx === -1) days.push(day)
      else days.splice(idx, 1)
      updated[chore.id] = days
    }
    setGrovePlans(updated)
    saveGrovePlans(userId, updated)
  }

  // ── Submission ─────────────────────────────────────────────────────────────

  async function handleDone(choreId: string, note?: string, file?: File) {
    setSubmitting(choreId)
    setSubmitErr(null)
    try {
      const result = await submitChore(choreId, note)
      if (file) await uploadProof(result.id, file)
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

  async function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !proofChoreId) return
    e.target.value = ''
    const id = proofChoreId
    setProofChoreId(null)
    await handleDone(id, undefined, file)
  }

  function startProofCapture(choreId: string) {
    setProofChoreId(choreId)
    setTimeout(() => proofFileRef.current?.click(), 50)
  }

  // ── Goal purchase ──────────────────────────────────────────────────────────

  async function _handlePurchase(goalId: string) {
    setPurchasing(goalId)
    try {
      await purchaseGoal(goalId)
      await load()
    } catch { /* ignore — goal already reached */ }
    finally { setPurchasing(null) }
  }

  // ── Filtered chores for active day ────────────────────────────────────────

  const dayChores = useMemo(
    () => chores.filter(c => effectiveDays(c, grovePlans).includes(activeDay)),
    [chores, grovePlans, activeDay],
  )

  const _unplannedChores = useMemo(
    () => chores.filter(c => effectiveDays(c, grovePlans).length === 0),
    [chores, grovePlans],
  )

  // One-off chores past their due date that haven't been submitted yet.
  const overdueChores = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    return chores.filter(c => {
      if (c.archived || c.frequency !== 'one-off' || !c.due_date || submitted.has(c.id)) return false
      const due = new Date(c.due_date)
      return !isNaN(due.getTime()) && due < todayStart
    })
  }, [chores, submitted])

  const activeTopGoal = goals[0] ?? null
  const tone = useAppView(appView)

  // ── Render ─────────────────────────────────────────────────────────────────

  // Teen mode uses flatter shadows and sharper borders for a fintech feel
  const cardClass = tone.isChild
    ? 'bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] card-depth overflow-hidden'
    : 'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] card-depth overflow-hidden'

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      {milestone && (
        <MilestoneOverlay event={milestone} onComplete={() => setMilestone(null)} />
      )}
      {activeCelebration && CONFIGS[activeCelebration.type]?.tier === 'micro' ? (
        <MicroToast
          event={activeCelebration}
          onDismiss={() => setActiveCelebration(null)}
        />
      ) : activeCelebration ? (
        <MilestoneOverlay
          event={activeCelebration}
          onComplete={() => setActiveCelebration(null)}
        />
      ) : null}
      {/* Account lock banner — shown when a parent has temporarily restricted this account */}
      {lockedUntil && lockedUntil > Date.now() / 1000 && (
        <div className="bg-amber-500/15 border-b border-amber-400/30 px-4 py-2.5 text-center">
          <p className="text-[0.8125rem] font-semibold text-amber-700 dark:text-amber-300">
            Your account is paused by a parent until{' '}
            {new Date(lockedUntil * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            You can still view everything, but earning is on hold.
          </p>
        </div>
      )}
      {/* Header */}
      <header className="safe-top sticky top-0 z-40 glass-header">
        <div className="max-w-[520px] mx-auto px-3.5 py-3 flex items-center justify-between">
          <FullLogo iconSize={26} />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="tap-target-44 w-10 h-10 rounded-xl border border-[color-mix(in_srgb,var(--brand-primary)_28%,var(--color-border))] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] hover:border-[var(--brand-primary)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-colors cursor-pointer"
              title="Settings"
              aria-label="Settings"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button
              onClick={() => navigate('/lock?manual=1')}
              className="tap-target-44 w-10 h-10 rounded-xl border border-[color-mix(in_srgb,var(--brand-primary)_28%,var(--color-border))] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] hover:border-[var(--brand-primary)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-colors cursor-pointer"
              title="Lock"
              aria-label="Lock screen"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
          <div
            ref={settingsPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-t-2xl shadow-xl max-w-[560px] w-full mx-auto px-4 pt-4 pb-10 space-y-5"
          >
            <div className="flex items-center justify-between">
              <p className="text-[1rem] font-extrabold text-[var(--color-text)]">Settings</p>
              <button
                onClick={() => setShowSettings(false)}
                className="tap-target-44 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Avatar */}
            <div>
              <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Avatar</p>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-[var(--color-border)] shrink-0">
                  <AvatarSVG id={avatarId} size={56} />
                </div>
                <button
                  onClick={() => setShowAvatarPicker(v => !v)}
                  className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
                >
                  {showAvatarPicker ? 'Close' : 'Change avatar'}
                </button>
              </div>

              {showAvatarPicker && (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-[var(--color-border)] p-2.5">
                  {AVATAR_CATEGORIES.map(cat => (
                    <div key={cat.id} className="mb-3 last:mb-0">
                      <p className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-0.5">{cat.label}</p>
                      <div className="grid grid-cols-6 gap-1.5">
                        {avatarsForCategory(cat.id as AvatarCategory).map(avId => (
                          <button
                            key={avId}
                            disabled={savingAvatar}
                            onClick={async () => {
                              setSavingAvatar(true)
                              try {
                                await updateSettings({ avatar_id: avId })
                                setAvatarId(avId)
                                updateDeviceIdentity({ avatar_id: avId })
                              } finally {
                                setSavingAvatar(false)
                              }
                            }}
                            className={`p-0.5 rounded-xl border-2 transition-colors cursor-pointer disabled:opacity-50 ${
                              avId === avatarId
                                ? 'border-[var(--brand-primary)]'
                                : 'border-transparent hover:border-[var(--color-border)]'
                            }`}
                          >
                            <AvatarSVG id={avId} size={36} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Appearance */}
            <div>
              <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Appearance</p>
              <div className="space-y-3">
                <ThemePicker />
                <HighContrastToggle />
              </div>
            </div>

            {/* Experience mode — read-only, parent controls */}
            <div>
              <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Experience</p>
              <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-3.5 py-3 bg-[var(--color-surface-alt)]">
                <div>
                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">
                    {appView === 'CLEAN' ? 'Professional mode' : 'Orchard mode'}
                  </p>
                  <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-0.5">Set by your parent</p>
                </div>
                <span className="text-[1.375rem] select-none">{appView === 'CLEAN' ? '📊' : '🌱'}</span>
              </div>
            </div>

            {/* Lock / switch-user lives on the dedicated header Lock button —
                no duplicate here. */}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[520px] mx-auto w-full px-3.5 py-4 pb-28 flex flex-col gap-4">
        {childTab === 'home' && (
          tone.isChild ? (
            <OrchardView
              balance={balance}
              appView={appView}
              chores={chores}
              pending={_pending}
              goals={goals}
              tone={tone}
              activeDay={activeDay}
              setActiveDay={setActiveDay}
              grovePlans={grovePlans}
              dayChores={dayChores}
              unplannedChores={_unplannedChores}
              overdueChores={overdueChores}
              activeTopGoal={activeTopGoal}
              goalBarPct={goalBarPct}
              submitted={submitted}
              submitting={submitting}
              purchasing={_purchasing}
              noteChore={noteChore}
              noteText={noteText}
              submitErr={submitErr}
              cardClass={cardClass}
              currency={currency}
              weeklyAllowancePence={weeklyAllowancePence}
              handleDone={handleDone}
              handlePurchase={_handlePurchase}
              setNoteChore={setNoteChore}
              setNoteText={setNoteText}
              onPlantGoal={() => setShowGrove(true)}
              onDoneWithProof={startProofCapture}
              streakData={streakData}
            />
          ) : (
            <ProfessionalView
              balance={balance}
              appView={appView}
              chores={chores}
              pending={_pending}
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
              onDoneWithProof={startProofCapture}
              cardClass={cardClass}
              activeDay={activeDay}
              setActiveDay={setActiveDay}
              grovePlans={grovePlans}
              dayChores={dayChores}
              overdueChores={overdueChores}
              streakData={streakData}
            />
          )
        )}

        <div className={childTab === 'chores' ? 'tab-panel' : 'tab-panel hidden'}>
          <div className="space-y-4">
            {/* AI Mentor earn nudge — dismisses itself when the X is tapped */}
            {childNudges.earn && (
              <ChildNudgeBanner
                nudge={childNudges.earn}
                appView={appView}
                onDismiss={() => setChildNudges(n => ({ ...n, earn: null }))}
              />
            )}

            <EarnTab familyId={familyId} childId={userId} currency={chores[0]?.currency ?? 'GBP'} grovePlans={grovePlans} onTogglePlant={togglePlant} appView={appView} earningsMode={earningsMode} allowanceAmountPence={allowanceAmountPence} />

            {/* Badges & streaks */}
            {!loading && streakData && (
              <BadgeAlmanac
                earnedBadgeKeys={streakData.earned_badge_keys}
                progress={{
                  longestStreak:         streakData.longest_streak,
                  totalApprovedChores:   streakData.total_approved_chores,
                  totalGoalsCompleted:   streakData.total_goals_completed,
                  totalSavedPence:       streakData.total_saved_pence,
                  totalLessonsCompleted: 0,
                }}
                appView={appView}
              />
            )}
          </div>
        </div>
        <div className={childTab === 'money' ? 'tab-panel' : 'tab-panel hidden'}>
          <ChildMoneyTab
            familyId={familyId}
            childId={userId}
            currency={currency}
            appView={appView}
            nudge={childNudges.money}
            onNudgeDismiss={() => setChildNudges(n => ({ ...n, money: null }))}
          />
        </div>
        <div className={childTab === 'goals' ? 'tab-panel' : 'tab-panel hidden'}>
          <ChildGoalsTab
            familyId={familyId}
            childId={userId}
            currency={currency}
            appView={appView}
            nudge={childNudges.goals}
            onNudgeDismiss={() => setChildNudges(n => ({ ...n, goals: null }))}
          />
        </div>
        <div className={childTab === 'lab'   ? 'tab-panel' : 'tab-panel hidden'}><LabTab appView={appView} /></div>

      </main>

      <ChildBottomNav
        activeTab={childTab}
        onTabChange={id => { setChildTab(id); if (id === 'lab') setLabUnread(0) }}
        badges={{ lab: labUnread }}
      />

      {/* Hidden camera input for proof-required chores */}
      <input
        ref={proofFileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleProofFileChange}
      />

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

      {import.meta.env.DEV && <DevTriggerPanel childId={userId} />}
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
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="w-9 h-9 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center shrink-0 text-[var(--color-text-muted)]">
          <ChoreIcon title={chore.title} size={18} />
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {!!chore.is_flash && (
              <span className="text-[0.625rem] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>
            )}
            {isRecurring && (
              <span className="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] rounded px-1.5 py-0.5">
                <RecurringIcon /> Repeating
              </span>
            )}
            <span className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate">{chore.title}</span>
          </div>
          <p className="text-[0.75rem] font-semibold text-[var(--brand-accent)] mt-0.5 tabular-nums">
            {formatCurrency(chore.reward_amount, chore.currency)}
          </p>
          {chore.proof_required ? (
            <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
              <CameraIconSmall /> Photo required to submit
            </p>
          ) : null}
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
          <span className="shrink-0 text-[0.75rem] font-bold text-amber-700 bg-amber-100 rounded-full px-2.5 py-1">
            {tone.waitingBadge}
          </span>
        ) : (
          <button
            onClick={() => { triggerHaptic(); onDone() }}
            disabled={submitting}
            className={`shrink-0 h-9 bg-[var(--brand-primary)] text-white text-[0.8125rem] font-bold ${tone.isChild ? 'rounded-xl' : 'rounded-lg'} hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 btn-depth ${chore.proof_required ? 'px-3' : 'px-3.5'}`}
          >
            {submitting ? '…' : chore.proof_required ? <><CameraIconSmall />{tone.doneButton}</> : tone.doneButton}
          </button>
        )}
      </div>

      {/* Note drawer */}
      {noteOpen && (
        <div className="mt-3 space-y-2">
          <ErrorBox message={submitErr} />
          <textarea
            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[0.8125rem] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] placeholder:text-[var(--color-text-muted)]"
            placeholder="Add a note for your parent (optional)"
            rows={2}
            value={noteText}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onNoteCancel}
              className="flex-1 border border-[var(--color-border)] rounded-lg py-2 text-[0.8125rem] font-semibold text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-surface-alt)]"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              disabled={submitting}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-lg py-2 text-[0.8125rem] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
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

function CameraIconSmall() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}

// ─── WeeklyPlannerCard — collapsible "My week" chore list, shared by both home views ──

interface WeeklyPlannerCardProps {
  cardClass: string
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  activeDay: number
  setActiveDay: (d: number) => void
  chores: Chore[]
  grovePlans: Record<string, number[]>
  dayChores: Chore[]
  submitted: Set<string>
  submitting: string | null
  noteChore: string | null
  noteText: string
  submitErr: string | null
  onDone: (chore: Chore) => void
  onNoteChange: (v: string) => void
  onNoteSubmit: (chore: Chore) => void
  onNoteCancel: () => void
}

function WeeklyPlannerCard({
  cardClass, tone, activeDay, setActiveDay, chores, grovePlans, dayChores,
  submitted, submitting, noteChore, noteText, submitErr,
  onDone, onNoteChange, onNoteSubmit, onNoteCancel,
}: WeeklyPlannerCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cardClass}>
      <button
        type="button"
        onClick={() => { triggerHaptic(); setExpanded(e => !e) }}
        className="w-full flex items-center justify-between px-4 py-4 text-left cursor-pointer"
      >
        <div>
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-text)]">{tone.weekSection}</h2>
          <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
            {dayChores.length === 0
              ? tone.weekSubtitle
              : `${dayChores.length} chore${dayChores.length !== 1 ? 's' : ''} today`}
          </p>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-[var(--color-text-muted)] shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {expanded && (
        <>
          <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {DAYS.map((day, i) => {
              const dayNum = i + 1
              const isToday = activeDay === dayNum
              const hasChores = chores.some(c => effectiveDays(c, grovePlans).includes(dayNum))
              return (
                <button
                  key={day}
                  onClick={() => { triggerHaptic(); setActiveDay(dayNum) }}
                  className={`shrink-0 flex flex-col items-center rounded-xl px-2.5 py-2 min-w-[44px] transition-colors duration-100 cursor-pointer
                    ${isToday ? 'bg-[var(--brand-primary)] text-white day-pill-active' : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'}`}
                >
                  <span className="text-[0.6875rem] font-semibold">{day}</span>
                  <span className={`mt-1.5 rounded-full w-1.5 h-1.5 ${hasChores ? (isToday ? 'bg-white/50' : 'bg-[var(--brand-primary)]') : 'bg-transparent'}`} />
                </button>
              )
            })}
          </div>
          <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {dayChores.length === 0 ? (
              <p className="px-4 py-5 text-[0.8125rem] text-[var(--color-text-muted)] text-center">
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
                  onDone={() => onDone(chore)}
                  onNoteChange={onNoteChange}
                  onNoteSubmit={() => onNoteSubmit(chore)}
                  onNoteCancel={onNoteCancel}
                  showPlantButton={false}
                  planted={true}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── KpiRow — compact effort/progress snapshot, shared by both home views ─────

interface KpiRowProps {
  streakData: {
    longest_streak:        number
    total_approved_chores: number
    total_goals_completed: number
    earned_badge_keys:     string[]
  } | null
}

function KpiRow({ streakData }: KpiRowProps) {
  if (!streakData) return null
  const stats: { icon: string; value: number; label: string; cardClass: string }[] = [
    {
      icon: '✅', value: streakData.total_approved_chores, label: 'Chores done',
      cardClass: 'bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)]',
    },
    {
      icon: '🎯', value: streakData.total_goals_completed, label: 'Goals hit',
      cardClass: 'bg-[color-mix(in_srgb,var(--brand-accent)_8%,transparent)] border-[color-mix(in_srgb,var(--brand-accent)_20%,transparent)]',
    },
    {
      icon: '🏆', value: streakData.earned_badge_keys.length, label: 'Badges',
      cardClass: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900',
    },
  ]
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map(({ icon, value, label, cardClass }) => (
        <div key={label} className={`rounded-xl border p-3 text-center ${cardClass}`}>
          <div className="text-[1.125rem] leading-none mb-1">{icon}</div>
          <div className="text-[1.0625rem] font-extrabold text-[var(--color-text)] tabular-nums leading-none">{value}</div>
          <div className="text-[0.625rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mt-1">{label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── OverdueChoresCard — one-off chores past their due date, not yet
// submitted. Surfaced on Home so nothing slips through unnoticed; everything
// else chore-related (browsing, scheduling, history) lives in the Chores tab.

interface OverdueChoresCardProps {
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  chores: Chore[]
  submitted: Set<string>
  submitting: string | null
  noteChore: string | null
  noteText: string
  submitErr: string | null
  onDone: (chore: Chore) => void
  onNoteChange: (v: string) => void
  onNoteSubmit: (chore: Chore) => void
  onNoteCancel: () => void
}

function OverdueChoresCard({
  tone, chores, submitted, submitting, noteChore, noteText, submitErr,
  onDone, onNoteChange, onNoteSubmit, onNoteCancel,
}: OverdueChoresCardProps) {
  if (chores.length === 0) return null

  return (
    <div className="bg-[var(--color-surface)] rounded-2xl card-depth border-2 border-amber-400 overflow-hidden">
      <div className="px-4 pt-4 pb-1 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <h2 className="text-[0.8125rem] font-extrabold text-amber-600 uppercase tracking-wider">
          {chores.length === 1 ? 'Overdue — 1 chore' : `Overdue — ${chores.length} chores`}
        </h2>
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
            onDone={() => onDone(chore)}
            onNoteChange={onNoteChange}
            onNoteSubmit={() => onNoteSubmit(chore)}
            onNoteCancel={onNoteCancel}
            showPlantButton={false}
            planted={false}
          />
        ))}
      </div>
    </div>
  )
}

// ─── OrchardView ─────────────────────────────────────────────────────────────
// Card-based, metaphorical layout for younger children.
// ─────────────────────────────────────────────────────────────────────────────

interface OrchardViewProps {
  balance: BalanceSummary | null
  appView: 'ORCHARD' | 'CLEAN'
  chores: Chore[]
  pending: Completion[]
  goals: Goal[]
  tone: ReturnType<typeof import('../lib/useTone').useTone>
  activeDay: number
  setActiveDay: (d: number) => void
  grovePlans: Record<string, number[]>
  dayChores: Chore[]
  unplannedChores: Chore[]
  overdueChores: Chore[]
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
  handleDone: (id: string, note?: string, file?: File) => Promise<void>
  handlePurchase: (id: string) => Promise<void>
  setNoteChore: (id: string | null) => void
  setNoteText: (t: string) => void
  onPlantGoal: () => void
  onDoneWithProof: (choreId: string) => void
  streakData: KpiRowProps['streakData']
}

function OrchardView({
  balance, appView, chores, pending, goals, tone,
  activeDay, setActiveDay, grovePlans, dayChores, unplannedChores, overdueChores,
  activeTopGoal, goalBarPct, submitted, submitting, purchasing,
  noteChore, noteText, submitErr, cardClass, currency, weeklyAllowancePence,
  handleDone, handlePurchase,
  setNoteChore, setNoteText, onPlantGoal, onDoneWithProof, streakData,
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
      return `${weeks} week${weeks !== 1 ? 's' : ''} of saving`
    }
    return formatCurrency(targetPence, currency)
  }

  const activeGoals = goals.filter(g => g.status === 'ACTIVE' || !g.status)
  return (
    <>
      {/* Balance card */}
      <div className="bg-[var(--color-surface)] rounded-2xl card-depth border-t-[3px] border-t-[var(--brand-primary)] border border-[var(--color-border)] p-4">
        <div className="text-[0.75rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{tone.balance}</div>
        <div className="text-[2.875rem] font-extrabold text-[var(--color-text)] leading-none tracking-tight tabular-nums">
          {balance ? formatCurrency(balance.available, currency) : '£—'}
        </div>
        <div className="flex gap-4 mt-2">
          <span className="text-[0.8125rem] text-[var(--color-text-muted)]">
            Earned: <strong className="text-[var(--color-text)] tabular-nums">
              {balance ? formatCurrency(balance.earned, currency) : '—'}
            </strong>
          </span>
          {(balance?.pending ?? 0) > 0 && (
            <span className="text-[0.8125rem] text-[var(--color-text-muted)]">
              Pending: <strong className="text-amber-500 tabular-nums">
                {formatCurrency(balance!.pending, currency)}
              </strong>
            </span>
          )}
        </div>
        {balance?.streak && balance.streak.current > 0 && (
          <div className="flex items-center gap-2 mt-2 text-sm text-teal-400 font-semibold tabular-nums">
            <span>🔥</span>
            <span>{balance.streak.current} day streak</span>
            {balance.streak.grace_remaining > 0 && (
              <span className="text-white/40 text-xs">
                ({balance.streak.grace_remaining} {appView === 'CLEAN' ? 'grace' : 'rain'}{balance.streak.grace_remaining > 1 ? ' days' : ' day'})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pending nudge */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-[1.25rem]">⏳</span>
          <p className="text-[0.8125rem] text-amber-800 font-semibold">
            {pending.length === 1
              ? `1 chore is waiting for your parent to check`
              : `${pending.length} chores are waiting for your parent to check`}
          </p>
        </div>
      )}

      {/* Overdue — one-off chores past their due date, not yet submitted */}
      <OverdueChoresCard
        tone={tone}
        chores={overdueChores}
        submitted={submitted}
        submitting={submitting}
        noteChore={noteChore}
        noteText={noteText}
        submitErr={submitErr}
        onDone={chore => chore.proof_required ? onDoneWithProof(chore.id) : (setNoteChore(chore.id), setNoteText(''))}
        onNoteChange={setNoteText}
        onNoteSubmit={chore => handleDone(chore.id, noteText || undefined)}
        onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
      />

      {/* Effort snapshot */}
      <KpiRow streakData={streakData} />

      {/* Weekly tracker — collapsed by default */}
      <WeeklyPlannerCard
        cardClass={cardClass}
        tone={tone}
        activeDay={activeDay}
        setActiveDay={setActiveDay}
        chores={chores}
        grovePlans={grovePlans}
        dayChores={dayChores}
        submitted={submitted}
        submitting={submitting}
        noteChore={noteChore}
        noteText={noteText}
        submitErr={submitErr}
        onDone={chore => chore.proof_required ? onDoneWithProof(chore.id) : chore.description ? setNoteChore(chore.id) : handleDone(chore.id)}
        onNoteChange={setNoteText}
        onNoteSubmit={chore => handleDone(chore.id, noteText || undefined)}
        onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
      />

      {chores.length === 0 && (
        <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] p-8 text-center">
          <p className="text-[1.75rem] mb-2">🌱</p>
          <p className="text-[0.9375rem] font-semibold text-[var(--color-text)]">{tone.emptyGrove}</p>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1">{tone.emptyGroveSub}</p>
        </div>
      )}

      {/* ── My Goals: Effort-to-Earn Mentor ──────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl card-depth border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-text)]">🎯 My Goals</h2>
          <button
            onClick={onPlantGoal}
            className="tap-target-44 flex items-center gap-1.5 text-[0.75rem] font-bold text-[var(--brand-primary)] border border-[var(--brand-primary)] rounded-lg px-2.5 py-1 hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
          >
            <span>+</span> Add Goal
          </button>
        </div>

        {activeGoals.length === 0 ? (
          <div className="px-4 pb-5 text-center flex flex-col items-center">
            <GrowingTree pct={0} size={64} showLabel className="mb-1" />
            <p className="text-[0.8125rem] font-semibold text-[var(--color-text)]">No goals yet</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">Tap "Add Goal" to start saving for something exciting!</p>
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
                  <div className="flex items-center gap-4">
                    <GrowingTree pct={pct} size={72} showLabel />
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate">{activeTopGoal.title}</div>
                      {activeTopGoal.parent_match_pct > 0 && (
                        <div className="text-[0.6875rem] text-emerald-600 font-semibold mt-0.5">
                          🤝 Parent matches {activeTopGoal.parent_match_pct}% — you only need {formatCurrency(effTarget, activeTopGoal.currency)}!
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="w-full h-4 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--brand-primary)] rounded-full progress-fill-glow"
                        style={{ width: `${goalBarPct}%`, transition: 'width 1.1s cubic-bezier(0.25, 1, 0.5, 1)' }}
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(avail, activeTopGoal.currency)} saved</span>
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">{pct}% • {formatCurrency(effTarget, activeTopGoal.currency)}</span>
                    </div>
                  </div>

                  {/* Effort labels */}
                  <div className="rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3.5 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-[0.75rem]">
                      <span>💪</span>
                      <span className="text-[var(--color-text-muted)]">Total cost:</span>
                      <span className="font-semibold text-[var(--color-text)]">{effortLabel(activeTopGoal.target_amount)}</span>
                    </div>
                    {remaining > 0 && (
                      <div className="flex items-center gap-2 text-[0.75rem]">
                        <span>🌿</span>
                        <span className="text-[var(--color-text-muted)]">Still need:</span>
                        <span className="font-semibold text-[var(--color-text)]">{effortLabel(remaining)}</span>
                      </div>
                    )}
                    {arrivalDate && (
                      <div className="flex items-center gap-2 text-[0.75rem]">
                        <span>📅</span>
                        <span className="text-[var(--color-text-muted)]">Estimated arrival:</span>
                        <span className="font-semibold text-[var(--brand-accent)]">{arrivalDate}</span>
                      </div>
                    )}
                  </div>

                  {/* Purchase button when funded */}
                  {isReady && (
                    <button
                      onClick={() => handlePurchase(activeTopGoal.id)}
                      disabled={purchasing === activeTopGoal.id}
                      className="w-full rounded-xl bg-emerald-500 text-white font-bold py-2.5 text-[0.8125rem] hover:bg-emerald-600 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {purchasing === activeTopGoal.id ? '🎉 Saving…' : '🎉 Mark as Purchased!'}
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Trade-off tool: secondary goals in same effort unit */}
            {activeGoals.length > 1 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">All goals — effort comparison</p>
                <div className="grid grid-cols-1 gap-2">
                  {activeGoals.map((g, i) => (
                    <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${i === 0 ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)]' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
                      <span className="text-base">{i === 0 ? '🎯' : '⭕'}</span>
                      <span className="flex-1 text-[0.75rem] font-semibold text-[var(--color-text)] truncate">{g.title}</span>
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] shrink-0">{effortLabel(g.target_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {unplannedChores.length > 0 && (
        <p className="text-center text-[0.75rem] text-[var(--color-text-muted)]">
          {unplannedChores.length} chore{unplannedChores.length > 1 ? 's' : ''} not in your week yet — find {unplannedChores.length > 1 ? 'them' : 'it'} in the Chores tab.
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
  appView: 'ORCHARD' | 'CLEAN'
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
  handleDone: (id: string, note?: string, file?: File) => Promise<void>
  setNoteChore: (id: string | null) => void
  setNoteText: (t: string) => void
  onDoneWithProof: (choreId: string) => void
  cardClass: string
  activeDay: number
  setActiveDay: (d: number) => void
  grovePlans: Record<string, number[]>
  dayChores: Chore[]
  overdueChores: Chore[]
  streakData: KpiRowProps['streakData']
}

function ProfessionalView({
  balance, appView, chores, pending, goals,
  tone, currency, submitted, submitting,
  noteChore, noteText, submitErr,
  handleDone, setNoteChore, setNoteText, onDoneWithProof,
  cardClass, activeDay, setActiveDay, grovePlans, dayChores, overdueChores, streakData,
}: ProfessionalViewProps) {
  return (
    <>
      {/* Account summary — dense stat row */}
      <div className="bg-[linear-gradient(155deg,color-mix(in_srgb,var(--brand-primary)_10%,var(--color-surface))_0%,var(--color-surface)_60%)] rounded-xl border-t-[3px] border-t-[var(--brand-primary)] border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-4 border-b border-[var(--color-border)] flex flex-col items-center text-center">
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{tone.balance}</p>
          <p className="text-[2.25rem] font-extrabold text-[var(--color-text)] leading-none tabular-nums mt-1">
            {balance ? formatCurrency(balance.available, currency) : '£—'}
          </p>
          {balance?.streak && balance.streak.current > 0 && (
            <div className="flex items-center gap-2 mt-2 text-sm text-teal-400 font-semibold tabular-nums">
              <span>🔥</span>
              <span>{balance.streak.current} day streak</span>
              {balance.streak.grace_remaining > 0 && (
                <span className="text-[var(--color-text-muted)] text-xs">
                  ({balance.streak.grace_remaining} {appView === 'CLEAN' ? 'grace' : 'rain'}{balance.streak.grace_remaining > 1 ? ' days' : ' day'})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
          {[
            { label: 'Earned',  value: balance?.earned    ?? 0 },
            { label: 'Pending', value: balance?.pending   ?? 0 },
            { label: 'Spent',   value: balance?.spent     ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2.5">
              <p className="text-[0.625rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</p>
              <p className="text-[0.8125rem] font-bold text-[var(--color-text)] tabular-nums mt-0.5">
                {formatCurrency(value, currency)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Pending transactions alert */}
      {pending.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-amber-300 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <p className="text-[0.8125rem] font-semibold text-[var(--color-text)]">
            {pending.length} pending transaction{pending.length > 1 ? 's' : ''}
          </p>
          <span className="text-[0.6875rem] font-bold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">AWAITING APPROVAL</span>
        </div>
      )}

      {/* Overdue — one-off chores past their due date, not yet submitted */}
      <OverdueChoresCard
        tone={tone}
        chores={overdueChores}
        submitted={submitted}
        submitting={submitting}
        noteChore={noteChore}
        noteText={noteText}
        submitErr={submitErr}
        onDone={chore => chore.proof_required ? onDoneWithProof(chore.id) : (setNoteChore(chore.id), setNoteText(''))}
        onNoteChange={setNoteText}
        onNoteSubmit={chore => handleDone(chore.id, noteText || undefined)}
        onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
      />

      {/* Effort snapshot */}
      <KpiRow streakData={streakData} />

      {/* Chore list — collapsed by default */}
      <WeeklyPlannerCard
        cardClass={cardClass}
        tone={tone}
        activeDay={activeDay}
        setActiveDay={setActiveDay}
        chores={chores}
        grovePlans={grovePlans}
        dayChores={dayChores}
        submitted={submitted}
        submitting={submitting}
        noteChore={noteChore}
        noteText={noteText}
        submitErr={submitErr}
        onDone={chore => chore.proof_required ? onDoneWithProof(chore.id) : (setNoteChore(chore.id), setNoteText(''))}
        onNoteChange={setNoteText}
        onNoteSubmit={chore => handleDone(chore.id, noteText || undefined)}
        onNoteCancel={() => { setNoteChore(null); setNoteText('') }}
      />

      {/* Savings goals — compact list */}
      {goals.length > 0 && (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <p className="text-[0.75rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Savings Goals</p>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-2 text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Goal</th>
                <th className="px-4 py-2 text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Target</th>
                <th className="px-4 py-2 text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide text-right">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {goals.map(goal => {
                const pct = Math.min(100, Math.round(((balance?.available ?? 0) / goal.target_amount) * 100))
                return (
                  <tr key={goal.id}>
                    <td className="px-4 py-2.5">
                      <span className="text-[0.8125rem] font-semibold text-[var(--color-text)]">{goal.title}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-[0.75rem] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(goal.target_amount, goal.currency)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--brand-primary)] rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] tabular-nums w-8 text-right">{pct}%</span>
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
