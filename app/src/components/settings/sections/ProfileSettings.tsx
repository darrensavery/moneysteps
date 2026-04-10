/**
 * ProfileSettings — Account & Profile section.
 *
 * Owns: inline form state (inputs, editing flags, errors, saving flags).
 * Parent owns: profile truth data, avatar/settings truth, identity.
 * Callbacks: onSaveName(newName), onSaveEmail(newEmail), onSetAvatar(id).
 */

import { useState } from 'react'
import { User, Shield, AlertTriangle, X, LogOut } from 'lucide-react'
import { AvatarSVG, AVATARS, AVATAR_CATEGORIES } from '../../../lib/avatars'
import type { MeResult } from '../../../lib/api'
import { leaveFamily, deleteFamily, clearToken } from '../../../lib/api'
import { clearDeviceIdentity, getDeviceIdentity } from '../../../lib/deviceIdentity'
import { cn } from '../../../lib/utils'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

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
  onBack, onComingSoon, toast,
}: Props) {
  const myAvatar = settings?.avatar_id ?? 'bot'

  // Avatar picker
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [savingAvatar,     setSavingAvatar]     = useState(false)

  // Display name inline edit
  const [editingName, setEditingName] = useState(false)
  const [nameInput,   setNameInput]   = useState('')
  const [nameSaving,  setNameSaving]  = useState(false)
  const [nameError,   setNameError]   = useState<string | null>(null)

  // Email inline edit
  const [editingEmail, setEditingEmail] = useState(false)
  const [emailInput,   setEmailInput]   = useState('')
  const [emailSaving,  setEmailSaving]  = useState(false)
  const [emailError,   setEmailError]   = useState<string | null>(null)

  // Danger zone modal state
  const [showLeaveModal,  setShowLeaveModal]  = useState(false)
  const [showUprootModal, setShowUprootModal] = useState(false)
  const [uprootInput,     setUprootInput]     = useState('')
  const [dangerBusy,      setDangerBusy]      = useState(false)
  const [dangerError,     setDangerError]     = useState<string | null>(null)

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
    setEmailSaving(true)
    setEmailError(null)
    try {
      await onSaveEmail(trimmed)
      setEditingEmail(false)
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

  function wipeLsAndRedirect() {
    clearDeviceIdentity()
    sessionStorage.removeItem('mc_parent_tab')
    localStorage.removeItem('mc_parent_avatar')
    clearToken()
    window.location.replace('/')
  }

  async function handleLeave() {
    setDangerBusy(true)
    setDangerError(null)
    try {
      await leaveFamily()
      wipeLsAndRedirect()
    } catch (err: unknown) {
      setDangerError((err as Error).message)
      setDangerBusy(false)
    }
  }

  async function handleUproot() {
    if (uprootInput !== 'UPROOT') return
    setDangerBusy(true)
    setDangerError(null)
    try {
      await deleteFamily()
      wipeLsAndRedirect()
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
              placeholder="Your name"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {nameError && <p className="text-[12px] text-red-500">{nameError}</p>}
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
          description={profile?.email ?? 'No email set'}
          badge={profile && (profile.email_verified === 0 || profile.email_pending) ? 'Unverified' : undefined}
          onClick={() => {
            setEmailInput(profile?.email ?? '')
            setEmailError(null)
            setEditingEmail(v => !v)
            setEditingName(false)
          }}
        />
        {editingEmail && (
          <form onSubmit={handleSaveEmail} className="px-4 py-3 border-t border-[var(--color-border)] space-y-2">
            <input
              type="email"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              autoFocus
              placeholder="your@email.com"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {emailError && <p className="text-[12px] text-red-500">{emailError}</p>}
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
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-[var(--color-text)]">Leave Family?</p>
              <button onClick={() => { setShowLeaveModal(false); setDangerError(null) }} className="text-[var(--color-text-muted)] cursor-pointer">
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
            {dangerError && <p className="text-[12px] text-red-500">{dangerError}</p>}
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
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-red-600">Delete Everything?</p>
              <button onClick={() => { setShowUprootModal(false); setUprootInput(''); setDangerError(null) }} className="text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              This will permanently uproot your orchard. All family data, chores, and goals will be deleted. The ledger will be anonymised but structurally preserved.
            </p>
            <input
              type="text"
              value={uprootInput}
              onChange={e => setUprootInput(e.target.value)}
              placeholder="Type UPROOT to confirm"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-red-300 bg-red-50 text-red-800 placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {dangerError && <p className="text-[12px] text-red-500">{dangerError}</p>}
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
    </div>
  )
}
