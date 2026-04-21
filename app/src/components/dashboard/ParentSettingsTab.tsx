/**
 * ParentSettingsTab — Morechard Parental Control Centre
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  ORCHARD ROADMAP — SETTINGS ARCHITECTURE                        │
 * │                                                                 │
 * │  Status tags:                                                   │
 * │    [Planned]    Not yet built — shows Coming Soon toast         │
 * │    [UI Shell]   Navigation exists, no underlying logic          │
 * │    [Functional] Fully coded and connected                       │
 * │                                                                 │
 * │  1. Account & Profile          [Functional]                     │
 * │     • Display Name             [Functional]                     │
 * │     • Email                    [Functional]  (unverified badge) │
 * │     • Delete Account *         [Planned]  (LEAD_PARENT only)    │
 * │                                                                 │
 * │  2. Manage Family              [UI Shell]                       │
 * │     • Children list            [Functional]                     │
 * │       ↳ Child Profile sub-menu [UI Shell]                       │
 * │         – Display Name         [Planned]                        │
 * │         – Reset PIN            [Planned]                        │
 * │         – Orchard Theme        [Functional]  (teen_mode toggle) │
 * │         – Experience Level     [Functional]  (teen_mode toggle) │
 * │         – Harvest Status       [Planned]                        │
 * │         – Approval Mode        [Planned]                        │
 * │         – Safety Net           [Planned]                        │
 * │         – Growth Path          [Functional]                     │
 * │         – Uproot Profile *     [Planned]  (LEAD_PARENT only)    │
 * │     • Co-parenting             [UI Shell]                       │
 * │       – Invite Co-Parent       [Functional]                     │
 * │       – Remove Co-Parent *     [Planned]  (LEAD_PARENT only)    │
 * │     • Global Orchard Rules     [UI Shell]  (read-only CO_PARENT)│
 * │       – Harvest Day            [Planned]                        │
 * │       – Global Overdraft       [Planned]                        │
 * │                                                                 │
 * │  3. Security & Access          [Planned]                        │
 * │     • PIN Management           [Planned]                        │
 * │     • Active Sessions          [Planned]                        │
 * │                                                                 │
 * │  4. Appearance & Display       [Functional]                     │
 * │     • App Mode (Light/Dark)    [Functional]                     │
 * │     • Language                 [Planned]                        │
 * │                                                                 │
 * │  5. Billing & Subscriptions    [Planned]  (LEAD_PARENT only)    │
 * │     • Trial Status             [Planned]                        │
 * │     • Plan Management          [Planned]                        │
 * │     • Payment History          [Planned]                        │
 * │                                                                 │
 * │  6. Data & Exports             [Planned]                        │
 * │     • Download Ledger          [Planned]                        │
 * │     • Data Pruning *           [Planned]  (LEAD_PARENT only)    │
 * │                                                                 │
 * │  7. Referrals                  [Planned]                        │
 * │     • Share the Grove          [Planned]                        │
 * │                                                                 │
 * │  8. About & Support            [UI Shell]                       │
 * │     • Version Info             [UI Shell]                       │
 * │     • Privacy Policy           [UI Shell]                       │
 * │     • Terms of Use             [UI Shell]                       │
 * │     • Support Desk             [UI Shell]                       │
 * └─────────────────────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  User, Users, Shield, Palette, CreditCard, Database,
  Gift, Info, ChevronRight, Clock, LogOut,
} from 'lucide-react'
import { clearDeviceIdentity, getDeviceIdentity, updateDeviceIdentity } from '../../lib/deviceIdentity'
import type { ChildRecord, ChildGrowthSettings } from '../../lib/api'
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
  getChildGrowth, updateChildGrowth,
  getMe, updateProfile, getLeadCount, getTrialStatus,
  type MeResult, type TrialStatus,
} from '../../lib/api'
import { track } from '../../lib/analytics'
import { useLocale, isPolish } from '../../lib/locale'
import { cn } from '../../lib/utils'
import { ProfileSettings }    from '../settings/sections/ProfileSettings'
import { FamilySettings }     from '../settings/sections/FamilySettings'
import { SecuritySettings }   from '../settings/sections/SecuritySettings'
import { AppearanceSettings } from '../settings/sections/AppearanceSettings'
import { BillingSettings }    from '../settings/sections/BillingSettings'
import { DataSettings }       from '../settings/sections/DataSettings'
import { AboutSettings }      from '../settings/sections/AboutSettings'
import { AvatarSVG }          from '../../lib/avatars'

// ── Types ─────────────────────────────────────────────────────────────────────

type TopSection =
  | 'account'
  | 'family'
  | 'security'
  | 'appearance'
  | 'billing'
  | 'data'
  | 'referrals'
  | 'about'

type View =
  | { type: 'menu' }
  | { type: 'section'; section: TopSection }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  familyId:         string
  online:           boolean
  onChildrenChange: (children: ChildRecord[]) => void
  onClose:          () => void
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return { toast, showToast }
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[#1a2e2e] text-white text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
      🌱 {message}
    </div>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParentSettingsTab({ familyId, online, onChildrenChange, onClose }: Props) {
  const identity        = getDeviceIdentity()
  const isLead          = identity?.parenting_role !== 'CO_PARENT'  // default to lead if unset (existing accounts)
  const { locale }      = useLocale()

  const [view,          setView]          = useState<View>({ type: 'menu' })
  const [children,      setChildren]      = useState<ChildRecord[]>([])
  const [family,        setFamily]        = useState<Record<string, unknown>>({})
  const [settings,      setSettings]      = useState<{ avatar_id: string; theme: string; locale: string } | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [threshold,      setThreshold]      = useState(5000) // 5000 pence = £50
  const [splitBp,        setSplitBp]        = useState(5000) // 5000 bp = 50%
  const [savingSettings, setSavingSettings] = useState(false)

  // Per-child settings (source of truth — passed to FamilySettings)
  const [appViews,       setAppViews]       = useState<Record<string, 'ORCHARD' | 'CLEAN'>>({})
  const [appViewBusy,    setAppViewBusy]    = useState<string | null>(null)
  const [growthSettings, setGrowthSettings] = useState<Record<string, ChildGrowthSettings>>({})
  const [growthBusy,     setGrowthBusy]     = useState<string | null>(null)

  const { toast, showToast } = useToast()

  // Profile (loaded from GET /auth/me)
  const [profile,   setProfile]   = useState<MeResult | null>(null)
  const [leadCount, setLeadCount] = useState<number>(1)
  const [trial,     setTrial]     = useState<TrialStatus | null>(null)

  function comingSoon() {
    showToast('Coming Soon to the Orchard')
  }

  async function handleSaveName(newName: string) {
    const updated = await updateProfile({ display_name: newName })
    setProfile(updated)
    updateDeviceIdentity({ display_name: updated.display_name })
    setFamily(prev => ({ ...prev, display_name: updated.display_name }))
    showToast('🌿 Name updated')
  }

  async function handleSaveEmail(newEmail: string) {
    const updated = await updateProfile({ email: newEmail })
    setProfile(updated)
    showToast('📬 Email updated')
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [c, f, s, p, leads, t] = await Promise.all([
      getChildren().then(r => r.children),
      getFamily(),
      getSettings(),
      getMe(),
      getLeadCount().then(r => r.lead_count).catch(() => 1),
      getTrialStatus().catch(() => null),
    ])
    setChildren(c)
    onChildrenChange(c)
    setFamily(f)
    setSettings(s)
    setProfile(p)
    setLeadCount(leads)
    setTrial(t)
    if (s?.avatar_id) localStorage.setItem('mc_parent_avatar', s.avatar_id)
    // Only seed from D1 if localStorage has no valid locale yet (avoids clobbering a recent user change)
    const validLocales = ['en-GB', 'en-US', 'pl']
    if (s?.locale && !validLocales.includes(localStorage.getItem('mc_locale') ?? '')) {
      localStorage.setItem('mc_locale', s.locale)
    }
    const [views, growths] = await Promise.all([
      Promise.all(
        c.map(child =>
          getChildSettings(child.id)
            .then(cs => [child.id, (cs.app_view ?? 'ORCHARD') as 'ORCHARD' | 'CLEAN'] as const)
            .catch(() => [child.id, 'ORCHARD' as const] as const)
        )
      ),
      Promise.all(
        c.map(child => getChildGrowth(child.id).catch(() => null))
      ),
    ])
    setAppViews(Object.fromEntries(views))
    const growthMap: Record<string, ChildGrowthSettings> = {}
    growths.forEach(g => { if (g) growthMap[g.id] = g })
    setGrowthSettings(growthMap)
    setLoading(false)
  }, [familyId, onChildrenChange])

  useEffect(() => { load() }, [load])

  async function handleAddChild(name: string) {
    const result = await addChild(name, 'HYBRID')
    await load()
    return result
  }

  async function handleSetAvatar(id: string) {
    await updateSettings({ avatar_id: id })
    localStorage.setItem('mc_parent_avatar', id)
    await load()
  }

  async function handleGenerateInvite() {
    return generateInvite('co-parent')
  }

  async function handleAppViewToggle(childId: string, next: 'ORCHARD' | 'CLEAN') {
    setAppViewBusy(childId)
    try {
      await updateChildSettings(childId, { app_view: next })
      setAppViews(prev => ({ ...prev, [childId]: next }))
    } finally {
      setAppViewBusy(null)
    }
  }

  function handleRenameChild(childId: string, newName: string) {
    setChildren(prev => prev.map(c => c.id === childId ? { ...c, display_name: newName } : c))
    showToast('Name updated')
  }

  function handlePinResetSuccess() {
    showToast('PIN updated')
  }

  async function handleGrowthUpdate(
    childId: string,
    patch: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>,
  ) {
    setGrowthBusy(childId)
    try {
      await updateChildGrowth(childId, patch)
      const next = { ...growthSettings[childId], ...patch }
      setGrowthSettings(prev => ({ ...prev, [childId]: next }))
      track.growthPathUpdated({
        mode:         next.earnings_mode      ?? 'HYBRID',
        frequency:    next.allowance_frequency ?? 'WEEKLY',
        amount_pence: next.allowance_amount    ?? 0,
      })
    } finally {
      setGrowthBusy(null)
    }
  }

  async function handleSaveCoParentSettings() {
    setSavingSettings(true)
    try {
      await fetch('/api/family/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shared_expense_threshold: threshold,
          shared_expense_split_bp:  splitBp,
        }),
      })
    } finally {
      setSavingSettings(false)
    }
  }

  // ── Section views ────────────────────────────────────────────────────────────

  const back = () => setView({ type: 'menu' })

  if (view.type === 'section') {
    if (view.section === 'account')    return <ProfileSection><ProfileSettings    profile={profile} settings={settings} identity={identity} family={family} isLead={isLead} leadCount={leadCount} onSaveName={handleSaveName} onSaveEmail={handleSaveEmail} onSetAvatar={handleSetAvatar} onBack={back} onComingSoon={comingSoon} toast={toast} /></ProfileSection>
    if (view.section === 'family')     return <ProfileSection><FamilySettings     children={children} appViews={appViews} appViewBusy={appViewBusy} growthSettings={growthSettings} growthBusy={growthBusy} isLead={isLead} toast={toast} onBack={back} onComingSoon={comingSoon} onAddChild={handleAddChild} onAppViewToggle={handleAppViewToggle} onGrowthUpdate={handleGrowthUpdate} onRenameChild={handleRenameChild} onPinResetSuccess={handlePinResetSuccess} onGenerateInvite={handleGenerateInvite} /></ProfileSection>
    if (view.section === 'security')   return <ProfileSection><SecuritySettings   profile={profile} toast={toast} onBack={back} onComingSoon={comingSoon} /></ProfileSection>
    if (view.section === 'appearance') return <ProfileSection><AppearanceSettings toast={toast} onBack={back} /></ProfileSection>
    if (view.section === 'billing')    return <ProfileSection><BillingSettings    toast={toast} onBack={back} onComingSoon={comingSoon} /></ProfileSection>
    if (view.section === 'data')       return <ProfileSection><DataSettings       isLead={isLead} hasLifetimeLicense={Boolean(trial?.has_lifetime_license)} hasAiMentor={Boolean(trial?.ai_subscription_active)} hasLegalBundle={Boolean(trial?.has_legal_bundle)} lang={isPolish(locale) ? 'pl' : 'en'} toast={toast} onBack={back} onComingSoon={comingSoon} /></ProfileSection>
    if (view.section === 'about')      return <ProfileSection><AboutSettings      toast={toast} onBack={back} onComingSoon={comingSoon} /></ProfileSection>
  }

  // ── Drawer: identity header + trial banner + grouped menu ───────────────────

  const pl = isPolish(locale)

  // Avatar element
  const avatarEl = (() => {
    const avatarId = localStorage.getItem('mc_parent_avatar')
    if (identity?.google_picture) {
      return <img src={identity.google_picture} alt={identity.display_name} className="w-12 h-12 rounded-full object-cover border-2 border-[var(--brand-primary)]" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
    }
    return avatarId ? (
      <div className="w-12 h-12 rounded-full overflow-hidden border border-[var(--color-border)]"><AvatarSVG id={avatarId} size={48} /></div>
    ) : (
      <div className="w-12 h-12 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-[15px] font-bold">{identity?.initials ?? 'P'}</div>
    )
  })()

  // Trial banner
  const trialBanner = (() => {
    if (trial?.has_lifetime_license) return null
    const daysLeft    = trial?.days_remaining ?? null
    const isActivated = trial?.is_activated ?? false

    if (!isLead) return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Clock size={13} />
        {pl ? 'Współrodzic — niektóre opcje są ograniczone' : 'Co-Parent — some options are restricted'}
      </div>
    )

    if (!isActivated || daysLeft === null) return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
        <Clock size={13} />
        {pl ? 'Rodzic — pełny dostęp' : 'Parent — full access'}
      </div>
    )

    const urgentAmber = daysLeft <= 2
    const pct   = Math.max(0, Math.min(100, (daysLeft / 14) * 100))
    const label = pl
      ? `Okres próbny: pozostało ${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}`
      : `Trial: ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} remaining`

    return (
      <div className={cn('rounded-xl border overflow-hidden', urgentAmber ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-teal-50 border-teal-200 text-teal-700')}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <Clock size={13} className="shrink-0" />
          <span className="flex-1 text-[12px] font-semibold">{label}</span>
          <button type="button" onClick={() => setView({ type: 'section', section: 'billing' })}
            className={cn('flex items-center gap-0.5 text-[11px] font-semibold shrink-0', urgentAmber ? 'text-amber-600' : 'text-teal-600')}>
            {pl ? 'Plany' : 'See Plans'}<ChevronRight size={12} />
          </button>
        </div>
        <div className={cn('h-1', urgentAmber ? 'bg-amber-100' : 'bg-teal-100')}>
          <div className={cn('h-full transition-all', urgentAmber ? 'bg-amber-400' : 'bg-teal-500')} style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  })()

  type MenuItem = { id: TopSection; icon: React.ReactNode; label: string; description: string; leadOnly?: boolean; onAction?: () => void }
  const GROUPS: { title: string; items: MenuItem[] }[] = [
    {
      title: pl ? 'Osobiste' : 'Personal',
      items: [
        { id: 'account',  icon: <User size={16} />,   label: pl ? 'Konto i profil'       : 'Account & Profile',  description: pl ? 'Imię, e-mail, awatar'            : 'Name, email, avatar' },
        { id: 'security', icon: <Shield size={16} />, label: pl ? 'Bezpieczeństwo'        : 'Security & Access',  description: pl ? 'PIN, aktywne sesje'               : 'PIN, active sessions' },
      ],
    },
    {
      title: pl ? 'Zarządzanie rodziną' : 'Family Management',
      items: [
        { id: 'family',     icon: <Users size={16} />,      label: pl ? 'Zarządzaj rodziną'    : 'Manage Family',            description: pl ? 'Dzieci, współrodzice, zasady' : 'Children, co-parenting, global rules' },
        { id: 'billing',    icon: <CreditCard size={16} />, label: pl ? 'Rozliczenia'           : 'Billing & Subscriptions',  description: pl ? 'Okres próbny, plan, faktury'  : 'Trial, plan, invoices', leadOnly: true },
        { id: 'appearance', icon: <Palette size={16} />,    label: pl ? 'Wygląd'                : 'Appearance & Display',     description: pl ? 'Motyw, język'                 : 'Theme, language' },
      ],
    },
    {
      title: pl ? 'Narzędzia' : 'Tools',
      items: [
        { id: 'data',      icon: <Database size={16} />, label: pl ? 'Dane i eksport'      : 'Data & Exports',    description: pl ? 'Pobierz księgę, archiwizacja'   : 'Download ledger, data pruning' },
        { id: 'referrals', icon: <Gift size={16} />,     label: pl ? 'Polecenia'            : 'Referrals',         description: pl ? 'Poleć rodzinę, zdobądź nagrody' : 'Refer a family, earn rewards', onAction: comingSoon },
        { id: 'about',     icon: <Info size={16} />,     label: pl ? 'O aplikacji i pomoc' : 'About & Support',   description: pl ? 'Wersja, prawo, pomoc'            : 'Version, legal, support' },
      ],
    },
  ]

  function MenuItem({ item }: { item: MenuItem }) {
    return (
      <button
        type="button"
        onClick={() => item.onAction ? item.onAction() : setView({ type: 'section', section: item.id })}
        className="w-full flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer transition-colors text-left"
      >
        <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
          {item.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--color-text)]">{item.label}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{item.description}</p>
        </div>
        <ChevronRight size={14} className="shrink-0 text-[var(--color-text-muted)]" />
      </button>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {toast && <Toast message={toast} />}

      {/* Drawer header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-4 border-b border-[var(--color-border)]">
        <h2 className="text-[17px] font-bold text-[var(--color-text)]">{pl ? 'Ustawienia' : 'Settings'}</h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
          aria-label="Close settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Identity + status */}
        <div className="px-4 py-4 space-y-3">
          {/* Avatar + name/email */}
          <div className="flex items-center gap-3">
            {avatarEl}
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-[var(--color-text)] truncate">{identity?.display_name ?? 'Parent'}</p>
              <p className="text-[12px] text-[var(--color-text-muted)] truncate">{profile?.email ?? ''}</p>
            </div>
            {/* System status */}
            <div className="flex items-center gap-1 shrink-0">
              {online ? (
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-400" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-amber-400" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg>
              )}
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {online ? (pl ? 'System online' : 'System online') : (pl ? 'Offline' : 'Offline')}
              </span>
            </div>
          </div>

          {/* Trial banner */}
          {loading ? (
            <div className="h-9 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
          ) : trialBanner}
        </div>

        {/* Grouped menu */}
        <div className="px-4 pb-4 space-y-4">
          {GROUPS.map(group => (
            <div key={group.title}>
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
                {group.title}
              </p>
              <SectionCard>
                {group.items
                  .filter(item => !item.leadOnly || isLead)
                  .map(item => <MenuItem key={item.id} item={item} />)
                }
              </SectionCard>
            </div>
          ))}
        </div>

        {/* Shared Expense Settings */}
        <div className="px-4 pb-4">
          <div className="mt-6 flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Shared Expenses
            </h3>

            {/* Trust Threshold */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Approval threshold
              </label>
              <p className="text-xs text-[var(--color-text-muted)]">
                Expenses above this amount require the other parent's approval (Verification mode only).
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm">£</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  value={(threshold / 100).toFixed(0)}
                  onChange={e => setThreshold(Math.round(parseFloat(e.target.value || '0') * 100))}
                  className="border border-[var(--color-border)] rounded-xl px-4 py-2 text-sm bg-[var(--color-surface-raised)] w-28 tabular-nums"
                />
              </div>
            </div>

            {/* Default Split */}
            <div className="flex flex-col gap-1 mt-2">
              <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Default split — {(splitBp / 100).toFixed(0)}% / {(100 - splitBp / 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min={0}
                max={10000}
                step={100}
                value={splitBp}
                onChange={e => setSplitBp(Number(e.target.value))}
                className="w-full mt-1"
              />
            </div>

            <button
              onClick={handleSaveCoParentSettings}
              disabled={savingSettings}
              className="mt-2 bg-[var(--brand-primary)] text-white font-semibold text-sm py-2 px-6 rounded-xl disabled:opacity-50 self-start"
            >
              {savingSettings ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Log out — footer with distinct tint */}
        <div className="px-4 pb-6">
          <div className="rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(pl ? 'Wylogować się? Dane rodziny są bezpieczne.' : "Log out? Your family's data stays safe.")) return
                clearDeviceIdentity()
                sessionStorage.removeItem('mc_parent_tab')
                localStorage.removeItem('mc_parent_avatar')
                window.location.replace('/')
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 active:bg-red-50 cursor-pointer transition-colors text-left"
            >
              <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-red-600 text-white">
                <LogOut size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-text)]">{pl ? 'Wyloguj się' : 'Log out'}</p>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{pl ? 'Dane rodziny są bezpieczne' : "Your family's data stays safe"}</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Thin wrapper to give section sub-pages the right scroll container inside the drawer
function ProfileSection({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-3.5 py-4">{children}</div>
}

// Version injected at build time by Vite define
