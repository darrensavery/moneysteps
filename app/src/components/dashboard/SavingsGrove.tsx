/**
 * SavingsGrove — Goal creation/edit sheet for child view.
 *
 * Shows:
 *  - Name, Target Amount, Category, Save-by Date (mandatory)
 *  - Product URL (teen mode only)
 *  - Live "Labor Equivalent" preview: "This will take N [chore title]s"
 *
 * Pass `goal` to edit an existing goal in place instead of creating a new
 * one — only the child who owns a goal can edit it (enforced server-side).
 * On submit: calls createGoal/updateGoal API and calls onCreated() callback.
 */

import { useState, useMemo, useEffect } from 'react'
import type { Chore, Goal } from '../../lib/api'
import { createGoal, updateGoal, formatCurrency } from '../../lib/api'
import { currencySymbol } from '../../lib/locale'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useDragToClose } from '../../hooks/useDragToClose'
import { ErrorBox } from '../ui/ErrorBox'

const CATEGORIES = [
  { id: 'Toys',     label: '🧸 Toys' },
  { id: 'Games',    label: '🎮 Games' },
  { id: 'Tech',     label: '💻 Tech' },
  { id: 'Outing',   label: '🎡 Outing' },
  { id: 'Clothing', label: '👕 Clothing' },
  { id: 'Books',    label: '📚 Books' },
  { id: 'Other',    label: '✨ Other' },
]

interface Props {
  familyId: string
  childId:  string
  currency: string
  chores:   Chore[]
  appView: 'ORCHARD' | 'CLEAN'
  weeklyAllowancePence: number   // 0 if none
  /** When set, edits this goal in place instead of creating a new one. */
  goal?:      Goal | null
  onCreated: (goal: Goal) => void
  onClose:   () => void
}

export function SavingsGrove({
  familyId, childId, currency, chores, appView,
  weeklyAllowancePence, goal, onCreated, onClose,
}: Props) {
  const isEditing = Boolean(goal)
  const [title,      setTitle]      = useState(goal?.title ?? '')
  const [amountStr,  setAmountStr]  = useState(goal ? (goal.target_amount / 100).toFixed(2) : '')
  const [category,   setCategory]   = useState(goal?.category ?? 'Other')
  const [deadline,   setDeadline]   = useState(goal?.deadline ?? '')
  const [productUrl, setProductUrl] = useState(goal?.product_url ?? '')
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  useAndroidBack(true, onClose)
  const { sheetRef, handleProps } = useDragToClose(onClose)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const targetPence = useMemo(() => {
    const n = parseFloat(amountStr)
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0
  }, [amountStr])

  // Best representative chore for effort calc: highest reward_amount
  const bestChore = useMemo(() => {
    const active = chores.filter(c => !c.archived)
    if (!active.length) return null
    return active.reduce((a, b) => a.reward_amount >= b.reward_amount ? a : b)
  }, [chores])

  // Effort preview text
  const effortText = useMemo(() => {
    if (!targetPence) return null
    if (bestChore && bestChore.reward_amount > 0) {
      const n = Math.ceil(targetPence / bestChore.reward_amount)
      return `${n} × "${bestChore.title}" (${formatCurrency(bestChore.reward_amount, currency)} each)`
    }
    if (weeklyAllowancePence > 0) {
      const weeks = Math.ceil(targetPence / weeklyAllowancePence)
      return `About ${weeks} week${weeks !== 1 ? 's' : ''} of ${appView === 'CLEAN' ? 'earnings' : 'saving'}`
    }
    return null
  }, [targetPence, bestChore, weeklyAllowancePence, currency])

  // Days to deadline
  const daysRemaining = useMemo(() => {
    if (!deadline) return null
    const diff = (new Date(deadline).getTime() - Date.now()) / 86_400_000
    return Math.ceil(diff)
  }, [deadline])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!title.trim())  return setErr('Please enter a goal name.')
    if (!targetPence)   return setErr('Enter a target amount greater than £0.')
    if (!deadline)      return setErr('Choose a save-by date.')
    if (isEditing && goal && targetPence < goal.current_saved_pence) {
      return setErr(`Target can't be lower than the ${formatCurrency(goal.current_saved_pence, currency)} already contributed toward this goal.`)
    }
    if (productUrl.trim()) {
      try {
        const parsed = new URL(productUrl.trim())
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return setErr('Product link must start with https://')
        }
      } catch {
        return setErr('Product link must be a valid URL (e.g. https://...)')
      }
    }

    setSaving(true)
    try {
      const result = isEditing && goal
        ? await updateGoal(goal.id, {
            title:         title.trim(),
            target_amount: targetPence,
            category,
            deadline,
            product_url: productUrl.trim() || null,
          } as Partial<Goal>)
        : await createGoal({
            family_id: familyId,
            child_id:  childId,
            title:     title.trim(),
            target_amount: targetPence,
            currency,
            category,
            deadline,
            product_url: productUrl.trim() || undefined,
          } as Parameters<typeof createGoal>[0])
      onCreated(result)
    } catch (ex: unknown) {
      setErr((ex as Error).message ?? 'Could not save goal.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Edit Goal' : (appView === 'CLEAN' ? 'Add a Goal' : 'Add a Goal — Savings Grove')}
      tabIndex={-1}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div ref={sheetRef} className="relative bg-[var(--color-surface)] rounded-t-3xl max-h-[92svh] overflow-y-auto transition-transform duration-300">
        {/* Drag handle */}
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between pt-1">
            <h2 className="text-lg font-bold text-[var(--color-text)]">
              {isEditing ? '✏️ Edit Goal' : (appView === 'CLEAN' ? 'Add a Goal' : '🎯 Add a Goal')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Goal name
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. New football boots"
              maxLength={80}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
          </div>

          {/* Amount + Effort preview */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Target amount
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--color-text-muted)]">
                {currencySymbol(currency)}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] pl-8 pr-3.5 py-2.5 text-sm tabular-nums text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
            </div>
            {isEditing && goal && goal.current_saved_pence > 0 && (
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
                {formatCurrency(goal.current_saved_pence, currency)} already contributed — the target can't go below this.
              </p>
            )}
            {/* Live effort preview */}
            {effortText && (
              <div className="flex items-start gap-2 rounded-xl bg-[var(--color-surface-alt)] px-3.5 py-2.5 border border-[var(--color-border)]">
                <span className="text-base mt-0.5">💪</span>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  That's about <span className="font-semibold text-[var(--color-text)]">{effortText}</span>
                </p>
              </div>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Category
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`rounded-xl border py-2 text-xs font-medium transition-colors ${
                    category === cat.id
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Save-by date */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Save-by date
            </label>
            <input
              type="date"
              value={deadline}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setDeadline(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {deadline && daysRemaining !== null && daysRemaining > 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} until your deadline
              </p>
            )}
          </div>

          {/* Product URL — CLEAN (mature) view only */}
          {appView === 'CLEAN' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Product link <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                type="url"
                value={productUrl}
                onChange={e => setProductUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
              <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
                Your parent can use this to check what you want before contributing.
              </p>
            </div>
          )}

          <ErrorBox message={err} />

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[var(--brand-primary)] text-white font-semibold py-3 text-sm disabled:opacity-60 transition-opacity"
          >
            {saving
              ? 'Saving…'
              : isEditing
                ? 'Save changes'
                : (appView === 'CLEAN' ? 'Save this Goal' : 'Add this Goal 🎯')}
          </button>
        </form>
      </div>
    </div>
  )
}
