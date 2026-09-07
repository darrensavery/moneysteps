import { useState, useEffect, useCallback, useRef } from 'react'
import { blurOnWheel, blockInvalidAmountKeys } from '../../lib/utils'
import { createPortal } from 'react-dom'
import type { Completion, PayoutRecord, ChildRecord, UnpaidSummaryRow } from '../../lib/api'
import {
  getHistory, getPayouts, createPayout, createBonus, formatCurrency,
  getCompletions, approveCompletion, reviseCompletion, rejectCompletion, approveAll, getProofUrl, getChores,
  markPaidBatch,
} from '../../lib/api'
import { useGatekeeper } from '../../hooks/useGatekeeper'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useDragToClose } from '../../hooks/useDragToClose'
import { PremiumShell, MentorAvatar, ProBadge, injectPremiumStyles, MENTOR_COLORS } from '../ui/PremiumShell'
import { getDetails, type StoredBankDetails } from '../../lib/localBankDetails'
import { useLocale, currencySymbol } from '../../lib/locale'
import { ErrorBox } from '../ui/ErrorBox'
import { StickyActionBar } from '../ui/StickyActionBar'

interface Props {
  familyId: string
  child: ChildRecord
  childCount: number
  onCountChange: (n: number) => void
  unpaidRow?: UnpaidSummaryRow | null
  onOpenBridge?: () => void
  onAfterPayout?: () => void
  /** Reserved for next iteration — real goal progress data */
  goalProgress?: { goalName: string; choresRemaining: number } | null
  /** Names of other children who have submissions waiting — drives the cross-child notice */
  siblingsWithPending?: string[]
}

const LIMIT = 500

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  completed:       { label: 'Approved',   bg: 'bg-green-100',  text: 'text-green-700' },
  awaiting_review: { label: 'Pending',    bg: 'bg-amber-100',  text: 'text-amber-700' },
  needs_revision:  { label: 'Needs redo', bg: 'bg-amber-100',  text: 'text-amber-700' },
  rejected:        { label: 'Rejected',   bg: 'bg-red-100',    text: 'text-red-700' },
}

function MiniSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const { sheetRef, handleProps } = useDragToClose(onClose)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Details"
        tabIndex={-1}
        className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl transition-transform duration-300 pb-safe"
      >
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>
        {children}
      </div>
    </div>
  )
}

export function ActivityTab({ familyId, child, childCount, onCountChange, unpaidRow, onOpenBridge, onAfterPayout, goalProgress, siblingsWithPending = [] }: Props) {
  // ── Pending completions (absorbed from PendingTab) ───────────────────────────
  const { locale } = useLocale()
  const familyCurrency = locale === 'en-US' ? 'USD' : locale === 'pl' ? 'PLN' : 'GBP'
  const { challenge, GatekeeperModal } = useGatekeeper()
  const onCountChangeRef = useRef(onCountChange)
  useEffect(() => { onCountChangeRef.current = onCountChange }, [onCountChange])
  const [completions,         setCompletions]         = useState<Completion[]>([])
  const [pendingLoading,      setPendingLoading]      = useState(true)
  const [reviseId,            setReviseId]            = useState<string | null>(null)
  const [reviseNote,          setReviseNote]          = useState('')
  const [rejectId,            setRejectId]            = useState<string | null>(null)
  const [rejectNote,          setRejectNote]          = useState('')
  const [approveBusy,         setApproveBusy]         = useState<string | null>(null)
  const [approveAllBusy,      setApproveAllBusy]      = useState(false)
  const [showApproveAllModal, setShowApproveAllModal] = useState(false)
  useEffect(() => {
    if (!showApproveAllModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowApproveAllModal(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showApproveAllModal])

  const [history, setHistory]   = useState<Completion[]>([])
  const [payouts, setPayouts]   = useState<PayoutRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [historySort, setHistorySort] = useState<'date-desc' | 'date-asc'>('date-desc')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [openMonths, setOpenMonths]   = useState<Set<string>>(new Set())

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
  const [overdueCount, setOverdueCount] = useState(0)
  const [detailCompletion, setDetailCompletion] = useState<Completion | null>(null)
  const [bankDetails, setBankDetails] = useState<StoredBankDetails | null>(null)

  useEffect(() => {
    let cancelled = false
    getDetails(familyId, child.id).then(d => { if (!cancelled) setBankDetails(d) })
    return () => { cancelled = true }
  }, [familyId, child.id])

  useAndroidBack(showApproveAllModal, () => setShowApproveAllModal(false))
  useAndroidBack(!!reviseId, () => { setReviseId(null); setReviseNote('') })
  useAndroidBack(!!rejectId, () => { setRejectId(null); setRejectNote('') })
  useAndroidBack(showPayout, () => { setShowPayout(false); setPayoutError(null) })
  useAndroidBack(showBonus, () => { setShowBonus(false); setBonusError(null) })

  useEffect(() => { injectPremiumStyles() }, [])

  const loadPending = useCallback(async (silent = false) => {
    if (!silent) setPendingLoading(true)
    const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'awaiting_review' })
    setCompletions(r.completions)
    onCountChangeRef.current(r.completions.length)
    setPendingLoading(false)
    if (r.completions.length === 0) {
      try {
        const today = new Date().toISOString().slice(0, 10)
        const { chores } = await getChores({ family_id: familyId, assigned_to: child.id })
        const overdue = chores.filter(c => c.due_date && c.due_date < today && !c.archived)
        setOverdueCount(overdue.length)
      } catch { /* non-fatal */ }
    } else {
      setOverdueCount(0)
    }
  }, [familyId, child.id])

  useEffect(() => { loadPending() }, [loadPending])

  useEffect(() => {
    const t = setInterval(() => loadPending(true), 30_000)
    const onVisible = () => { if (!document.hidden) loadPending(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadPending])

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

  async function handleReject(id: string) {
    setApproveBusy(id)
    try {
      await rejectCompletion(id, rejectNote.trim() || undefined)
      setRejectId(null)
      setRejectNote('')
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

  const load = useCallback(async () => {
    if (!familyId) return
    setLoading(true)
    try {
      const [h, p] = await Promise.all([
        getHistory({ family_id: familyId, child_id: child.id, limit: LIMIT, offset: 0 }),
        getPayouts(familyId, child.id),
      ])
      setHistory(h.history)
      setPayouts(p.payouts)
    } finally {
      setLoading(false)
    }
  }, [familyId, child.id])

  useEffect(() => { load() }, [familyId, child.id])

  async function handlePayout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!payoutAmount) return
    setPayoutBusy(true)
    setPayoutError(null)
    try {
      await createPayout({
        family_id: familyId, child_id: child.id,
        amount: Math.round(parseFloat(payoutAmount) * 100),
        currency: unpaidRow?.currency ?? familyCurrency,
        note: payoutNote || undefined,
      })
      // Stamp paid_out_at on all unpaid completions so the banner clears
      const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'completed' })
      const unpaidIds = r.completions
        .filter(c => c.id && c.paid_out_at == null)
        .map(c => c.id)
      if (unpaidIds.length > 0) await markPaidBatch(familyId, unpaidIds)
      setShowPayout(false)
      setPayoutAmount('')
      setPayoutNote('')
      onAfterPayout?.()
      await load()
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
        currency: familyCurrency,
        reason: bonusReason.trim(),
      })
      setShowBonus(false)
      setBonusAmount('')
      setBonusReason('')
      await load()
    } catch (err: unknown) {
      setBonusError((err as Error).message)
    } finally {
      setBonusBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-48">
      <GatekeeperModal />

      {/* ── Pay out + Bonus — fixed above bottom nav dock ─────────────────── */}
      <StickyActionBar className="flex gap-2">
        <button
          onClick={() => setShowPayout(true)}
          className="flex-1 h-11 flex items-center justify-center bg-[var(--brand-primary)] text-white font-bold rounded-xl text-[0.875rem] hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer shadow-lg"
        >
          Pay out
        </button>
        <button
          onClick={() => setShowBonus(true)}
          className="flex-1 h-11 flex items-center justify-center border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] font-bold rounded-xl text-[0.875rem] bg-[var(--color-surface)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)] active:scale-[0.98] transition-all cursor-pointer shadow-lg"
        >
          + Bonus
        </button>
      </StickyActionBar>

      {/* ── Cross-child pending notice ────────────────────────────────────────── */}
      {siblingsWithPending.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-3.5 py-2.5 flex items-center gap-2.5">
          <span className="text-amber-500 text-base shrink-0">⏳</span>
          <p className="text-[0.75rem] text-amber-800 dark:text-amber-300 leading-snug">
            <strong>{siblingsWithPending.join(' & ')}</strong> also {siblingsWithPending.length === 1 ? 'has' : 'have'} submissions waiting — switch child to review.
          </p>
        </div>
      )}

      {/* ── Pending approvals section (conditional) ──────────────────────────── */}
      {!pendingLoading && completions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[0.75rem] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider">
              Pending Approvals
            </p>
            <span className="bg-red-500 text-white text-[0.625rem] font-bold rounded-full px-2 py-0.5 leading-none">
              {completions.length}
            </span>
          </div>

          {/* Approve-all bulk action — only when >1 pending */}
          {completions.length > 1 && (
            <button
              onClick={() => setShowApproveAllModal(true)}
              disabled={approveAllBusy}
              className="w-full bg-[var(--brand-primary)] text-white font-bold py-3.5 rounded-2xl text-[0.9375rem] hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.98] transition-all"
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
              isRejecting={rejectId === c.id}
              rejectNote={rejectNote}
              busy={approveBusy === c.id}
              anyBusy={!!approveBusy || approveAllBusy}
              onApprove={() => challenge(() => handleApprove(c.id))}
              onStartRevise={() => { setRejectId(null); setReviseId(c.id); setReviseNote('') }}
              onCancelRevise={() => { setReviseId(null); setReviseNote('') }}
              onReviseNoteChange={setReviseNote}
              onConfirmRevise={() => handleRevise(c.id)}
              onStartReject={() => { setReviseId(null); setRejectId(c.id); setRejectNote('') }}
              onCancelReject={() => { setRejectId(null); setRejectNote('') }}
              onRejectNoteChange={setRejectNote}
              onConfirmReject={() => handleReject(c.id)}
            />
          ))}
        </section>
      )}

      {/* ── Approve-all confirmation modal ───────────────────────────────────── */}
      {showApproveAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowApproveAllModal(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm payment"
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
          >
            <div>
              <p className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight">Confirm payment</p>
              <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                You are about to pay out <strong className="text-[var(--color-text)]">{completions.length} chore{completions.length !== 1 ? 's' : ''}</strong> totalling{' '}
                <strong className="text-[var(--brand-primary)]">{formatCurrency(approveAllTotal, approveAllCurrency)}</strong>.
                Have you verified that these chores meet the agreed standard?
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
              {completions.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[0.8125rem] text-[var(--color-text)] truncate mr-3">{c.chore_title}</span>
                  <span className="text-[0.8125rem] font-semibold tabular-nums text-[var(--brand-primary)] shrink-0">
                    {formatCurrency(c.reward_amount, c.currency)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowApproveAllModal(false)}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-3 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => challenge(handleConfirmApproveAll)}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-3 text-[0.875rem] font-bold hover:opacity-90 cursor-pointer active:scale-[0.98] transition-all shadow-sm"
              >
                Confirm &amp; pay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unpaid earnings summary ───────────────────────────────────────────── */}
      {unpaidRow && unpaidRow.unpaid_total > 0 && (() => {
        const hasPaymentDetails =
          !!child.monzo_handle || !!child.revolut_handle ||
          !!child.paypal_handle || !!child.venmo_handle ||
          !!(bankDetails?.sortCode && bankDetails?.accountNumber) ||
          !!bankDetails?.zelleHandle
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[0.8125rem] font-semibold text-amber-900">
              {formatCurrency(unpaidRow.unpaid_total, unpaidRow.currency)} approved but not yet transferred
            </p>
            {hasPaymentDetails && onOpenBridge ? (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenBridge}
                  className="rounded-lg bg-amber-800 px-3 py-1.5 text-[0.75rem] font-semibold text-white"
                >
                  Pay now
                </button>
                <span className="text-[0.6875rem] text-amber-700">or use Pay out above to log cash</span>
              </div>
            ) : (
              <p className="text-[0.75rem] text-amber-700 mt-0.5">
                Use the Pay out button above to transfer earnings
              </p>
            )}
          </div>
        )
      })()}

      {/* ── AI Mentor empty-state card (shown only when no pending approvals) ── */}
      {!pendingLoading && completions.length === 0 && (
        <MentorEmptyCard childName={child.display_name} childCount={childCount} goalProgress={goalProgress ?? null} overdueCount={overdueCount} />
      )}

      {/* ── Pay out bottom sheet ──────────────────────────────────────────────── */}
      {showPayout && (
        <MiniSheet onClose={() => { setShowPayout(false); setPayoutError(null) }}>
          <form onSubmit={handlePayout} className="px-5 pb-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">Pay out to {child.display_name}</p>
              <button type="button" onClick={() => { setShowPayout(false); setPayoutError(null) }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <ErrorBox message={payoutError} />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[var(--color-text-muted)]">{currencySymbol(unpaidRow?.currency ?? familyCurrency)}</span>
              <input
                type="number" min="0.01" step="0.01" required autoFocus
                className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2.5 text-[0.875rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="0.00"
                value={payoutAmount}
                onChange={e => setPayoutAmount(e.target.value)}
                onWheel={blurOnWheel}
                onKeyDown={blockInvalidAmountKeys}
              />
            </div>
            <input
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[0.875rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              placeholder="Note (optional)"
              value={payoutNote}
              onChange={e => setPayoutNote(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowPayout(false); setPayoutError(null) }}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={payoutBusy}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[0.875rem] font-extrabold hover:opacity-90 disabled:opacity-50 cursor-pointer ring-2 ring-[var(--brand-primary)] ring-offset-1">
                {payoutBusy ? 'Saving…' : '✓ Confirm payment'}
              </button>
            </div>
          </form>
        </MiniSheet>
      )}

      {/* ── Bonus bottom sheet ───────────────────────────────────────────────── */}
      {showBonus && (
        <MiniSheet onClose={() => { setShowBonus(false); setBonusError(null) }}>
          <form onSubmit={handleBonus} className="px-5 pb-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">Add bonus for {child.display_name}</p>
              <button type="button" onClick={() => { setShowBonus(false); setBonusError(null) }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <ErrorBox message={bonusError} />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[var(--color-text-muted)]">{currencySymbol(familyCurrency)}</span>
              <input
                type="number" min="0.01" step="0.01" required autoFocus
                className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2.5 text-[0.875rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                placeholder="0.00"
                value={bonusAmount}
                onChange={e => setBonusAmount(e.target.value)}
                onWheel={blurOnWheel}
                onKeyDown={blockInvalidAmountKeys}
              />
            </div>
            <input
              required
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[0.875rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              placeholder="Reason (required)"
              value={bonusReason}
              onChange={e => setBonusReason(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowBonus(false); setBonusError(null) }}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={bonusBusy}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[0.875rem] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                {bonusBusy ? 'Saving…' : 'Add bonus'}
              </button>
            </div>
          </form>
        </MiniSheet>
      )}

      {/* ── Recent payouts ───────────────────────────────────────────────────── */}
      {payouts.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          <p className="px-4 py-2.5 text-[0.8125rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Recent payouts</p>
          {payouts.slice(0, 3).map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{formatCurrency(p.amount, p.currency)}</p>
                <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                  {new Date(p.paid_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {p.note && ` · ${p.note}`}
                </p>
              </div>
              <span className="text-[0.75rem] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] rounded-full px-2 py-1">Paid</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Chore detail sheet ───────────────────────────────────────────────── */}
      {detailCompletion && (
        <ChoreDetailSheet
          completion={detailCompletion}
          onClose={() => setDetailCompletion(null)}
        />
      )}

      {/* ── Chore history archive ─────────────────────────────────────────────── */}
      {(() => {
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

        return (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
            {/* Archive header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setHistoryOpen(o => !o)}
                className="flex items-center gap-2 text-[0.8125rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide cursor-pointer"
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform duration-200 ${historyOpen ? 'rotate-90' : ''}`}
                >
                  <path d="M9 18l6-6-6-6"/>
                </svg>
                Chore history
                {history.length > 0 && (
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] normal-case tracking-normal">
                    ({history.length})
                  </span>
                )}
              </button>
              {history.length > 0 && (
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
              )}
            </div>

            {!historyOpen ? null : loading && history.length === 0 ? (
              <div className="px-4 py-6 text-center text-[0.875rem] text-[var(--color-text-muted)]">Loading…</div>
            ) : history.length === 0 ? (
              <div className="px-4 py-6 text-center text-[0.875rem] text-[var(--color-text-muted)]">No history yet.</div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {groups.map(([key, items]) => {
                  const [year, month] = key.split('-')
                  const monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
                    .toLocaleString('default', { month: 'long', year: 'numeric' })
                  const monthTotal = items.filter(i => i.status === 'completed').reduce((s, i) => s + i.reward_amount, 0)
                  const currency = items[0]?.currency ?? 'GBP'
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
                        {monthTotal > 0 && (
                          <span className="text-[0.75rem] font-bold tabular-nums text-[var(--brand-primary)]">
                            {formatCurrency(monthTotal, currency)}
                          </span>
                        )}
                      </button>

                      {/* Month rows */}
                      {isOpen && (
                        <div className="divide-y divide-[var(--color-border)]">
                          {items.map(item => {
                            const s = STATUS_STYLES[item.status] ?? { label: item.status, bg: 'bg-gray-100', text: 'text-gray-600' }
                            const itemDate = new Date(item.submitted_at * 1000)
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setDetailCompletion(item)}
                                className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer opacity-90 hover:opacity-100"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate flex items-center gap-1.5">
                                    {item.chore_title}
                                    {item.proof_url && (
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Has photo">
                                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                                      </svg>
                                    )}
                                  </p>
                                  <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                                    {formatCurrency(item.reward_amount, item.currency)} ·{' '}
                                    {itemDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </p>
                                </div>
                                <span className={`shrink-0 text-[0.6875rem] font-bold rounded-full px-2 py-1 ${s.bg} ${s.text}`}>
                                  {s.label}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ── Chore Detail Sheet ────────────────────────────────────────────────────────

export function ChoreDetailSheet({ completion: c, onClose, onRate }: {
  completion: Completion
  onClose: () => void
  /** Child-only: rate how the completed chore felt (thumbs up/down). Omit for the parent's view. */
  onRate?: (rating: 1 | -1) => void
}) {
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [proofState, setProofState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const { sheetRef, handleProps } = useDragToClose(onClose)

  useEffect(() => {
    if (!c.proof_url) return
    setProofState('loading')
    getProofUrl(c.id)
      .then(r => { setProofUrl(r.url); setProofState('loaded') })
      .catch(() => setProofState('error'))
  }, [c.id, c.proof_url])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const dateStr = new Date(c.submitted_at * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const timeStr = new Date(c.submitted_at * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  })

  const statusLabel: Record<string, string> = {
    completed: 'Approved', awaiting_review: 'Pending', needs_revision: 'Needs revision', pending: 'Pending',
  }
  const s = STATUS_STYLES[c.status] ?? { label: c.status, bg: 'bg-gray-100', text: 'text-gray-600' }

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={c.chore_title}
        tabIndex={-1}
        className="relative mt-auto w-full max-h-[90dvh] bg-[var(--color-surface)] rounded-t-2xl flex flex-col overflow-hidden shadow-2xl transition-transform duration-300"
      >

        {/* Drag handle */}
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-[var(--color-border)] shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">Chore</p>
            <h2 className="text-[1rem] font-bold text-[var(--color-text)] leading-snug truncate pr-2">{c.chore_title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-target-44 shrink-0 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-border)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Amount hero */}
          <div className="rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-4 flex items-center justify-between">
            <p className="text-2xl font-bold tabular-nums text-[var(--brand-primary)]">
              {formatCurrency(c.reward_amount, c.currency)}
            </p>
            <span className={`text-[0.6875rem] font-bold rounded-full px-2.5 py-1 ${s.bg} ${s.text}`}>
              {statusLabel[c.status] ?? c.status}
            </span>
          </div>

          {/* Detail rows */}
          <div className="rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            <ChoreDetailRow label="Submitted" value={`${dateStr} at ${timeStr}`} />
            {c.attempt_count > 1 && (
              <ChoreDetailRow label="Attempt" value={`#${c.attempt_count} (re-submission)`} />
            )}
            {c.resolved_at && (
              <ChoreDetailRow
                label="Resolved"
                value={new Date(c.resolved_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              />
            )}
          </div>

          {/* Rate this chore — child-only, once it's actually approved */}
          {onRate && c.status === 'completed' && (
            <div className="rounded-xl border border-[var(--color-border)] p-3.5 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--color-text)]">How did this one feel?</p>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onRate(1)}
                  aria-pressed={c.rating === 1}
                  aria-label="Thumbs up"
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all active:scale-90 cursor-pointer ${
                    c.rating === 1
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-emerald-600'
                  }`}
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() => onRate(-1)}
                  aria-pressed={c.rating === -1}
                  aria-label="Thumbs down"
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all active:scale-90 cursor-pointer ${
                    c.rating === -1
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-red-500'
                  }`}
                >
                  👎
                </button>
              </div>
            </div>
          )}

          {/* Child's note */}
          {c.note && (
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <p className="text-[0.625rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                {c.child_name}'s note
              </p>
              <p className="text-sm text-[var(--color-text)] leading-snug italic">"{c.note}"</p>
            </div>
          )}

          {/* Parent notes */}
          {(c.parent_notes || c.rejection_note) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[0.625rem] font-semibold text-amber-700 uppercase tracking-wider mb-1">Parent feedback</p>
              <p className="text-sm text-amber-900 leading-snug">
                {c.parent_notes ?? c.rejection_note}
              </p>
            </div>
          )}

          {/* Proof photo */}
          {c.proof_url && (
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                </svg>
                <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Proof photo</p>
              </div>
              <div className="p-3">
                {proofState === 'loading' && (
                  <div className="flex items-center justify-center h-40 rounded-lg bg-[var(--color-surface-alt)]">
                    <div className="w-5 h-5 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {proofState === 'error' && (
                  <div className="flex flex-col items-center gap-2 py-6 text-center text-[var(--color-text-muted)]">
                    <p className="text-sm font-medium">Photo unavailable</p>
                    <p className="text-xs">The evidence photo could not be loaded or has expired.</p>
                  </div>
                )}
                {proofState === 'loaded' && proofUrl && (
                  <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={proofUrl} alt="Proof of work" className="w-full rounded-lg object-contain max-h-80" />
                    <p className="text-[0.625rem] text-center text-[var(--color-text-muted)] mt-1.5">Tap image to open full size ↗</p>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChoreDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="text-xs text-[var(--color-text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[var(--color-text)] flex-1 text-right font-medium">{value}</span>
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
  childCount,
  goalProgress,
  overdueCount = 0,
}: {
  childName: string
  childCount: number
  goalProgress: GoalProgress | null
  overdueCount?: number
}) {
  const heading = overdueCount > 0
    ? `${overdueCount} overdue chore${overdueCount !== 1 ? 's' : ''} need attention`
    : `${childName} is all caught up! 🎉`

  const mentorLine = overdueCount > 0
    ? `${childName} has ${overdueCount} chore${overdueCount !== 1 ? 's' : ''} past their due date with no submission yet. A gentle reminder usually does the trick.`
    : goalProgress
      ? `It looks like ${childName} is ${goalProgress.choresRemaining} chore${goalProgress.choresRemaining !== 1 ? 's' : ''} away from their '${goalProgress.goalName}' goal.`
      : childCount === 1
        ? `Keep an eye on ${childName}'s progress — their next goal milestone is coming up soon.`
        : `No pending tasks for ${childName} right now. Switch to another child above to check their pending approvals.`

  return (
    <PremiumShell>
      <div className="relative z-10 px-4 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <MentorAvatar />
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[0.625rem] font-bold tracking-widest uppercase" style={{ color: MENTOR_COLORS.label }}>
                  Orchard Mentor
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              </div>
              <p className="text-[0.9375rem] font-extrabold tracking-tight" style={{ color: MENTOR_COLORS.heading }}>
                {heading}
              </p>
            </div>
          </div>
          <ProBadge />
        </div>
        <p className="text-[0.8125rem] leading-relaxed" style={{ color: MENTOR_COLORS.body }}>
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
  isRejecting: boolean
  rejectNote: string
  busy: boolean
  anyBusy: boolean
  onApprove: () => void
  onStartRevise: () => void
  onCancelRevise: () => void
  onReviseNoteChange: (v: string) => void
  onConfirmRevise: () => void
  onStartReject: () => void
  onCancelReject: () => void
  onRejectNoteChange: (v: string) => void
  onConfirmReject: () => void
}

function AuditCard({
  completion: c, isRevising, reviseNote, isRejecting, rejectNote, busy, anyBusy,
  onApprove, onStartRevise, onCancelRevise, onReviseNoteChange, onConfirmRevise,
  onStartReject, onCancelReject, onRejectNoteChange, onConfirmReject,
}: AuditCardProps) {
  const [proofUrl, setProofUrl]     = useState<string | null>(null)
  const [loadingProof, setLoadingProof] = useState(false)
  const [proofError, setProofError] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
        <p className="px-4 pt-3 pb-1 text-[0.75rem] text-[var(--color-text-muted)] italic">
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
              <p className="text-[0.75rem] text-[var(--color-text-muted)]">Evidence expired or unavailable</p>
            </div>
          )}
          {proofUrl && !proofError && (
            <button
              type="button"
              className="absolute inset-0 w-full h-full"
              onClick={() => setLightboxOpen(true)}
              aria-label="View full size photo"
            >
              <img
                src={proofUrl}
                alt="Proof of work"
                className="w-full h-full object-cover"
              />
            </button>
          )}
          {/* Gradient overlay for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
          <div className="absolute bottom-2.5 left-3 pointer-events-none">
            <span className="text-[0.6875rem] font-semibold text-white/90 bg-black/40 rounded-full px-2 py-0.5">
              📷 Evidence photo
            </span>
          </div>
          {proofUrl && !proofError && (
            <div className="absolute bottom-2.5 right-3 pointer-events-none">
              <span className="text-[0.6875rem] font-semibold text-white/90 bg-black/40 rounded-full px-2 py-0.5">
                ⤢ Tap to expand
              </span>
            </div>
          )}
        </div>
      )}

      {/* Lightbox — portalled to body so overflow-hidden ancestors can't clip it */}
      {lightboxOpen && proofUrl && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none z-10"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
          <img
            src={proofUrl}
            alt="Proof of work"
            className="max-w-full max-h-full object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>,
        document.body,
      )}

      {/* Card body */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[0.9375rem] font-bold text-[var(--color-text)] leading-tight">{c.chore_title}</p>
              {isResubmission && (
                <span className="shrink-0 text-[0.625rem] font-extrabold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-400 rounded-full px-2 py-0.5 uppercase tracking-wide">
                  Re-submission #{c.attempt_count}
                </span>
              )}
            </div>
            <p className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] mt-0.5">
              {formatCurrency(c.reward_amount, c.currency)}
            </p>
            {c.note && (
              <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-1 italic">
                "{c.note}"
              </p>
            )}
            <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-1.5">{submittedAt}</p>
          </div>
        </div>
      </div>

      {/* Revise drawer */}
      {isRevising && (
        <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[0.75rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
            Feedback for {c.child_name}
          </p>
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[0.8125rem] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-amber-500 transition"
            placeholder="What needs to be improved? Be specific so they know exactly what to fix."
            rows={3}
            value={reviseNote}
            onChange={e => onReviseNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onCancelRevise}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmRevise}
              disabled={busy || !reviseNote.trim()}
              className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-[0.875rem] font-bold hover:bg-amber-600 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {busy ? 'Sending…' : 'Send feedback →'}
            </button>
          </div>
        </div>
      )}

      {/* Reject drawer */}
      {isRejecting && (
        <div className="px-4 pb-4 space-y-2.5 border-t border-red-200 dark:border-red-900 pt-3 bg-red-50 dark:bg-red-950/20">
          <p className="text-[0.75rem] font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">
            Reject this submission
          </p>
          <textarea
            className="w-full border border-red-200 dark:border-red-800 rounded-xl px-3.5 py-2.5 text-[0.8125rem] resize-none bg-white dark:bg-red-950/30 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-red-400 transition"
            placeholder="Explain why this is rejected (optional but helpful)"
            rows={2}
            value={rejectNote}
            onChange={e => onRejectNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onCancelReject}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmReject}
              disabled={busy}
              className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-[0.875rem] font-bold hover:bg-red-700 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {busy ? 'Rejecting…' : 'Reject ✗'}
            </button>
          </div>
        </div>
      )}

      {/* Action bar — hidden when a drawer is open */}
      {!isRevising && !isRejecting && (
        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={onStartReject}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[0.8125rem] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 cursor-pointer transition-colors"
          >
            Reject
          </button>
          <div className="w-px bg-[var(--color-border)]" />
          <button
            onClick={onStartRevise}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[0.8125rem] font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40 cursor-pointer transition-colors"
          >
            Revise
          </button>
          <div className="w-px bg-[var(--color-border)]" />
          <button
            onClick={onApprove}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[0.8125rem] font-bold text-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] disabled:opacity-40 cursor-pointer transition-colors"
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
