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
 * │  1. Account & Profile          [UI Shell]                       │
 * │     • Display Name             [Planned]                        │
 * │     • Email Management         [Planned]                        │
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

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  User, Users, Shield, Palette, CreditCard, Database,
  Gift, Info, ChevronRight, ChevronLeft, Lock,
  TreePine, Eye, Calendar, AlertTriangle, LogOut,
  X, Check,
} from 'lucide-react'
import { track } from '../../lib/analytics'
import { clearDeviceIdentity, getDeviceIdentity } from '../../lib/deviceIdentity'
import type { ChildRecord, ChildGrowthSettings } from '../../lib/api'
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
  getChildGrowth, updateChildGrowth,
} from '../../lib/api'
import { AvatarSVG, AVATARS, AVATAR_CATEGORIES } from '../../lib/avatars'
import { ThemePicker } from '../../lib/theme'
import { cn } from '../../lib/utils'

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
  | { type: 'child'; childId: string }

// ── Growth Path config (preserved from original) ─────────────────────────────

const GROWTH_PATHS = [
  {
    mode: 'ALLOWANCE' as const,
    title: 'The Automated Harvest',
    subtitle: 'Allowance only',
    description: 'Fruit that grows on its own every season.',
    icon: '🌧️',
  },
  {
    mode: 'CHORES' as const,
    title: 'The Labor of the Land',
    subtitle: 'Chores only',
    description: 'Fruit gathered only by tending to the trees.',
    icon: '🪵',
  },
  {
    mode: 'HYBRID' as const,
    title: 'The Integrated Grove',
    subtitle: 'Allowance + Chores',
    description: 'A steady harvest with extra rewards for hard work.',
    icon: '🌳',
  },
]

const FREQ_LABELS: Record<string, string> = {
  WEEKLY:    'Weekly',
  BI_WEEKLY: 'Every 2 weeks',
  MONTHLY:   'Monthly',
}

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
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[var(--color-text)] text-white text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
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

  // Add child
  const [showAddChild,    setShowAddChild]    = useState(false)
  const [newChildName,    setNewChildName]    = useState('')
  const [addingChild,     setAddingChild]     = useState(false)
  const [addChildResult,  setAddChildResult]  = useState<{ child_id: string; invite_code: string } | null>(null)

  // Avatar picker
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [savingAvatar,     setSavingAvatar]     = useState(false)

  // Co-parent invite
  const [inviteCode,    setInviteCode]    = useState<string | null>(null)
  const [inviteExpiry,  setInviteExpiry]  = useState<string | null>(null)
  const [genningInvite, setGenningInvite] = useState(false)

  // Per-child settings
  const [teenModes,     setTeenModes]     = useState<Record<string, number>>({})
  const [teenModeBusy,  setTeenModeBusy]  = useState<string | null>(null)
  const [growthSettings, setGrowthSettings] = useState<Record<string, ChildGrowthSettings>>({})
  const [growthBusy,    setGrowthBusy]    = useState<string | null>(null)
  const [expandedGrowth, setExpandedGrowth] = useState<string | null>(null)

  const { toast, showToast } = useToast()

  function comingSoon() {
    showToast('Coming Soon to the Orchard')
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [c, f, s] = await Promise.all([
      getChildren().then(r => r.children),
      getFamily(),
      getSettings(),
    ])
    setChildren(c)
    onChildrenChange(c)
    setFamily(f)
    setSettings(s)
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

  async function handleAddChild(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newChildName.trim()) return
    setAddingChild(true)
    try {
      const result = await addChild(newChildName.trim(), 'HYBRID')
      setAddChildResult(result)
      setNewChildName('')
      await load()
    } finally {
      setAddingChild(false)
    }
  }

  async function handleSetAvatar(id: string) {
    setSavingAvatar(true)
    try {
      await updateSettings({ avatar_id: id })
      localStorage.setItem('mc_parent_avatar', id)
      await load()
      setShowAvatarPicker(false)
    } finally {
      setSavingAvatar(false)
    }
  }

  async function handleGenerateInvite() {
    setGenningInvite(true)
    try {
      const r = await generateInvite('co-parent')
      setInviteCode(r.code)
      setInviteExpiry(new Date(r.expires_at * 1000).toLocaleString('en-GB'))
    } finally {
      setGenningInvite(false)
    }
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

  const myAvatar = settings?.avatar_id ?? 'bot'
  const activeChild = view.type === 'child'
    ? children.find(c => c.id === view.childId) ?? null
    : null

  // ── Views ───────────────────────────────────────────────────────────────────

  // ── Child Profile sub-menu ──────────────────────────────────────────────────
  if (view.type === 'child' && activeChild) {
    const isTeen = teenModes[activeChild.id] === 1
    const isBusy = teenModeBusy === activeChild.id
    const g      = growthSettings[activeChild.id]

    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}

        <SectionHeader
          title={activeChild.display_name}
          onBack={() => setView({ type: 'section', section: 'family' })}
        />

        {/* Identity & Security */}
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
            Identity & Security
          </p>
          <SectionCard>
            <SettingsRow
              icon={<User size={15} />}
              label="Display Name"
              description="Edit this child's name"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Lock size={15} />}
              label="Reset PIN"
              description="Generate a new 6-digit secret key"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>}
              label="Login History"
              description="Recent sessions and device activity"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>

        {/* Interface & Experience */}
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
            Interface & Experience
          </p>
          <SectionCard>
            {/* Orchard Theme — functional via teen_mode */}
            <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                    <Eye size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--color-text)]">Interface Style</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                      {isTeen ? "Detailed 'Professional' view" : "Simplified 'Seedling' view"}
                    </p>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={isTeen}
                  onClick={() => handleTeenModeToggle(activeChild.id)}
                  disabled={isBusy}
                  className={cn(
                    'shrink-0 relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
                    'disabled:opacity-50',
                    isTeen ? 'bg-[var(--brand-primary)]' : 'bg-[var(--color-border)]',
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
                    isTeen ? 'translate-x-5' : 'translate-x-0',
                  )} />
                </button>
              </div>
            </div>

            <SettingsRow
              icon={<TreePine size={15} />}
              label="Experience Level"
              description="Seedling View (under 12) or Professional View (12+)"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>

        {/* Orchard Rules (Individual) */}
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
            Individual Rules
          </p>
          <SectionCard>
            <SettingsRow
              icon={<Check size={15} />}
              label="Approval Mode"
              description="Parental sign-off or self-reported (trust-based)"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Calendar size={15} />}
              label="Allowance Status"
              description="Pause or resume the flow of funds to this account"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Shield size={15} />}
              label="Safety Net"
              description={`Overdraft limit for this child — currently £0`}
              onClick={comingSoon}
            />

            {/* Growth Path — functional */}
            <div className="px-4 py-3.5">
              <button
                onClick={() => setExpandedGrowth(expandedGrowth === activeChild.id ? null : activeChild.id)}
                className="w-full flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                    <span className="text-[15px]">🌳</span>
                  </span>
                  <div className="text-left min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--color-text)]">Growth Path</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                      {(() => {
                        const path = GROWTH_PATHS.find(p => p.mode === (g?.earnings_mode ?? 'HYBRID'))
                        return path ? `${path.icon} ${path.subtitle}` : '🌳 Allowance + Chores'
                      })()}
                    </p>
                  </div>
                </div>
                <span className={cn('text-[var(--color-text-muted)] text-[12px] transition-transform duration-150', expandedGrowth === activeChild.id ? 'rotate-180' : '')}>▾</span>
              </button>

              {expandedGrowth === activeChild.id && (
                <div className="mt-3 space-y-1.5">
                  {GROWTH_PATHS.map(path => {
                    const active = (g?.earnings_mode ?? 'HYBRID') === path.mode
                    const busy   = growthBusy === activeChild.id
                    return (
                      <button
                        key={path.mode}
                        disabled={busy}
                        onClick={() => handleGrowthUpdate(activeChild.id, { earnings_mode: path.mode })}
                        className={cn(
                          'w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer disabled:opacity-50',
                          active
                            ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]'
                            : 'border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[16px]">{path.icon}</span>
                          <div className="min-w-0">
                            <p className={cn('text-[13px] font-semibold', active ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text)]')}>
                              {path.title}
                            </p>
                            <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">{path.description}</p>
                          </div>
                          {active && <Check size={14} className="ml-auto text-[var(--brand-primary)] shrink-0" />}
                        </div>
                      </button>
                    )
                  })}

                  {(g?.earnings_mode ?? 'HYBRID') !== 'CHORES' && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Amount (pence)</label>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          defaultValue={g?.allowance_amount ?? 0}
                          onBlur={e => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val >= 0) handleGrowthUpdate(activeChild.id, { allowance_amount: val })
                          }}
                          className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[13px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                        />
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">500 = £5.00</p>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Frequency</label>
                        <select
                          value={g?.allowance_frequency ?? 'WEEKLY'}
                          onChange={e => handleGrowthUpdate(activeChild.id, { allowance_frequency: e.target.value as 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' })}
                          className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[13px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
                        >
                          {Object.entries(FREQ_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Danger Zone — Lead Parent only */}
        {isLead && (
          <div>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
              Danger Zone
            </p>
            <div className="rounded-xl border-2 border-red-500 overflow-hidden">
              <SettingsRow
                icon={<AlertTriangle size={15} />}
                label="Delete Profile"
                description="Permanently uproot this child from the orchard — deletes their ledger and all data"
                onClick={comingSoon}
                destructive
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Section views ───────────────────────────────────────────────────────────

  if (view.type === 'section') {

    // ── 1. Account & Profile ──────────────────────────────────────────────────
    if (view.section === 'account') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Account & Profile" onBack={() => setView({ type: 'menu' })} />

          {/* Avatar */}
          <SectionCard>
            <div className="px-4 py-3.5 flex items-center gap-3">
              <button
                onClick={() => setShowAvatarPicker(true)}
                className="relative cursor-pointer group shrink-0"
                title="Change avatar"
              >
                <AvatarSVG id={myAvatar} size={52} />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 rounded-full transition-colors text-white text-[18px] opacity-0 group-hover:opacity-100">✎</span>
              </button>
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-text)]">
                  {(family.display_name as string) ?? identity?.display_name ?? 'My family'}
                </p>
                <button
                  onClick={() => setShowAvatarPicker(true)}
                  className="text-[12px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
                >
                  Change avatar
                </button>
              </div>
            </div>
          </SectionCard>

          {showAvatarPicker && (
            <SectionCard>
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <p className="text-[15px] font-bold">Choose avatar</p>
                <button onClick={() => setShowAvatarPicker(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {AVATAR_CATEGORIES.map(cat => (
                  <div key={cat.id}>
                    <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">{cat.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {AVATARS.filter(av => av.category === cat.id).map(av => (
                        <button
                          key={av.id}
                          onClick={() => handleSetAvatar(av.id)}
                          disabled={savingAvatar}
                          className={cn(
                            'p-1.5 rounded-xl border-2 transition-colors cursor-pointer',
                            myAvatar === av.id
                              ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]'
                              : 'border-transparent hover:border-[var(--color-border)]',
                          )}
                          title={av.name}
                        >
                          <AvatarSVG id={av.id} size={40} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard>
            <SettingsRow
              icon={<User size={15} />}
              label="Display Name"
              description="Update your name as shown in the app"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Shield size={15} />}
              label="Email Management"
              description="Update or verify your email address"
              onClick={comingSoon}
            />
          </SectionCard>

          {/* Delete — Lead only */}
          {isLead && (
            <div>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
              <div className="rounded-xl border-2 border-red-500 overflow-hidden">
                <SettingsRow
                  icon={<AlertTriangle size={15} />}
                  label="Delete Account"
                  description="Permanently uproot your orchard and delete your family account, including all data"
                  onClick={comingSoon}
                  destructive
                />
              </div>
            </div>
          )}
        </div>
      )
    }

    // ── 2. Manage Family ─────────────────────────────────────────────────────
    if (view.section === 'family') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Manage Family" onBack={() => setView({ type: 'menu' })} />

          {/* Children */}
          <div>
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Children</p>
              {isLead && (
                <button
                  onClick={() => setShowAddChild(v => !v)}
                  className="text-[12px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
                >
                  + Add child
                </button>
              )}
            </div>
            <SectionCard>
              {children.length === 0 && !showAddChild && (
                <p className="px-4 py-6 text-center text-[14px] text-[var(--color-text-muted)]">No children yet.</p>
              )}
              {children.map(child => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => setView({ type: 'child', childId: child.id })}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer transition-colors text-left"
                >
                  <AvatarSVG id={child.avatar_id ?? 'bot'} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--color-text)]">{child.display_name}</p>
                    {child.locked_until && child.locked_until > Date.now() / 1000 && (
                      <p className="text-[12px] text-red-600 font-semibold">Locked</p>
                    )}
                  </div>
                  <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
                </button>
              ))}

              {showAddChild && isLead && (
                <form onSubmit={handleAddChild} className="px-4 py-3 space-y-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  {addChildResult && (
                    <div className="bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] rounded-lg p-3">
                      <p className="text-[13px] font-semibold text-[var(--brand-primary)] mb-1">Child added!</p>
                      <p className="text-[12px] text-[var(--color-text)]">Share this PIN code with them to log in:</p>
                      <p className="text-[20px] font-extrabold text-[var(--brand-primary)] tracking-widest mt-1">{addChildResult.invite_code}</p>
                    </div>
                  )}
                  <input
                    required
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                    placeholder="Child's name"
                    value={newChildName}
                    onChange={e => setNewChildName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowAddChild(false); setAddChildResult(null) }} className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] bg-white cursor-pointer">Cancel</button>
                    <button type="submit" disabled={addingChild} className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                      {addingChild ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </form>
              )}
            </SectionCard>
          </div>

          {/* Co-parenting */}
          <div>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Co-parenting</p>
            <SectionCard>
              {/* Invite co-parent — functional */}
              <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
                <p className="text-[14px] font-semibold text-[var(--color-text)] mb-2">Invite a Co-Parent</p>
                {inviteCode ? (
                  <div className="space-y-1">
                    <p className="text-[13px] text-[var(--color-text-muted)]">Share this code (expires {inviteExpiry}):</p>
                    <p className="text-[22px] font-extrabold tracking-widest text-[var(--color-text)]">{inviteCode}</p>
                    <button onClick={() => setInviteCode(null)} className="text-[12px] text-[var(--color-text-muted)] hover:underline cursor-pointer">Clear</button>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={genningInvite}
                    className="w-full border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50 cursor-pointer"
                  >
                    {genningInvite ? 'Generating…' : 'Generate invite code'}
                  </button>
                )}
              </div>

              {/* Remove co-parent — Lead only */}
              {isLead && (
                <SettingsRow
                  icon={<Users size={15} />}
                  label="Remove Co-Parent"
                  description="Revoke access for the secondary manager"
                  onClick={comingSoon}
                  destructive
                />
              )}
            </SectionCard>
          </div>

          {/* Global Orchard Rules */}
          <div>
            <div className="flex items-center gap-2 px-1 mb-2">
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Global Family Rules</p>
              {!isLead && <ReadOnlyBadge />}
            </div>
            <SectionCard>
              <SettingsRow
                icon={<Calendar size={15} />}
                label="Allowance Day"
                description="Weekly day for automated allowance drops — your family's harvest day"
                onClick={comingSoon}
                disabled={!isLead}
                badge={!isLead ? undefined : undefined}
              />
              <SettingsRow
                icon={<Shield size={15} />}
                label="Global Overdraft Policy"
                description="Toggle bailouts — default: off / £0"
                onClick={comingSoon}
                disabled={!isLead}
              />
            </SectionCard>
          </div>
        </div>
      )
    }

    // ── 3. Security & Access ─────────────────────────────────────────────────
    if (view.section === 'security') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Security & Access" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <SettingsRow
              icon={<Lock size={15} />}
              label="PIN Management"
              description="Reset your 6-digit parent PIN"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Eye size={15} />}
              label="Active Sessions"
              description="View and log out of all devices accessing the Family Orchard"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>
      )
    }

    // ── 4. Appearance & Display ──────────────────────────────────────────────
    if (view.section === 'appearance') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Appearance & Display" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
              <ThemePicker />
            </div>
            <SettingsRow
              icon={<Info size={15} />}
              label="Language"
              description="UK English / Polish"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>
      )
    }

    // ── 5. Billing & Subscriptions ───────────────────────────────────────────
    if (view.section === 'billing') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Billing & Subscriptions" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <SettingsRow
              icon={<CreditCard size={15} />}
              label="Trial Status"
              description="Visual tracker for the 14-day Professional trial"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<CreditCard size={15} />}
              label="Plan Management"
              description="Upgrade, downgrade or cancel subscription"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<CreditCard size={15} />}
              label="Payment History"
              description="View past invoices for Seedling or Professional tiers"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>
      )
    }

    // ── 6. Data & Exports ────────────────────────────────────────────────────
    if (view.section === 'data') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Data & Exports" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <SettingsRow
              icon={<Database size={15} />}
              label="Download Ledger"
              description="Full family transaction history (CSV / PDF)"
              onClick={comingSoon}
            />
            {/* Data Pruning — Lead only */}
            {isLead && (
              <SettingsRow
                icon={<AlertTriangle size={15} />}
                label="Data Pruning"
                description="Clean up records older than 2 years (immutable ledger protection)"
                onClick={comingSoon}
                destructive
              />
            )}
          </SectionCard>
        </div>
      )
    }

    // ── 7. Referrals ─────────────────────────────────────────────────────────
    if (view.section === 'referrals') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="Referrals" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <SettingsRow
              icon={<Gift size={15} />}
              label="Refer a Family"
              description="Share the grove — generate a unique referral link or discount code for other families"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>
      )
    }

    // ── 8. About & Support ───────────────────────────────────────────────────
    if (view.section === 'about') {
      return (
        <div className="space-y-4">
          {toast && <Toast message={toast} />}
          <SectionHeader title="About & Support" onBack={() => setView({ type: 'menu' })} />
          <SectionCard>
            <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
              <p className="text-[13px] font-semibold text-[var(--color-text-muted)]">Version</p>
              <p className="text-[14px] font-bold text-[var(--color-text)] mt-0.5">
                {__APP_VERSION__ ?? '—'}
              </p>
            </div>
            <SettingsRow
              icon={<Info size={15} />}
              label="Privacy Policy"
              description="How we handle your family's data"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Info size={15} />}
              label="Terms of Use"
              description="The Legal Grove"
              onClick={comingSoon}
            />
            <SettingsRow
              icon={<Info size={15} />}
              label="Support Desk"
              description="Get help with Morechard"
              onClick={comingSoon}
            />
          </SectionCard>
        </div>
      )
    }
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
declare const __APP_VERSION__: string | undefined
