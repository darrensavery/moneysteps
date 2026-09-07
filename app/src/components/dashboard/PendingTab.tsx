/**
 * PendingTab — parent approval queue.
 *
 * Shows completions with status 'awaiting_review'.
 * Features:
 *  - Proof image (presigned R2 URL, loaded on demand)
 *  - Resubmission badge when attempt_count > 1
 *  - Revise drawer with parent_notes textarea
 *  - Approve / Approve-all
 *  - Correct status vocabulary (awaiting_review, not 'pending')
 */

import { useState, useEffect, useCallback } from 'react'
import { tick } from '../../lib/haptics'
import { useGatekeeper } from '../../hooks/useGatekeeper'
import type { Completion, ChildRecord } from '../../lib/api'
import {
  getCompletions, approveCompletion, reviseCompletion,
  approveAll, formatCurrency, getProofUrl,
} from '../../lib/api'
import { PaymentBridgeSheet } from '../payment/PaymentBridgeSheet'
import { Button } from '../ui/button'
import { SkeletonList } from '../ui/Skeleton'
import { useToast, Toast } from '../settings/shared'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { ReviewPromptSheet } from '../review/ReviewPromptSheet'
import { trackReviewPrompt } from '../../lib/reviewPrompt'

interface Props {
  familyId: string
  child: ChildRecord
  onCountChange: (n: number) => void
}

// Co-parent race guard — the worker returns a 409 with one of these messages
// when a completion has already been actioned by the time this request lands
// (both parents can be shown the same "ready to approve" push notification).
// See worker/src/routes/completions.ts handleCompletionApprove/Revise/Reject.
function isAlreadyResolvedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /no longer awaiting review|^Cannot (approve|reject|request revision) — completion is/.test(err.message)
}

export function PendingTab({ familyId, child, onCountChange }: Props) {
  const { challenge, GatekeeperModal } = useGatekeeper()
  const [completions, setCompletions] = useState<Completion[]>([])
  const [loading, setLoading]         = useState(true)
  const [reviseId, setReviseId]       = useState<string | null>(null)
  const [reviseNote, setReviseNote]   = useState('')
  const [busy, setBusy]               = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveAllBusy, setApproveAllBusy] = useState(false)
  const [showApproveAllModal, setShowApproveAllModal] = useState(false)
  useAndroidBack(showApproveAllModal, () => setShowApproveAllModal(false))
  useEffect(() => {
    if (!showApproveAllModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowApproveAllModal(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showApproveAllModal])
  useAndroidBack(!!reviseId, () => { setReviseId(null); setReviseNote('') })
  const { toast, showToast } = useToast()
  const [bridgeCtx, setBridgeCtx] = useState<null | {
    completionIds: string[];
    total: number;
    currency: string;
  }>(null)
  const [pendingToastAction, setPendingToastAction] = useState<null | {
    label: string;
    onClick: () => void;
  }>(null)
  const [showReviewPrompt, setShowReviewPrompt] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'awaiting_review' })
    setCompletions(r.completions)
    onCountChange(r.completions.length)
    setLoading(false)
  }, [familyId, child.id, onCountChange])

  useEffect(() => { load() }, [load])

  // How long the card's checkmark/fade exit plays before it actually leaves
  // the list — long enough to read as a confirmed action, short enough to
  // not feel laggy ("Behind the Button": the button reflects a real step,
  // not a generic spinner).
  const APPROVE_EXIT_MS = 260

  async function handleApprove(id: string) {
    void tick()
    const approved = completions.find((c) => c.id === id)
    if (!approved) return
    const indexInList = completions.findIndex((c) => c.id === id)

    // Optimistic: fire the request immediately and let the exit animation
    // play in parallel rather than waiting on the round trip. `approvingId`
    // is the "leaving" flag so the card shows its checkmark/fade regardless
    // of how fast the network responds; a genuine failure cancels the pending
    // removal and restores the card in its original slot. Deliberately kept
    // separate from `busy` (revise flow) so a revise-in-progress card never
    // fades — only a genuine approval does.
    setApprovingId(id)
    let removed = false
    const removeTimer = setTimeout(() => {
      removed = true
      setCompletions(prev => prev.filter((c) => c.id !== id))
      onCountChange(completions.length - 1)
    }, APPROVE_EXIT_MS)

    try {
      const result = await approveCompletion(id)
      setApprovingId(null)
      setPendingToastAction({
        label: `Pay Now (${formatCurrency(approved.reward_amount, approved.currency)})`,
        onClick: () => setBridgeCtx({
          completionIds: [approved.id],
          total: approved.reward_amount,
          currency: approved.currency,
        }),
      })
      showToast(`Approved ✓`)
      if (result.show_review_prompt) {
        setTimeout(() => {
          trackReviewPrompt('shown', { platform: 'web', trigger: 'nth_approval' })
          setShowReviewPrompt(true)
        }, 500)
      }
    } catch (err) {
      clearTimeout(removeTimer)
      setApprovingId(null)
      // Co-parent race: both parents can be looking at the same awaiting_review
      // item (e.g. both tapped the "ready to approve" push notification). Whoever
      // taps second gets a 409 from the server — refresh the list instead of
      // leaving a dead card / a raw error on screen.
      if (isAlreadyResolvedError(err)) {
        // Always refresh here (regardless of whether the exit animation had
        // finished) — the card is stale either way, and load() replaces the
        // whole list from the server so there's nothing to reconcile by hand.
        await load()
        showToast('Already actioned by the other parent')
      } else {
        // Genuine failure — restore the card where it was (if the exit timer
        // already fired) and let the parent retry.
        if (removed) {
          setCompletions(prev => {
            const next = [...prev]
            next.splice(Math.min(indexInList, next.length), 0, approved)
            return next
          })
          onCountChange(completions.length)
        }
        showToast('Something went wrong — please try again.')
      }
    }
  }

  async function handleRevise(id: string) {
    if (!reviseNote.trim()) return
    setBusy(id)
    try {
      await reviseCompletion(id, reviseNote.trim())
      setReviseId(null)
      setReviseNote('')
      await load()
    } catch (err) {
      if (isAlreadyResolvedError(err)) {
        setReviseId(null)
        setReviseNote('')
        await load()
        showToast('Already actioned by the other parent')
      } else {
        showToast('Something went wrong — please try again.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleConfirmApproveAll() {
    setShowApproveAllModal(false)
    setApproveAllBusy(true)
    const snapshot = completions.map((c) => ({
      id: c.id, amount: c.reward_amount, currency: c.currency,
    }))
    try {
      await approveAll(familyId, child.id)
      await load()

      const byCurrency = new Map<string, { ids: string[]; total: number }>()
      for (const r of snapshot) {
        const bucket = byCurrency.get(r.currency) ?? { ids: [], total: 0 }
        bucket.ids.push(r.id)
        bucket.total += r.amount
        byCurrency.set(r.currency, bucket)
      }

      if (byCurrency.size === 1) {
        const [[currency, bucket]] = [...byCurrency.entries()]
        setPendingToastAction({
          label: `Pay Now (${formatCurrency(bucket.total, currency)})`,
          onClick: () => setBridgeCtx({
            completionIds: bucket.ids,
            total: bucket.total,
            currency,
          }),
        })
      }
      // Multi-currency: skip auto-offer, parent uses Unpaid pill.

      showToast(`${snapshot.length} approved ✓`)
    } finally {
      setApproveAllBusy(false)
    }
  }

  // Totals for the modal — multi-currency guard
  const uniqueCurrencies = [...new Set(completions.map(c => c.currency))]
  const isMixedCurrency  = uniqueCurrencies.length > 1
  const approveAllTotal    = isMixedCurrency ? 0 : completions.reduce((s, c) => s + c.reward_amount, 0)
  const approveAllCurrency = completions[0]?.currency ?? 'GBP'

  if (loading) return <SkeletonList count={3} withIcon={false} />

  // Note: even when the list is empty (e.g. the co-parent just resolved the
  // only pending item, or every item was approved), we still render the toast
  // / pay-now button / review-prompt below — a bare early-return here used to
  // swallow the "Already actioned by the other parent" toast whenever the
  // race left the list empty.
  const isEmpty = completions.length === 0

  return (
    <div className="space-y-3">
      <GatekeeperModal />
      {isEmpty && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-10 text-center">
          <div className="text-4xl mb-3">✓</div>
          <p className="text-[1rem] font-bold text-[var(--color-text)]">All clear</p>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1">Nothing waiting for your review.</p>
        </div>
      )}
      {/* Approve-all bulk action */}
      {completions.length > 1 && (
        <Button
          onClick={() => setShowApproveAllModal(true)}
          disabled={approveAllBusy}
          size="lg"
          className="w-full"
        >
          {approveAllBusy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
              Approving…
            </span>
          ) : `Approve all ${completions.length} submissions`}
        </Button>
      )}

      {completions.map(c => (
        <AuditCard
          key={c.id}
          completion={c}
          isRevising={reviseId === c.id}
          reviseNote={reviseNote}
          busy={busy === c.id}
          isApproving={approvingId === c.id}
          anyBusy={!!busy || !!approvingId || approveAllBusy}
          onApprove={() => handleApprove(c.id)}
          onStartRevise={() => { setReviseId(c.id); setReviseNote('') }}
          onCancelRevise={() => { setReviseId(null); setReviseNote('') }}
          onReviseNoteChange={setReviseNote}
          onConfirmRevise={() => handleRevise(c.id)}
        />
      ))}

      {/* Approve-all confirmation modal */}
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
            {/* Header */}
            <div>
              <p className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight">
                Confirm payment
              </p>
              <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                You are about to pay out <strong className="text-[var(--color-text)]">{completions.length} task{completions.length !== 1 ? 's' : ''}</strong>
                {isMixedCurrency
                  ? <> across <strong className="text-[var(--color-text)]">multiple currencies</strong> (see totals below).</>
                  : <> totalling <strong className="text-[var(--brand-primary)]">{formatCurrency(approveAllTotal, approveAllCurrency)}</strong>.</>
                }
                {' '}Have you verified that these tasks meet the agreed standard?
              </p>
            </div>

            {/* Task list — scrollable if long */}
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

            {/* Actions */}
            <div className="flex gap-2.5">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setShowApproveAllModal(false)}>
                Cancel
              </Button>
              <Button size="lg" className="flex-1" onClick={() => challenge(handleConfirmApproveAll)}>
                Confirm &amp; pay
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast message={toast} />}

      {pendingToastAction && (
        <button
          type="button"
          onClick={() => {
            pendingToastAction.onClick()
            setPendingToastAction(null)
          }}
          className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-600 text-white text-[0.8125rem] font-semibold shadow-lg"
        >
          {pendingToastAction.label}
        </button>
      )}

      {bridgeCtx && (
        <PaymentBridgeSheet
          open={true}
          onClose={() => setBridgeCtx(null)}
          familyId={familyId}
          child={child}
          completionIds={bridgeCtx.completionIds}
          totalMinorUnits={bridgeCtx.total}
          currency={bridgeCtx.currency}
          onPaid={() => { /* parent dashboard refetches unpaid-summary on its own */ }}
        />
      )}
      <ReviewPromptSheet
        open={showReviewPrompt}
        onClose={() => setShowReviewPrompt(false)}
      />
    </div>
  )
}

// ── AuditCard ──────────────────────────────────────────────────────────────────

interface AuditCardProps {
  completion: Completion
  isRevising: boolean
  reviseNote: string
  busy: boolean
  isApproving: boolean
  anyBusy: boolean
  onApprove: () => void
  onStartRevise: () => void
  onCancelRevise: () => void
  onReviseNoteChange: (v: string) => void
  onConfirmRevise: () => void
}

function AuditCard({
  completion: c, isRevising, reviseNote, busy, isApproving, anyBusy,
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
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl card-depth overflow-hidden transition-all duration-[260ms] ease-out"
      style={isApproving ? { opacity: 0, transform: 'scale(0.97)', pointerEvents: 'none' } : undefined}
    >

      {/* Proof image */}
      {hasProof && (
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
            <img
              src={proofUrl}
              alt="Proof of work"
              className="w-full h-full object-cover"
            />
          )}
          {/* Gradient overlay for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-2.5 left-3">
            <span className="text-[0.6875rem] font-semibold text-white/90 bg-black/40 rounded-full px-2 py-0.5">
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
      {isRevising ? (
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
          {/* Visible instead of a hover/press tooltip — this is a mostly-mobile
              app, and native `title` never shows on touch. */}
          {!reviseNote.trim() && (
            <p className="text-[0.6875rem] text-[var(--color-text-muted)] -mt-1">
              Add feedback so they know what to fix.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancelRevise}>
              Cancel
            </Button>
            <Button
              variant="warning"
              className="flex-1"
              onClick={onConfirmRevise}
              disabled={busy || !reviseNote.trim()}
            >
              {busy ? 'Sending…' : 'Send feedback →'}
            </Button>
          </div>
        </div>
      ) : (
        /* Action bar */
        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={onStartRevise}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[0.875rem] font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40 cursor-pointer transition-colors"
          >
            Revise
          </button>
          <div className="w-px bg-[var(--color-border)]" />
          <button
            onClick={onApprove}
            disabled={anyBusy}
            className="flex-1 py-3.5 text-[0.875rem] font-bold text-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] disabled:opacity-40 cursor-pointer transition-colors"
          >
            {isApproving ? (
              <span className="flex items-center justify-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Approved
              </span>
            ) : 'Approve ✓'}
          </button>
        </div>
      )}
    </div>
  )
}
