/**
 * ProfileSettings — Account & Profile section.
 *
 * Owns: inline form state (inputs, editing flags, errors, saving flags).
 * Parent owns: profile truth data, avatar/settings truth, identity.
 * Callbacks: onSaveName(newName), onSaveEmail(newEmail), onSetAvatar(id).
 */

import { useState, useEffect, useRef } from 'react'
import { User, Shield, AlertTriangle, X, LogOut } from 'lucide-react'
import { AvatarSVG, DefaultAvatar, AVATAR_CATEGORIES, avatarsForCategory, type AvatarCategory } from '../../../lib/avatars'
import type { MeResult } from '../../../lib/api'
import { leaveFamily, deleteFamily, logout } from '../../../lib/api'
import { clearDeviceIdentity, getDeviceIdentity, verifyPinHash } from '../../../lib/deviceIdentity'
import { cn } from '../../../lib/utils'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useFocusTrap } from '../../../hooks/useFocusTrap'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  profile:      MeResult | null
  settings:     { avatar_id: string; theme: string; locale: string } | null
  identity:     ReturnType<typeof getDeviceIdentity>
  family:       Record<string, unknown>
  isLead:       boolean
  leadCount:    number
  onSaveName:   (newName: string) => Promise<void>
  onSaveEmail:  (newEmail: string) => Promise<void>
  onSetAvatar:  (id: string) => Promise<void>
  onBack:       () => void
  onComingSoon: () => void
  toast:        string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfileSettings({
  profile, settings, identity, family, isLead, leadCount,
  onSaveName, onSaveEmail, onSetAvatar,
  onBack, onComingSoon: _onComingSoon, toast,
}: Props) {
  const myAvatar = settings?.avatar_id ?? null

  // Avatar picker
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [savingAvatar,     setSavingAvatar]     = useState(false)

  // Display name inline edit
  const [editingName, setEditingName] = useState(false)
  const [nameInput,   setNameInput]   = useState('')
  const [nameSaving,  setNameSaving]  = useState(false)
  const [nameError,   setNameError]   = useState<string | null>(null)

  // Email inline edit
  const [editingEmail,    setEditingEmail]    = useState(false)
  const [emailInput,      setEmailInput]      = useState('')
  const [emailSaving,     setEmailSaving]     = useState(false)
  const [emailError,      setEmailError]      = useState<string | null>(null)
  const [emailSentTo,     setEmailSentTo]     = useState<string | null>(null)

  // Danger zone modal state
  const [showLeaveModal,  setShowLeaveModal]  = useState(false)
  const [showUprootModal, setShowUprootModal] = useState(false)
  const [uprootInput,     setUprootInput]     = useState('')
  const [dangerBusy,      setDangerBusy]      = useState(false)
  const [dangerError,     setDangerError]     = useState<string | null>(null)

  // PIN re-auth gate for sensitive operations
  const [pinGate,       setPinGate]       = useState<'email' | 'leave' | 'uproot' | null>(null)
  const [pinInput,      setPinInput]      = useState('')
  const [pinError,      setPinError]      = useState<string | null>(null)
  const [pinVerified,   setPinVerified]   = useState<'email' | 'leave' | 'uproot' | null>(null)

  // Focus traps for the three confirmation overlays
  const leaveModalRef  = useRef<HTMLDivElement>(null)
  const uprootModalRef = useRef<HTMLDivElement>(null)
  const pinGateModalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(leaveModalRef, showLeaveModal)
  useFocusTrap(uprootModalRef, showUprootModal)
  useFocusTrap(pinGateModalRef, pinGate !== null)

  useEffect(() => {
    if (!showLeaveModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowLeaveModal(false); setDangerError(null) }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showLeaveModal])

  useEffect(() => {
    if (!showUprootModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowUprootModal(false); setUprootInput(''); setDangerError(null) }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showUprootModal])

  useEffect(() => {
    if (!pinGate) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setPinGate(null); setPinInput(''); setPinError(null) }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pinGate])

  async function verifyPin(action: 'email' | 'leave' | 'uproot') {
    const storedHash = identity?.pin_hash
    if (!storedHash) { setPinVerified(action); setPinGate(null); return }
    const ok = await verifyPinHash(pinInput, storedHash)
    if (!ok) { setPinError('Incorrect PIN'); setPinInput(''); return }
    setPinVerified(action)
    setPinGate(null)
    setPinInput('')
    setPinError(null)
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === (profile?.display_name ?? '')) return
    setNameSaving(true)
    setNameError(null)
    try {
      await onSaveName(trimmed)
      setEditingName(false)
    } catch (err: unknown) {
      setNameError((err as Error).message)
    } finally {
      setNameSaving(false)
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = emailInput.trim()
    if (!trimmed || trimmed === (profile?.email ?? '')) return
    if (identity?.pin_hash && pinVerified !== 'email') {
      setPinGate('email')
      return
    }
    setEmailSaving(true)
    setEmailError(null)
    try {
      await onSaveEmail(trimmed)
      setEditingEmail(false)
      setEmailSentTo(trimmed)
      setPinVerified(null)
    } catch (err: unknown) {
      setEmailError((err as Error).message)
    } finally {
      setEmailSaving(false)
    }
  }

  async function handleSetAvatar(id: string) {
    setSavingAvatar(true)
    try {
      await onSetAvatar(id)
      setShowAvatarPicker(false)
    } finally {
      setSavingAvatar(false)
    }
  }

  async function wipeLsAndRedirect() {
    clearDeviceIdentity()
    localStorage.removeItem('mc_parent_tab')
    localStorage.removeItem('mc_parent_avatar')
    await logout().catch(() => undefined)
    window.location.replace('/')
  }

  async function handleLeave() {
    if (identity?.pin_hash && pinVerified !== 'leave') {
      setPinGate('leave')
      return
    }
    setDangerBusy(true)
    setDangerError(null)
    try {
      await leaveFamily()
      await wipeLsAndRedirect()
    } catch (err: unknown) {
      setDangerError((err as Error).message)
      setDangerBusy(false)
    }
  }

  async function handleUproot() {
    if (uprootInput !== 'UPROOT') return
    if (identity?.pin_hash && pinVerified !== 'uproot') {
      setPinGate('uproot')
      return
    }
    setDangerBusy(true)
    setDangerError(null)
    try {
      await deleteFamily()
      await wipeLsAndRedirect()
    } catch (err: unknown) {
      setDangerError((err as Error).message)
      setDangerBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Account & Profile" onBack={onBack} />

      {/* Avatar */}
      <SectionCard>
        <div className="px-4 py-3.5 flex items-center gap-3">
          {identity?.google_picture ? (
            <img
              src={identity.google_picture}
              alt={`${identity.display_name}'s profile photo`}
              className="w-[52px] h-[52px] rounded-full object-cover border-2 border-[var(--brand-primary)] shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <button
              onClick={() => setShowAvatarPicker(true)}
              className="relative cursor-pointer group shrink-0"
              title="Change avatar"
            >
              {myAvatar
                ? <AvatarSVG id={myAvatar} size={52} />
                : <DefaultAvatar size={52} initials={identity?.initials ?? identity?.display_name ?? 'P'} />
              }
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 rounded-full transition-colors text-white text-[18px] opacity-0 group-hover:opacity-100">✎</span>
            </button>
          )}
          <div>
            <p className="text-[14px] font-semibold text-[var(--color-text)]">
              {(family.display_name as string) ?? identity?.display_name ?? 'My family'}
            </p>
            {identity?.google_picture ? (
              <p className="text-[12px] text-[var(--color-text-muted)]">Google profile picture</p>
            ) : (
              <button
                onClick={() => setShowAvatarPicker(true)}
                className="text-[12px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
              >
                Change avatar
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      {!identity?.google_picture && showAvatarPicker && (
        <SectionCard>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <p className="text-[15px] font-bold">Choose avatar</p>
            <button onClick={() => setShowAvatarPicker(false)} className="tap-target-44 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <div className="p-3 grid grid-cols-6 gap-2">
            {AVATAR_CATEGORIES.flatMap(cat =>
              avatarsForCategory(cat.id as AvatarCategory).map(avId => (
                <button
                  key={avId}
                  onClick={() => handleSetAvatar(avId)}
                  disabled={savingAvatar}
                  className={cn(
                    'p-1 rounded-xl border-2 transition-colors cursor-pointer',
                    myAvatar === avId
                      ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]'
                      : 'border-transparent hover:border-[var(--color-border)]',
                  )}
                >
                  <AvatarSVG id={avId} size={44} />
                </button>
              ))
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard>
        {/* Display Name row */}
        <SettingsRow
          icon={<User size={15} />}
          label="Display Name"
          description={profile?.display_name ?? identity?.display_name ?? 'Not set'}
          onClick={() => {
            setNameInput(profile?.display_name ?? identity?.display_name ?? '')
            setNameError(null)
            setEditingName(v => !v)
            setEditingEmail(false)
            setShowAvatarPicker(false)
          }}
        />
        {editingName && (
          <form onSubmit={handleSaveName} className="px-4 py-3 border-t border-[var(--color-border)] space-y-2">
            <label htmlFor="profile-name-input" className="sr-only">Your name</label>
            <input
              id="profile-name-input"
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              maxLength={40}
              autoFocus
              required
              aria-required="true"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'profile-name-error' : undefined}
              placeholder="Your name"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {nameError && <p id="profile-name-error" role="alert" className="text-[12px] text-red-500">{nameError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={nameSaving || nameInput.trim().length < 2 || nameInput.trim() === (profile?.display_name ?? identity?.display_name ?? '')}
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

        {/* Email row */}
        <SettingsRow
          icon={<Shield size={15} />}
          label="Email"
          description={profile?.email_pending
            ? `${profile.email} · change pending`
            : (profile?.email ?? 'No email set')}
          badge={profile?.email_pending
            ? 'Verify pending'
            : (profile && profile.email_verified === 0 ? 'Unverified' : undefined)}
          onClick={() => {
            setEmailInput(profile?.email ?? '')
            setEmailError(null)
            setEmailSentTo(null)
            setEditingEmail(v => !v)
            setEditingName(false)
            setShowAvatarPicker(false)
          }}
        />
        {emailSentTo && !editingEmail && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-start gap-2 bg-teal-50">
            <span className="text-teal-600 shrink-0 mt-0.5">✓</span>
            <p className="text-[12px] text-teal-700 leading-snug">
              Verification email sent to <span className="font-semibold">{emailSentTo}</span>. Click the link in that email to confirm the change — your current address remains active until then.
            </p>
          </div>
        )}

        {editingEmail && (
          <form onSubmit={handleSaveEmail} className="px-4 py-3 border-t border-[var(--color-border)] space-y-2">
            <label htmlFor="profile-email-input" className="sr-only">Email address</label>
            <input
              id="profile-email-input"
              type="email"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              autoFocus
              required
              aria-required="true"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'profile-email-error' : undefined}
              placeholder="your@email.com"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {emailError && <p id="profile-email-error" role="alert" className="text-[12px] text-red-500">{emailError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={emailSaving || !emailInput.trim() || emailInput.trim() === (profile?.email ?? '')}
                className="flex-1 py-2 rounded-xl text-[13px] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {emailSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditingEmail(false); setEmailError(null) }}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      {/* Danger Zone — visible to all parents */}
      <div>
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
        <div className="rounded-xl border-2 border-red-500 overflow-hidden">
          {leadCount > 1 ? (
            <SettingsRow
              icon={<LogOut size={15} />}
              label="Leave Family"
              description="You will lose access, but the family ledger will remain for the other parent."
              onClick={() => setShowLeaveModal(true)}
              destructive
            />
          ) : (
            <SettingsRow
              icon={<AlertTriangle size={15} />}
              label="Delete Account"
              description="Permanently uproot your orchard and delete your family account, including all data"
              onClick={() => setShowUprootModal(true)}
              destructive
            />
          )}
        </div>
      </div>

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
          <div
            ref={leaveModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Leave family"
            tabIndex={-1}
            className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-[var(--color-text)]">Leave Family?</p>
              <button onClick={() => { setShowLeaveModal(false); setDangerError(null) }} className="tap-target-44 text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              You will permanently lose access to this family. The ledger and all data will remain for the other parent.
            </p>
            {isLead && (
              <p className="text-[12px] text-amber-600 font-semibold leading-relaxed">
                A co-parent will be promoted to Lead to ensure the family can still be managed.
              </p>
            )}
            {dangerError && <p role="alert" className="text-[12px] text-red-500">{dangerError}</p>}
            <button
              onClick={handleLeave}
              disabled={dangerBusy}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-red-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {dangerBusy ? 'Leaving…' : 'Leave Family'}
            </button>
          </div>
        </div>
      )}

      {/* Uproot Modal */}
      {showUprootModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
          <div
            ref={uprootModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Delete everything"
            tabIndex={-1}
            className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-red-600">Delete Everything?</p>
              <button onClick={() => { setShowUprootModal(false); setUprootInput(''); setDangerError(null) }} className="tap-target-44 text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              This will permanently uproot your orchard. All family data, chores, and goals will be deleted. The ledger is anonymised immediately, but pseudonymised transaction records are retained for up to 7 years to preserve the hash chain's integrity (see our Privacy Policy, Section 6), then permanently deleted.
            </p>
            <label htmlFor="uproot-confirm-input" className="sr-only">Type UPROOT to confirm</label>
            <input
              id="uproot-confirm-input"
              type="text"
              value={uprootInput}
              onChange={e => setUprootInput(e.target.value)}
              required
              aria-required="true"
              aria-invalid={!!dangerError}
              aria-describedby={dangerError ? 'uproot-error' : undefined}
              placeholder="Type UPROOT to confirm"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-red-300 bg-red-50 text-red-800 placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {dangerError && <p id="uproot-error" role="alert" className="text-[12px] text-red-500">{dangerError}</p>}
            <button
              onClick={handleUproot}
              disabled={dangerBusy || uprootInput !== 'UPROOT'}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-red-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {dangerBusy ? 'Deleting…' : 'Delete Everything'}
            </button>
          </div>
        </div>
      )}

      {/* PIN re-auth gate */}
      {pinGate && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pb-8">
          <div
            ref={pinGateModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm your PIN"
            tabIndex={-1}
            className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-[var(--color-text)]">Confirm your PIN</p>
              <button onClick={() => { setPinGate(null); setPinInput(''); setPinError(null) }} className="tap-target-44 text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              Enter your PIN to continue with this sensitive action.
            </p>
            <label htmlFor="profile-pin-confirm-input" className="sr-only">PIN</label>
            <input
              id="profile-pin-confirm-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(null) }}
              placeholder="••••"
              required
              aria-required="true"
              aria-invalid={!!pinError}
              aria-describedby={pinError ? 'profile-pin-confirm-error' : undefined}
              className="w-full text-center text-[24px] tracking-[0.5em] border-2 border-[var(--color-border)] rounded-xl px-3 py-3 bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:border-[var(--brand-primary)]"
              autoFocus
            />
            {pinError && <p id="profile-pin-confirm-error" role="alert" className="text-[12px] font-semibold text-red-600">{pinError}</p>}
            <button
              onClick={() => void verifyPin(pinGate)}
              disabled={pinInput.length < 4}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
