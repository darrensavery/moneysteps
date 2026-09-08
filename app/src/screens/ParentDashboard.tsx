import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ChildRecord } from '../lib/api'
import { getChildren, getCompletions, clearToken, getUnpaidSummary, getFamily, getTrialStatus, authHeaders, apiUrl, type UnpaidSummaryRow, type TrialStatus } from '../lib/api'
import { getDeviceIdentity } from '../lib/deviceIdentity'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { StreakChip } from '../components/dashboard/StreakChip'
import { useLocale, isPolish } from '../lib/locale'
import { AvatarSVG } from '../lib/avatars'
import { ChoresTab }   from '../components/dashboard/JobsTab'
import { ActivityTab } from '../components/dashboard/HistoryTab'
import { InsightsTab } from '../components/dashboard/InsightsTab'
import { ParentSettingsTab, type View as SettingsView } from '../components/dashboard/ParentSettingsTab'
import { PoolTab }         from '../components/dashboard/PoolTab'
import { AddExpenseSheet } from '../components/dashboard/AddExpenseSheet'
import { SettlementCard }  from '../components/dashboard/SettlementCard'
import { GoalBoostingTab }  from '../components/dashboard/GoalBoostingTab'
import { FullLogo } from '../components/ui/Logo'
import { PaymentBridgeSheet } from '../components/payment/PaymentBridgeSheet'
import { DemoBanner } from '../components/demo/DemoBanner'
import { DemoUpsellCard } from '../components/demo/DemoUpsellCard'
import { GiveRequestsPanel } from '../components/dashboard/GiveRequestsPanel'
import { ParentBottomNav } from '../components/navigation/ParentBottomNav'

// Offline signal SVG
function OfflineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <circle cx="12" cy="20" r="1" fill="currentColor"/>
    </svg>
  )
}

type Tab = 'chores' | 'activity' | 'pool' | 'insights' | 'goals'

export function ParentDashboard() {
  const navigate   = useNavigate()
  const { locale } = useLocale()
  const identity   = useMemo(() => getDeviceIdentity(), [])
  const familyId   = identity?.family_id ?? ''
  const [searchParams] = useSearchParams()

  const [tab,        setTab]        = useState<Tab>(() => {
    const valid: Tab[] = ['chores', 'activity', 'pool', 'insights', 'goals']
    const fromQuery = searchParams.get('tab')
    if (valid.includes(fromQuery as Tab)) return fromQuery as Tab
    const saved = localStorage.getItem('mc_parent_tab')
    return valid.includes(saved as Tab) ? (saved as Tab) : 'chores'
  })
  // Warm start: the initializer above only runs on first mount, so navigating
  // to /parent?tab=activity while this screen is ALREADY mounted (a push-
  // notification deep-link tap with the app open/backgrounded) would otherwise
  // do nothing. Re-apply a valid ?tab= whenever the query param changes.
  const queryTab = searchParams.get('tab')
  useEffect(() => {
    const valid: Tab[] = ['chores', 'activity', 'pool', 'insights', 'goals']
    if (valid.includes(queryTab as Tab)) setTab(queryTab as Tab)
  }, [queryTab])
  // Persist whenever the tab changes, including the initial value when it
  // came from a ?tab= query param (e.g. a push-notification deep link) —
  // not just on manual clicks via handleTabChange.
  useEffect(() => {
    localStorage.setItem('mc_parent_tab', tab)
  }, [tab])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsJump, setSettingsJump] = useState<{ view: SettingsView; token: number }>({
    view:  { type: 'menu' },
    token: 0,
  })
  function openBillingUpgrade() {
    setSettingsJump(j => ({
      view:  { type: 'section', section: 'billing', billingSubView: 'plan' },
      token: j.token + 1,
    }))
    setShowSettings(true)
  }
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
  const [showAddExpense,  setShowAddExpense]  = useState(false)
  const [showSettlement,  setShowSettlement]  = useState(false)
  const [poolRefreshKey, setPoolRefreshKey] = useState(0)

  function handleTabChange(t: Tab) {
    if (t === tab) return
    // Push a history entry per tab so the browser/OS back gesture steps back
    // through tabs one at a time, like a normal multi-page back button —
    // picked up by the ?tab= sync effect above, which also persists it.
    navigate(`/parent?tab=${t}`)
  }

  function handleSetActiveChild(child: ChildRecord) {
    setActiveChild(child)
    localStorage.setItem('mc_active_child_id', child.id)
  }

  const [children,   setChildren]   = useState<ChildRecord[]>([])
  const [activeChild, setActiveChild] = useState<ChildRecord | null>(null)
  const [childrenLoaded, setChildrenLoaded] = useState(false)
  const [pendingByChild,    setPendingByChild]    = useState<Record<string, number>>({})
  const [pendingGiveCount,  setPendingGiveCount]  = useState(0)
  // Badge = chore submissions across all children + pending give requests
  const pendingCount = Object.values(pendingByChild).reduce((sum, n) => sum + n, 0) + pendingGiveCount
  const siblingsWithPending = activeChild
    ? Object.entries(pendingByChild)
        .filter(([id, n]) => id !== activeChild.id && n > 0)
        .map(([id]) => children.find(c => c.id === id)?.display_name ?? id)
    : []
  const [online,       setOnline]       = useState(navigator.onLine)
  const [parentingMode, setParentingMode] = useState<'single' | 'co-parenting'>('single')
  const [trialStatus,  setTrialStatus]  = useState<TrialStatus | null>(null)
  const [unpaid, setUnpaid] = useState<UnpaidSummaryRow[]>([])
  const [bridgeCtx, setBridgeCtx] = useState<null | {
    child: ChildRecord; completionIds: string[]; total: number; currency: string;
  }>(null)
  const [streaksByChild, setStreaksByChild] = useState<Record<string, {
    current_streak: number
    grace_days_remaining: number
    consistency_score: number
  }>>({})

  // Child selector edge-fades — only shown when the strip actually overflows,
  // so a 3rd/4th child added later is discoverable without a redesign.
  const childScrollRef = useRef<HTMLDivElement>(null)
  const [childScrollEdges, setChildScrollEdges] = useState({ left: false, right: false })
  useEffect(() => {
    const el = childScrollRef.current
    if (!el) return
    const update = () => {
      setChildScrollEdges({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [children.length])

  async function refreshUnpaid() {
    if (!familyId) return
    try { setUnpaid((await getUnpaidSummary(familyId)).children) }
    catch { /* non-fatal */ }
  }

  useEffect(() => { refreshUnpaid() }, [familyId])

  // Fetch trial/license status for upsell card
  useEffect(() => {
    if (!familyId) return
    getTrialStatus().then(setTrialStatus).catch(() => { /* non-fatal */ })
  }, [familyId])

  // Load family config to drive household-vs-co-parenting UX
  useEffect(() => {
    if (!familyId) return
    getFamily()
      .then(f => {
        const mode = f?.parenting_mode === 'co-parenting' ? 'co-parenting' : 'single'
        setParentingMode(mode)
      })
      .catch(() => { /* non-fatal — defaults to 'single' */ })
  }, [familyId])

  async function openBridgeForChild(child: ChildRecord, row: UnpaidSummaryRow) {
    const r = await getCompletions({
      family_id: familyId, child_id: child.id, status: 'completed',
    })
    const unpaidIds = r.completions
      .filter((c) => c.paid_out_at == null)
      .map((c) => c.id)
    if (unpaidIds.length === 0) { refreshUnpaid(); return }
    setBridgeCtx({
      child,
      completionIds: unpaidIds,
      total: row.unpaid_total,
      currency: row.currency,
    })
  }

  // Trial nudge: shown once after first child is added (set by WelcomeOrchardScreen)
  const [showTrialNudge, setShowTrialNudge] = useState(() => {
    return localStorage.getItem('mc_first_child_added') === '1'
      && localStorage.getItem('has_seen_trial_intro') !== '1'
  })

  function dismissTrialNudge() {
    localStorage.setItem('has_seen_trial_intro', '1')
    setShowTrialNudge(false)
  }

  // Load children on mount
  useEffect(() => {
    if (!familyId) { navigate('/'); return }
    getChildren().then(r => {
      setChildren(r.children)
      if (r.children.length > 0) {
        const savedId = localStorage.getItem('mc_active_child_id')
        const saved = savedId ? r.children.find(c => c.id === savedId) : null
        setActiveChild(saved ?? r.children[0])
      }
      setChildrenLoaded(true)
    }).catch(async (err: unknown) => {
      setChildrenLoaded(true)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
        await clearToken()
        navigate('/lock', { replace: true })
      }
      // Non-auth errors (network, server): stay on the page, don't redirect
    })
  }, [familyId])

  // Fetch streak data for all children (non-blocking — degrades gracefully)
  useEffect(() => {
    if (children.length === 0) return
    let cancelled = false
    authHeaders().then(headers => {
      if (cancelled) return
      Promise.allSettled(
        children.map(child =>
          fetch(apiUrl(`/api/streaks/${child.id}`), { headers })
            .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((data: { current_streak: number; grace_days_remaining: number; consistency_score: number }) => ({ id: child.id, data }))
        )
      ).then(results => {
        if (cancelled) return
        const map: Record<string, { current_streak: number; grace_days_remaining: number; consistency_score: number }> = {}
        for (const result of results) {
          if (result.status === 'fulfilled') {
            map[result.value.id] = result.value.data
          }
        }
        setStreaksByChild(map)
      })
    })
    return () => { cancelled = true }
  }, [children])

  // Track online status
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Poll pending counts for all children — pauses when the tab is hidden.
  // Skip the active child when the Activity tab is open — ActivityTab owns that poll
  // and calls onCountChange to keep pendingByChild in sync, avoiding a double-fetch.
  useEffect(() => {
    if (!familyId || children.length === 0) return
    const load = () => {
      if (document.hidden) return
      const activeTabIsActivity = tab === 'activity'
      Promise.allSettled(
        children
          .filter(child => !(activeTabIsActivity && child.id === activeChild?.id))
          .map(child =>
            getCompletions({ family_id: familyId, child_id: child.id, status: 'awaiting_review' })
              .then(r => ({ id: child.id, count: r.completions.length }))
          )
      ).then(results => {
        const map: Record<string, number> = {}
        for (const result of results) {
          if (result.status === 'fulfilled') map[result.value.id] = result.value.count
        }
        setPendingByChild(prev => ({ ...prev, ...map }))
      })
    }
    load()
    const t = setInterval(load, 30_000)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [familyId, children, tab, activeChild?.id])

  const navBadges = useMemo(() => ({ activity: pendingCount || undefined }), [pendingCount])

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col" style={{ overscrollBehaviorY: 'none' }}>
      <DemoBanner />
      <DemoUpsellCard trialStatus={trialStatus} />
      {/* Header */}
      <header className="safe-top sticky top-0 z-40 glass-header">
        <div className="max-w-[560px] mx-auto px-3.5 py-2.5 flex items-center justify-between">
          <FullLogo iconSize={22} />
          <div className="flex items-center gap-2">
            {/* Offline indicator — only visible when offline */}
            {!online && (
              <span title="Offline" className="flex items-center justify-center w-7 h-7 rounded-lg text-amber-500">
                <OfflineIcon />
              </span>
            )}
            {/* Avatar — opens settings drawer */}
            {(() => {
              const avatarId = localStorage.getItem('mc_parent_avatar')
              if (identity?.google_picture) {
                return (
                  <button
                    onClick={() => setShowSettings(true)}
                    className="shrink-0 w-8 h-8 rounded-full cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                    title="Settings"
                    aria-label="Open settings"
                  >
                    <img
                      src={identity.google_picture}
                      alt={identity.display_name}
                      className="w-8 h-8 rounded-full object-cover border-2 border-[var(--brand-primary)]"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </button>
                )
              }
              return avatarId ? (
                <button
                  onClick={() => setShowSettings(true)}
                  className="tap-target-44 w-7 h-7 rounded-full overflow-hidden shrink-0 border border-[var(--color-border)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                  title="Settings"
                  aria-label="Open settings"
                >
                  <AvatarSVG id={avatarId} size={28} />
                </button>
              ) : (
                <button
                  onClick={() => setShowSettings(true)}
                  className="tap-target-44 w-7 h-7 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-[0.625rem] font-bold tracking-wide shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--brand-primary)]"
                  title="Settings"
                  aria-label="Open settings"
                >
                  {identity?.initials ?? 'P'}
                </button>
              )
            })()}
          </div>
        </div>

        {/* Child selector */}
        {children.length > 1 && (
          <div className="max-w-[560px] mx-auto relative">
            {childScrollEdges.left && (
              <div className="pointer-events-none absolute left-0 top-0 bottom-2 w-6 z-10 bg-gradient-to-r from-[var(--color-surface)] to-transparent" />
            )}
            {childScrollEdges.right && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-6 z-10 bg-gradient-to-l from-[var(--color-surface)] to-transparent" />
            )}
            <div ref={childScrollRef} className="px-3.5 pb-2 flex gap-2 overflow-x-auto scrollbar-hide">
            {children.map(child => {
              const childPending = pendingByChild[child.id] ?? 0
              const showNavBadge = childPending > 0 && (child.id !== activeChild?.id || tab !== 'activity')
              return (
                <button
                  key={child.id}
                  onClick={() => handleSetActiveChild(child)}
                  className={`
                    tap-target-44 shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.75rem] font-semibold
                    border transition-colors duration-100 cursor-pointer relative
                    ${activeChild?.id === child.id
                      ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)] text-white'
                      : 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:opacity-80'}
                  `}
                >
                  <AvatarSVG id={child.avatar_id ?? 'bottts:spark'} size={18} />
                  {child.display_name}
                  {showNavBadge && (
                    <span className="bg-red-500 text-white text-[0.5625rem] font-bold rounded-full w-[16px] h-[16px] flex items-center justify-center leading-none shrink-0">
                      {childPending}
                    </span>
                  )}
                </button>
              )
            })}
            </div>
          </div>
        )}
        {/* Active child streak chip */}
        {activeChild && (
          <div className="max-w-[560px] mx-auto px-3.5 pb-2">
            <StreakChip
              currentStreak={streaksByChild[activeChild.id]?.current_streak ?? 0}
              graceRemaining={streaksByChild[activeChild.id]?.grace_days_remaining ?? 0}
              consistencyScore={streaksByChild[activeChild.id]?.consistency_score ?? 0}
              appView="ORCHARD"
            />
          </div>
        )}

      </header>

      {/* Trial nudge — one-time, shown after first child added */}
      {showTrialNudge && (
        <div className="max-w-[560px] mx-auto w-full px-3.5 pt-3">
          <div className="rounded-2xl bg-[color-mix(in_srgb,var(--brand-primary)_8%,white)] border border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] px-4 py-3.5 flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">🌳</span>
            <div className="flex-1 min-w-0">
              <p className="text-[0.8125rem] font-semibold text-[var(--color-text)] leading-snug">
                Your 14-day harvest begins here.
              </p>
              <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                Once you add the first chore or goal, the clock starts. We'll guide you and {activeChild?.display_name ?? 'your child'} through your first harvest — everything Morechard has to offer, yours to explore.
              </p>
            </div>
            <button
              onClick={dismissTrialNudge}
              className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none mt-0.5 cursor-pointer"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Settings drawer — slide in from right */}
      {/* Backdrop */}
      <div
        onClick={() => setShowSettings(false)}
        className={`fixed inset-0 z-39 bg-black/40 transition-opacity duration-300 ${showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        ref={settingsPanelRef}
        className={`fixed top-0 right-0 bottom-0 z-50 w-[min(360px,100vw)] bg-[var(--color-bg)] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}
        aria-modal="true"
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
      >
        <ParentSettingsTab
          familyId={familyId}
          online={online}
          onChildrenChange={setChildren}
          onClose={() => setShowSettings(false)}
          settingsJumpView={settingsJump.view}
          settingsJumpToken={settingsJump.token}
        />
        <p className="text-center text-[0.625rem] text-[var(--color-text-muted)] opacity-40 tracking-wide pb-3">
          v{__APP_VERSION__}
        </p>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-[560px] mx-auto w-full px-3.5 py-4 pb-28">
        {!childrenLoaded ? <DashboardSkeleton /> : activeChild ? (
          <>
            <div className={tab === 'chores'   ? 'tab-panel' : 'tab-panel hidden'}><ChoresTab       familyId={familyId} child={activeChild} children={children} /></div>
            <div className={tab === 'activity' ? 'tab-panel' : 'tab-panel hidden'}>
              <GiveRequestsPanel familyId={familyId} onCountChange={setPendingGiveCount} />
              <ActivityTab familyId={familyId} child={activeChild} childCount={children.length} onCountChange={count => setPendingByChild(prev => ({ ...prev, [activeChild.id]: count }))} unpaidRow={unpaid.find(u => u.child_id === activeChild.id) ?? null} onOpenBridge={() => { const row = unpaid.find(u => u.child_id === activeChild.id); if (row) openBridgeForChild(activeChild, row) }} onAfterPayout={refreshUnpaid} siblingsWithPending={siblingsWithPending} />
            </div>
            <div className={tab === 'pool'     ? 'tab-panel' : 'tab-panel hidden'}>
              <PoolTab
                familyId={familyId}
                currentUserId={identity?.user_id ?? ''}
                parentingMode={parentingMode}
                refreshKey={poolRefreshKey}
                onAddClick={() => setShowAddExpense(true)}
                onReconcileClick={() => setShowSettlement(true)}
              />
            </div>
            <div className={tab === 'insights' ? 'tab-panel' : 'tab-panel hidden'}><InsightsTab     familyId={familyId} child={activeChild} children={children} trialStatus={trialStatus} onUpgrade={openBillingUpgrade} /></div>
            <div className={tab === 'goals'    ? 'tab-panel' : 'tab-panel hidden'}><GoalBoostingTab familyId={familyId} child={activeChild} /></div>
          </>
        ) : (
          (() => {
            const name = identity?.display_name ?? ''
            const welcome  = isPolish(locale)
              ? `Witaj, ${name}. Zacznijmy uprawę Twojego sadu.`
              : `Welcome, ${name}. Let's grow your orchard.`
            return (
              <div className="flex flex-col h-full min-h-[70svh] px-4 text-center">
                {/* Sapling illustration + copy — centered in the available space */}
                <div className="flex-1 flex flex-col items-center justify-center gap-5">
                  <div className="w-20 h-20 rounded-3xl bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] flex items-center justify-center shadow-sm">
                    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                      {/* Soil line */}
                      <rect x="8" y="36" width="28" height="3" rx="1.5" fill="color-mix(in srgb, var(--brand-primary) 30%, transparent)" opacity="0.4"/>
                      {/* Trunk */}
                      <path d="M22 36 L22 22" stroke="#92613a" strokeWidth="2.5" strokeLinecap="round"/>
                      {/* Left leaf */}
                      <path d="M22 26 C22 26 14 24 13 17 C17 17 22 21 22 26Z" fill="#34d399"/>
                      <path d="M22 26 C22 26 14 24 13 17 C17 17 22 21 22 26Z" fill="none" stroke="#059669" strokeWidth="0.6"/>
                      {/* Right leaf */}
                      <path d="M22 22 C22 22 30 20 31 13 C27 13 22 17 22 22Z" fill="#34d399"/>
                      <path d="M22 22 C22 22 30 20 31 13 C27 13 22 17 22 22Z" fill="none" stroke="#059669" strokeWidth="0.6"/>
                      {/* Leaf vein left */}
                      <path d="M22 26 L14.5 18.5" stroke="#059669" strokeWidth="0.5" strokeLinecap="round" opacity="0.6"/>
                      {/* Leaf vein right */}
                      <path d="M22 22 L29.5 15" stroke="#059669" strokeWidth="0.5" strokeLinecap="round" opacity="0.6"/>
                      {/* Top bud */}
                      <circle cx="22" cy="11" r="3" fill="#6ee7b7"/>
                      <circle cx="22" cy="11" r="3" fill="none" stroke="#059669" strokeWidth="0.6"/>
                    </svg>
                  </div>

                  <div>
                    <p className="text-[0.75rem] font-semibold text-[var(--brand-primary)] mb-2 tracking-wide">
                      {welcome}
                    </p>
                    <h2 className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight mb-1.5">
                      Add your first child
                    </h2>
                    <p className="text-[0.8125rem] text-[var(--color-text-muted)] leading-relaxed max-w-[260px] mx-auto">
                      Once you add a child, you can set up chores, track their pocket money, and watch their savings grow.
                    </p>
                  </div>
                </div>

                {/* Primary CTA — pinned to the bottom, matching other primary-action placement */}
                <button
                  onClick={() => setShowSettings(true)}
                  className="h-12 px-6 mx-auto mb-2 bg-[var(--brand-primary)] text-white font-semibold text-[0.875rem] rounded-2xl cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all shadow-md flex items-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Add a child
                </button>
              </div>
            )
          })()
        )}
      </main>

      <ParentBottomNav
        activeTab={tab}
        onTabChange={handleTabChange}
        badges={navBadges}
      />

        {showAddExpense && (
          <AddExpenseSheet
            defaultSplitBp={5000}
            currency="GBP"
            parentingMode={parentingMode}
            familyName={activeChild?.display_name ?? undefined}
            onClose={() => setShowAddExpense(false)}
            onSaved={() => { setShowAddExpense(false); setPoolRefreshKey(k => k + 1) }}
          />
        )}
        {showSettlement && (
          <SettlementCard
            period={new Date().toISOString().slice(0, 7)}
            onClose={() => setShowSettlement(false)}
            onReconciled={() => { setShowSettlement(false) }}
          />
        )}
        {bridgeCtx && (
          <PaymentBridgeSheet
            open={true}
            onClose={() => setBridgeCtx(null)}
            familyId={familyId}
            child={bridgeCtx.child}
            completionIds={bridgeCtx.completionIds}
            totalMinorUnits={bridgeCtx.total}
            currency={bridgeCtx.currency}
            onPaid={() => { refreshUnpaid(); setBridgeCtx(null) }}
          />
        )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-[72px] rounded-2xl bg-[var(--color-surface-alt)]" />
      <div className="h-[72px] rounded-2xl bg-[var(--color-surface-alt)]" />
      <div className="h-[72px] rounded-2xl bg-[var(--color-surface-alt)]" />
      <div className="h-[72px] rounded-2xl bg-[var(--color-surface-alt)]" />
    </div>
  )
}

declare const __APP_VERSION__: string
