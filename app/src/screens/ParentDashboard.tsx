import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChildRecord } from '../lib/api'
import { getChildren, getCompletions, clearToken, getUnpaidSummary, type UnpaidSummaryRow } from '../lib/api'
import { getDeviceIdentity } from '../lib/deviceIdentity'
import { useLocale, isPolish } from '../lib/locale'
import { AvatarSVG } from '../lib/avatars'
import { ChoresTab }   from '../components/dashboard/JobsTab'
import { ActivityTab } from '../components/dashboard/HistoryTab'
import { InsightsTab } from '../components/dashboard/InsightsTab'
import { ParentSettingsTab } from '../components/dashboard/ParentSettingsTab'
import { PoolTab }         from '../components/dashboard/PoolTab'
import { AddExpenseSheet } from '../components/dashboard/AddExpenseSheet'
import { SettlementCard }  from '../components/dashboard/SettlementCard'
import { GoalBoostingTab }  from '../components/dashboard/GoalBoostingTab'
import { FullLogo } from '../components/ui/Logo'
import { UnpaidIndicator } from '../components/payment/UnpaidIndicator'
import { PaymentBridgeSheet } from '../components/payment/PaymentBridgeSheet'

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
  const familyId   = getDeviceIdentity()?.family_id ?? ''

  const [tab,        setTab]        = useState<Tab>(() => {
    const saved = sessionStorage.getItem('mc_parent_tab')
    const valid: Tab[] = ['chores', 'activity', 'pool', 'insights', 'goals']
    return valid.includes(saved as Tab) ? (saved as Tab) : 'chores'
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showAddExpense,  setShowAddExpense]  = useState(false)
  const [showSettlement,  setShowSettlement]  = useState(false)

  function handleTabChange(t: Tab) {
    setTab(t)
    sessionStorage.setItem('mc_parent_tab', t)
  }
  const [children,   setChildren]   = useState<ChildRecord[]>([])
  const [activeChild, setActiveChild] = useState<ChildRecord | null>(null)
  const [childrenLoaded, setChildrenLoaded] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [online,     setOnline]     = useState(navigator.onLine)
  const [unpaid, setUnpaid] = useState<UnpaidSummaryRow[]>([])
  const [bridgeCtx, setBridgeCtx] = useState<null | {
    child: ChildRecord; completionIds: string[]; total: number; currency: string;
  }>(null)

  async function refreshUnpaid() {
    if (!familyId) return
    try { setUnpaid((await getUnpaidSummary(familyId)).children) }
    catch { /* non-fatal */ }
  }

  useEffect(() => { refreshUnpaid() }, [familyId])

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
      if (r.children.length > 0 && !activeChild) setActiveChild(r.children[0])
      setChildrenLoaded(true)
    }).catch((err: unknown) => {
      setChildrenLoaded(true)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
        clearToken()
        navigate('/lock', { replace: true })
      }
      // Non-auth errors (network, server): stay on the page, don't redirect
    })
  }, [familyId])

  // Track online status
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Poll pending count
  useEffect(() => {
    if (!familyId || !activeChild) return
    const load = () => getCompletions({ family_id: familyId, child_id: activeChild.id, status: 'awaiting_review' })
      .then(r => setPendingCount(r.completions.length))
      .catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [familyId, activeChild])

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'chores',   label: 'Chores' },
    { id: 'activity', label: 'Activity', badge: pendingCount || undefined },
    { id: 'pool',     label: 'Pool' },
    { id: 'insights', label: 'Insights' },
    { id: 'goals',    label: 'Goals' },
  ]

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col" style={{ overscrollBehaviorY: 'none' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)]">
        <div className="max-w-[560px] mx-auto px-3.5 py-3 flex items-center justify-between">
          <FullLogo iconSize={26} />
          <div className="flex items-center gap-2">
            {/* Offline indicator — only visible when offline */}
            {!online && (
              <span title="Offline" className="flex items-center justify-center w-8 h-8 rounded-lg text-amber-500">
                <OfflineIcon />
              </span>
            )}
            {/* Avatar — opens settings drawer */}
            {(() => {
              const avatarId = localStorage.getItem('mc_parent_avatar')
              const identity = getDeviceIdentity()
              if (identity?.google_picture) {
                return (
                  <button
                    onClick={() => setShowSettings(true)}
                    className="shrink-0 rounded-full cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                    title="Settings"
                    aria-label="Open settings"
                  >
                    <img
                      src={identity.google_picture}
                      alt={identity.display_name}
                      className="w-9 h-9 rounded-full object-cover border-2 border-[var(--brand-primary)]"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </button>
                )
              }
              return avatarId ? (
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-[var(--color-border)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                  title="Settings"
                  aria-label="Open settings"
                >
                  <AvatarSVG id={avatarId} size={32} />
                </button>
              ) : (
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-8 h-8 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-[11px] font-bold tracking-wide shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--brand-primary)]"
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
          <div className="max-w-[560px] mx-auto px-3.5 pb-2.5 flex gap-2 overflow-x-auto scrollbar-hide">
            {children.map(child => {
              const row = unpaid.find((u) => u.child_id === child.id)
              return (
                <div key={child.id} className="shrink-0 flex items-center gap-1.5">
                  <button
                    onClick={() => setActiveChild(child)}
                    className={`
                      shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold
                      transition-colors duration-100 cursor-pointer
                      ${activeChild?.id === child.id
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:opacity-80'}
                    `}
                  >
                    <AvatarSVG id={child.avatar_id ?? 'bottts:spark'} size={20} />
                    {child.display_name}
                  </button>
                  {row && (
                    <UnpaidIndicator
                      unpaidMinorUnits={row.unpaid_total}
                      currency={row.currency}
                      onClick={() => openBridgeForChild(child, row)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Tab bar */}
        <div className="max-w-[560px] mx-auto border-t border-[var(--color-border)] flex overflow-x-auto scrollbar-hide">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`
                flex-1 shrink-0 px-3 py-2.5 text-[13px] font-semibold
                relative flex items-center justify-center gap-1.5
                transition-colors duration-100 cursor-pointer
                ${tab === t.id ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}
              `}
            >
              {t.label}
              {t.badge ? (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
                  {t.badge}
                </span>
              ) : null}
              {tab === t.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-[var(--brand-primary)] rounded-t-full" />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Trial nudge — one-time, shown after first child added */}
      {showTrialNudge && (
        <div className="max-w-[560px] mx-auto w-full px-3.5 pt-3">
          <div className="rounded-2xl bg-[color-mix(in_srgb,var(--brand-primary)_8%,white)] border border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] px-4 py-3.5 flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">🌳</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--color-text)] leading-snug">
                Your 14-day harvest begins here.
              </p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
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
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-[min(360px,100vw)] bg-[var(--color-bg)] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}
        aria-modal="true"
        role="dialog"
        aria-label="Settings"
      >
        <ParentSettingsTab
          familyId={familyId}
          online={online}
          onChildrenChange={setChildren}
          onClose={() => setShowSettings(false)}
        />
        <p className="text-center text-[10px] text-[var(--color-text-muted)] opacity-40 tracking-wide pb-3">
          v{__APP_VERSION__}
        </p>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-[560px] mx-auto w-full px-3.5 py-4">
        {!childrenLoaded ? null : activeChild ? (
          <>
            {tab === 'chores'   && <ChoresTab       familyId={familyId} child={activeChild} children={children} />}
            {tab === 'activity' && <ActivityTab     familyId={familyId} child={activeChild} onCountChange={setPendingCount} />}
            {tab === 'pool'     && (
              <PoolTab
                familyId={familyId}
                currentUserId={getDeviceIdentity()?.user_id ?? ''}
                onAddClick={() => setShowAddExpense(true)}
                onReconcileClick={() => setShowSettlement(true)}
              />
            )}
            {tab === 'insights' && <InsightsTab     familyId={familyId} child={activeChild} children={children} />}
            {tab === 'goals'    && <GoalBoostingTab familyId={familyId} child={activeChild} />}
          </>
        ) : (
          (() => {
            const identity = getDeviceIdentity()
            const name     = identity?.display_name ?? ''
            const welcome  = isPolish(locale)
              ? `Witaj, ${name}. Zacznijmy uprawę Twojego sadu.`
              : `Welcome, ${name}. Let's grow your orchard.`
            return (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-5">
                {/* Sapling illustration */}
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
                  <p className="text-[12px] font-semibold text-[var(--brand-primary)] mb-2 tracking-wide">
                    {welcome}
                  </p>
                  <h2 className="text-[18px] font-extrabold text-[var(--color-text)] tracking-tight mb-1.5">
                    Add your first child
                  </h2>
                  <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed max-w-[260px] mx-auto">
                    Once you add a child, you can set up chores, track their pocket money, and watch their savings grow.
                  </p>
                </div>

                <button
                  onClick={() => setShowSettings(true)}
                  className="h-12 px-6 bg-[var(--brand-primary)] text-white font-semibold text-[14px] rounded-2xl cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all shadow-md flex items-center gap-2"
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

      <footer className="py-3 text-center">
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-50 tracking-wide">
          v{__APP_VERSION__}
        </p>
      </footer>

        {showAddExpense && (
          <AddExpenseSheet
            defaultSplitBp={5000}
            currency="GBP"
            onClose={() => setShowAddExpense(false)}
            onSaved={() => { setShowAddExpense(false) }}
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

declare const __APP_VERSION__: string
