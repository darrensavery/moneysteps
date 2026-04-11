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

import { useState, useEffect, useCallback } from 'react'
import {
  User, Users, Shield, Palette, CreditCard, Database,
  Gift, Info, ChevronRight, TreePine, LogOut,
} from 'lucide-react'
import { clearDeviceIdentity, getDeviceIdentity, updateDeviceIdentity } from '../../lib/deviceIdentity'
import type { ChildRecord, ChildGrowthSettings } from '../../lib/api'
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
  getChildGrowth, updateChildGrowth,
  getMe, updateProfile, getLeadCount,
  type MeResult,
} from '../../lib/api'
import { track } from '../../lib/analytics'
import { cn } from '../../lib/utils'
import { ProfileSettings }    from '../settings/sections/ProfileSettings'
import { FamilySettings }     from '../settings/sections/FamilySettings'
import { SecuritySettings }   from '../settings/sections/SecuritySettings'
import { AppearanceSettings } from '../settings/sections/AppearanceSettings'
import { BillingSettings }    from '../settings/sections/BillingSettings'
import { DataSettings }       from '../settings/sections/DataSettings'
import { ReferralsSettings }  from '../settings/sections/ReferralsSettings'
import { AboutSettings }      from '../settings/sections/AboutSettings'

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
  onChildrenChange: (children: ChildRecord[]) => void
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

// ── Row atoms ─────────────────────────────────────────────────────────────────

function SettingsRow({
  icon, label, description, onClick, destructive = false, disabled = false, badge,
}: {
  icon?: React.ReactNode
  label: string
  description?: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors',
        'border-b border-[var(--color-border)] last:border-0',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer',
      )}
    >
      {icon && (
        <span className={cn(
          'shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
          destructive ? 'bg-red-600 text-white' : 'bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]',
        )}>
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-[14px] font-semibold',
          destructive ? 'text-[var(--color-text)]' : 'text-[var(--color-text)]',
        )}>
          {label}
        </p>
        {description && (
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      {badge && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
          {badge}
        </span>
      )}
      <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
    </button>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
      {children}
    </div>
  )
}

function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        type="button"
        onClick={onBack}
        className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
      >
        <ChevronLeft size={16} className="text-[var(--color-text-muted)]" />
      </button>
      <h2 className="text-[16px] font-bold text-[var(--color-text)]">{title}</h2>
    </div>
  )
}

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
      <Lock size={9} /> Read only
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParentSettingsTab({ familyId, onChildrenChange }: Props) {
  const identity        = getDeviceIdentity()
  const isLead          = identity?.parenting_role !== 'CO_PARENT'  // default to lead if unset (existing accounts)

  const [view,          setView]          = useState<View>({ type: 'menu' })
  const [children,      setChildren]      = useState<ChildRecord[]>([])
  const [family,        setFamily]        = useState<Record<string, unknown>>({})
  const [settings,      setSettings]      = useState<{ avatar_id: string; theme: string; locale: string } | null>(null)
  const [loading,       setLoading]       = useState(true)

  // Per-child settings (source of truth — passed to FamilySettings)
  const [teenModes,      setTeenModes]      = useState<Record<string, number>>({})
  const [teenModeBusy,   setTeenModeBusy]   = useState<string | null>(null)
  const [growthSettings, setGrowthSettings] = useState<Record<string, ChildGrowthSettings>>({})
  const [growthBusy,     setGrowthBusy]     = useState<string | null>(null)

  const { toast, showToast } = useToast()

  // Profile (loaded from GET /auth/me)
  const [profile, setProfile] = useState<MeResult | null>(null)
  const [leadCount, setLeadCount] = useState<number>(1)

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
    const [c, f, s, p, leads] = await Promise.all([
      getChildren().then(r => r.children),
      getFamily(),
      getSettings(),
      getMe(),
      getLeadCount().then(r => r.lead_count).catch(() => 1),
    ])
    setChildren(c)
    onChildrenChange(c)
    setFamily(f)
    setSettings(s)
    setProfile(p)
    setLeadCount(leads)
    if (s?.avatar_id) localStorage.setItem('mc_parent_avatar', s.avatar_id)
    const [modes, growths] = await Promise.all([
      Promise.all(
        c.map(child => getChildSettings(child.id).then(cs => [child.id, cs.teen_mode] as const).catch(() => [child.id, 0] as const))
      ),
      Promise.all(
        c.map(child => getChildGrowth(child.id).catch(() => null))
      ),
    ])
    setTeenModes(Object.fromEntries(modes))
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

  async function handleTeenModeToggle(childId: string) {
    const next = teenModes[childId] === 1 ? 0 : 1
    setTeenModeBusy(childId)
    try {
      await updateChildSettings(childId, { teen_mode: next })
      setTeenModes(prev => ({ ...prev, [childId]: next }))
      track.uiStyleChanged({ style: next === 1 ? 'professional' : 'orchard', child_id: childId })
    } finally {
      setTeenModeBusy(null)
    }
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

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  // ── Section views ────────────────────────────────────────────────────────────

  const back = () => setView({ type: 'menu' })

  if (view.type === 'section') {
    if (view.section === 'account')    return <ProfileSettings    profile={profile} settings={settings} identity={identity} family={family} isLead={isLead} leadCount={leadCount} onSaveName={handleSaveName} onSaveEmail={handleSaveEmail} onSetAvatar={handleSetAvatar} onBack={back} onComingSoon={comingSoon} toast={toast} />
    if (view.section === 'family')     return <FamilySettings     children={children} teenModes={teenModes} teenModeBusy={teenModeBusy} growthSettings={growthSettings} growthBusy={growthBusy} isLead={isLead} toast={toast} onBack={back} onComingSoon={comingSoon} onAddChild={handleAddChild} onTeenModeToggle={handleTeenModeToggle} onGrowthUpdate={handleGrowthUpdate} onGenerateInvite={handleGenerateInvite} />
    if (view.section === 'security')   return <SecuritySettings   profile={profile} toast={toast} onBack={back} onComingSoon={comingSoon} />
    if (view.section === 'appearance') return <AppearanceSettings toast={toast} onBack={back} onComingSoon={comingSoon} />
    if (view.section === 'billing')    return <BillingSettings    toast={toast} onBack={back} onComingSoon={comingSoon} />
    if (view.section === 'data')       return <DataSettings       isLead={isLead} toast={toast} onBack={back} onComingSoon={comingSoon} />
    if (view.section === 'referrals')  return <ReferralsSettings  toast={toast} onBack={back} onComingSoon={comingSoon} />
    if (view.section === 'about')      return <AboutSettings      toast={toast} onBack={back} onComingSoon={comingSoon} />
  }

  // ── Top-level menu ──────────────────────────────────────────────────────────

  const MENU_SECTIONS: {
    id:          TopSection
    icon:        React.ReactNode
    label:       string
    description: string
    leadOnly?:   boolean
  }[] = [
    {
      id:          'account',
      icon:        <User size={17} />,
      label:       'Account & Profile',
      description: 'Name, email, avatar',
    },
    {
      id:          'family',
      icon:        <Users size={17} />,
      label:       'Manage Family',
      description: 'Children, co-parenting, global rules',
    },
    {
      id:          'security',
      icon:        <Shield size={17} />,
      label:       'Security & Access',
      description: 'PIN, active sessions',
    },
    {
      id:          'appearance',
      icon:        <Palette size={17} />,
      label:       'Appearance & Display',
      description: 'Theme, language',
    },
    {
      id:          'billing',
      icon:        <CreditCard size={17} />,
      label:       'Billing & Subscriptions',
      description: 'Trial, plan, invoices',
      leadOnly:    true,
    },
    {
      id:          'data',
      icon:        <Database size={17} />,
      label:       'Data & Exports',
      description: 'Download ledger, data pruning',
    },
    {
      id:          'referrals',
      icon:        <Gift size={17} />,
      label:       'Referrals',
      description: 'Refer a family, earn rewards',
    },
    {
      id:          'about',
      icon:        <Info size={17} />,
      label:       'About & Support',
      description: 'Version, legal, support',
    },
  ]

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}

      {/* Role badge */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold',
        isLead
          ? 'bg-teal-50 text-teal-700 border border-teal-200'
          : 'bg-amber-50 text-amber-700 border border-amber-200',
      )}>
        <TreePine size={13} />
        {isLead ? 'Parent — full access' : 'Co-Parent — some options are restricted'}
      </div>

      {/* Main menu */}
      <SectionCard>
        {MENU_SECTIONS
          .filter(s => !s.leadOnly || isLead)
          .map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setView({ type: 'section', section: s.id })}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer transition-colors text-left"
            >
              <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                {s.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[var(--color-text)]">{s.label}</p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{s.description}</p>
              </div>
              <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
            </button>
          ))
        }
      </SectionCard>

      {/* Log out */}
      <SectionCard>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("Log out? Your family's data stays safe.")) return
            clearDeviceIdentity()
            sessionStorage.removeItem('mc_parent_tab')
            localStorage.removeItem('mc_parent_avatar')
            window.location.replace('/')
          }}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer transition-colors text-left rounded-xl"
        >
          <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-red-600 text-white">
            <LogOut size={17} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Log out</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">Your family's data stays safe</p>
          </div>
        </button>
      </SectionCard>
    </div>
  )
}

// Version injected at build time by Vite define
