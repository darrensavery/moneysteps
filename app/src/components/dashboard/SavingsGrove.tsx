/**
 * SavingsGrove — Goal creation sheet for child view.
 *
 * Shows:
 *  - Name, Target Amount, Category, Save-by Date (mandatory)
 *  - Product URL (teen mode only)
 *  - Live "Labor Equivalent" preview: "This will take N [chore title]s"
 *
 * On submit: calls createGoal API and calls onCreated() callback.
 */

import { useState, useMemo } from 'react'
import type { Chore, Goal } from '../../lib/api'
import { createGoal, formatCurrency } from '../../lib/api'

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
  teenMode: number
  weeklyAllowancePence: number   // 0 if none
  onCreated: (goal: Goal) => void
  onClose:   () => void
}

export function SavingsGrove({
  familyId, childId, currency, chores, teenMode,
  weeklyAllowancePence, onCreated, onClose,
}: Props) {
  const [title,      setTitle]      = useState('')
  const [amountStr,  setAmountStr]  = useState('')
  const [category,   setCategory]   = useState('Other')
  const [deadline,   setDeadline]   = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

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
      return `About ${weeks} week${weeks !== 1 ? 's' : ''} of Harvest`
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

    setSaving(true)
    try {
      const goal = await createGoal({
        family_id: familyId,
        child_id:  childId,
        title:     title.trim(),
        target_amount: targetPence,
        currency,
        category,
        deadline,
        product_url: productUrl.trim() || undefined,
      } as Parameters<typeof createGoal>[0])
      onCreated(goal)
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
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-[var(--color-surface)] rounded-t-3xl max-h-[92svh] overflow-y-auto">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between pt-1">
            <h2 className="text-lg font-bold text-[var(--color-text)]">🌱 Plant a Goal</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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
                {currency === 'GBP' ? '£' : currency === 'PLN' ? 'zł' : '$'}
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

          {/* Product URL — teen mode only */}
          {teenMode === 1 && (
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
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Your parent can use this to check what you want before contributing.
              </p>
            </div>
          )}

          {err && (
            <p className="text-xs font-medium text-red-600">{err}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[var(--brand-primary)] text-white font-semibold py-3 text-sm disabled:opacity-60 transition-opacity"
          >
            {saving ? 'Planting…' : 'Plant this Goal 🌱'}
          </button>
        </form>
      </div>
    </div>
  )
}
