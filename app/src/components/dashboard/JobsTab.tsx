import { useState, useEffect, useCallback, useRef } from 'react'
import type { Chore, Suggestion, Plan, ChildRecord } from '../../lib/api'
import {
  getChores, archiveChore, restoreChore,
  getSuggestions, approveSuggestion, rejectSuggestion, getPlans, createPlan, deletePlan,
  formatCurrency, getMondayISO,
} from '../../lib/api'
import { CreateChoreSheet } from './CreateChoreSheet'
import { PremiumShell, MentorAvatar, ProBadge, injectPremiumStyles, MENTOR_COLORS } from '../ui/PremiumShell'
import { Button } from '../ui/button'
import { SkeletonList } from '../ui/Skeleton'
import { useLocale } from '../../lib/locale'
import { ErrorBox } from '../ui/ErrorBox'
import { requestPushPermission, hasPromptedForPushPermission } from '../../lib/push.js'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Maps UI label → D1 frequency value
const FREQUENCY_OPTIONS: { label: string; value: string; recurring: boolean }[] = [
  { label: 'One-off',          value: 'as_needed',   recurring: false },
  { label: 'Daily',            value: 'daily',        recurring: true  },
  { label: 'Weekly',           value: 'weekly',       recurring: true  },
  { label: 'Fortnightly',      value: 'bi_weekly',    recurring: true  },
  { label: 'Monthly',          value: 'monthly',      recurring: true  },
  { label: 'School Days',      value: 'school_days',  recurring: true  },
]

interface Props {
  familyId: string
  child: ChildRecord
  children: ChildRecord[]
}

export function ChoresTab({ familyId, child, children }: Props) {
  const { locale } = useLocale()
  const CURRENCY = locale === 'en-US' ? 'USD' : locale === 'pl' ? 'PLN' : 'GBP'
  const [chores, setChores]           = useState<Chore[]>([])
  const [archived, setArchived]       = useState<Chore[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [plans, setPlans]             = useState<Plan[]>([])
  const [loading, setLoading]         = useState(true)
  const [showSheet, setShowSheet]         = useState(false)
  const [showArchived, setShowArchived]   = useState(false)
  const [editingChore, setEditingChore]   = useState<Chore | null>(null)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [toast, setToast]                 = useState<{ choreId: string; title: string } | null>(null)
  const toastTimerRef                     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const weekStart = getMondayISO()

  // Suggestion review state
  const [reviewId, setReviewId]       = useState<string | null>(null)
  const [reviewMode, setReviewMode]   = useState<'edit' | 'decline' | null>(null)
  const [reviewBusy, setReviewBusy]   = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // Edit fields (pre-filled from suggestion on open)
  const [editTitle, setEditTitle]     = useState('')
  const [editAmount, setEditAmount]   = useState('')
  const [editFreq, setEditFreq]       = useState('as_needed')
  const [editDueDate, setEditDueDate] = useState('')
  // Decline field
  const [rejectNote, setRejectNote]   = useState('')

  useEffect(() => { injectPremiumStyles() }, [])

  const load = useCallback(async (silent = false) => {
    if (!familyId) return
    if (!silent) setLoading(true)
    try {
      const [c, a, s, p] = await Promise.all([
        getChores({ family_id: familyId, child_id: child.id }).then(r => r.chores),
        getChores({ family_id: familyId, child_id: child.id, archived: true }).then(r => r.chores),
        getSuggestions(familyId, 'pending').then(r => r.suggestions.filter(s => s.child_id === child.id)),
        getPlans(familyId, child.id, weekStart).then(r => r.plans),
      ])
      setChores(c)
      setArchived(a)
      setSuggestions(s)
      setPlans(p)
    } catch { /* silently degrade on transient network errors */ }
    finally {
      setLoading(false)
    }
  }, [familyId, child.id, weekStart])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  async function handleArchive(id: string) {
    const chore = chores.find(c => c.id === id)
    if (!chore) return

    // Optimistic remove
    setChores(prev => prev.filter(c => c.id !== id))
    setExpandedId(null)

    // Show toast
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ choreId: id, title: chore.title })
    toastTimerRef.current = setTimeout(async () => {
      setToast(null)
      await archiveChore(id)
      await load()
    }, 4000)
  }

  async function handleUndoArchive() {
    if (!toast) return
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    // Restore chore to list without hitting the server (was never archived)
    setToast(null)
    await load()
  }

  async function handleRestore(id: string) {
    await restoreChore(id)
    await load()
  }

  function openReview(s: Suggestion, mode: 'edit' | 'decline') {
    setReviewId(s.id)
    setReviewMode(mode)
    setReviewError(null)
    setRejectNote('')
    setEditTitle(s.title)
    setEditAmount((s.proposed_amount / 100).toFixed(2))
    setEditFreq(s.frequency ?? 'as_needed')
    setEditDueDate(s.due_date ?? '')
  }

  function closeReview() {
    setReviewId(null)
    setReviewMode(null)
    setReviewError(null)
  }

  async function handleApprove() {
    if (!reviewId) return
    const pence = Math.round(parseFloat(editAmount) * 100)
    if (!editTitle.trim()) { setReviewError('Title is required.'); return }
    if (!editAmount || isNaN(pence) || pence <= 0) { setReviewError('Enter a valid amount.'); return }
    setReviewBusy(true)
    setReviewError(null)
    try {
      await approveSuggestion(reviewId, {
        title: editTitle.trim(),
        proposed_amount: pence,
        frequency: editFreq,
        due_date: editDueDate || null,
      })
      setSuggestions(prev => prev.filter(x => x.id !== reviewId))
      closeReview()
      await load()
    } catch {
      setReviewError('Something went wrong — please try again.')
    } finally {
      setReviewBusy(false)
    }
  }

  async function handleReject() {
    if (!reviewId) return
    if (!rejectNote.trim()) { setReviewError('Please explain why you\'re declining.'); return }
    setReviewBusy(true)
    setReviewError(null)
    try {
      await rejectSuggestion(reviewId, rejectNote.trim())
      setSuggestions(prev => prev.filter(x => x.id !== reviewId))
      closeReview()
    } catch {
      setReviewError('Something went wrong — please try again.')
    } finally {
      setReviewBusy(false)
    }
  }

  async function togglePlan(chore: Chore, dayIndex: number) {
    const dayOfWeek = dayIndex + 1
    const existing = plans.find(p => p.chore_id === chore.id && p.day_of_week === dayOfWeek)

    if (existing) {
      // Optimistic remove
      setPlans(prev => prev.filter(p => p.id !== existing.id))
      try {
        await deletePlan(existing.id)
      } catch {
        // Rollback on failure
        setPlans(prev => [...prev, existing])
      }
    } else {
      // Optimistic add — use a temp id until the real one comes back
      const tempId = `temp-${chore.id}-${dayOfWeek}`
      const tempPlan: Plan = {
        id: tempId,
        chore_id: chore.id,
        day_of_week: dayOfWeek,
        week_start: weekStart,
        chore_title: chore.title,
        reward_amount: chore.reward_amount,
        currency: chore.currency,
      }
      setPlans(prev => [...prev, tempPlan])
      try {
        const { id: realId } = await createPlan({ family_id: familyId, chore_id: chore.id, child_id: child.id, day_of_week: dayOfWeek, week_start: weekStart })
        setPlans(prev => prev.map(p => p.id === tempId ? { ...tempPlan, id: realId } : p))
      } catch {
        // Rollback on failure
        setPlans(prev => prev.filter(p => p.id !== tempId))
      }
    }
  }

  if (loading) return <SkeletonList count={4} className="space-y-2.5 pb-28" />

  return (
    <div className="space-y-4 pb-28">
      {/* Suggestion cards */}
      {suggestions.length > 0 && (
        <div className="space-y-3">
          {suggestions.map(s => {
            const isReviewing = reviewId === s.id
            const hasModule   = s.reason?.startsWith('module:') ?? false
            const moduleLabel = hasModule
              ? s.reason!.replace('module:', '').replace(/-/g, ' ').replace(/^\d+\s*/, '')
              : null
            const userReason  = !hasModule && s.reason ? s.reason : null

            return (
              <div key={s.id} className="bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] rounded-2xl overflow-hidden">
                {/* Summary row */}
                <div className="px-4 pt-4 pb-3">
                  <p className="text-[0.6875rem] font-bold text-[var(--brand-primary)] uppercase tracking-wider mb-1.5">
                    {hasModule ? '🌱 Learning Lab chore idea' : '💡 Chore suggestion'}
                  </p>
                  <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{s.title}</p>
                  <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-0.5 tabular-nums">
                    {hasModule ? (
                      <>Inspired by the <span className="capitalize">{moduleLabel}</span> lesson — {formatCurrency(s.proposed_amount, CURRENCY)}</>
                    ) : (
                      <>{formatCurrency(s.proposed_amount, CURRENCY)}</>
                    )}
                  </p>
                  {userReason && (
                    <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-1 italic">"{userReason}"</p>
                  )}
                  {s.due_date && (
                    <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-1">
                      Requested by: <span className="font-semibold">{s.due_date}</span>
                    </p>
                  )}
                </div>

                {/* Review panel */}
                {!isReviewing ? (
                  <div className="px-4 pb-4 flex gap-2">
                    <Button size="sm" className="flex-1 h-9" onClick={() => openReview(s, 'edit')}>
                      Review &amp; approve
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 h-9" onClick={() => openReview(s, 'decline')}>
                      Decline
                    </Button>
                  </div>
                ) : reviewMode === 'edit' ? (
                  <div className="border-t border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] px-4 pt-3 pb-4 space-y-3">
                    <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Edit before approving</p>
                    <ErrorBox message={reviewError} />
                    <div>
                      <label className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] block mb-1">Chore title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] block mb-1">Pay (£)</label>
                        <input
                          type="number" min="0.01" step="0.01"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] block mb-1">Frequency</label>
                        <select
                          value={editFreq}
                          onChange={e => setEditFreq(e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                        >
                          {FREQUENCY_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] block mb-1">Due date <span className="font-normal">(optional)</span></label>
                      <input
                        type="date"
                        value={editDueDate}
                        onChange={e => setEditDueDate(e.target.value)}
                        className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-[0.8125rem] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="flex-1 h-10" onClick={closeReview}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-10"
                        onClick={handleApprove}
                        disabled={reviewBusy}
                      >
                        {reviewBusy ? 'Approving…' : 'Approve →'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] px-4 pt-3 pb-4 space-y-3">
                    <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Explain your decision</p>
                    <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                      {child.display_name} will see this message. Be clear and encouraging.
                    </p>
                    <ErrorBox message={reviewError} />
                    <textarea
                      rows={3}
                      placeholder={`e.g. We already have this covered, but try suggesting something else!`}
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      autoFocus
                      className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[0.8125rem] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 h-10" onClick={closeReview}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1 h-10"
                        onClick={handleReject}
                        disabled={reviewBusy || !rejectNote.trim()}
                        title={!rejectNote.trim() ? 'Explain why you\'re declining first' : undefined}
                      >
                        {reviewBusy ? 'Declining…' : 'Send decline'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Active chores */}
      {chores.length === 0 ? (
        <EmptyChoresState childName={child.display_name} onAdd={() => setShowSheet(true)} />
      ) : (
        <div className="space-y-2.5">
          {chores.map(chore => (
            <ChoreCard
              key={chore.id}
              chore={chore}
              plans={plans.filter(p => p.chore_id === chore.id)}
              expanded={expandedId === chore.id}
              onToggle={() => setExpandedId(expandedId === chore.id ? null : chore.id)}
              onArchive={() => handleArchive(chore.id)}
              onEdit={() => setEditingChore(chore)}
              onTogglePlan={(day) => togglePlan(chore, day)}
            />
          ))}
        </div>
      )}

      {/* Add chore — fixed above bottom nav dock */}
      <div className="fixed bottom-0 inset-x-0 z-20 flex justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[520px] mx-3"
          style={{ marginBottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 68px)' }}
        >
          <Button onClick={() => setShowSheet(true)} className="w-full shadow-lg">
            + Add chore
          </Button>
        </div>
      </div>

      {/* Create chore sheet */}
      {showSheet && (
        <CreateChoreSheet
          familyId={familyId}
          children={children}
          currency={CURRENCY}
          onCreated={() => {
            setShowSheet(false)
            load()
            if (!hasPromptedForPushPermission()) requestPushPermission().catch(() => {})
          }}
          onClose={() => setShowSheet(false)}
        />
      )}

      {/* Edit chore sheet */}
      {editingChore && (
        <CreateChoreSheet
          familyId={familyId}
          children={children}
          currency={CURRENCY}
          editChore={editingChore}
          onCreated={() => { setEditingChore(null); setExpandedId(null); load() }}
          onClose={() => setEditingChore(null)}
        />
      )}


      {/* Archived toggle */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-[0.8125rem] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            {showArchived ? '▲' : '▼'} Archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map(chore => (
                <div key={chore.id} className="bg-[var(--color-surface)] rounded-xl px-4 py-3 flex items-center justify-between opacity-60" style={{ boxShadow: 'var(--shadow-card)' }}>
                  <div>
                    <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{chore.title}</p>
                    <p className="text-[0.75rem] text-[var(--color-text-muted)]">{formatCurrency(chore.reward_amount, chore.currency)}</p>
                  </div>
                  <button onClick={() => handleRestore(chore.id)} className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Archive undo toast */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--color-text)] text-[var(--color-surface)] text-[0.8125rem] font-medium shadow-xl transition-all duration-300 ${toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <span>Chore archived.</span>
        <button
          onClick={handleUndoArchive}
          className="font-bold text-[var(--brand-primary)] hover:opacity-80 transition-opacity cursor-pointer"
        >
          Undo
        </button>
      </div>
    </div>
  )
}

// ── Category icons — mirrors CreateChoreSheet TILE_ICONS ─────────────────────

function ChoreIcon({ title, size = 20 }: { title: string; size?: number }) {
  const s = `${size}px`
  const t = title.toLowerCase()

  if (t.includes('tidy') || t.includes('room') || t.includes('clean room'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  if (t.includes('dish') || t.includes('wash up'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 1 0 20"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/></svg>
  if (t.includes('vacuum') || t.includes('hoover'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 9V3"/><path d="M6.6 6.6 4.5 4.5"/><path d="M9 12H3"/><path d="M6.6 17.4l-2.1 2.1"/><path d="M12 15v6"/><path d="M17.4 17.4l2.1 2.1"/><path d="M15 12h6"/><path d="M17.4 6.6l2.1-2.1"/></svg>
  if (t.includes('bin') || t.includes('rubbish') || t.includes('trash'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
  if (t.includes('dog') || t.includes('walk') || t.includes('pet'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 2.115"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 2.115"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444c0-1.084-.22-2.2-.682-3.31"/></svg>
  if (t.includes('car') || t.includes('wash car'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h10l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  if (t.includes('homework') || t.includes('reading') || t.includes('study') || t.includes('book'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  if (t.includes('bed') || t.includes('bedroom'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16"/><path d="M22 4v16"/><path d="M2 8h20"/><path d="M2 20h20"/><path d="M2 12h6a2 2 0 0 1 2 2v4H2v-6z"/><path d="M16 12h6v8h-8v-4a2 2 0 0 1 2-2z"/></svg>
  if (t.includes('lawn') || t.includes('garden') || t.includes('grass') || t.includes('mow'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M9 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M15 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M7 21v-9"/><path d="M13 21v-9"/><path d="M17 21v-6c0-2-1-3-3-3"/></svg>
  if (t.includes('cook') || t.includes('dinner') || t.includes('lunch') || t.includes('meal'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11v6"/><path d="M9 11v2a3 3 0 0 0 6 0v-2"/><path d="M3 11h18"/><path d="M12 2v3"/><path d="M8 2c0 2.5 4 2.5 4 5"/><path d="M16 2c0 2.5-4 2.5-4 5"/></svg>
  if (t.includes('laundry') || t.includes('washing') || t.includes('clothes'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="4"/><circle cx="8" cy="7" r="1"/></svg>
  // fallback — generic task circle
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>
}

function RecurringIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-70">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}

// ── Mini week dots — read-only at-a-glance schedule ──────────────────────────

function MiniScheduleDots({ plannedDays }: { plannedDays: number[] }) {
  const days = ['M','T','W','T','F','S','S']
  return (
    <div className="flex items-center gap-[3px] mt-1.5">
      {days.map((d, i) => (
        <div
          key={i}
          title={['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}
          className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[0.5625rem] font-bold transition-colors
            ${plannedDays.includes(i)
              ? 'bg-[var(--brand-primary)] text-white'
              : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]/50'
            }`}
        >
          {d}
        </div>
      ))}
    </div>
  )
}

// ── Empty state with AI Mentor flavour ───────────────────────────────────────

function EmptyChoresState({ childName, onAdd }: { childName: string; onAdd: () => void }) {
  return (
    <div className="space-y-4">
      {/* Mentor card */}
      <PremiumShell>
        <div className="relative z-10 px-4 pt-5 pb-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
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
                  No chores yet for <span style={{ color: MENTOR_COLORS.bright }}>{childName}</span>
                </p>
              </div>
            </div>
            <ProBadge />
          </div>
          {/* Body */}
          <p className="text-[0.8125rem] leading-relaxed" style={{ color: MENTOR_COLORS.body }}>
            Once you add chores I can track {childName}'s consistency, spot patterns, and give you genuinely useful coaching — not generic tips.
          </p>
          {/* Action list */}
          <div className="space-y-2">
            <p className="text-[0.625rem] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>Get started</p>
            {[
              `Add 2–3 small daily chores so I can spot ${childName}'s consistency patterns.`,
              'Try "Check Going Rates" in the new chore form to set fair rewards instantly.',
              `Plan the week once a chore is added — so ${childName} knows what's expected.`,
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="shrink-0 text-[0.5625rem] font-black tracking-wider tabular-nums mt-0.5" style={{ color: MENTOR_COLORS.accent }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-[0.75rem] leading-relaxed" style={{ color: MENTOR_COLORS.body }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </PremiumShell>

      {/* Add chore CTA */}
      <button
        onClick={onAdd}
        className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl py-3.5 text-[0.875rem] font-semibold text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
      >
        + Add first chore
      </button>
    </div>
  )
}

function ChoreCard({ chore, plans, expanded, onToggle, onArchive, onEdit, onTogglePlan }: {
  chore: Chore
  plans: Plan[]
  expanded: boolean
  onToggle: () => void
  onArchive: () => void
  onEdit: () => void
  onTogglePlan: (dayIndex: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const dueDateObj = chore.due_date && /^\d{4}-\d{2}-\d{2}$/.test(chore.due_date) ? new Date(chore.due_date + 'T00:00:00') : null
  const isOverdue = !!dueDateObj && chore.due_date! < new Date().toLocaleDateString('sv')
  const plannedDays = plans.map(p => p.day_of_week - 1)

  const accentBorderClass = chore.is_flash
    ? 'border-l-4 border-l-red-500'
    : chore.is_priority
    ? 'border-l-4 border-l-amber-500'
    : isOverdue
    ? 'border-l-4 border-l-red-400'
    : ''

  const bgClass = isOverdue && !chore.is_flash
    ? 'bg-red-100 dark:bg-red-950/40'
    : chore.is_priority && !chore.is_flash
    ? 'bg-amber-50 dark:bg-amber-950/30'
    : 'bg-[var(--color-surface)]'

  const borderColor = isOverdue || chore.is_flash
    ? '1px solid rgba(220,38,38,0.35)'
    : chore.is_priority
    ? '1px solid rgba(217,119,6,0.30)'
    : '1px solid var(--color-border)'

  const shadowStyle = {
    border: borderColor,
    transition: 'box-shadow 200ms ease',
    boxShadow: hovered
      ? 'var(--shadow-card-hover)'
      : (isOverdue || chore.is_flash)
      ? 'var(--shadow-card-urgent)'
      : 'var(--shadow-card)',
  }

  return (
    <div
      className={`${bgClass} ${accentBorderClass} rounded-xl overflow-hidden`}
      style={shadowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className="w-full px-4 py-3 flex items-start gap-3 cursor-pointer"
        onClick={onToggle}
      >
        {/* Category icon */}
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center mt-0.5 ${
          isOverdue || chore.is_flash
            ? 'bg-red-200 text-red-600 dark:bg-red-900/40 dark:text-red-400'
            : chore.is_priority
            ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
            : 'bg-[var(--color-surface-alt)] text-[var(--brand-primary)]'
        }`}>
          <ChoreIcon title={chore.title} size={20} />
        </div>

        {/* Title + metadata */}
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {!!chore.is_flash && <span className="text-[0.6875rem] font-bold text-red-600 bg-red-100 rounded px-1.5 py-0.5">FLASH</span>}
            {!!chore.is_priority && !chore.is_flash && <span className="text-[0.6875rem] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">PRIORITY</span>}
            <span className="text-[0.9375rem] font-semibold text-[var(--color-text)]">{chore.title}</span>
            {!expanded && !!chore.description && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)] opacity-50 shrink-0" aria-label="Has instructions">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            )}
          </div>
          {/* Frequency / due date — below title so all cards stay the same height */}
          {(chore.frequency !== 'as_needed' && chore.frequency !== 'one-off') || dueDateObj ? (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {chore.frequency !== 'as_needed' && chore.frequency !== 'one-off' && (
                <span className="text-[0.625rem] text-[var(--color-text-muted)] flex items-center gap-0.5">
                  <RecurringIcon />
                  {FREQUENCY_OPTIONS.find(o => o.value === chore.frequency)?.label ?? chore.frequency}
                </span>
              )}
              {dueDateObj && (
                <span className={`text-[0.625rem] font-semibold ${isOverdue ? 'text-red-500' : 'text-[var(--color-text-muted)]'}`}>
                  Due {dueDateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          ) : null}
          {/* Mini read-only schedule dots */}
          {plannedDays.length > 0 && !expanded && (
            <MiniScheduleDots plannedDays={plannedDays} />
          )}
        </div>

        {/* Price + chevron */}
        <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
          <span className="text-[0.875rem] font-bold text-[var(--color-text)] tabular-nums">
            {formatCurrency(chore.reward_amount, chore.currency)}
          </span>
          {/* Chevron */}
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-[var(--color-text-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>

      {/* Grid-rows trick: animates height without knowing content height up
          front (0fr → 1fr), so the chevron rotation and the panel opening
          read as one connected motion instead of a rotate + instant pop. */}
      <div
        className="grid transition-[grid-template-rows] duration-[220ms] ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        // Content stays mounted (for the height transition) even while
        // collapsed, so keep it out of the tab order / a11y tree until open.
        inert={!expanded}
      >
        <div className="overflow-hidden">
        <div className="px-4 pb-4 space-y-3 border-t border-[color-mix(in_srgb,var(--color-border)_50%,transparent)] pt-3">
          {chore.description && (
            <p className="text-[0.8125rem] text-[var(--color-text-muted)]">{chore.description}</p>
          )}

          {/* Overdue nudge — encouraging, not alarming */}
          {isOverdue && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
              <span className="text-[0.75rem] text-red-600 dark:text-red-400 flex-1">Missed the due date — no worries!</span>
              <button
                onClick={e => { e.stopPropagation(); onEdit() }}
                className="shrink-0 inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-[var(--brand-primary)] border border-[var(--brand-primary)] rounded-lg px-2.5 py-1 hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
                </svg>
                Reschedule
              </button>
            </div>
          )}

          {/* Schedule planner strip */}
          <div>
            <p className="text-[0.75rem] font-semibold text-[var(--color-text-muted)] mb-2">Set schedule</p>
            <div className="flex gap-2">
              {DAYS.map((day, i) => (
                <button
                  key={`${day}-${i}`}
                  onClick={e => { e.stopPropagation(); onTogglePlan(i) }}
                  className={`flex-1 h-9 rounded-xl text-[0.75rem] font-bold transition-all duration-150 cursor-pointer active:scale-95
                    ${plannedDays.includes(i)
                      ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Edit + Archive row */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[0.75rem] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit chore
            </button>
            <button
              onClick={onArchive}
              className="inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--color-text-muted)] hover:text-red-500 transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
              Archive
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}