/**
 * ActiveSessionsSettings — view and revoke parent login sessions.
 */

import { useState, useEffect } from 'react'
import { Monitor, Smartphone, Tablet, AlertCircle, Loader2 } from 'lucide-react'
import type { SessionRow } from '../../../lib/api'
import { getSessions, revokeSession, revokeOtherSessions } from '../../../lib/api'
import { SectionHeader } from '../shared'

// ── UA parsing ────────────────────────────────────────────────────────────────

function parseUA(ua: string | null): string {
  if (!ua) return 'Unknown Device'
  if (ua.includes('Morechard'))                           return 'Morechard Mobile App'
  if (ua.includes('iPhone'))                              return 'Safari on iPhone'
  if (ua.includes('iPad'))                                return 'Safari on iPad'
  if (ua.includes('Android') && ua.includes('Firefox'))  return 'Firefox on Android'
  if (ua.includes('Android'))                             return 'Chrome on Android'
  if (ua.includes('Macintosh') && ua.includes('Chrome')) return 'Chrome on Mac'
  if (ua.includes('Macintosh') && ua.includes('Firefox'))return 'Firefox on Mac'
  if (ua.includes('Macintosh'))                           return 'Safari on Mac'
  if (ua.includes('Windows') && ua.includes('Firefox'))  return 'Firefox on Windows'
  if (ua.includes('Windows'))                             return 'Chrome on Windows'
  return 'Unknown Device'
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return 'Unknown'
  const diffMs  = Date.now() - unixSeconds * 1000
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60)    return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)    return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)      return `${diffH} hour${diffH === 1 ? '' : 's'} ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30)      return `${diffD} day${diffD === 1 ? '' : 's'} ago`
  const diffMo = Math.floor(diffD / 30)
  return `${diffMo} month${diffMo === 1 ? '' : 's'} ago`
}

// ── Device icon ────────────────────────────────────────────────────────────────

function DeviceIcon({ label }: { label: string }) {
  if (label.includes('iPhone') || label.includes('Android') || label.includes('Mobile')) {
    return <Smartphone size={18} className="text-[var(--brand-primary)]" />
  }
  if (label.includes('iPad')) {
    return <Tablet size={18} className="text-[var(--brand-primary)]" />
  }
  return <Monitor size={18} className="text-[var(--brand-primary)]" />
}

// ── JWT jti extraction ────────────────────────────────────────────────────────

function getCurrentJti(): string | null {
  try {
    const token = localStorage.getItem('mc_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.jti ?? null
  } catch {
    return null
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActiveSessionsSettings({ onBack }: Props) {
  const [sessions,    setSessions]    = useState<SessionRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [revoking,    setRevoking]    = useState<string | null>(null)
  const [revokeAll,   setRevokeAll]   = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const currentJti = getCurrentJti()

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const result = await getSessions()
      setSessions(result.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sessions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleRevoke(jti: string) {
    setRevoking(jti)
    setRevokeError(null)
    const snapshot = sessions
    setSessions(prev => prev.filter(s => s.jti !== jti))
    try {
      await revokeSession(jti)
    } catch (err) {
      setSessions(snapshot)
      setRevokeError('Could not revoke session. Please try again.')
      console.error('revokeSession failed:', err)
    } finally {
      setRevoking(null)
    }
  }

  async function handleRevokeAll() {
    setRevokeAll(true)
    setRevokeError(null)
    const snapshot = sessions
    setSessions(prev => prev.filter(s => s.jti === currentJti))
    try {
      await revokeOtherSessions()
    } catch (err) {
      setSessions(snapshot)
      setRevokeError('Could not revoke sessions. Please try again.')
      console.error('revokeOtherSessions failed:', err)
    } finally {
      setRevokeAll(false)
    }
  }

  const otherSessions = sessions.filter(s => s.jti !== currentJti)

  return (
    <div className="space-y-4">
      <SectionHeader title="Active Sessions" onBack={onBack} />

      {loading && (
        <div className="flex items-center justify-center py-10 gap-2 text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-[13px]">Loading sessions…</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-[var(--color-surface)] border border-red-200 rounded-xl p-5 flex flex-col items-center gap-3 text-center">
          <AlertCircle size={22} className="text-red-500" />
          <p className="text-[13px] text-[var(--color-text-muted)]">Could not load sessions. Try again.</p>
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 rounded-xl text-[13px] font-bold bg-[var(--brand-primary)] text-white cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {sessions.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 text-center">
              <p className="text-[13px] text-[var(--color-text-muted)]">No active sessions found.</p>
            </div>
          ) : (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
              {sessions.map((session, idx) => {
                const isCurrent  = session.jti === currentJti
                const label      = parseUA(session.user_agent)
                const age        = relativeTime(session.issued_at)
                const isRevoking = revoking === session.jti

                return (
                  <div
                    key={session.jti}
                    className={`flex items-center gap-3 px-4 py-3.5 ${idx < sessions.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}
                  >
                    <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)]">
                      <DeviceIcon label={label} />
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-[var(--color-text)] truncate">{label}</p>
                        {isCurrent && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                            current
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{age}</p>
                    </div>

                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(session.jti)}
                        disabled={isRevoking}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition-colors"
                      >
                        {isRevoking ? '…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {otherSessions.length > 0 && (
            <button
              type="button"
              onClick={handleRevokeAll}
              disabled={revokeAll}
              className="w-full py-3 rounded-xl text-[14px] font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              {revokeAll ? 'Revoking…' : 'Revoke All Other Devices'}
            </button>
          )}

          {otherSessions.length === 0 && sessions.length > 0 && (
            <p className="text-center text-[12px] text-[var(--color-text-muted)]">No other devices logged in.</p>
          )}

          {revokeError && (
            <p className="text-center text-[12px] text-red-500">{revokeError}</p>
          )}
        </>
      )}
    </div>
  )
}
