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
import { useGatekeeper } from '../../hooks/useGatekeeper'
import type { Completion, ChildRecord } from '../../lib/api'
import {
  getCompletions, approveCompletion, reviseCompletion,
  approveAll, formatCurrency, getProofUrl,
} from '../../lib/api'
import { PaymentBridgeSheet } from '../payment/PaymentBridgeSheet'
import { useToast, Toast } from '../settings/shared'

interface Props {
  familyId: string
  child: ChildRecord
  onCountChange: (n: number) => void
}

export function PendingTab({ familyId, child, onCountChange }: Props) {
  const { challenge, GatekeeperModal } = useGatekeeper()
  const [completions, setCompletions] = useState<Completion[]>([])
  const [loading, setLoading]         = useState(true)
  const [reviseId, setReviseId]       = useState<string | null>(null)
  const [reviseNote, setReviseNote]   = useState('')
  const [busy, setBusy]               = useState<string | null>(null)
  const [approveAllBusy, setApproveAllBusy] = useState(false)
  const [showApproveAllModal, setShowApproveAllModal] = useState(false)
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

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'awaiting_review' })
    setCompletions(r.completions)
    onCountChange(r.completions.length)
    setLoading(false)
  }, [familyId, child.id, onCountChange])

  useEffect(() => { load() }, [load])

  async function handleApprove(id: string) {
    setBusy(id)
    try {
      await approveCompletion(id)
      const approved = completions.find((c) => c.id === id)
      await load()
      if (approved) {
        setPendingToastAction({
          label: `Pay Now (${formatCurrency(approved.reward_amount, approved.currency)})`,
          onClick: () => setBridgeCtx({
            completionIds: [approved.id],
            total: approved.reward_amount,
            currency: approved.currency,
          }),
        })
        showToast(`Approved ✓`)
      }
    } finally {
      setBusy(null)
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

  // Totals for the modal
  const approveAllTotal = completions.reduce((s, c) => s + c.reward_amount, 0)
  const approveAllCurrency = completions[0]?.currency ?? 'GBP'

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  if (completions.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-10 text-center">
        <div className="text-4xl mb-3">✓</div>
        <p className="text-[16px] font-bold text-[var(--color-text)]">All clear</p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">Nothing waiting for your review.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <GatekeeperModal />
      {/* Approve-all bulk action */}
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
          busy={busy === c.id}
          anyBusy={!!busy || approveAllBusy}
          onApprove={() => challenge(() => handleApprove(c.id))}
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
          <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            {/* Header */}
            <div>
              <p className="text-[18px] font-extrabold text-[var(--color-text)] tracking-tight">
                Confirm payment
              </p>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                You are about to pay out <strong className="text-[var(--color-text)]">{completions.length} task{completions.length !== 1 ? 's' : ''}</strong> totalling{' '}
                <strong className="text-[var(--brand-primary)]">{formatCurrency(approveAllTotal, approveAllCurrency)}</strong>.
                Have you verified that these tasks meet the agreed standard?
              </p>
            </div>

            {/* Task list — scrollable if long */}
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

            {/* Actions */}
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
      {toast && <Toast message={toast} />}

      {toast && pendingToastAction && (
        <button
          type="button"
          onClick={() => {
            pendingToastAction.onClick()
            setPendingToastAction(null)
          }}
          className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-600 text-white text-[13px] font-semibold shadow-lg"
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
    </div>
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
