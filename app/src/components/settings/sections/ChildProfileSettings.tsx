/**
 * ChildProfileSettings — Child profile sub-menu.
 *
 * Rendered by FamilySettings when a child row is tapped.
 * Owns: activeView routing, sheet open/close state, growth path expand/collapse.
 * Parent (FamilySettings) owns: teen modes, growth settings, busy flags.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Shield, Calendar, AlertTriangle, Check,
  TreePine, Lock,
} from 'lucide-react'
import type { ChildRecord, ChildGrowthSettings } from '../../../lib/api'
import { renameChild, setChildPin as apiSetChildPin } from '../../../lib/api'
import { cn } from '../../../lib/utils'
import { SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useTone } from '../../../lib/useTone'
import { ChildLoginHistory } from './ChildLoginHistory'

// ── Growth Path config ────────────────────────────────────────────────────────

const GROWTH_PATHS = [
  { mode: 'ALLOWANCE' as const, title: 'The Automated Harvest',  subtitle: 'Allowance only',      description: 'Fruit that grows on its own every season.',           icon: '🌧️' },
  { mode: 'CHORES'    as const, title: 'The Labor of the Land',  subtitle: 'Chores only',          description: 'Fruit gathered only by tending to the trees.',        icon: '🪵' },
  { mode: 'HYBRID'    as const, title: 'The Integrated Grove',   subtitle: 'Allowance + Chores',   description: 'A steady harvest with extra rewards for hard work.',   icon: '🌳' },
]

const FREQ_LABELS: Record<string, string> = {
  WEEKLY:    'Weekly',
  BI_WEEKLY: 'Every 2 weeks',
  MONTHLY:   'Monthly',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  child:            ChildRecord
  appView:          'ORCHARD' | 'CLEAN'
  appViewBusy:      boolean
  growth:           ChildGrowthSettings | undefined
  growthBusy:       string | null
  isLead:           boolean
  onAppViewToggle:  (childId: string, next: 'ORCHARD' | 'CLEAN') => void
  onGrowthUpdate:   (childId: string, patch: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>) => void
  onRenameChild:    (childId: string, newName: string) => void
  onPinResetSuccess: () => void
  onComingSoon:     () => void
  onBack:           () => void
}


// ── Reset PIN Sheet ───────────────────────────────────────────────────────────

const PIN_LENGTH = 4

function ResetPinSheet({
  child, onSuccess, onClose,
}: { child: ChildRecord; onSuccess: () => void; onClose: () => void }) {
  const [digits,  setDigits]  = useState<string[]>([])
  const [saving,  setSaving]  = useState(false)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  function handleDigit(d: string) {
    if (digits.length >= PIN_LENGTH || saving) return
    if ('vibrate' in navigator) navigator.vibrate(10)
    const next = [...digits, d]
    setDigits(next)
    if (next.length === PIN_LENGTH) submitPin(next.join(''))
  }

  function handleBackspace() {
    setDigits(prev => prev.slice(0, -1))
    setErrMsg(null)
  }

  async function submitPin(pin: string) {
    setSaving(true)
    setErrMsg(null)
    try {
      await apiSetChildPin(child.id, pin)
      onSuccess()
      onClose()
    } catch {
      setErrMsg('Something went wrong — try again.')
      setDigits([])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-[17px] font-bold text-[var(--color-text)] text-center">
          Set a new PIN for {child.display_name}
        </p>

        {/* Dot display */}
        <div className="flex justify-center gap-4">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                i < digits.length
                  ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]'
                  : 'bg-transparent border-[var(--color-border)]',
              )}
            />
          ))}
        </div>

        {errMsg && <p className="text-[13px] text-red-500 text-center">{errMsg}</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              disabled={saving}
              className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={saving}
            className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            disabled={saving}
            className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[18px] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-[13px] text-[var(--color-text-muted)] hover:underline cursor-pointer pt-1"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActiveView = 'root' | 'login-history'

export function ChildProfileSettings({
  child, appView, appViewBusy, growth, growthBusy, isLead,
  onAppViewToggle, onGrowthUpdate, onRenameChild, onPinResetSuccess, onComingSoon, onBack,
}: Props) {
  const { terminology } = useTone(0)
  const [expanded,     setExpanded]     = useState(false)
  const [activeView,   setActiveView]   = useState<ActiveView>('root')
  const [editingName,  setEditingName]  = useState(false)
  const [nameInput,    setNameInput]    = useState('')
  const [nameSaving,   setNameSaving]   = useState(false)
  const [nameError,    setNameError]    = useState<string | null>(null)
  const [showPinSheet, setShowPinSheet] = useState(false)

  if (activeView === 'login-history') {
    return (
      <ChildLoginHistory
        childId={child.id}
        childName={child.display_name}
        onBack={() => setActiveView('root')}
      />
    )
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === child.display_name) return
    setNameSaving(true)
    setNameError(null)
    try {
      const result = await renameChild(child.id, trimmed)
      onRenameChild(child.id, result.display_name)
      setEditingName(false)
    } catch (err: unknown) {
      setNameError((err as Error).message ?? 'Could not update name — please try again.')
    } finally {
      setNameSaving(false)
    }
  }

  return (
    <>
      {showPinSheet && (
        <ResetPinSheet
          child={child}
          onSuccess={onPinResetSuccess}
          onClose={() => setShowPinSheet(false)}
        />
      )}

      <div className="space-y-4">
        <SectionHeader title={child.display_name} onBack={onBack} />

        {/* Identity & Security */}
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Identity & Security</p>
          <SectionCard>
            <SettingsRow
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              label="Display Name"
              description={child.display_name}
              onClick={() => {
                setNameInput(child.display_name)
                setNameError(null)
                setEditingName(v => !v)
              }}
            />
            {editingName && (
              <form onSubmit={handleSaveName} className="px-4 py-3 border-t border-[var(--color-border)] space-y-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  maxLength={40}
                  autoFocus
                  placeholder="Child's name"
                  className="w-full px-3 py-2 text-[14px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
                {nameError && <p className="text-[12px] text-red-500">{nameError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={nameSaving || nameInput.trim().length < 1 || nameInput.trim() === child.display_name}
                    className="flex-1 py-2 rounded-xl text-[13px] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {nameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingName(false); setNameError(null) }}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <SettingsRow
              icon={<Lock size={15} />}
              label="Reset PIN"
              description="Update this child's 4-digit login PIN"
              onClick={() => setShowPinSheet(true)}
            />
            <SettingsRow
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>}
              label="Login History"
              description="Recent sessions and device activity"
              onClick={() => setActiveView('login-history')}
            />
          </SectionCard>
        </div>

        {/* Rules & Experience */}
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Rules & Experience</p>
          <SectionCard>
            {/* App View — two-option selector */}
            <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3 mb-3">
                <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                  <TreePine size={15} />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[var(--color-text)]">App View</p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    {appView === 'ORCHARD' ? 'Orchard View — nature metaphors' : 'Clean View — professional terms'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['ORCHARD', 'CLEAN'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    disabled={appViewBusy}
                    onClick={() => { if (appView !== v) onAppViewToggle(child.id, v) }}
                    className={cn(
                      'py-2.5 rounded-xl border text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-50',
                      appView === v
                        ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] text-[var(--brand-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]',
                    )}
                  >
                    {v === 'ORCHARD' ? '🌳 Orchard' : '📊 Clean'}
                  </button>
                ))}
              </div>
            </div>
            <SettingsRow icon={<Check size={15} />} label="Approval Mode" description="Parental sign-off or self-reported (trust-based)" onClick={onComingSoon} />
            <SettingsRow icon={<Calendar size={15} />} label={`${terminology.allowanceLabel} Status`} description="Pause or resume the flow of funds to this account" onClick={onComingSoon} />
            <SettingsRow icon={<Shield size={15} />} label="Safety Net" description="Overdraft limit for this child — currently £0" onClick={onComingSoon} />

            {/* Growth Path */}
            <div className="px-4 py-3.5">
              <button
                onClick={() => setExpanded(v => !v)}
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
                        const path = GROWTH_PATHS.find(p => p.mode === (growth?.earnings_mode ?? 'HYBRID'))
                        return path ? `${path.icon} ${path.subtitle}` : '🌳 Allowance + Chores'
                      })()}
                    </p>
                  </div>
                </div>
                <span className={cn('text-[var(--color-text-muted)] text-[12px] transition-transform duration-150', expanded ? 'rotate-180' : '')}>▾</span>
              </button>

              {expanded && (
                <div className="mt-3 space-y-1.5">
                  {GROWTH_PATHS.map(path => {
                    const active = (growth?.earnings_mode ?? 'HYBRID') === path.mode
                    const busy   = growthBusy === child.id
                    return (
                      <button
                        key={path.mode}
                        disabled={busy}
                        onClick={() => onGrowthUpdate(child.id, { earnings_mode: path.mode })}
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
                            <p className={cn('text-[13px] font-semibold', active ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text)]')}>{path.title}</p>
                            <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">{path.description}</p>
                          </div>
                          {active && <Check size={14} className="ml-auto text-[var(--brand-primary)] shrink-0" />}
                        </div>
                      </button>
                    )
                  })}

                  {(growth?.earnings_mode ?? 'HYBRID') !== 'CHORES' && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Amount (pence)</label>
                        <input
                          type="number" min={0} step={50}
                          defaultValue={growth?.allowance_amount ?? 0}
                          onBlur={e => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val >= 0) onGrowthUpdate(child.id, { allowance_amount: val })
                          }}
                          className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[13px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                        />
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">500 = £5.00</p>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Frequency</label>
                        <select
                          value={growth?.allowance_frequency ?? 'WEEKLY'}
                          onChange={e => onGrowthUpdate(child.id, { allowance_frequency: e.target.value as 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' })}
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

        {/* Danger Zone */}
        {isLead && (
          <div>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
            <div className="rounded-xl border-2 border-red-500 overflow-hidden">
              <SettingsRow
                icon={<AlertTriangle size={15} />}
                label="Delete Profile"
                description="Permanently uproot this child from the orchard — deletes their ledger and all data"
                onClick={onComingSoon}
                destructive
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
