/**
 * FamilySettings — Manage Family section.
 *
 * Owns: active-child routing, add-child form state, co-parent invite state.
 * Parent (ParentSettingsTab) owns: children list, teen modes, growth settings.
 * Child profile sub-menu delegated to ChildProfileSettings.
 */

import { useState, type FormEvent } from 'react'
import { Users, Shield, Calendar, ChevronRight } from 'lucide-react'
import type { ChildRecord, ChildGrowthSettings } from '../../../lib/api'
import { AvatarSVG } from '../../../lib/avatars'
import { Toast, SettingsRow, SectionCard, SectionHeader, ReadOnlyBadge } from '../shared'
import { ChildProfileSettings } from './ChildProfileSettings'
import { useTone } from '../../../lib/useTone'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  children:          ChildRecord[]
  appViews:          Record<string, 'ORCHARD' | 'CLEAN'>
  appViewBusy:       string | null
  growthSettings:    Record<string, ChildGrowthSettings>
  growthBusy:        string | null
  isLead:            boolean
  toast:             string | null
  onBack:            () => void
  onComingSoon:      () => void
  onAddChild:        (name: string) => Promise<{ child_id: string; invite_code: string }>
  onAppViewToggle:   (childId: string, next: 'ORCHARD' | 'CLEAN') => void
  onGrowthUpdate:    (childId: string, patch: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>) => void
  onRenameChild:     (childId: string, newName: string) => void
  onPinResetSuccess: () => void
  onGenerateInvite:  () => Promise<{ code: string; expires_at: number }>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FamilySettings({
  children, appViews, appViewBusy, growthSettings, growthBusy,
  isLead, toast, onBack, onComingSoon,
  onAddChild, onAppViewToggle, onGrowthUpdate, onRenameChild, onPinResetSuccess, onGenerateInvite,
}: Props) {
  const { terminology } = useTone(0)  // parent settings — never teen view
  const [activeChildId,  setActiveChildId]  = useState<string | null>(null)
  const [showAddChild,   setShowAddChild]   = useState(false)
  const [newChildName,   setNewChildName]   = useState('')
  const [addingChild,    setAddingChild]    = useState(false)
  const [addChildResult, setAddChildResult] = useState<{ child_id: string; invite_code: string } | null>(null)
  const [inviteCode,     setInviteCode]     = useState<string | null>(null)
  const [inviteExpiry,   setInviteExpiry]   = useState<string | null>(null)
  const [genningInvite,  setGenningInvite]  = useState(false)

  async function handleAddChild(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newChildName.trim()) return
    setAddingChild(true)
    try {
      const result = await onAddChild(newChildName.trim())
      setAddChildResult(result)
      setNewChildName('')
    } finally {
      setAddingChild(false)
    }
  }

  async function handleGenerateInvite() {
    setGenningInvite(true)
    try {
      const r = await onGenerateInvite()
      setInviteCode(r.code)
      setInviteExpiry(new Date(r.expires_at * 1000).toLocaleString('en-GB'))
    } finally {
      setGenningInvite(false)
    }
  }

  const activeChild = activeChildId ? children.find(c => c.id === activeChildId) ?? null : null

  if (activeChild) {
    return (
      <>
        {toast && <Toast message={toast} />}
        <ChildProfileSettings
          child={activeChild}
          appView={appViews[activeChild.id] ?? 'ORCHARD'}
          appViewBusy={appViewBusy === activeChild.id}
          growth={growthSettings[activeChild.id]}
          growthBusy={growthBusy}
          isLead={isLead}
          onAppViewToggle={onAppViewToggle}
          onGrowthUpdate={onGrowthUpdate}
          onRenameChild={onRenameChild}
          onPinResetSuccess={onPinResetSuccess}
          onComingSoon={onComingSoon}
          onBack={() => setActiveChildId(null)}
        />
      </>
    )
  }

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Manage Family" onBack={onBack} />

      {/* Children */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Children</p>
          {isLead && (
            <button onClick={() => setShowAddChild(v => !v)} className="text-[12px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
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
              onClick={() => setActiveChildId(child.id)}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer transition-colors text-left"
            >
              <AvatarSVG id={child.avatar_id ?? 'bottts:spark'} size={36} />
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
          {isLead && (
            <SettingsRow icon={<Users size={15} />} label="Remove Co-Parent" description="Revoke access for the secondary manager" onClick={onComingSoon} destructive />
          )}
        </SectionCard>
      </div>

      {/* Global Family Rules */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Global Family Rules</p>
          {!isLead && <ReadOnlyBadge />}
        </div>
        <SectionCard>
          <SettingsRow icon={<Calendar size={15} />} label={`${terminology.allowanceLabel} Day`} description={`Weekly day for automated ${terminology.money} drops — your family's harvest day`} onClick={onComingSoon} disabled={!isLead} />
          <SettingsRow icon={<Shield size={15} />} label="Global Overdraft Policy" description="Toggle bailouts — default: off / £0" onClick={onComingSoon} disabled={!isLead} />
        </SectionCard>
      </div>
    </div>
  )
}
