import { useState, useEffect, useCallback } from 'react'
import type { Completion } from '../../lib/api'
import { getHistory, formatCurrency, rateCompletion } from '../../lib/api'
import { ChoreDetailSheet } from './HistoryTab'

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  completed:       { label: 'Approved',     bg: 'bg-green-100',  text: 'text-green-700'  },
  awaiting_review: { label: 'In review',    bg: 'bg-amber-100',  text: 'text-amber-700'  },
  needs_revision:  { label: 'Needs redo',   bg: 'bg-red-100',    text: 'text-red-700'    },
  rejected:        { label: 'Not approved', bg: 'bg-gray-100',   text: 'text-gray-500'   },
  pending:         { label: 'Pending',      bg: 'bg-amber-100',  text: 'text-amber-700'  },
}

type Variant = 'chore' | 'money'

interface Props {
  familyId: string
  childId:  string
  currency: string
  /**
   * 'chore' — date heading, amount sub-heading, chore name on the right
   * 'money' — date heading, chore name sub-heading, amount on the right
   */
  variant:  Variant
}

function fmtDate(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export function ChildHistoryTab({ familyId, childId, currency, variant }: Props) {
  const [history,     setHistory]     = useState<Completion[]>([])
  const [loading,     setLoading]     = useState(true)
  const [historySort, setHistorySort] = useState<'date-desc' | 'date-asc'>('date-desc')
  const [openMonths,  setOpenMonths]  = useState<Set<string>>(new Set())
  const [detail,      setDetail]      = useState<Completion | null>(null)

  // `silent` skips the full-screen loading swap so background polls/refreshes
  // don't make the summary banner + history flash away and reappear.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await getHistory({ family_id: familyId, child_id: childId, limit: 500, offset: 0 })
      setHistory(r.history)
    } catch { /* silently degrade */ }
    finally { if (!silent) setLoading(false) }
  }, [familyId, childId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  if (loading) return (
    <div className="py-16 text-center text-[0.875rem] text-[var(--color-text-muted)]">Loading…</div>
  )

  if (history.length === 0) return (
    <div className="py-16 text-center">
      <p className="text-4xl mb-3">🌱</p>
      <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">No history yet</p>
      <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1">
        Completed chores will appear here once approved.
      </p>
    </div>
  )

  // Group by YYYY-MM from submitted_at
  const sorted = [...history].sort((a, b) =>
    historySort === 'date-desc'
      ? b.submitted_at - a.submitted_at
      : a.submitted_at - b.submitted_at
  )
  const groupMap = new Map<string, Completion[]>()
  for (const item of sorted) {
    const d = new Date(item.submitted_at * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(item)
  }
  const groups = [...groupMap.entries()].sort((a, b) =>
    historySort === 'date-desc' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])
  )

  const approvedCount = history.filter(h => h.status === 'completed').length
  const totalEarned   = history.filter(h => h.status === 'completed').reduce((s, h) => s + h.reward_amount, 0)

  return (
    <div className="space-y-4">

      {/* Summary banner — money shows total earned, chore shows count completed */}
      {variant === 'money' ? (
        totalEarned > 0 && (
          <div className="rounded-xl bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] px-4 py-3 flex items-center justify-between">
            <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Total earned</p>
            <p className="text-[1.125rem] font-extrabold tabular-nums text-[var(--brand-primary)]">
              {formatCurrency(totalEarned, currency)}
            </p>
          </div>
        )
      ) : (
        approvedCount > 0 && (
          <div className="rounded-xl bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)] px-4 py-3 flex items-center justify-between">
            <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Chores completed</p>
            <p className="text-[1.125rem] font-extrabold tabular-nums text-[var(--brand-primary)]">
              {approvedCount}
            </p>
          </div>
        )
      )}

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
          <p className="text-[0.8125rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
            {variant === 'money' ? 'Earnings history' : 'Chore history'}
            <span className="ml-1.5 text-[0.6875rem] font-semibold normal-case tracking-normal">
              ({history.length})
            </span>
          </p>
          <button
            type="button"
            onClick={() => setHistorySort(s => s === 'date-desc' ? 'date-asc' : 'date-desc')}
            className="tap-target-44 flex items-center gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-[var(--color-surface-alt)]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M3 6h18M7 12h10M11 18h2"/>
            </svg>
            {historySort === 'date-desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>

        {/* Month groups */}
        <div className="divide-y divide-[var(--color-border)]">
          {groups.map(([key, items]) => {
            const [year, month] = key.split('-')
            const monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
              .toLocaleString('default', { month: 'long', year: 'numeric' })
            const monthEarned = items.filter(i => i.status === 'completed').reduce((s, i) => s + i.reward_amount, 0)
            const cur = items[0]?.currency ?? currency
            const isOpen = openMonths.has(key)

            return (
              <div key={key}>
                {/* Month header */}
                <button
                  type="button"
                  onClick={() => setOpenMonths(prev => {
                    const next = new Set(prev)
                    next.has(key) ? next.delete(key) : next.add(key)
                    return next
                  })}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-[color-mix(in_srgb,var(--color-surface-alt)_70%,var(--color-border))] hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_55%,var(--color-border))] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className={`text-[var(--color-text-muted)] transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                    >
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                    <span className="text-[0.75rem] font-bold text-[var(--color-text)]">{monthLabel}</span>
                    <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
                      {items.length} chore{items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {monthEarned > 0 && (
                    <span className="text-[0.75rem] font-bold tabular-nums text-[var(--brand-primary)]">
                      {formatCurrency(monthEarned, cur)}
                    </span>
                  )}
                </button>

                {/* Rows */}
                {isOpen && (
                  <div className="divide-y divide-[var(--color-border)]">
                    {items.map(item => {
                      const s = STATUS_STYLES[item.status] ?? { label: item.status, bg: 'bg-gray-100', text: 'text-gray-600' }
                      const dateStr   = fmtDate(item.submitted_at)
                      const amountStr = formatCurrency(item.reward_amount, item.currency)

                      // Left column: date heading + variant-specific sub-heading
                      const subHeading = variant === 'money'
                        ? item.chore_title
                        : amountStr
                      // Right column value
                      const rightValue = variant === 'money'
                        ? amountStr
                        : item.chore_title

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setDetail(item)}
                          className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">
                              {dateStr}
                            </p>
                            <p className="text-[0.75rem] text-[var(--color-text-muted)] truncate flex items-center gap-1.5 mt-0.5">
                              {variant === 'money'
                                ? <span className="truncate">{subHeading}</span>
                                : <span className="tabular-nums">{subHeading}</span>}
                              {item.proof_url && (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Has photo">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                                </svg>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1 max-w-[45%]">
                            <span className={`text-[0.875rem] font-bold text-right ${variant === 'money' ? 'tabular-nums text-[var(--brand-primary)]' : 'text-[var(--color-text)] truncate'}`}>
                              {rightValue}
                            </span>
                            <span className={`text-[0.625rem] font-bold rounded-full px-2 py-0.5 ${s.bg} ${s.text}`}>
                              {s.label}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {detail && (
        <ChoreDetailSheet
          completion={detail}
          onClose={() => setDetail(null)}
          onRate={(rating) => {
            // Optimistic: reflect the tap immediately in both the open sheet
            // and the underlying list; rateCompletion() fires in the background
            // and this is a low-stakes preference, so no rollback on failure.
            setDetail(d => (d ? { ...d, rating } : d))
            setHistory(prev => prev.map(h => h.id === detail.id ? { ...h, rating } : h))
            rateCompletion(detail.id, rating).catch(() => { /* best-effort */ })
          }}
        />
      )}
    </div>
  )
}
