import { useState, useEffect, useCallback } from 'react'
import { clearDeviceIdentity } from '../../lib/deviceIdentity'
import type { ChildRecord } from '../../lib/api'
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
} from '../../lib/api'
import { AvatarSVG, AVATARS, AVATAR_CATEGORIES } from '../../lib/avatars'
import { ThemePicker } from '../../lib/theme'

interface Props {
  familyId: string
  onChildrenChange: (children: ChildRecord[]) => void
}

export function ParentSettingsTab({ familyId, onChildrenChange }: Props) {
  const [children, setChildren]     = useState<ChildRecord[]>([])
  const [family, setFamily]         = useState<Record<string, unknown>>({})
  const [settings, setSettings]     = useState<{ avatar_id: string; theme: string; locale: string } | null>(null)
  const [loading, setLoading]       = useState(true)

  // Add child
  const [showAddChild, setShowAddChild]     = useState(false)
  const [newChildName, setNewChildName]     = useState('')
  const [addingChild, setAddingChild]       = useState(false)
  const [addChildResult, setAddChildResult] = useState<{ child_id: string; invite_code: string } | null>(null)

  // Avatar picker
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [savingAvatar, setSavingAvatar]         = useState(false)

  // Invite
  const [inviteCode, setInviteCode]   = useState<string | null>(null)
  const [inviteExpiry, setInviteExpiry] = useState<string | null>(null)
  const [genningInvite, setGenningInvite] = useState(false)

  // Per-child teen_mode toggles: Record<child_id, 0|1>
  const [teenModes, setTeenModes]       = useState<Record<string, number>>({})
  const [teenModeBusy, setTeenModeBusy] = useState<string | null>(null)

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
    // Load teen_mode for each child in parallel
    const modes = await Promise.all(
      c.map(child => getChildSettings(child.id).then(cs => [child.id, cs.teen_mode] as const).catch(() => [child.id, 0] as const))
    )
    setTeenModes(Object.fromEntries(modes))
    setLoading(false)
  }, [familyId, onChildrenChange])

  useEffect(() => { load() }, [load])

  async function handleAddChild(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newChildName.trim()) return
    setAddingChild(true)
    try {
      const result = await addChild(newChildName.trim())
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
    } finally {
      setTeenModeBusy(null)
    }
  }

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  const myAvatar = settings?.avatar_id ?? 'bot'

  return (
    <div className="space-y-4">
      {/* My account */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <p className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">My account</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAvatarPicker(true)}
            className="relative cursor-pointer group"
            title="Change avatar"
          >
            <AvatarSVG id={myAvatar} size={52} />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 rounded-full transition-colors text-white text-[18px] opacity-0 group-hover:opacity-100">✎</span>
          </button>
          <div>
            <p className="text-[14px] font-semibold text-[var(--color-text)]">
              {(family.display_name as string) ?? 'My family'}
            </p>
            <button
              onClick={() => setShowAvatarPicker(true)}
              className="text-[12px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
            >
              Change avatar
            </button>
          </div>
        </div>
      </section>

      {/* Avatar picker */}
      {showAvatarPicker && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[15px] font-bold">Choose avatar</p>
            <button onClick={() => setShowAvatarPicker(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer text-[20px] leading-none">×</button>
          </div>
          {AVATAR_CATEGORIES.map(cat => (
            <div key={cat.id} className="mb-3">
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-1.5">{cat.label}</p>
              <div className="flex flex-wrap gap-2">
                {AVATARS.filter(av => av.category === cat.id).map(av => (
                  <button
                    key={av.id}
                    onClick={() => handleSetAvatar(av.id)}
                    disabled={savingAvatar}
                    className={`p-1.5 rounded-xl border-2 transition-colors cursor-pointer
                      ${myAvatar === av.id ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]' : 'border-transparent hover:border-[var(--color-border)]'}`}
                    title={av.name}
                  >
                    <AvatarSVG id={av.id} size={40} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Children */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Children</p>
          <button
            onClick={() => setShowAddChild(v => !v)}
            className="text-[13px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
          >
            + Add child
          </button>
        </div>

        {children.map(child => {
          const isTeen = teenModes[child.id] === 1
          const isBusy = teenModeBusy === child.id
          return (
            <div key={child.id} className="px-4 py-3 border-b border-[var(--color-border)] last:border-0">
              <div className="flex items-center gap-3">
                <AvatarSVG id={child.avatar_id ?? 'bot'} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--color-text)]">{child.display_name}</p>
                  {child.locked_until && child.locked_until > Date.now() / 1000 && (
                    <p className="text-[12px] text-red-600 font-semibold">Locked</p>
                  )}
                </div>
              </div>

              {/* Mature View toggle */}
              <div className="mt-2.5 flex items-start justify-between gap-3 pl-[52px]">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text)]">Mature View (Ages 13+)</p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    Switches the dashboard to a minimalist, professional fintech layout.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={isTeen}
                  onClick={() => handleTeenModeToggle(child.id)}
                  disabled={isBusy}
                  className={`
                    shrink-0 relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]
                    disabled:opacity-50
                    ${isTeen ? 'bg-[var(--brand-primary)]' : 'bg-[var(--color-border)]'}
                  `}
                >
                  <span className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                    ${isTeen ? 'translate-x-5' : 'translate-x-0'}
                  `} />
                </button>
              </div>
            </div>
          )
        })}

        {children.length === 0 && !showAddChild && (
          <div className="px-4 py-6 text-center text-[14px] text-[var(--color-text-muted)]">No children yet.</div>
        )}

        {showAddChild && (
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
      </section>

      {/* Co-parent invite */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <p className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Invite co-parent</p>
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
      </section>

      {/* Display mode */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <ThemePicker />
      </section>

      {/* Log out */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Log out</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
              Your family's data stays safe. You'll need to log back in to use the app on this phone.
            </p>
          </div>
          <button
            onClick={() => {
              if (!window.confirm('Log out? Your family\'s data stays safe.')) return
              clearDeviceIdentity()
              window.location.href = '/'
            }}
            className="shrink-0 px-4 py-2 rounded-xl border-2 border-[var(--color-border)] text-[var(--color-text-muted)] text-[13px] font-semibold hover:bg-[var(--color-surface-alt)] active:scale-[0.98] transition-all cursor-pointer"
          >
            Log out
          </button>
        </div>
      </section>
    </div>
  )
}