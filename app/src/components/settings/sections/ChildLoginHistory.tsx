/**
 * ChildLoginHistory — sub-screen showing a child's last 50 logins.
 *
 * Rendered by ChildProfileSettings when activeView === 'login-history'.
 * Groups entries by day; shows device icon, friendly label, relative time, IP.
 * Pulsing green dot on any entry whose session is still active (is_current).
 */

import { useEffect, useState } from 'react'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import type { LoginEntry } from '../../../lib/api'
import { getChildLoginHistory } from '../../../lib/api'
import { SectionHeader } from '../shared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(epoch: number): string {
  const diff = Math.floor(Date.now() / 1000) - epoch
  if (diff < 60)          return 'Just now'
  if (diff < 3600)        return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400)       return `${Math.floor(diff / 3600)} hr ago`
  if (diff < 86400 * 7)   return `${Math.floor(diff / 86400)} days ago`
  return new Date(epoch * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayLabel(epoch: number): string {
  const d = new Date(epoch * 1000)
  const today     = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString())     return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function groupByDay(logins: LoginEntry[]): { label: string; entries: LoginEntry[] }[] {
  const map = new Map<string, LoginEntry[]>()
  for (const entry of logins) {
    const label = dayLabel(entry.logged_at)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(entry)
  }
  return Array.from(map.entries()).map(([label, entries]) => ({ label, entries }))
}

function DeviceIcon({ type, isCurrent }: { type: LoginEntry['device_type']; isCurrent: boolean }) {
  const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : Monitor
  return (
    <div className="relative shrink-0">
      <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
        <Icon size={15} />
      </span>
      {isCurrent && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse border-2 border-[var(--color-surface)]" />
      )}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="w-8 h-8 rounded-xl bg-[var(--color-border)] animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
          <div className="h-2.5 w-14 rounded bg-[var(--color-border)] animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  childId:   string
  childName: string
  onBack:    () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChildLoginHistory({ childId, childName, onBack }: Props) {
  const [logins,  setLogins]  = useState<LoginEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    getChildLoginHistory(childId)
      .then(r => setLogins(r.logins))
      .catch(() => setError('Could not load login history.'))
      .finally(() => setLoading(false))
  }, [childId])

  const groups = groupByDay(logins)

  return (
    <div className="space-y-4">
      <SectionHeader title={childName} subtitle="Login History" onBack={onBack} />

      {loading && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <Skeleton />
        </div>
      )}

      {!loading && error && (
        <p className="text-center text-[0.875rem] text-red-500 px-4 py-6">{error}</p>
      )}

      {!loading && !error && logins.length === 0 && (
        <p className="text-center text-[0.875rem] text-[var(--color-text-muted)] px-4 py-8">
          No login history yet — logins will appear here once {childName} signs in.
        </p>
      )}

      {!loading && !error && groups.map(group => (
        <div key={group.label}>
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">
            {group.label}
          </p>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            {group.entries.map((entry, idx) => (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${idx < group.entries.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}
              >
                <DeviceIcon type={entry.device_type} isCurrent={entry.is_current} />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate">
                    {entry.device_label}
                  </p>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
                    {entry.ip_address}
                  </p>
                </div>
                <p
                  className="text-[0.75rem] text-[var(--color-text-muted)] shrink-0"
                  title={new Date(entry.logged_at * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'}
                >
                  {relativeTime(entry.logged_at)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
