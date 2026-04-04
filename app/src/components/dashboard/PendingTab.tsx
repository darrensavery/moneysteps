import { useState, useEffect, useCallback } from 'react'
import type { Completion, ChildRecord } from '../../lib/api'
import {
  getCompletions, approveCompletion, rejectCompletion, approveAll, formatCurrency,
} from '../../lib/api'

interface Props {
  familyId: string
  child: ChildRecord
  onCountChange: (n: number) => void
}

export function PendingTab({ familyId, child, onCountChange }: Props) {
  const [completions, setCompletions] = useState<Completion[]>([])
  const [loading, setLoading]         = useState(true)
  const [rejectId, setRejectId]       = useState<string | null>(null)
  const [rejectNote, setRejectNote]   = useState('')
  const [busy, setBusy]               = useState<string | null>(null)
  const [approveAllBusy, setApproveAllBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getCompletions({ family_id: familyId, child_id: child.id, status: 'pending' })
    setCompletions(r.completions)
    onCountChange(r.completions.length)
    setLoading(false)
  }, [familyId, child.id, onCountChange])

  useEffect(() => { load() }, [load])

  async function handleApprove(id: string) {
    setBusy(id)
    try {
      await approveCompletion(id)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function handleReject(id: string) {
    setBusy(id)
    try {
      await rejectCompletion(id, rejectNote.trim() || undefined)
      setRejectId(null)
      setRejectNote('')
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function handleApproveAll() {
    setApproveAllBusy(true)
    try {
      await approveAll(familyId, child.id)
      await load()
    } finally {
      setApproveAllBusy(false)
    }
  }

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  if (completions.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 text-center">
        <p className="text-[28px] mb-2">✓</p>
        <p className="text-[15px] font-semibold text-[var(--color-text)]">All clear</p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">Nothing waiting for approval.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {completions.length > 1 && (
        <button
          onClick={handleApproveAll}
          disabled={approveAllBusy}
          className="w-full bg-[var(--brand-primary)] text-white font-bold py-3 rounded-xl text-[15px] hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {approveAllBusy ? 'Approving…' : `Approve all (${completions.length})`}
        </button>
      )}

      {completions.map(c => (
        <div key={c.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--color-text)] truncate">{c.chore_title}</p>
                <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">
                  {formatCurrency(c.reward_amount, c.currency)}
                  {c.note && <span className="ml-2 italic">"{c.note}"</span>}
                </p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                  {new Date(c.submitted_at * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <span className="shrink-0 text-[12px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-1">
                Pending
              </span>
            </div>
          </div>

          {rejectId === c.id ? (
            <div className="px-4 pb-4 space-y-2 border-t border-[var(--color-border)] pt-3">
              <textarea
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Reason (optional)"
                rows={2}
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setRejectId(null); setRejectNote('') }}
                  className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(c.id)}
                  disabled={busy === c.id}
                  className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-[14px] font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy === c.id ? 'Rejecting…' : 'Confirm reject'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex border-t border-[var(--color-border)]">
              <button
                onClick={() => setRejectId(c.id)}
                disabled={!!busy}
                className="flex-1 py-3 text-[14px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer transition-colors"
              >
                Reject
              </button>
              <div className="w-px bg-[var(--color-border)]" />
              <button
                onClick={() => handleApprove(c.id)}
                disabled={!!busy}
                className="flex-1 py-3 text-[14px] font-bold text-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] disabled:opacity-40 cursor-pointer transition-colors"
              >
                {busy === c.id ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
