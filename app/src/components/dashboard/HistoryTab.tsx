import { useState, useEffect, useCallback } from 'react'
import type { Completion, PayoutRecord, ChildRecord } from '../../lib/api'
import {
  getHistory, getPayouts, createPayout, createBonus, formatCurrency,
  getCompletions, approveCompletion, reviseCompletion, approveAll, getProofUrl,
} from '../../lib/api'
import { useGatekeeper } from '../../hooks/useGatekeeper'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { PremiumShell, MentorAvatar, ProBadge, injectPremiumStyles } from '../ui/PremiumShell'

interface Props {
  familyId: string
  child: ChildRecord
  onCountChange: (n: number) => void
  /** Reserved for next iteration — real goal progress data */
  goalProgress?: { goalName: string; choresRemaining: number } | null
}

const LIMIT = 20

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  approved:   { label: 'Approved',   bg: 'bg-green-100',  text: 'text-green-700' },
  pending:    { label: 'Pending',    bg: 'bg-amber-100',  text: 'text-amber-700' },
  rejected:   { label: 'Rejected',  bg: 'bg-red-100',    text: 'text-red-700' },
  suggestion: { label: 'Suggestion', bg: 'bg-blue-100',   text: 'text-blue-700' },
}

export function ActivityTab({ familyId, child, onCountChange, goalProgress }: Props) {
  // ── Pending completions (absorbed from PendingTab) ───────────────────────────
  const { challenge, GatekeeperModal } = useGatekeeper()
  const [completions,         setCompletions]         = useState<Completion[]>([])
  const [pendingLoading,      setPendingLoading]      = useState(true)
  const [reviseId,            setReviseId]            = useState<string | null>(null)
  const [reviseNote,          setReviseNote]          = useState('')
  const [approveBusy,         setApproveBusy]         = useState<string | null>(null)
  const [approveAllBusy,      setApproveAllBusy]      = useState(false)
  const [showApproveAllModal, setShowApproveAllModal] = useState(false)

  const [history, setHistory]   = useState<Completion[]>([])
  const [payouts, setPayouts]   = useState<PayoutRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [offset, setOffset]     = useState(0)
  const [hasMore, setHasMore]   = useState(false)

  // Pay out modal
  const [showPayout, setShowPayout]   = useState(false)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutNote, setPayoutNote]   = useState('')
  const [payoutBusy, setPayoutBusy]   = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)

  // Bonus modal
  const [showBonus, setShowBonus]   = useState(false)
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusReason, setBonusReason] = useState('')
  const [bonusBusy, setBonusBusy]   = useState(false)
  const [bonusError, setBonusError] = useState<string | null>(null)

  useAndroidBack(showApproveAllModal, () => setShowApproveAllModal(false))
  useAndroidBack(!!reviseId, () => { setReviseId(null); setReviseNote('') })
  useAndroidBack(showPayout, () => { setShowPayout(false); setPayoutError(null) })
  useAndroidBack(showBonus, () => { setShowBonus(false); setBonusError(null) })

  useEffect(() => { injectPremiumStyles() }, [])

  const loadPending = useCallback(async () => {
    setPendingLoading(true)
    const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'awaiting_review' })
    setCompletions(r.completions)
    onCountChange(r.completions.length)
    setPendingLoading(false)
  }, [familyId, child.id, onCountChange])

  useEffect(() => { loadPending() }, [loadPending])

  async function handleApprove(id: string) {
    setApproveBusy(id)
    try { await approveCompletion(id); await loadPending() }
    finally { setApproveBusy(null) }
  }

  async function handleRevise(id: string) {
    if (!reviseNote.trim()) return
    setApproveBusy(id)
    try {
      await reviseCompletion(id, reviseNote.trim())
      setReviseId(null)
      setReviseNote('')
      await loadPending()
    } finally { setApproveBusy(null) }
  }

  async function handleConfirmApproveAll() {
    setShowApproveAllModal(false)
    setApproveAllBusy(true)
    try { await approveAll(familyId, child.id); await loadPending() }
    finally { setApproveAllBusy(false) }
  }

  const approveAllTotal    = completions.reduce((s, c) => s + c.reward_amount, 0)
  const approveAllCurrency = completions[0]?.currency ?? 'GBP'

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    const newOffset = reset ? 0 : offset
    const [h, p] = await Promise.all([
      getHistory({ family_id: familyId, child_id: child.id, limit: LIMIT, offset: newOffset }),
      getPayouts(familyId, child.id),
    ])
    setHistory(reset ? h.history : prev => [...prev, ...h.history])
    setPayouts(p.payouts)
    setHasMore(h.history.length === LIMIT)
    if (reset) setOffset(0)
    setLoading(false)
  }, [familyId, child.id, offset])

  useEffect(() => { load(true) }, [familyId, child.id])

  async function handlePayout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!payoutAmount) return
    setPayoutBusy(true)
    setPayoutError(null)
    try {
      await createPayout({
        family_id: familyId, child_id: child.id,
        amount: Math.round(parseFloat(payoutAmount) * 100),
        currency: 'GBP', // TODO: thread actual family currency once currency is wired to history API
        note: payoutNote || undefined,
      })
      setShowPayout(false)
      setPayoutAmount('')
      setPayoutNote('')
      await load(true)
    } catch (err: unknown) {
      setPayoutError((err as Error).message)
    } finally {
      setPayoutBusy(false)
    }
  }

  async function handleBonus(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!bonusAmount || !bonusReason.trim()) return
    setBonusBusy(true)
    setBonusError(null)
    try {
      await createBonus({
        family_id: familyId, child_id: child.id,
        amount: Math.round(parseFloat(bonusAmount) * 100),
        currency: 'GBP', // TODO: thread actual family currency once currency is wired to history API
        reason: bonusReason.trim(),
      })
      setShowBonus(false)
      setBonusAmount('')
      setBonusReason('')
      await load(true)
    } catch (err: unknown) {
      setBonusError((err as Error).message)
    } finally {
      setBonusBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <GatekeeperModal />

      {/* ── Sticky action row ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[var(--color-bg)] pt-1 pb-2 -mx-3.5 px-3.5 flex gap-2 border-b border-[var(--color-border)]">
        <button
          onClick={() => setShowPayout(true)}
          className="flex-1 bg-[var(--brand-primary)] text-white font-bold py-3 rounded-xl text-[14px] hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer shadow-sm"
        >
          Pay out
        </button>
        <button
          onClick={() => setShowBonus(true)}
          className="flex-1 border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] font-bold py-3 rounded-xl text-[14px] bg-white hover:bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)] active:scale-[0.98] transition-all cursor-pointer"
        >
          + Bonus
        </button>
      </div>

      {/* ── Pending approvals section (conditional) ──────────────────────────── */}
      {!pendingLoading && completions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider">
              Pending Approvals
            </p>
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5 leading-none">
              {completions.length}
            </span>
          </div>

          {/* Approve-all bulk action — only when >1 pending */}
          {completions.length > 1 && (
            <button
              onClick={() => setShowApproveAllModal(true)}
              disabled={approveAllBusy}
              className="w-full bg-[var(--brand-primary)] text-white font-bold py-3.5 rounded-2xl text-[15px] hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.98] transition-all"
            >
              {approveAllBusy ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                  Approving…
                </span>
              ) : `Approve all ${completions.length} submissions`}
            </button>
          )}

          {completions.map(c => (
            <AuditCard
              key={c.id}
              completion={c}
              isRevising={reviseId === c.id}
              reviseNote={reviseNote}
              busy={approveBusy === c.id}
              anyBusy={!!approveBusy || approveAllBusy}
              onApprove={() => challenge(() => handleApprove(c.id))}
              onStartRevise={() => { setReviseId(c.id); setReviseNote('') }}
              onCancelRevise={() => { setReviseId(null); setReviseNote('') }}
              onReviseNoteChange={setReviseNote}
              onConfirmRevise={() => handleRevise(c.id)}
            />
          ))}
        </section>
      )}

      {/* ── Approve-all confirmation modal ───────────────────────────────────── */}
      {showApproveAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowApproveAllModal(false)} />
          <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div>
              <p className="text-[18px] font-extrabold text-[var(--color-text)] tracking-tight">Confirm payment</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                You are about to pay out <strong className="text-[var(--color-text)]">{completions.length} chore{completions.length !== 1 ? 's' : ''}</strong> totalling{' '}
                <strong className="text-[var(--brand-primary)]">{formatCurrency(approveAllTotal, approveAllCurrency)}</strong>.
                Have you verified that these chores meet the agreed standard?
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
              {completions.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[13px] text-[var(--color-text)] truncate mr-3">{c.chore_title}</span>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--brand-primary)] shrink-0">
                    {formatCurrency(c.reward_amount, c.currency)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowApproveAllModal(false)}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-3 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => challenge(handleConfirmApproveAll)}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-3 text-[14px] font-bold hover:opacity-90 cursor-pointer active:scale-[0.98] transition-all shadow-sm"
              >
                Confirm &amp; pay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Mentor empty-state card (shown only when no pending approvals) ── */}
      {!pendingLoading && completions.length === 0 && (
        <MentorEmptyCard childName={child.display_name} goalProgress={goalProgress ?? null} />
      )}

      {/* ── Pay out bottom sheet ──────────────────────────────────────────────── */}
      {showPayout && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowPayout(false); setPayoutError(null) } }}
        >
          <form
            onSubmit={handlePayout}
            className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl p-5 space-y-3 pb-safe"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[15px] font-bold text-[var(--color-text)]">Pay out to {child.display_name}</p>
              <button type="button" onClick={() => { setShowPayout(false); setPayoutError(null) }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {payoutError && <p className="text-[13px] text-red-600">{payoutError}</p>}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">£</span>
              <input
                type="number" min="0.01" step="0.01" required autoFocus
                className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="0.00"
                value={payoutAmount}
                onChange={e => setPayoutAmount(e.target.value)}
              />
            </div>
            <input
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              placeholder="Note (optional)"
              value={payoutNote}
              onChange={e => setPayoutNote(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowPayout(false); setPayoutError(null) }}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={payoutBusy}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[14px] font-extrabold hover:opacity-90 disabled:opacity-50 cursor-pointer ring-2 ring-[var(--brand-primary)] ring-offset-1">
                {payoutBusy ? 'Saving…' : '✓ Confirm payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Bonus bottom sheet ───────────────────────────────────────────────── */}
      {showBonus && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowBonus(false); setBonusError(null) } }}
        >
          <form
            onSubmit={handleBonus}
            className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl p-5 space-y-3 pb-safe"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[15px] font-bold text-[var(--color-text)]">Add bonus for {child.display_name}</p>
              <button type="button" onClick={() => { setShowBonus(false); setBonusError(null) }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {bonusError && <p className="text-[13px] text-red-600">{bonusError}</p>}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">£</span>
              <input
                type="number" min="0.01" step="0.01" required autoFocus
                className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="0.00"
                value={bonusAmount}
                onChange={e => setBonusAmount(e.target.value)}
              />
            </div>
            <input
              required
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              placeholder="Reason (required)"
              value={bonusReason}
              onChange={e => setBonusReason(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowBonus(false); setBonusError(null) }}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={bonusBusy}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                {bonusBusy ? 'Saving…' : 'Add bonus'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Recent payouts ───────────────────────────────────────────────────── */}
      {payouts.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          <p className="px-4 py-2.5 text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Recent payouts</p>
          {payouts.slice(0, 3).map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-text)]">{formatCurrency(p.amount, p.currency)}</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  {new Date(p.paid_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {p.note && ` · ${p.note}`}
                </p>
              </div>
              <span className="text-[12px] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] rounded-full px-2 py-1">Paid</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Chore history ────────────────────────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
        <p className="px-4 py-2.5 text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Chore history</p>
        {loading && history.length === 0 ? (
          <div className="px-4 py-6 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>
        ) : history.length === 0 ? (
          <div className="px-4 py-6 text-center text-[14px] text-[var(--color-text-muted)]">No history yet.</div>
        ) : (
          <>
            {history.map(item => {
              const s = STATUS_STYLES[item.status] ?? { label: item.status, bg: 'bg-gray-100', text: 'text-gray-600' }
              const itemDate = new Date(item.submitted_at * 1000)
              return (
                <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-[var(--color-text)] truncate">{item.chore_title}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)]">
                      {formatCurrency(item.reward_amount, item.currency)} ·{' '}
                      {itemDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {item.rejection_note && <span className="ml-1 italic text-red-500">"{item.rejection_note}"</span>}
                    </p>
                    <WeeklyRhythmDots history={history} choreTitle={item.chore_title} />
                  </div>
                  <span className={`shrink-0 text-[11px] font-bold rounded-full px-2 py-1 ${s.bg} ${s.text}`}>
                    {s.label}
                  </span>
                </div>
              )
            })}
            {hasMore && (
              <button
                onClick={() => { setOffset(o => o + LIMIT); load() }}
                className="w-full py-3 text-[13px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Weekly Rhythm Dots ────────────────────────────────────────────────────────

function getWeekBounds(): { weekStart: Date; weekEnd: Date } {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const weekStart = new Date(now)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(now.getDate() + diffToMon)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)
  return { weekStart, weekEnd }
}

function WeeklyRhythmDots({
  history,
  choreTitle,
}: {
  history: Completion[]
  choreTitle: string
}) {
  const { weekStart, weekEnd } = getWeekBounds()
  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

  const activeDayIndices = new Set<number>()
  history
    .filter(h => h.chore_title === choreTitle)
    .forEach(h => {
      const d = new Date(h.submitted_at * 1000)
      if (d >= weekStart && d <= weekEnd) {
        const iso = (d.getDay() + 6) % 7
        activeDayIndices.add(iso)
      }
    })

  if (activeDayIndices.size === 0) return null

  return (
    <div className="flex items-center gap-[3px] mt-1.5">
      {DAY_LABELS.map((label, i) => (
        <div
          key={i}
          title={['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}
          className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold transition-colors
            ${activeDayIndices.has(i)
              ? 'bg-[var(--brand-primary)] text-white'
              : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]/50'
            }`}
        >
          {label}
        </div>
      ))}
    </div>
  )
}

// ── AI Mentor empty-state card ────────────────────────────────────────────────

interface GoalProgress {
  goalName: string
  choresRemaining: number
}

function MentorEmptyCard({
  childName,
  goalProgress,
}: {
  childName: string
  goalProgress: GoalProgress | null
}) {
  const mentorLine = goalProgress
    ? `It looks like ${childName} is ${goalProgress.choresRemaining} chore${goalProgress.choresRemaining !== 1 ? 's' : ''} away from their '${goalProgress.goalName}' goal.`
    : `Keep an eye on ${childName}'s progress — their next goal milestone is coming up soon.`

  return (
    <PremiumShell>
      <div className="relative z-10 px-4 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <MentorAvatar />
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#6b9e87' }}>
                  Orchard Mentor
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              </div>
              <p className="text-[15px] font-extrabold tracking-tight" style={{ color: '#f0fdf4' }}>
                The kids are all caught up! 🎉
              </p>
            </div>
          </div>
          <ProBadge />
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: '#a7c4b5' }}>
          {mentorLine}
        </p>
      </div>
    </PremiumShell>
  )
}

// ── AuditCard ──────────────────────────────────────────────────────────────────

interface AuditCardProps {
  completion: Completion
  isRevising: boolean
  reviseNote: string
  busy: boolean
  anyBusy: boolean
  onApprove: () => void
  onStartRevise: () => void
  onCancelRevise: () => void
  onReviseNoteChange: (v: string) => void
  onConfirmRevise: () => void
}

function AuditCard({
  completion: c, isRevising, reviseNote, busy, anyBusy,
  onApprove, onStartRevise, onCancelRevise, onReviseNoteChange, onConfirmRevise,
}: AuditCardProps) {
  const [proofUrl, setProofUrl]     = useState<string | null>(null)
  const [loadingProof, setLoadingProof] = useState(false)
  const [proofError, setProofError] = useState(false)

  const isResubmission = (c.attempt_count ?? 1) > 1
  const hasProof = !!c.proof_url

  // Load presigned URL when card has proof
  useEffect(() => {
    if (!hasProof) return
    setLoadingProof(true)
    getProofUrl(c.id)
      .then(r => setProofUrl(r.url))
      .catch(() => setProofError(true))
      .finally(() => setLoadingProof(false))
  }, [c.id, hasProof])

  const submittedAt = new Date(c.submitted_at * 1000).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl overflow-hidden">

      {/* Proof image / archived evidence guard */}
      {c.pruned_at != null && c.proof_exif == null ? (
        <p className="px-4 pt-3 pb-1 text-[12px] text-[var(--color-text-muted)] italic">
          Details archived (2+ years old)
        </p>
      ) : hasProof && (
        <div className="relative h-44 bg-[var(--color-surface-alt)] overflow-hidden">
          {loadingProof && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {proofError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[12px] text-[var(--color-text-muted)]">Evidence expired or unavailable</p>
            </div>
          )}
          {proofUrl && !proofError && (
            <img
              src={proofUrl}
              alt="Proof of work"
              className="w-full h-full object-cover"
            />
          )}
          {/* Gradient overlay for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-2.5 left-3">
            <span className="text-[11px] font-semibold text-white/90 bg-black/40 rounded-full px-2 py-0.5">
              📷 Evidence photo
            </span>
          </div>
        </div>
      )}

      {/* Card body */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[15px] font-bold text-[var(--color-text)] leading-tight">{c.chore_title}</p>
              {isResubmission && (
                <span className="shrink-0 text-[10px] font-extrabold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-400 rounded-full px-2 py-0.5 uppercase tracking-wide">
                  Re-submission #{c.attempt_count}
                </span>
              )}
            </div>
            <p className="text-[13px] font-semibold text-[var(--brand-primary)] mt-0.5">
              {formatCurrency(c.reward_amount, c.currency)}
            </p>
            {c.note && (
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1 italic">
                "{c.note}"
              </p>
            )}
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">{submittedAt}</p>
          </div>
        </div>
      </div>

      {/* Revise drawer */}
      {isRevising ? (
        <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
            Feedback for {c.child_name}
          </p>
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
            placeholder="What needs to be improved? Be specific so they know exactly what to fix."
            rows={3}
            value={reviseNote}
            onChange={e => onReviseNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onCancelRevise}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmRevise}
              disabled={busy || !reviseNote.trim()}
              className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-[14px] font-bold hover:bg-amber-600 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {busy ? 'Sending…' : 'Send feedback →'}
            </button>
          </div>
        </div>
      ) : (
        /* Action bar */
        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={onStartRevise}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[14px] font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40 cursor-pointer transition-colors"
          >
            Revise
          </button>
          <div className="w-px bg-[var(--color-border)]" />
          <button
            onClick={onApprove}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[14px] font-bold text-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] disabled:opacity-40 cursor-pointer transition-colors"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
                Approving…
              </span>
            ) : 'Approve ✓'}
          </button>
        </div>
      )}
    </div>
  )
}
