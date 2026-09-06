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
  getChores, getCompletions, submitChore, claimChore,
  uploadProof, formatCurrency,
} from '../../lib/api'
import { track } from '../../lib/analytics'
import { ChoreGuideSheet } from './ChoreGuideSheet'
import { ErrorBox } from '../ui/ErrorBox'
import { ChoreIcon } from './ChoreIcon'
import { SkeletonList } from '../ui/Skeleton'

interface Props {
  familyId: string
  childId: string
  currency: string
  grovePlans?: Record<string, number[]>
  onTogglePlant?: (chore: Chore, day: number) => void
  appView?: 'ORCHARD' | 'CLEAN'
  earningsMode?: 'ALLOWANCE' | 'CHORES' | 'HYBRID'
  allowanceAmountPence?: number
}

function triggerHaptic() {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(1) } catch { /* unsupported */ }
  }
}

interface SubmitState {
  choreId: string
  completionId: string | null  // set once lazy record is identified
  isRevision: boolean
  stage: 'note' | 'uploading' | 'submitting' | 'harvesting'
  note: string
  error: string | null
  startedAt: number            // epoch ms — for velocity tracking
  /** Object URL for the just-picked proof photo — shown while it uploads, revoked once done. */
  proofPreviewUrl?: string
}

export function EarnTab({ familyId, childId, currency, grovePlans = {}, onTogglePlant, appView = 'ORCHARD', earningsMode = 'CHORES', allowanceAmountPence = 0 }: Props) {
  const [chores,    setChores]    = useState<Chore[]>([])
  const [openChores, setOpenChores] = useState<Chore[]>([])  // assigned_to='anyone', unclaimed
  const [available, setAvailable] = useState<Completion[]>([])  // status=available
  const [awaiting,  setAwaiting]  = useState<Completion[]>([])  // status=awaiting_review
  const [revisions, setRevisions] = useState<Completion[]>([])  // status=needs_revision
  const [loading,   setLoading]   = useState(true)
  const [claiming,  setClaiming]  = useState<string | null>(null)  // chore id being claimed
  const [claimError, setClaimError] = useState<string | null>(null)
  const [submit,    setSubmit]    = useState<SubmitState | null>(null)
  const [choreGuideOpen, setChoreGuideOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      // GET /api/chores triggers lazy generation server-side for recurring chores
      const [c, open, av, aw, rev] = await Promise.all([
        getChores({ family_id: familyId, child_id: childId }).then(r => r.chores),
        getChores({ family_id: familyId, assigned_to: 'anyone' }).then(r => r.chores).catch(() => [] as Chore[]),
        getCompletions({ family_id: familyId, child_id: childId, status: 'available' }).then(r => r.completions),
        getCompletions({ family_id: familyId, child_id: childId, status: 'awaiting_review' }).then(r => r.completions),
        getCompletions({ family_id: familyId, child_id: childId, status: 'needs_revision' }).then(r => r.completions),
      ])
      setChores(c)
      setOpenChores(open)
      setAvailable(av)
      setAwaiting(aw)
      setRevisions(rev)
    } catch { /* silently degrade */ }
    finally { setLoading(false) }
  }, [familyId, childId])

  async function handleClaim(choreId: string) {
    // Optimistic: pull the card the instant it's tapped, don't wait on the round trip.
    // load() below is the reconciler either way — it removes the card for good on
    // success, restores it if the claim genuinely failed (e.g. network error), and
    // drops it on a 409 (sibling claimed first) — so no manual rollback needed here.
    setOpenChores(prev => prev.filter(c => c.id !== choreId))
    setClaiming(choreId)
    setClaimError(null)
    try {
      await claimChore(choreId)
    } catch (err: unknown) {
      setClaimError((err as Error).message)
    } finally {
      // BUG-024: always reload — removes the stale card on 409 (claimed by sibling)
      // BUG-025: always reset claiming state even if load() fails silently
      await load()
      setClaiming(null)
    }
  }

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

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

    // Show the picked photo immediately — same "confirm what you're sending"
    // pattern as ReceiptPicker, instead of a bare spinner with no preview.
    const previewUrl = URL.createObjectURL(file)
    setSubmit(s => s ? { ...s, stage: 'uploading', error: null, proofPreviewUrl: previewUrl } : s)
    try {
      const res = await submitChore(submit.choreId, submit.note || undefined)
      await uploadProof(res.id, file)
      const velocityMs = Date.now() - submit.startedAt
      track.taskSubmitted({ chore_id: submit.choreId, is_revision: submit.isRevision, velocity_ms: velocityMs, had_proof: true })
      setSubmit(s => s ? { ...s, stage: 'harvesting' } : s)
      setTimeout(() => { URL.revokeObjectURL(previewUrl); load().then(() => setSubmit(null)) }, 1800)
    } catch (err: unknown) {
      URL.revokeObjectURL(previewUrl)
      setSubmit(s => s ? { ...s, stage: 'note', error: (err as Error).message, proofPreviewUrl: undefined } : s)
    }
  }

  async function handleNoteSubmit() {
    if (!submit) return
    const pending = submit
    // Optimistic: jump straight to the harvest celebration instead of a
    // 'submitting' spinner — no proof upload here, so the request is cheap and
    // rarely fails. submitChore() fires in the background; a failure rolls the
    // card back to the note stage with an error rather than losing the tap.
    setSubmit(s => s ? { ...s, stage: 'harvesting', error: null } : s)
    try {
      await submitChore(pending.choreId, pending.note.trim() || undefined)
      const velocityMs = Date.now() - pending.startedAt
      track.taskSubmitted({ chore_id: pending.choreId, is_revision: pending.isRevision, velocity_ms: velocityMs, had_proof: false })
      setTimeout(() => { setSubmit(null); load() }, 1800)
    } catch (err: unknown) {
      setSubmit(s => (s && s.choreId === pending.choreId) ? { ...s, stage: 'note', error: (err as Error).message } : s)
    }
  }

  if (loading) return <SkeletonList count={4} />

  const hasAnything = revisions.length > 0 || available.length > 0 || awaiting.length > 0 || openChores.length > 0

  return (
    <div className="space-y-6">

      {/* ── ALLOWANCE NOTICE — shown when parent has set an allowance ── */}
      {(earningsMode === 'ALLOWANCE' || earningsMode === 'HYBRID') && allowanceAmountPence > 0 && (
        <div className="rounded-xl bg-[color-mix(in_srgb,var(--brand-accent)_10%,transparent)] border border-[var(--brand-accent)]/40 px-4 py-3.5 flex items-center gap-3">
          <span className="text-xl shrink-0">💰</span>
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-bold text-[var(--color-text)]">
              {earningsMode === 'ALLOWANCE' ? 'Your pocket money' : 'Weekly allowance'}
            </p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-snug">
              {earningsMode === 'ALLOWANCE'
                ? `Your parent sends you ${formatCurrency(allowanceAmountPence, currency)} automatically — no chores needed!`
                : `You also get ${formatCurrency(allowanceAmountPence, currency)} added automatically each week.`
              }
            </p>
          </div>
        </div>
      )}

      {/* ── ALLOWANCE-ONLY empty state — hide chore UI entirely ─────── */}
      {earningsMode === 'ALLOWANCE' && !hasAnything && (
        <div className="py-10 text-center text-[0.875rem] text-[var(--color-text-muted)]">
          Your parent handles your pocket money — nothing to submit here.
        </div>
      )}

      {/* ── NEEDS REVISION — top priority ─────────────────────────── */}
      {revisions.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-[0.8125rem] font-extrabold text-amber-600 uppercase tracking-wider">
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
          <h2 className="text-[0.8125rem] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
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
                  appView={appView}
                  isActive={submit?.choreId === chore.id}
                  stage={submit?.choreId === chore.id ? submit.stage : null}
                  note={submit?.choreId === chore.id ? submit.note : ''}
                  error={submit?.choreId === chore.id ? submit.error : null}
                  proofPreviewUrl={submit?.choreId === chore.id ? submit.proofPreviewUrl : undefined}
                  plannedDays={grovePlans[chore.id] ?? []}
                  onTogglePlant={onTogglePlant ? (day) => onTogglePlant(chore, day) : undefined}
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

      {/* ── OPEN TASKS (anyone can claim) ──────────────────────────── */}
      {openChores.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Open tasks — first come, first served
          </h2>
          <ErrorBox message={claimError} className="mb-2" />
          <div className="space-y-2.5">
            {openChores.map(chore => (
              <div key={chore.id} className={`bg-[var(--color-surface)] border rounded-xl px-4 py-3 flex items-center gap-3 ${chore.is_flash ? 'border-l-4 border-l-red-500 border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {!!chore.is_flash && <span className="text-[0.625rem] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>}
                    <p className="text-[0.9375rem] font-semibold text-[var(--color-text)]">{chore.title}</p>
                  </div>
                  <p className="text-[0.8125rem] font-semibold text-[var(--brand-accent)] mt-0.5 tabular-nums">
                    {formatCurrency(chore.reward_amount, currency)}
                  </p>
                  {meaningfulDescription(chore.description) && (
                    <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-1 leading-relaxed">{meaningfulDescription(chore.description)}</p>
                  )}
                  {!!chore.is_flash && chore.flash_deadline && (
                    <p className="text-[0.6875rem] font-bold text-red-600 mt-1">
                      ⏱ Due by {new Date(chore.flash_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { triggerHaptic(); handleClaim(chore.id) }}
                  disabled={claiming === chore.id}
                  className="shrink-0 h-10 px-4 bg-[var(--brand-primary)] text-white rounded-xl font-bold text-[0.8125rem] hover:opacity-90 disabled:opacity-50 active:scale-95 transition-all cursor-pointer btn-depth"
                >
                  {claiming === chore.id ? '…' : 'Grab it'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── AWAITING REVIEW ────────────────────────────────────────── */}
      {awaiting.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-extrabold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Waiting for review
          </h2>
          <div className="space-y-2">
            {awaiting.map(c => (
              <div key={c.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center justify-between opacity-70">
                <div>
                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{c.chore_title}</p>
                  <p className="text-[0.75rem] font-semibold text-[var(--brand-accent)] mt-0.5 tabular-nums">{formatCurrency(c.reward_amount, c.currency)}</p>
                </div>
                <span className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] rounded-full px-2.5 py-1">
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
          <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">No tasks yet</p>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1">Ask your parent to add some tasks for you.</p>
        </div>
      )}

      {/* ── SUGGEST A CHORE — bottom CTA, mirrors parent's "+ Add chore" ── */}
      {earningsMode !== 'ALLOWANCE' && (
        <button
          type="button"
          onClick={() => setChoreGuideOpen(true)}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
        >
          + Suggest a chore
        </button>
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
        familyId={familyId}
        context={null}
        currency={currency}
        appView={appView}
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
          <span className="text-[1.25rem] shrink-0">💬</span>
          <div className="flex-1 min-w-0">
            <p className="text-[0.6875rem] font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
              Parent's feedback
            </p>
            <p className="text-[0.875rem] font-semibold text-[var(--color-text)] leading-snug">
              {parentNotes ?? 'Please redo this task.'}
            </p>
          </div>
        </div>
      </div>

      {/* Chore identity */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div>
          <p className="text-[0.8125rem] font-semibold text-[var(--color-text-muted)]">{c.chore_title}</p>
          <p className="text-[0.75rem] font-semibold tabular-nums text-[var(--brand-accent)]">{formatCurrency(c.reward_amount, c.currency)}</p>
        </div>
        {(c.attempt_count ?? 1) > 1 && (
          <span className="text-[0.625rem] font-bold text-amber-700 dark:text-amber-400 bg-amber-200 dark:bg-amber-900/50 rounded-full px-2 py-0.5">
            Attempt {c.attempt_count}
          </span>
        )}
      </div>

      {/* Note drawer or resubmit button */}
      {noteOpen ? (
        <div className="px-4 pb-4 space-y-2 border-t border-amber-200 dark:border-amber-800 pt-3">
          <ErrorBox message={submitError} />
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[0.8125rem] resize-none bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
            placeholder="Tell your parent what you've improved…"
            rows={2}
            value={submitNote}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onNoteCancel}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.8125rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              disabled={isSubmitting}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[0.8125rem] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
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
            className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold text-[0.875rem] rounded-xl cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
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
  appView: 'ORCHARD' | 'CLEAN'
  isActive: boolean
  stage: SubmitState['stage'] | null
  note: string
  error: string | null
  proofPreviewUrl?: string
  plannedDays: number[]
  onTogglePlant?: (day: number) => void
  onStart: () => void
  onNoteChange: (v: string) => void
  onNoteSubmit: () => void
  onCancel: () => void
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * A description is only worth showing if it carries real instructions.
 * A real instruction always contains at least one letter, so values made up
 * solely of digits/punctuation/whitespace (e.g. "0", "0.0", ".", "-", or a
 * lone "0" padded with a zero-width char) are treated as junk and hidden.
 * Uses \p{L} so non-Latin scripts (Polish, etc.) still count as meaningful.
 */
function meaningfulDescription(desc?: string | null): string | null {
  const trimmed = desc?.trim()
  if (!trimmed || !/\p{L}/u.test(trimmed)) return null
  return trimmed
}

function OpenChoreCard({
  chore, currency, appView, isActive, stage, note, error, proofPreviewUrl,
  plannedDays, onTogglePlant,
  onStart, onNoteChange, onNoteSubmit, onCancel,
}: OpenChoreCardProps) {
  const [expanded, setExpanded] = useState(false)
  const doneLabel = appView === 'CLEAN' ? 'Mark complete' : 'Done!'

  if (stage === 'harvesting') return <HarvestPulse label="Submitted!" />

  return (
    <div className={`bg-[var(--color-surface)] border rounded-xl overflow-hidden transition-all
      ${isActive ? 'border-[var(--brand-primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-primary)_15%,transparent)]' : 'border-[var(--color-border)]'}
      ${!!chore.is_flash ? 'border-l-4 border-l-red-500' : !!chore.is_priority ? 'border-l-4 border-l-amber-500' : ''}
    `}>
      {/* Tappable card body — expands day picker */}
      <button
        type="button"
        onClick={() => !isActive && onTogglePlant && setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer"
      >
        <div className="w-9 h-9 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center shrink-0 text-[var(--color-text-muted)]">
          <ChoreIcon title={chore.title} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {!!chore.is_flash && (
              <span className="text-[0.625rem] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>
            )}
            {!!chore.is_priority && !chore.is_flash && (
              <span className="text-[0.625rem] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">PRIORITY</span>
            )}
            <p className="text-[0.9375rem] font-semibold text-[var(--color-text)]">{chore.title}</p>
          </div>
          <p className="text-[0.8125rem] font-semibold text-[var(--brand-accent)] mt-0.5 tabular-nums">
            {formatCurrency(chore.reward_amount, currency)}
          </p>
          {meaningfulDescription(chore.description) && (
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-1 leading-relaxed">{meaningfulDescription(chore.description)}</p>
          )}
          {!!chore.is_flash && chore.flash_deadline && (
            <p className="text-[0.6875rem] font-bold text-red-600 mt-1">
              ⏱ Due by {new Date(chore.flash_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {chore.proof_required && (
            <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
              <CameraIcon small /> Photo required to submit
            </p>
          )}
          {plannedDays.length > 0 && !expanded && (
            <p className="text-[0.6875rem] text-[var(--brand-primary)] mt-1">
              Planned: {plannedDays.map(d => DAY_LABELS[d - 1]).join(', ')}
            </p>
          )}
        </div>

        {stage === 'uploading' || stage === 'submitting' ? (
          <span className="shrink-0 flex items-center gap-1.5 text-[0.75rem] font-bold text-[var(--brand-primary)]">
            {proofPreviewUrl ? (
              <img src={proofPreviewUrl} alt="" className="w-7 h-7 rounded-md object-cover border border-[var(--brand-primary)]/40" />
            ) : (
              <span className="w-4 h-4 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin" />
            )}
            {stage === 'uploading' ? 'Uploading…' : 'Submitting…'}
          </span>
        ) : (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); triggerHaptic(); onStart() }}
            className={`shrink-0 h-10 rounded-xl font-bold text-[0.8125rem] transition-all active:scale-95 cursor-pointer btn-depth
              ${chore.proof_required
                ? 'px-3 bg-[var(--brand-primary)] text-white hover:opacity-90 flex items-center gap-1.5'
                : 'px-4 bg-[var(--brand-primary)] text-white hover:opacity-90'
              }`}
          >
            {chore.proof_required ? <><CameraIcon /> {doneLabel}</> : doneLabel}
          </button>
        )}
      </button>

      {/* Day picker — shown when expanded */}
      {expanded && !isActive && onTogglePlant && (
        <div className="px-4 pb-3 border-t border-[var(--color-border)] pt-2.5">
          <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {chore.frequency === 'one-off' ? 'Pick a day to do this' : 'Plan which days'}
          </p>
          <div className="flex gap-1.5">
            {DAY_LABELS.map((label, i) => {
              // grove plans are 1-indexed (1=Mon … 7=Sun) across the app
              const dayNum = i + 1
              const active = plannedDays.includes(dayNum)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onTogglePlant(dayNum)}
                  className={`flex-1 py-2 rounded-lg text-[0.6875rem] font-bold transition-colors cursor-pointer
                    ${active
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_15%,transparent)]'
                    }`}
                >
                  {label.slice(0, 1)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Note drawer */}
      {isActive && stage === 'note' && (
        <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--color-border)] pt-3">
          <ErrorBox message={error} />
          <textarea
            className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[0.8125rem] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
            placeholder="Add a note for your parent (optional)"
            rows={2}
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[0.8125rem] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onNoteSubmit}
              className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[0.8125rem] font-bold hover:opacity-90 cursor-pointer"
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
      <p className="text-[0.9375rem] font-extrabold text-[var(--brand-primary)]">{label}</p>
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

