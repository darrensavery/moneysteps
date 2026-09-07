/**
 * FamilySettings — Manage Family section.
 *
 * Owns: active-child routing, add-child form state, co-parent invite state.
 * Parent (ParentSettingsTab) owns: children list, teen modes, growth settings.
 * Child profile sub-menu delegated to ChildProfileSettings.
 */

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { copyText } from '../../../lib/clipboard'
import { blurOnWheel, blockInvalidAmountKeys } from '../../../lib/utils'
import { Users, Shield, Calendar, ChevronRight, AlertTriangle } from 'lucide-react'
import type { ChildRecord, ChildGrowthSettings } from '../../../lib/api'
import { getCoParents, removeCoParent } from '../../../lib/api'
import { AvatarSVG } from '../../../lib/avatars'
import { Toast, SettingsRow, SectionCard, SectionHeader, ReadOnlyBadge } from '../shared'
import { ChildProfileSettings } from './ChildProfileSettings'
import { GovernanceConsentBanner } from './GovernanceConsentBanner'
import { useTone } from '../../../lib/useTone'
import { Toggle } from '../../ui/Toggle'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  children:          ChildRecord[]
  appViews:          Record<string, 'ORCHARD' | 'CLEAN'>
  appViewBusy:       string | null
  growthSettings:    Record<string, ChildGrowthSettings>
  growthBusy:        string | null
  familyId:          string
  userId:            string
  isLead:            boolean
  hasCoParent:       boolean
  sharedExpenseThreshold:       number
  sharedExpenseSplitBp:         number
  savingSharedExpense:          boolean
  toast:             string | null
  onBack:            () => void
  onComingSoon:      () => void
  onAddChild:        (name: string) => Promise<{ child_id: string; invite_code: string }>
  onAppViewToggle:   (childId: string, next: 'ORCHARD' | 'CLEAN') => void
  onGrowthUpdate:    (childId: string, patch: Partial<Pick<ChildGrowthSettings, 'earnings_mode' | 'allowance_amount' | 'allowance_frequency'>>) => void
  onRenameChild:     (childId: string, newName: string) => void
  onPinResetSuccess: () => void
  onGenerateInvite:  () => Promise<{ code: string; expires_at: number }>
  onSharedExpenseThresholdChange: (v: number) => void
  onSharedExpenseSplitChange:     (v: number) => void
  onSaveSharedExpense:            () => Promise<void>
  pocketMoneyDay:        number
  onSavePocketMoneyDay:  (day: number) => Promise<void>
  overdraftEnabled:      boolean
  overdraftLimitPence:   number
  onSaveOverdraftPolicy: (enabled: boolean, limitPence: number) => Promise<void>
  onCoParentRemoved:     () => Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FamilySettings({
  children, appViews, appViewBusy, growthSettings, growthBusy,
  familyId, userId, isLead, hasCoParent,
  sharedExpenseThreshold, sharedExpenseSplitBp, savingSharedExpense,
  toast, onBack, onComingSoon,
  onAddChild, onAppViewToggle, onGrowthUpdate, onRenameChild, onPinResetSuccess, onGenerateInvite,
  onSharedExpenseThresholdChange, onSharedExpenseSplitChange, onSaveSharedExpense,
  pocketMoneyDay, onSavePocketMoneyDay,
  overdraftEnabled, overdraftLimitPence, onSaveOverdraftPolicy,
  onCoParentRemoved,
}: Props) {
  const { terminology } = useTone(0)  // parent settings — never teen view
  const [activeChildId,       setActiveChildId]       = useState<string | null>(null)
  const [showAddChild,        setShowAddChild]        = useState(false)
  const [newChildName,        setNewChildName]        = useState('')
  const [addingChild,         setAddingChild]         = useState(false)
  const [addChildResult,      setAddChildResult]      = useState<{ child_id: string; invite_code: string } | null>(null)
  const [inviteCode,          setInviteCode]          = useState<string | null>(null)
  const [inviteExpiry,        setInviteExpiry]        = useState<string | null>(null)
  const [genningInvite,       setGenningInvite]       = useState(false)
  const [copied,              setCopied]              = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])
  const [showSharedExpenses,  setShowSharedExpenses]  = useState(false)

  const [showPocketMoneyDay,  setShowPocketMoneyDay]  = useState(false)
  const [selectedDay,         setSelectedDay]         = useState(pocketMoneyDay)
  const [savingDay,           setSavingDay]           = useState(false)

  const [showOverdraftPolicy, setShowOverdraftPolicy] = useState(false)
  const [localEnabled,        setLocalEnabled]        = useState(overdraftEnabled)
  const [localLimitPence,     setLocalLimitPence]     = useState(overdraftLimitPence)
  const [savingOverdraft,     setSavingOverdraft]     = useState(false)

  const [showRemoveCoParent,   setShowRemoveCoParent]   = useState(false)
  const [coParentInfo,         setCoParentInfo]         = useState<{ user_id: string; display_name: string } | null>(null)
  const [loadingCoParent,      setLoadingCoParent]      = useState(false)
  const [removingCoParent,     setRemovingCoParent]     = useState(false)
  const [removeCoParentError,  setRemoveCoParentError]  = useState<string | null>(null)

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

  async function handleShare() {
    if (!inviteCode) return
    const text = `Join my family on Morechard! Download the app at app.morechard.com and use invite code ${inviteCode} to join.`
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my family on Morechard!',
          text,
          url: 'https://app.morechard.com',
        })
      } catch {
        // user cancelled or share failed — ignore
      }
    } else {
      await copyText(text)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopied(true)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    }
  }

  useEffect(() => {
    if (!showRemoveCoParent) return
    setLoadingCoParent(true)
    setRemoveCoParentError(null)
    getCoParents()
      .then(({ co_parents }) => setCoParentInfo(co_parents[0] ?? null))
      .catch(() => setRemoveCoParentError('Could not load co-parent information.'))
      .finally(() => setLoadingCoParent(false))
  }, [showRemoveCoParent])

  async function handleConfirmRemoveCoParent() {
    if (!coParentInfo) return
    setRemovingCoParent(true)
    setRemoveCoParentError(null)
    try {
      await removeCoParent(coParentInfo.user_id)
      setShowRemoveCoParent(false)
      setCoParentInfo(null)
      await onCoParentRemoved()
    } catch (err) {
      setRemoveCoParentError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRemovingCoParent(false)
    }
  }

  const activeChild = activeChildId ? children.find(c => c.id === activeChildId) ?? null : null

  if (showPocketMoneyDay) {
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    async function handleSaveDay() {
      setSavingDay(true)
      try {
        await onSavePocketMoneyDay(selectedDay)
        setShowPocketMoneyDay(false)
      } finally {
        setSavingDay(false)
      }
    }

    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}
        <SectionHeader title={`${terminology.allowanceLabel} Day`} onBack={() => setShowPocketMoneyDay(false)} />

        <SectionCard>
          <div className="px-4 py-3.5">
            <p className="text-[0.8125rem] font-semibold text-[var(--color-text)] mb-0.5">
              Weekly payout day
            </p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-3 leading-snug">
              The day each child's allowance is automatically added to their balance.
            </p>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedDay(idx)}
                  className={`flex-1 py-2 rounded-lg text-[0.75rem] font-semibold border cursor-pointer transition-colors ${
                    selectedDay === idx
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </SectionCard>

        <button
          onClick={handleSaveDay}
          disabled={savingDay}
          className="w-full bg-[var(--brand-primary)] text-white font-semibold text-[0.875rem] py-3 rounded-xl disabled:opacity-50 cursor-pointer"
        >
          {savingDay ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    )
  }

  if (showOverdraftPolicy) {
    async function handleSaveOverdraft() {
      setSavingOverdraft(true)
      try {
        await onSaveOverdraftPolicy(localEnabled, localLimitPence)
        setShowOverdraftPolicy(false)
      } finally {
        setSavingOverdraft(false)
      }
    }

    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}
        <SectionHeader title="Global Overdraft Policy" onBack={() => setShowOverdraftPolicy(false)} />

        <SectionCard>
          {/* Toggle row */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--color-border)]">
            <div className="flex-1 min-w-0 pr-4">
              <p className="text-[0.8125rem] font-semibold text-[var(--color-text)]">Allow Overdraft</p>
              <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-snug">
                Let children's balances go negative
              </p>
            </div>
            <Toggle checked={localEnabled} onChange={() => setLocalEnabled(!localEnabled)} label="Allow Overdraft" />
          </div>

          {/* Limit input — shown only when enabled */}
          {localEnabled && (
            <div className="px-4 py-3.5">
              <p className="text-[0.8125rem] font-semibold text-[var(--color-text)] mb-0.5">Overdraft Limit</p>
              <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-2.5 leading-snug">
                Maximum amount a child can go into the negative.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[0.875rem] text-[var(--color-text-muted)]">£</span>
                <label htmlFor="overdraft-limit-input" className="sr-only">Overdraft limit</label>
                <input
                  id="overdraft-limit-input"
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  required
                  aria-required="true"
                  value={(localLimitPence / 100).toFixed(0)}
                  onChange={e => setLocalLimitPence(Math.round(parseFloat(e.target.value || '0') * 100))}
                  onWheel={blurOnWheel}
                  onKeyDown={blockInvalidAmountKeys}
                  className="border border-[var(--color-border)] rounded-xl px-4 py-2 text-[0.875rem] bg-[var(--color-surface)] w-28 tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
            </div>
          )}
        </SectionCard>

        <button
          onClick={handleSaveOverdraft}
          disabled={savingOverdraft}
          className="w-full bg-[var(--brand-primary)] text-white font-semibold text-[0.875rem] py-3 rounded-xl disabled:opacity-50 cursor-pointer"
        >
          {savingOverdraft ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    )
  }

  if (showSharedExpenses) {
    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}
        <SectionHeader title="Shared Expenses" onBack={() => setShowSharedExpenses(false)} />

        <SectionCard>
          {/* Approval threshold */}
          <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
            <p className="text-[0.8125rem] font-semibold text-[var(--color-text)] mb-0.5">Approval Threshold</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-2.5">
              Expenses above this amount require the other parent's approval (Verification mode only).
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[0.875rem] text-[var(--color-text-muted)]">£</span>
              <label htmlFor="shared-expense-threshold-input" className="sr-only">Approval threshold</label>
              <input
                id="shared-expense-threshold-input"
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                required
                aria-required="true"
                value={(sharedExpenseThreshold / 100).toFixed(0)}
                onChange={e => onSharedExpenseThresholdChange(Math.round(parseFloat(e.target.value || '0') * 100))}
                onWheel={blurOnWheel}
                onKeyDown={blockInvalidAmountKeys}
                className="border border-[var(--color-border)] rounded-xl px-4 py-2 text-[0.875rem] bg-[var(--color-surface)] w-28 tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
            </div>
          </div>

          {/* Default split */}
          <div className="px-4 py-3.5">
            <label htmlFor="shared-expense-split-input" className="text-[0.8125rem] font-semibold text-[var(--color-text)] mb-0.5 block">
              Default Split — {(sharedExpenseSplitBp / 100).toFixed(0)}% / {(100 - sharedExpenseSplitBp / 100).toFixed(0)}%
            </label>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-2.5">
              Your share vs. the co-parent's share for new shared expenses.
            </p>
            <input
              id="shared-expense-split-input"
              type="range"
              min={0}
              max={10000}
              step={100}
              value={sharedExpenseSplitBp}
              onChange={e => onSharedExpenseSplitChange(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </SectionCard>

        <button
          onClick={onSaveSharedExpense}
          disabled={savingSharedExpense}
          className="w-full bg-[var(--brand-primary)] text-white font-semibold text-[0.875rem] py-3 rounded-xl disabled:opacity-50 cursor-pointer"
        >
          {savingSharedExpense ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    )
  }

  if (showRemoveCoParent) {
    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}
        <SectionHeader title="Remove Co-Parent" onBack={() => { setShowRemoveCoParent(false); setRemoveCoParentError(null) }} />

        {loadingCoParent && (
          <p className="text-center text-[0.875rem] text-[var(--color-text-muted)] py-8">Loading…</p>
        )}

        {!loadingCoParent && coParentInfo && (
          <>
            <SectionCard>
              <div className="px-4 py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertTriangle size={18} className="text-red-600" />
                  </span>
                  <div>
                    <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{coParentInfo.display_name}</p>
                    <p className="text-[0.75rem] text-[var(--color-text-muted)]">Co-parent</p>
                  </div>
                </div>
                <p className="text-[0.8125rem] text-[var(--color-text-muted)] leading-relaxed">
                  Removing <strong>{coParentInfo.display_name}</strong> will immediately revoke their access. They will be
                  logged out on all devices and won't be able to view or manage the family. Any pending shared expenses will
                  be voided. This cannot be undone — you would need to send a new invite to re-add them.
                </p>
              </div>
            </SectionCard>

            {removeCoParentError && (
              <p className="text-[0.8125rem] text-red-600 font-semibold px-1">{removeCoParentError}</p>
            )}

            <button
              onClick={handleConfirmRemoveCoParent}
              disabled={removingCoParent}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold text-[0.875rem] py-3 rounded-xl disabled:opacity-50 cursor-pointer transition-colors"
            >
              {removingCoParent ? 'Removing…' : `Remove ${coParentInfo.display_name}`}
            </button>

            <button
              onClick={() => { setShowRemoveCoParent(false); setRemoveCoParentError(null) }}
              className="w-full border border-[var(--color-border)] text-[var(--color-text-muted)] font-semibold text-[0.875rem] py-3 rounded-xl cursor-pointer hover:bg-[var(--color-surface-alt)] transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {!loadingCoParent && !coParentInfo && !removeCoParentError && (
          <p className="text-center text-[0.875rem] text-[var(--color-text-muted)] py-8">No co-parent found.</p>
        )}

        {removeCoParentError && !coParentInfo && (
          <p className="text-[0.8125rem] text-red-600 font-semibold px-1">{removeCoParentError}</p>
        )}
      </div>
    )
  }

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
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Children</p>
          {isLead && (
            <button onClick={() => setShowAddChild(v => !v)} className="text-[0.75rem] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
              + Add child
            </button>
          )}
        </div>
        <SectionCard>
          {children.length === 0 && !showAddChild && (
            <p className="px-4 py-6 text-center text-[0.875rem] text-[var(--color-text-muted)]">No children yet.</p>
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
                <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{child.display_name}</p>
                {child.locked_until && child.locked_until > Date.now() / 1000 && (
                  <p className="text-[0.75rem] text-red-600 font-semibold">Locked</p>
                )}
              </div>
              <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
            </button>
          ))}

          {showAddChild && isLead && (
            <form onSubmit={handleAddChild} className="px-4 py-3 space-y-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
              {addChildResult && (
                <div className="bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] rounded-lg p-3">
                  <p className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] mb-1">Child added!</p>
                  <p className="text-[0.75rem] text-[var(--color-text)]">Share this PIN code with them to log in:</p>
                  <p className="text-[1.25rem] font-extrabold text-[var(--brand-primary)] tracking-widest mt-1">{addChildResult.invite_code}</p>
                </div>
              )}
              <label htmlFor="family-add-child-name" className="sr-only">Child's name</label>
              <input
                id="family-add-child-name"
                required
                aria-required="true"
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[0.875rem] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="Child's name"
                value={newChildName}
                onChange={e => setNewChildName(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowAddChild(false); setAddChildResult(null) }} className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] bg-white cursor-pointer">Cancel</button>
                <button type="submit" disabled={addingChild} className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[0.875rem] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                  {addingChild ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          )}
        </SectionCard>
      </div>

      {/* Partner / Co-parenting */}
      <div>
        {hasCoParent && <GovernanceConsentBanner familyId={familyId} userId={userId} />}
        <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
          {hasCoParent ? 'Co-parenting' : 'Partner'}
        </p>
        <SectionCard>
          <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
            <p className="text-[0.875rem] font-semibold text-[var(--color-text)] mb-2">
              {hasCoParent ? 'Invite a Co-Parent' : 'Add a Partner'}
            </p>
            {!hasCoParent && (
              <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-2 leading-snug">
                Share an invite code so your partner can join the family.
              </p>
            )}
            {inviteCode ? (
              <div className="space-y-1">
                <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Share this code (expires {inviteExpiry}):</p>
                <p className="text-[1.375rem] font-extrabold tracking-widest text-[var(--color-text)]">{inviteCode}</p>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleShare}
                    className="text-[0.75rem] font-semibold text-[var(--color-text)] hover:underline cursor-pointer"
                  >
                    {copied ? 'Copied!' : 'Share'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteCode(null)}
                    className="text-[0.75rem] text-[var(--color-text-muted)] hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerateInvite}
                disabled={genningInvite}
                className="w-full border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                {genningInvite ? 'Generating…' : 'Generate invite code'}
              </button>
            )}
          </div>
          {hasCoParent && (
            <SettingsRow
              icon={<Users size={15} />}
              label="Shared Expenses"
              description="Approval threshold and default split with your co-parent"
              onClick={() => setShowSharedExpenses(true)}
            />
          )}
          {isLead && hasCoParent && (
            <SettingsRow icon={<Users size={15} />} label="Remove Co-Parent" description="Revoke access for the secondary manager" onClick={() => setShowRemoveCoParent(true)} destructive />
          )}
        </SectionCard>
      </div>

      {/* Global Family Rules */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Global Family Rules</p>
          {!isLead && <ReadOnlyBadge />}
        </div>
        <SectionCard>
          <SettingsRow icon={<Calendar size={15} />} label={`${terminology.allowanceLabel} Day`} description={`Weekly day for automated ${terminology.money} drops — your family's harvest day`} onClick={() => { setSelectedDay(pocketMoneyDay); setShowPocketMoneyDay(true) }} disabled={!isLead} />
          <SettingsRow icon={<Shield size={15} />} label="Global Overdraft Policy" description="Toggle bailouts — default: off / £0" onClick={() => { setLocalEnabled(overdraftEnabled); setLocalLimitPence(overdraftLimitPence); setShowOverdraftPolicy(true) }} disabled={!isLead} />
        </SectionCard>
      </div>
    </div>
  )
}
