/**
 * EarnTab — child's task earn view.
 *
 * Data model (post lazy-generation):
 *   available       — worker created this for the current period; child taps Done to submit
 *   needs_revision  — parent sent back with notes; child must resubmit
 *   awaiting_review — already submitted; waiting for parent
 *
 * Submission handshake:
 *   proof_required  → camera input (capture="environment") → upload → harvest pulse
 *   no proof        → optional note drawer → submit → harvest pulse
 *
 * PostHog funnel events:
 *   task_submit_started   — child taps Done (or camera button)
 *   task_submitted        — submission confirmed by worker
 *   revision_viewed       — needs_revision card rendered (dwell tracked)
 *   revision_resubmitted  — child resubmits after revision
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Chore, Completion } from '../../lib/api'
import {
  getChores, getCompletions, submitChore,
  uploadProof, formatCurrency,
} from '../../lib/api'
import { track } from '../../lib/analytics'
import { ChoreGuideSheet } from './ChoreGuideSheet'

interface Props {
  familyId: string
  childId: string
  currency: string
}

interface SubmitState {
  choreId: string
  completionId: string | null  // set once lazy record is identified
  isRevision: boolean
  stage: 'note' | 'uploading' | 'submitting' | 'harvesting'
  note: string
  error: string | null
  startedAt: number            // epoch ms — for velocity tracking
}

export function EarnTab({ familyId, childId, currency }: Props) {
  const [chores,    setChores]    = useState<Chore[]>([])
  const [available, setAvailable] = useState<Completion[]>([])  // status=available
  const [awaiting,  setAwaiting]  = useState<Completion[]>([])  // status=awaiting_review
  const [revisions, setRevisions] = useState<Completion[]>([])  // status=needs_revision
  const [loading,   setLoading]   = useState(true)
  const [submit,    setSubmit]    = useState<SubmitState | null>(null)
  const [choreGuideOpen, setChoreGuideOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // GET /api/chores triggers lazy generation server-side for recurring chores
      const [c, av, aw, rev] = await Promise.all([
        getChores({ family_id: familyId, child_id: childId }).then(r => r.chores),
        getCompletions({ family_id: familyId, child_id: childId, status: 'available' }).then(r => r.completions),
        getCompletions({ family_id: familyId, child_id: childId, status: 'awaiting_review' }).then(r => r.completions),
        getCompletions({ family_id: familyId, child_id: childId, status: 'needs_revision' }).then(r => r.completions),
      ])
      setChores(c)
      setAvailable(av)
      setAwaiting(aw)
      setRevisions(rev)
    } catch { /* silently degrade */ }
    finally { setLoading(false) }
  }, [familyId, childId])

  useEffect(() => { load() }, [load])

  // Map chore_id → Chore for quick lookup
  const choreMap = new Map(chores.map(c => [c.id, c]))

  // ── Submission flow ─────────────────────────────────────────────────────────

  function startSubmit(comp: Completion, isRevision: boolean) {
    const chore = choreMap.get(comp.chore_id)
    track.taskSubmitStarted({
      chore_id: comp.chore_id,
      is_revision: isRevision,
      has_proof_required: !!(chore?.proof_required),
    })

    if (chore?.proof_required) {
      setSubmit({
        choreId: comp.chore_id,
        completionId: comp.id,
        isRevision,
        stage: 'uploading',
        note: '',
        error: null,
        startedAt: Date.now(),
      })
      setTimeout(() => fileRef.current?.click(), 50)
    } else {
      setSubmit({
        choreId: comp.chore_id,
        completionId: comp.id,
        isRevision,
        stage: 'note',
        note: '',
        error: null,
        startedAt: Date.now(),
      })
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !submit) return
    e.target.value = ''

    setSubmit(s => s ? { ...s, stage: 'uploading', error: null } : s)
    try {
      const res = await submitChore(submit.choreId, submit.note || undefined)
      await uploadProof(res.id, file)
      const velocityMs = Date.now() - submit.startedAt
      track.taskSubmitted({ chore_id: submit.choreId, is_revision: submit.isRevision, velocity_ms: velocityMs, had_proof: true })
      setSubmit(s => s ? { ...s, stage: 'harvesting' } : s)
      setTimeout(() => { setSubmit(null); load() }, 1800)
    } catch (err: unknown) {
      setSubmit(s => s ? { ...s, stage: 'note', error: (err as Error).message } : s)
    }
  }

  async function handleNoteSubmit() {
    if (!submit) return
    setSubmit(s => s ? { ...s, stage: 'submitting', error: null } : s)
    try {
      await submitChore(submit.choreId, submit.note.trim() || undefined)
      const velocityMs = Date.now() - submit.startedAt
      track.taskSubmitted({ chore_id: submit.choreId, is_revision: submit.isRevision, velocity_ms: velocityMs, had_proof: false })
      setSubmit(s => s ? { ...s, stage: 'harvesting' } : s)
      setTimeout(() => { setSubmit(null); load() }, 1800)
    } catch (err: unknown) {
      setSubmit(s => s ? { ...s, stage: 'note', error: (err as Error).message } : s)
    }
  }

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  const hasAnything = revisions.length > 0 || available.length > 0 || awaiting.length > 0

  return (
    <div className="space-y-6">

      {/* ── CHORE GUIDE button ─────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setChoreGuideOpen(true)}
          className="text-xs font-medium text-[var(--brand-primary)] hover:underline underline-offset-2"
        >
          Chore Guide
        </button>
      </div>

      {/* ── NEEDS REVISION — top priority ─────────────────────────── */}
      {revisions.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-[13px] font-extrabold text-amber-600 uppercase tracking-wider">
              Needs your attention
            </h2>
          </div>
          <div className="space-y-3">
            {revisions.map(c => (
              <RevisionCard
                key={c.id}
                completion={c}
                chore={choreMap.get(c.chore_id) ?? null}
                isSubmitting={submit?.choreId === c.chore_id && submit.stage === 'submitting'}
                isHarvesting={submit?.choreId === c.chore_id && submit.stage === 'harvesting'}
                submitNote={submit?.choreId === c.chore_id ? submit.note : ''}
                submitError={submit?.choreId === c.chore_id ? submit.error : null}
                noteOpen={submit?.choreId === c.chore_id && submit.stage === 'note'}
                onResubmit={() => startSubmit(c, true)}
                onNoteChange={v => setSubmit(s => s ? { ...s, note: v } : s)}
                onNoteSubmit={handleNoteSubmit}
                onNoteCancel={() => setSubmit(null)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── AVAILABLE TASKS ────────────────────────────────────────── */}
      {available.length > 0 && (
        <section>
          <h2 className="text-[13px] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Available tasks
          </h2>
          <div className="space-y-2.5">
            {available.map(comp => {
              const chore = choreMap.get(comp.chore_id)
              if (!chore) return null
              return (
                <OpenChoreCard
                  key={comp.id}
                  chore={chore}
                  currency={currency}
                  isActive={submit?.choreId === chore.id}
                  stage={submit?.choreId === chore.id ? submit.stage : null}
                  note={submit?.choreId === chore.id ? submit.note : ''}
                  error={submit?.choreId === chore.id ? submit.error : null}
                  onStart={() => startSubmit(comp, false)}
                  onNoteChange={v => setSubmit(s => s ? { ...s, note: v } : s)}
                  onNoteSubmit={handleNoteSubmit}
                  onCancel={() => setSubmit(null)}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* ── AWAITING REVIEW ────────────────────────────────────────── */}
      {awaiting.length > 0 && (
        <section>
          <h2 className="text-[13px] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Waiting for review
          </h2>
          <div className="space-y-2">
            {awaiting.map(c => (
              <div key={c.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center justify-between opacity-70">
                <div>
                  <p className="text-[14px] font-semibold text-[var(--color-text)]">{c.chore_title}</p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 tabular-nums">{formatCurrency(c.reward_amount, c.currency)}</p>
                </div>
                <span className="text-[11px] font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] rounded-full px-2.5 py-1">
                  In review…
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasAnything && (
        <div className="py-16 text-center">
          <p className="text-4xl mb-3">🌱</p>
          <p className="text-[15px] font-bold text-[var(--color-text)]">No tasks yet</p>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">Ask your parent to add some tasks for you.</p>
        </div>
      )}

      {/* Hidden file input for camera capture */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <ChoreGuideSheet
        open={choreGuideOpen}
        onClose={() => setChoreGuideOpen(false)}
        context={null}
      />
    </div>
  )
}

// ── RevisionCard ───────────────────────────────────────────────────────────────

interface RevisionCardProps {
  completion: Completion
  chore: Chore | null
  isSubmitting: boolean
  isHarvesting: boolean
  submitNote: string
  submitError: string | null
  noteOpen: boolean
  onResubmit: () => void
  onNoteChange: (v: string) => void
  onNoteSubmit: () => void
  onNoteCancel: () => void
}

function RevisionCard({
  completion: c, chore, isSubmitting, isHarvesting,
  submitNote, submitError, noteOpen,
  onResubmit, onNoteChange, onNoteSubmit, onNoteCancel,
}: RevisionCardProps) {
  const parentNotes = c.parent_notes ?? c.rejection_note

  // Track how long the child spends looking at the revision card
  useEffect(() => {
    const viewedAt = Date.now()
    track.revisionViewed({ chore_id: c.chore_id, attempt_count: c.attempt_count ?? 1 })
    return () => {
      const dwellMs = Date.now() - viewedAt
      track.revisionDwellTime({ chore_id: c.chore_id, dwell_ms: dwellMs })
    }
  }, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isHarvesting) return <HarvestPulse label="Resubmitted!" />

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30">
      {/* Parent feedback — primary content */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-2.5">
          <span className="text-[20px] shrink-0">💬</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
              Parent's feedback
            </p>
            <p className="text-[14px] font-semibold text-[var(--color-text)] leading-snug">
              {parentNotes ?? 'Please redo this task.'}
            </p>
          </div>
        </div>
      </div>

      {/* Chore identity */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-[var(--color-text-muted)]">{c.chore_title}</p>
          <p className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{formatCurrency(c.reward_amount, c.currency)}</p>
        </div>
        {(c.attempt_count ?? 1) > 1 && (
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-200 dark:bg-amber-900/50 rounded-full px-2 py-0.5">
            Attempt {c.attempt_count}
          </span>
        )}
      </div>

      {/* Note drawer or resubmit button */}
      {noteOpen ? (
        <div className="px-4 pb-4 space-y-2 border-t border-amber-200 dark:border-amber-800 pt-3">
          {submitError && <p className="text-[12px] text-red-600">{submitError}</p>}
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
            placeholder="Tell your parent what you've improved…"
            rows={2}
            value={submitNote}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onNoteCancel}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              disabled={isSubmitting}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[13px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? 'Submitting…' : 'Resubmit →'}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-4 border-t border-amber-200 dark:border-amber-800 pt-3">
          <button
            onClick={onResubmit}
            disabled={isSubmitting}
            className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold text-[14px] rounded-xl cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {chore?.proof_required ? (
              <><CameraIcon /> Take photo &amp; resubmit</>
            ) : 'Resubmit task →'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── OpenChoreCard ─────────────────────────────────────────────────────────────

interface OpenChoreCardProps {
  chore: Chore
  currency: string
  isActive: boolean
  stage: SubmitState['stage'] | null
  note: string
  error: string | null
  onStart: () => void
  onNoteChange: (v: string) => void
  onNoteSubmit: () => void
  onCancel: () => void
}

function OpenChoreCard({
  chore, currency, isActive, stage, note, error,
  onStart, onNoteChange, onNoteSubmit, onCancel,
}: OpenChoreCardProps) {
  if (stage === 'harvesting') return <HarvestPulse label="Submitted!" />

  return (
    <div className={`bg-[var(--color-surface)] border rounded-xl overflow-hidden transition-all
      ${isActive ? 'border-[var(--brand-primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-primary)_15%,transparent)]' : 'border-[var(--color-border)]'}
      ${chore.is_flash ? 'border-l-4 border-l-red-500' : chore.is_priority ? 'border-l-4 border-l-amber-500' : ''}
    `}>
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {chore.is_flash && (
              <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>
            )}
            {chore.is_priority && !chore.is_flash && (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">PRIORITY</span>
            )}
            <p className="text-[15px] font-semibold text-[var(--color-text)]">{chore.title}</p>
          </div>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5 tabular-nums">
            {formatCurrency(chore.reward_amount, currency)}
          </p>
          {chore.description && (
            <p className="text-[12px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{chore.description}</p>
          )}
          {chore.proof_required && (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
              <CameraIcon small /> Photo required to submit
            </p>
          )}
        </div>

        {stage === 'uploading' || stage === 'submitting' ? (
          <span className="shrink-0 flex items-center gap-1.5 text-[12px] font-bold text-[var(--brand-primary)]">
            <span className="w-4 h-4 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
            {stage === 'uploading' ? 'Uploading…' : 'Submitting…'}
          </span>
        ) : (
          <button
            onClick={onStart}
            className={`shrink-0 h-10 rounded-xl font-bold text-[13px] transition-all active:scale-95 cursor-pointer
              ${chore.proof_required
                ? 'px-3 bg-[var(--brand-primary)] text-white hover:opacity-90 flex items-center gap-1.5'
                : 'px-4 bg-[var(--brand-primary)] text-white hover:opacity-90'
              }`}
          >
            {chore.proof_required ? <><CameraIcon /> Done</> : 'Done'}
          </button>
        )}
      </div>

      {/* Note drawer */}
      {isActive && stage === 'note' && (
        <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--color-border)] pt-3">
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
            placeholder="Add a note for your parent (optional)"
            rows={2}
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[13px] font-bold hover:opacity-90 cursor-pointer"
            >
              Submit →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Harvest pulse ─────────────────────────────────────────────────────────────

function HarvestPulse({ label }: { label: string }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] border-2 border-[var(--brand-primary)] px-4 py-5 flex items-center justify-center gap-3">
      <span className="absolute inset-0 rounded-2xl animate-ping bg-[var(--brand-primary)] opacity-10 pointer-events-none" />
      <span className="text-2xl">🌿</span>
      <p className="text-[15px] font-extrabold text-[var(--brand-primary)]">{label}</p>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon({ small = false }: { small?: boolean }) {
  const s = small ? 11 : 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}
