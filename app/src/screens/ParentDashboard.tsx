import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChildRecord } from '../lib/api'
import { getChildren, getCompletions } from '../lib/api'
import { getDeviceIdentity } from '../lib/deviceIdentity'
import { useLocale, isPolish } from '../lib/locale'
import { AvatarSVG } from '../lib/avatars'
import { ChoresTab }   from '../components/dashboard/JobsTab'
import { PendingTab }  from '../components/dashboard/PendingTab'
import { ActivityTab } from '../components/dashboard/HistoryTab'
import { InsightsTab } from '../components/dashboard/InsightsTab'
import { ParentSettingsTab } from '../components/dashboard/ParentSettingsTab'
import { GoalBoostingTab }  from '../components/dashboard/GoalBoostingTab'
import { FullLogo } from '../components/ui/Logo'

type Tab = 'chores' | 'approvals' | 'activity' | 'insights' | 'goals'

export function ParentDashboard() {
  const navigate   = useNavigate()
  const { locale } = useLocale()
  const familyId   = getDeviceIdentity()?.family_id ?? ''

  const [tab,        setTab]        = useState<Tab>(() => {
    const saved = sessionStorage.getItem('mc_parent_tab')
    const valid: Tab[] = ['chores', 'approvals', 'activity', 'insights', 'goals']
    return valid.includes(saved as Tab) ? (saved as Tab) : 'chores'
  })
  const [showSettings, setShowSettings] = useState(false)

  function handleTabChange(t: Tab) {
    setTab(t)
    sessionStorage.setItem('mc_parent_tab', t)
  }
  const [children,   setChildren]   = useState<ChildRecord[]>([])
  const [activeChild, setActiveChild] = useState<ChildRecord | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [online,     setOnline]     = useState(navigator.onLine)

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
    }).catch(() => navigate('/'))
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
    const load = () => getCompletions({ family_id: familyId, child_id: activeChild.id, status: 'pending' })
      .then(r => setPendingCount(r.completions.length))
      .catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [familyId, activeChild])

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'chores',    label: 'Chores' },
    { id: 'approvals', label: 'Approvals', badge: pendingCount || undefined },
    { id: 'activity',  label: 'Activity' },
    { id: 'insights',  label: 'Insights' },
    { id: 'goals',     label: 'Goals' },
  ]

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col" style={{ overscrollBehaviorY: 'none' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)]">
        <div className="max-w-[560px] mx-auto px-3.5 py-3 flex items-center justify-between">
          <FullLogo iconSize={26} />
          <div className="flex items-center gap-2">
            {/* Parent avatar */}
            {(() => {
              const avatarId = localStorage.getItem('mc_parent_avatar')
              const identity = getDeviceIdentity()
              if (identity?.google_picture) {
                return (
                  <img
                    src={identity.google_picture}
                    alt={identity.display_name}
                    title={identity.display_name}
                    className="w-9 h-9 rounded-full object-cover border-2 border-[var(--brand-primary)] shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )
              }
              return avatarId ? (
                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-[var(--color-border)]"
                     title={identity?.display_name ?? 'Parent'}>
                  <AvatarSVG id={avatarId} size={32} />
                </div>
              ) : (
                <div
                  className="w-8 h-8 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-[11px] font-bold tracking-wide shrink-0"
                  title={identity?.display_name ?? 'Parent'}
                >
                  {identity?.initials ?? 'P'}
                </div>
              )
            })()}
            {/* Connectivity icon */}
            <span
              title={online ? 'Online' : 'Offline'}
              className={`flex items-center justify-center w-8 h-8 rounded-lg ${online ? 'text-[var(--color-text-muted)]' : 'text-amber-500'}`}
            >
              {online ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                  <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                  <circle cx="12" cy="20" r="1" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
                  <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
                  <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
                  <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                  <circle cx="12" cy="20" r="1" fill="currentColor"/>
                </svg>
              )}
            </span>
            {/* Settings cog */}
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
          </div>
        </div>

        {/* Child selector */}
        {children.length > 1 && (
          <div className="max-w-[560px] mx-auto px-3.5 pb-2.5 flex gap-2 overflow-x-auto scrollbar-hide">
            {children.map(child => (
              <button
                key={child.id}
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
            ))}
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

      {/* Settings overlay */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-[var(--color-bg)] flex flex-col">
          <header className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)]">
            <div className="max-w-[560px] mx-auto px-3.5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
                  title="Back"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <h2 className="text-[16px] font-bold text-[var(--color-text)]">Settings</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Parent avatar */}
                {(() => {
                  const avatarId = localStorage.getItem('mc_parent_avatar')
                  const identity = getDeviceIdentity()
                  if (identity?.google_picture) {
                    return (
                      <img
                        src={identity.google_picture}
                        alt={identity.display_name}
                        className="w-9 h-9 rounded-full object-cover border-2 border-[var(--brand-primary)] shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )
                  }
                  return avatarId ? (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-[var(--color-border)]">
                      <AvatarSVG id={avatarId} size={32} />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-[11px] font-bold tracking-wide shrink-0">
                      {identity?.initials ?? 'P'}
                    </div>
                  )
                })()}
                {/* Online status */}
                <span
                  title={online ? 'Online' : 'Offline'}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg ${online ? 'text-[var(--color-text-muted)]' : 'text-amber-500'}`}
                >
                  {online ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>
                    </svg>
                  )}
                </span>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto max-w-[560px] mx-auto w-full px-3.5 py-4">
            <ParentSettingsTab familyId={familyId} onChildrenChange={setChildren} />
            <p className="text-center text-[10px] text-[var(--color-text-muted)] opacity-50 tracking-wide mt-4 pb-2">
              v{__APP_VERSION__}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-[560px] mx-auto w-full px-3.5 py-4">
        {activeChild ? (
          <>
            {tab === 'chores'    && <ChoresTab        familyId={familyId} child={activeChild} />}
            {tab === 'approvals' && <PendingTab        familyId={familyId} child={activeChild} onCountChange={setPendingCount} />}
            {tab === 'activity'  && <ActivityTab       familyId={familyId} child={activeChild} />}
            {tab === 'insights'  && <InsightsTab       familyId={familyId} child={activeChild} children={children} />}
            {tab === 'goals'     && <GoalBoostingTab   familyId={familyId} child={activeChild} />}
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
    </div>
  )
}

declare const __APP_VERSION__: string
