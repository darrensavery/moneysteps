/**
 * ChildProfileSettings — Child profile sub-menu.
 *
 * Rendered by FamilySettings when a child row is tapped.
 * Owns: growth path expand/collapse state.
 * Parent (FamilySettings) owns: teen modes, growth settings, busy flags.
 */

import { useState } from 'react'
import {
  Shield, Calendar, AlertTriangle, Check,
  TreePine, Eye, Lock,
} from 'lucide-react'
import type { ChildRecord, ChildGrowthSettings } from '../../../lib/api'
import { cn } from '../../../lib/utils'
import { SettingsRow, SectionCard, SectionHeader } from '../shared'

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
  isTeen:           boolean
  isBusy:           boolean
  growth:           ChildGrowthSettings | undefined
  growthBusy:       string | null
  isLead:           boolean
  onTeenModeToggle: (childId: string) => void
  onGrowthUpdate:   (childId: string, patch: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>) => void
  onComingSoon:     () => void
  onBack:           () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChildProfileSettings({
  child, isTeen, isBusy, growth, growthBusy, isLead,
  onTeenModeToggle, onGrowthUpdate, onComingSoon, onBack,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-4">
      <SectionHeader title={child.display_name} onBack={onBack} />

      {/* Identity & Security */}
      <div>
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Identity & Security</p>
        <SectionCard>
          <SettingsRow
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
            label="Display Name" description="Edit this child's name" onClick={onComingSoon}
          />
          <SettingsRow icon={<Lock size={15} />} label="Reset PIN" description="Generate a new 6-digit secret key" onClick={onComingSoon} />
          <SettingsRow
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>}
            label="Login History" description="Recent sessions and device activity" onClick={onComingSoon}
          />
        </SectionCard>
      </div>

      {/* Interface & Experience */}
      <div>
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Interface & Experience</p>
        <SectionCard>
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
                onClick={() => onTeenModeToggle(child.id)}
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
          <SettingsRow icon={<TreePine size={15} />} label="Experience Level" description="Seedling View (under 12) or Professional View (12+)" onClick={onComingSoon} />
        </SectionCard>
      </div>

      {/* Individual Rules */}
      <div>
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Individual Rules</p>
        <SectionCard>
          <SettingsRow icon={<Check size={15} />} label="Approval Mode" description="Parental sign-off or self-reported (trust-based)" onClick={onComingSoon} />
          <SettingsRow icon={<Calendar size={15} />} label="Allowance Status" description="Pause or resume the flow of funds to this account" onClick={onComingSoon} />
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
  )
}
