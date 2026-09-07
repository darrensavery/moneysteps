/**
 * ChildProfileSettings — Child profile sub-menu.
 *
 * Rendered by FamilySettings when a child row is tapped.
 * Owns: activeView routing, sheet open/close state, growth path expand/collapse.
 * Parent (FamilySettings) owns: teen modes, growth settings, busy flags.
 */

import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import {
  Shield, Calendar, AlertTriangle, Check,
  TreePine, Lock, CreditCard,
} from 'lucide-react'
import type { ChildRecord, ChildGrowthSettings } from '../../../lib/api'
import { renameChild, setChildPin as apiSetChildPin, setPaymentHandles, getFamilyId, regenerateChildInvite } from '../../../lib/api'
import { getDetails, setDetails, clearDetails } from '../../../lib/localBankDetails'
import { cn } from '../../../lib/utils'
import { SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useTone } from '../../../lib/useTone'
import { useLocale } from '../../../lib/locale'
import { ChildLoginHistory } from './ChildLoginHistory'

// ── Growth Path config ────────────────────────────────────────────────────────

const GROWTH_PATHS = [
  { mode: 'ALLOWANCE' as const, title: 'Only Allowance',    description: 'A fixed amount paid automatically on a regular schedule — no chores required.',   icon: '💰' },
  { mode: 'CHORES'    as const, title: 'Only Chores',       description: 'Money is earned by completing tasks. Nothing is paid unless a chore is done.',      icon: '✅' },
  { mode: 'HYBRID'    as const, title: 'Chores + Allowance', description: 'Regular allowance payments plus the option to earn extra by completing chores.',    icon: '⚖️' },
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


// ── Invite Code Sheet ─────────────────────────────────────────────────────────

function InviteCodeSheet({
  child, onClose,
}: { child: ChildRecord; onClose: () => void }) {
  const [code,    setCode]    = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)

  useEffect(() => {
    let cancelled = false
    regenerateChildInvite(child.id)
      .then(res => { if (!cancelled) { setCode(res.invite_code); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not generate code — please try again.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [child.id])

  async function copyCode() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function shareCode() {
    if (!code) return
    const text = `Join ${child.display_name}'s family on Morechard! Download the app at app.morechard.com and enter code: ${code}`
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await copyCode()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center space-y-1">
          <p className="text-[1.0625rem] font-bold text-[var(--color-text)]">
            {child.display_name}&apos;s Invite Code
          </p>
          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
            Share this code so {child.display_name} can log in on their device
          </p>
        </div>

        {loading && (
          <p className="text-center text-[0.875rem] text-[var(--color-text-muted)] py-4">Generating…</p>
        )}

        {error && (
          <p className="text-center text-[0.8125rem] text-red-500">{error}</p>
        )}

        {code && !loading && (
          <>
            <div className="flex justify-center">
              <p className="text-[2.5rem] font-extrabold tracking-[0.25em] text-[var(--brand-primary)] font-mono select-all">
                {code}
              </p>
            </div>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)] text-center">
              Valid for 72 hours · Single use · Generating a new code invalidates the old one
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyCode}
                className="flex-1 py-3 rounded-xl text-[0.875rem] font-bold border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
              >
                {copied ? '✓ Copied' : 'Copy Code'}
              </button>
              <button
                type="button"
                onClick={shareCode}
                className="flex-1 py-3 rounded-xl text-[0.875rem] font-bold bg-[var(--brand-primary)] text-white hover:opacity-90 transition-opacity cursor-pointer"
              >
                Share
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full text-[0.8125rem] text-[var(--color-text-muted)] hover:underline cursor-pointer pt-1"
        >
          Close
        </button>
      </div>
    </div>
  )
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
        <p className="text-[1.0625rem] font-bold text-[var(--color-text)] text-center">
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

        {errMsg && <p className="text-[0.8125rem] text-red-500 text-center">{errMsg}</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              disabled={saving}
              className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[1.375rem] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={saving}
            className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[1.375rem] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            disabled={saving}
            className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[1.125rem] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-[0.8125rem] text-[var(--color-text-muted)] hover:underline cursor-pointer pt-1"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Payment Settings View ─────────────────────────────────────────────────────

type Handle = 'monzo' | 'revolut' | 'paypal' | 'venmo'

interface PaymentSettingsProps {
  child:           ChildRecord
  isUS:            boolean
  isPL:            boolean
  locale:          string
  sortCode:        string
  setSortCode:     (v: string) => void
  acctNum:         string
  setAcctNum:      (v: string) => void
  zelle:           string
  setZelle:        (v: string) => void
  saveBankDetails: () => Promise<void>
  onBack:          () => void
}

function PaymentSettingsView({
  child, isUS, isPL, locale,
  sortCode, setSortCode, acctNum, setAcctNum, zelle, setZelle,
  saveBankDetails, onBack,
}: PaymentSettingsProps) {
  const handles: { key: Handle; label: string; placeholder: string }[] = [
    ...(!isUS && !isPL ? [
      { key: 'monzo'   as const, label: 'Monzo',   placeholder: 'alexj' },
      { key: 'revolut' as const, label: 'Revolut', placeholder: 'alexj' },
    ] : []),
    { key: 'paypal', label: 'PayPal', placeholder: 'alexj' },
    ...(isUS ? [{ key: 'venmo' as const, label: 'Venmo', placeholder: 'alexj' }] : []),
  ]

  const [handleValues, setHandleValues] = useState<Partial<Record<Handle, string>>>(
    () => Object.fromEntries(handles.map(h => [h.key, child[`${h.key}_handle`] ?? ''])),
  )
  const [handleSaving, setHandleSaving] = useState(false)
  const [handleSaved,  setHandleSaved]  = useState(false)
  const [handleErr,    setHandleErr]    = useState<string | null>(null)

  const [bankSaved, setBankSaved] = useState(false)

  async function saveHandles() {
    setHandleSaving(true)
    setHandleErr(null)
    setHandleSaved(false)
    try {
      const patch: Record<string, string | null> = {}
      for (const h of handles) {
        patch[`${h.key}_handle`] = handleValues[h.key]?.trim() || null
      }
      await setPaymentHandles(child.id, patch)
      setHandleSaved(true)
    } catch {
      setHandleErr('Could not save — please try again.')
    } finally {
      setHandleSaving(false)
    }
  }

  async function saveBankAndMark() {
    await saveBankDetails()
    setBankSaved(true)
    setTimeout(() => setBankSaved(false), 2000)
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Payment Settings" onBack={onBack} />

      {/* Payment Handles — locale-gated */}
      <div>
        <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Payment Handles</p>
        <SectionCard>
          <div className="px-4 py-3">
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mb-3">
              Your child&apos;s username for their payment app — no @ sign. Used to
              deep-link into your banking app when you pay rewards.
            </p>
            {handles.map(({ key, label, placeholder }) => (
              <label key={key} className="flex items-center gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
                <span className="w-20 text-[0.8125rem] text-[var(--color-text)]">{label}</span>
                <input
                  type="text"
                  value={handleValues[key] ?? ''}
                  onChange={e => setHandleValues(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 text-[0.875rem] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </label>
            ))}
            {handleErr && <p className="text-[0.75rem] text-red-500 mt-2">{handleErr}</p>}
            <button
              type="button"
              onClick={saveHandles}
              disabled={handleSaving}
              className="mt-3 w-full py-2 rounded-xl text-[0.8125rem] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-50 cursor-pointer"
            >
              {handleSaving ? 'Saving…' : handleSaved ? '✓ Saved' : 'Save Handles'}
            </button>
          </div>
        </SectionCard>
      </div>

      {/* Bank Transfer / Zelle — locale-gated */}
      {(locale === 'en-GB' || locale === 'en-US') && (
        <div>
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
            {isUS ? 'Zelle' : 'Bank Transfer Details'}
          </p>
          <SectionCard>
            <div className="px-4 py-3">
              {!isUS && (
                <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-[0.6875rem] text-neutral-600 mb-3">
                  Stored on this device only — never sent to our servers. If you switch
                  phones, you&apos;ll re-enter them.
                </div>
              )}
              {!isUS && (
                <>
                  <label className="flex items-center gap-3 py-2 border-b border-[var(--color-border)]">
                    <span className="w-32 text-[0.8125rem] text-[var(--color-text)]">Sort code</span>
                    <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                      value={sortCode} onChange={e => setSortCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="201575"
                      className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 font-mono text-[0.875rem] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
                  </label>
                  <label className="flex items-center gap-3 py-2">
                    <span className="w-32 text-[0.8125rem] text-[var(--color-text)]">Account number</span>
                    <input inputMode="numeric" pattern="[0-9]{8}" maxLength={8}
                      value={acctNum} onChange={e => setAcctNum(e.target.value.replace(/\D/g, ''))}
                      placeholder="12345678"
                      className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 font-mono text-[0.875rem] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
                  </label>
                </>
              )}
              {isUS && (
                <label className="flex items-center gap-3 py-2">
                  <span className="w-32 text-[0.8125rem] text-[var(--color-text)]">Email / phone</span>
                  <input type="text"
                    value={zelle} onChange={e => setZelle(e.target.value)}
                    placeholder="alex@example.com"
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2 py-1 text-[0.875rem] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
                </label>
              )}
              <button
                type="button"
                onClick={saveBankAndMark}
                className="mt-3 w-full py-2 rounded-xl text-[0.8125rem] font-bold bg-[var(--brand-primary)] text-white cursor-pointer"
              >
                {bankSaved ? '✓ Saved' : isUS ? 'Save Zelle Details' : 'Save Bank Details'}
              </button>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActiveView = 'root' | 'login-history' | 'payment-settings'

export function ChildProfileSettings({
  child, appView, appViewBusy, growth, growthBusy, isLead,
  onAppViewToggle, onGrowthUpdate, onRenameChild, onPinResetSuccess, onComingSoon, onBack,
}: Props) {
  const { terminology } = useTone(0)
  const { locale } = useLocale()
  const familyId = getFamilyId()

  // Derive currency symbol and minor-unit divisor from locale
  const isUS = locale === 'en-US'
  const isPL = locale === 'pl'
  const currencySymbol = isUS ? '$' : isPL ? 'zł' : '£'
  const minorDivisor   = isPL ? 100 : 100  // pence / grosz — always 100
  const [expanded,     setExpanded]     = useState(false)
  const [activeView,   setActiveView]   = useState<ActiveView>('root')
  const [editingName,  setEditingName]  = useState(false)
  const [nameInput,    setNameInput]    = useState('')
  const [nameSaving,   setNameSaving]   = useState(false)
  const [nameError,    setNameError]    = useState<string | null>(null)
  const [showPinSheet, setShowPinSheet] = useState(false)
  const [showInviteSheet, setShowInviteSheet] = useState(false)
  const [sortCode, setSortCode] = useState('')
  const [acctNum, setAcctNum] = useState('')
  const [zelle, setZelle] = useState('')

  useEffect(() => {
    let cancelled = false
    getDetails(familyId, child.id).then(d => {
      if (cancelled) return
      setSortCode(d?.sortCode ?? '')
      setAcctNum(d?.accountNumber ?? '')
      setZelle(d?.zelleHandle ?? '')
    })
    return () => { cancelled = true }
  }, [familyId, child.id])

  async function saveBankDetails() {
    if (!sortCode && !acctNum && !zelle) {
      await clearDetails(familyId, child.id)
      return
    }
    await setDetails(familyId, child.id, {
      childId: child.id,
      sortCode: sortCode || undefined,
      accountNumber: acctNum || undefined,
      zelleHandle: zelle || undefined,
      updatedAt: Date.now(),
    })
  }

  if (activeView === 'login-history') {
    return (
      <ChildLoginHistory
        childId={child.id}
        childName={child.display_name}
        onBack={() => setActiveView('root')}
      />
    )
  }

  if (activeView === 'payment-settings') {
    return <PaymentSettingsView
      child={child}
      isUS={isUS}
      isPL={isPL}
      locale={locale}
      sortCode={sortCode}
      setSortCode={setSortCode}
      acctNum={acctNum}
      setAcctNum={setAcctNum}
      zelle={zelle}
      setZelle={setZelle}
      saveBankDetails={saveBankDetails}
      onBack={() => setActiveView('root')}
    />
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
      {showInviteSheet && (
        <InviteCodeSheet
          child={child}
          onClose={() => setShowInviteSheet(false)}
        />
      )}

      <div className="space-y-4">
        <SectionHeader title={child.display_name} onBack={onBack} />

        {/* Identity & Security */}
        <div>
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Identity & Security</p>
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
                <label htmlFor="child-profile-name-input" className="sr-only">Child's name</label>
                <input
                  id="child-profile-name-input"
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  maxLength={40}
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? 'child-profile-name-error' : undefined}
                  placeholder="Child's name"
                  className="w-full px-3 py-2 text-[0.875rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
                {nameError && <p id="child-profile-name-error" role="alert" className="text-[0.75rem] text-red-500">{nameError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={nameSaving || nameInput.trim().length < 1 || nameInput.trim() === child.display_name}
                    className="flex-1 py-2 rounded-xl text-[0.8125rem] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {nameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingName(false); setNameError(null) }}
                    className="px-4 py-2 rounded-xl text-[0.8125rem] font-semibold text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
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
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>}
              label="Invite Code"
              description="Get a 6-digit code so your child can log in"
              onClick={() => setShowInviteSheet(true)}
            />
            <SettingsRow
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>}
              label="Login History"
              description="Recent sessions and device activity"
              onClick={() => setActiveView('login-history')}
            />
          </SectionCard>
        </div>

        {/* Payment Settings */}
        <div>
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Payments</p>
          <SectionCard>
            <SettingsRow
              icon={<CreditCard size={15} />}
              label="Payment Settings"
              description="Payment handles and bank transfer details"
              onClick={() => setActiveView('payment-settings')}
            />
          </SectionCard>
        </div>

        {/* Rules & Experience */}
        <div>
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Rules & Experience</p>
          <SectionCard>
            {/* App View — two-option selector */}
            <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3 mb-3">
                <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                  <TreePine size={15} />
                </span>
                <div>
                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">App View</p>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
                    {appView === 'ORCHARD' ? 'Orchard View — nature metaphors' : 'No Metaphors — plain language'}
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
                      'py-2.5 rounded-xl border text-[0.8125rem] font-semibold transition-colors cursor-pointer disabled:opacity-50',
                      appView === v
                        ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] text-[var(--brand-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]',
                    )}
                  >
                    {v === 'ORCHARD' ? '🌳 Orchard' : '💬 No Metaphors'}
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
                  <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                    <TreePine size={15} />
                  </span>
                  <div className="text-left min-w-0">
                    <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">Earning Method</p>
                    <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
                      {GROWTH_PATHS.find(p => p.mode === (growth?.earnings_mode ?? 'HYBRID'))?.title ?? 'Chores + Allowance'}
                    </p>
                  </div>
                </div>
                <span className={cn('text-[var(--color-text-muted)] text-[0.75rem] transition-transform duration-150', expanded ? 'rotate-180' : '')}>▾</span>
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
                        <div className="flex items-center gap-3">
                          <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[0.875rem]">
                            {path.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-[0.8125rem] font-semibold', active ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text)]')}>{path.title}</p>
                            <p className="text-[0.6875rem] text-[var(--color-text-muted)] leading-snug mt-0.5">{path.description}</p>
                          </div>
                          {active && <Check size={14} className="shrink-0 text-[var(--brand-primary)]" />}
                        </div>
                      </button>
                    )
                  })}

                  {(growth?.earnings_mode ?? 'HYBRID') !== 'CHORES' && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="child-growth-allowance-amount" className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                          Amount ({currencySymbol})
                        </label>
                        <input
                          id="child-growth-allowance-amount"
                          type="number" min={0} step={1}
                          defaultValue={Math.round((growth?.allowance_amount ?? 0) / minorDivisor)}
                          onBlur={e => {
                            const whole = parseFloat(e.target.value)
                            if (!isNaN(whole) && whole >= 0)
                              onGrowthUpdate(child.id, { allowance_amount: Math.round(whole * minorDivisor) })
                          }}
                          className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                        />
                      </div>
                      <div>
                        <label htmlFor="child-growth-allowance-frequency" className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Frequency</label>
                        <select
                          id="child-growth-allowance-frequency"
                          value={growth?.allowance_frequency ?? 'WEEKLY'}
                          onChange={e => onGrowthUpdate(child.id, { allowance_frequency: e.target.value as 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' })}
                          className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] cursor-pointer"
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
            <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
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
