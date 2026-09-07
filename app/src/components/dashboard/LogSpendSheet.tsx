// app/src/components/dashboard/LogSpendSheet.tsx
import { useState } from 'react'
import { logSpend, getGoals, formatCurrency } from '../../lib/api'
import type { Goal } from '../../lib/api'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useDragToClose } from '../../hooks/useDragToClose'
import { useEffect } from 'react'
import { ErrorBox } from '../ui/ErrorBox'
import { Input } from '../ui/input'
import { blurOnWheel, blockInvalidAmountKeys } from '../../lib/utils'

const SVG_PROPS = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.8',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

function SpendIcon({ id }: { id: string }) {
  switch (id) {
    case 'food':
      // Fork + knife
      return <svg {...SVG_PROPS}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
    case 'games':
      // Game controller
      return <svg {...SVG_PROPS}><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>
    case 'clothes':
      // T-shirt
      return <svg {...SVG_PROPS}><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>
    case 'books':
      // Open book
      return <svg {...SVG_PROPS}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
    case 'toys':
      // Star / prize
      return <svg {...SVG_PROPS}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'travel':
      // Bus
      return <svg {...SVG_PROPS}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M2 8h20"/><path d="M7 3v5"/><path d="M17 3v5"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></svg>
    case 'cinema':
      // Film / clapperboard
      return <svg {...SVG_PROPS}><path d="M2 12h20"/><path d="M2 6h20"/><path d="M2 18h20"/><rect x="2" y="2" width="20" height="20" rx="2"/></svg>
    case 'stationery':
      // Pencil
      return <svg {...SVG_PROPS}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
    default:
      return <svg {...SVG_PROPS}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
  }
}

const QUICK_PICKS = [
  { id: 'food',       label: 'Food & snacks' },
  { id: 'games',      label: 'Games' },
  { id: 'clothes',    label: 'Clothes' },
  { id: 'books',      label: 'Books' },
  { id: 'toys',       label: 'Toys' },
  { id: 'travel',     label: 'Travel' },
  { id: 'cinema',     label: 'Cinema' },
  { id: 'stationery', label: 'Stationery' },
]

interface Props {
  familyId: string
  childId:  string
  currency: string
  onClose:  () => void
  onSaved:  () => void
}

export function LogSpendSheet({ familyId, childId, currency, onClose, onSaved }: Props) {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł'

  const [title,     setTitle]     = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [note,      setNote]      = useState('')
  const [noteOpen,  setNoteOpen]  = useState(false)
  const [goalId,    setGoalId]    = useState('')
  const [goalOpen,  setGoalOpen]  = useState(false)
  const [goals,     setGoals]     = useState<Goal[]>([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  // Touched-on-blur, not onChange — so an inline error only appears once the
  // user has actually left the field, not while they're still typing it.
  const [titleTouched,  setTitleTouched]  = useState(false)
  const [amountTouched, setAmountTouched] = useState(false)

  useAndroidBack(true, onClose)
  const { sheetRef, handleProps } = useDragToClose(onClose)

  useEffect(() => {
    getGoals(familyId, childId)
      .then(r => setGoals(r.goals.filter(g => g.status === 'ACTIVE')))
      .catch(() => {})
  }, [familyId, childId])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const amountPence = Math.round(parseFloat(amountStr || '0') * 100)
  const canSubmit   = title.trim().length > 0 && amountPence > 0
  const titleError  = titleTouched && title.trim().length === 0 ? 'Tell us what you bought' : null
  const amountError = amountTouched && amountPence <= 0 ? 'Enter an amount greater than zero' : null

  function pickQuick(label: string) {
    setTitle(label)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) { setTitleTouched(true); setAmountTouched(true); return }
    setSaving(true)
    setError(null)
    try {
      await logSpend({
        family_id: familyId,
        title:     title.trim(),
        amount:    amountPence,
        currency,
        note:      note.trim() || undefined,
        goal_id:   goalId || undefined,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const selectedGoal = goals.find(g => g.id === goalId)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Log a spend"
        tabIndex={-1}
        className="relative bg-[var(--color-surface)] rounded-t-3xl shadow-2xl w-full max-w-[560px] flex flex-col max-h-[92dvh] transition-transform duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight leading-tight">
              💸 Log a spend
            </p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
              What did you spend your money on?
            </p>
          </div>
          <button
            onClick={onClose}
            className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 pb-10">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* Quick picks */}
            <div>
              <p className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
                Quick pick
              </p>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_PICKS.map(p => {
                  const active = title === p.label
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickQuick(p.label)}
                      className={[
                        'flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 py-3 px-1 text-center transition-all cursor-pointer',
                        active
                          ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)]/50 hover:text-[var(--brand-primary)]',
                      ].join(' ')}
                    >
                      <SpendIcon id={p.id} />
                      <span className="text-[0.5625rem] font-semibold leading-tight text-center">
                        {p.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* What did you buy */}
            <div>
              <label className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                What did you buy? <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => setTitleTouched(true)}
                placeholder="e.g. Roblox, lunch, book…"
                error={!!titleError}
                className="mt-1.5 h-auto py-3 text-15"
              />
              {titleError && <p className="mt-1 text-[0.75rem] text-red-500">{titleError}</p>}
            </div>

            {/* Amount */}
            <div>
              <label className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                How much? ({symbol}) <span className="text-red-500">*</span>
              </label>
              <div className="mt-1.5 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[1.125rem] font-bold text-[var(--color-text-muted)]">
                  {symbol}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  onBlur={() => setAmountTouched(true)}
                  onWheel={blurOnWheel}
                  onKeyDown={blockInvalidAmountKeys}
                  placeholder="0.00"
                  error={!!amountError}
                  className="h-auto pl-8 pr-3 py-3 text-[1.375rem] font-bold tabular-nums"
                />
              </div>
              {amountError && <p className="mt-1 text-[0.75rem] text-red-500">{amountError}</p>}
            </div>

            {/* Optional: link to goal */}
            {goals.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setGoalOpen(v => !v)}
                  className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[var(--brand-primary)] cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4l3 3"/>
                  </svg>
                  {goalOpen ? 'Remove goal link' : `Link to a saving goal ${selectedGoal ? `— ${selectedGoal.title}` : ''}`}
                </button>
                {goalOpen && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setGoalId(''); setGoalOpen(false) }}
                      className={[
                        'w-full text-left px-3 py-2.5 rounded-xl border text-[0.8125rem] font-medium transition-colors cursor-pointer',
                        !goalId
                          ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
                      ].join(' ')}
                    >
                      No goal — just general spending
                    </button>
                    {goals.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => { setGoalId(g.id); setGoalOpen(false) }}
                        className={[
                          'w-full text-left px-3 py-2.5 rounded-xl border text-[0.8125rem] transition-colors cursor-pointer',
                          goalId === g.id
                            ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                            : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
                        ].join(' ')}
                      >
                        <span className="font-semibold">{g.title}</span>
                        <span className="ml-2 text-[0.6875rem]">
                          {formatCurrency(g.current_saved_pence, g.currency)} saved
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Optional note */}
            <div>
              <button
                type="button"
                onClick={() => setNoteOpen(v => !v)}
                className="text-[0.8125rem] font-semibold text-[var(--brand-primary)] cursor-pointer"
              >
                {noteOpen ? '▾ Remove note' : '▸ Add a note'}
              </button>
              {noteOpen && (
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. birthday money treat"
                  rows={2}
                  className="mt-2 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[0.875rem] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] resize-none"
                />
              )}
            </div>

            <ErrorBox message={error} />

            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="w-full bg-[var(--brand-primary)] text-white font-bold text-[1rem] py-4 rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
            >
              {saving ? 'Saving…' : 'Save my spend'}
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}
