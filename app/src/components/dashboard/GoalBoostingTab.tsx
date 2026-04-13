/**
 * GoalBoostingTab — Parent view of all active child goals.
 *
 * Features:
 *  - Lists all active goals for the selected child
 *  - Shows product_url as a "Vet item" link (parent can check what child wants)
 *  - Toggle parent match % per goal (PATCH /api/goals/:id)
 *  - One-time fixed contribution button (POST /api/goals/:id/contribute)
 *  - Shows "Effective Target" for child accounting for parent match
 */

import { useState, useEffect } from 'react'
import type { ChildRecord, Goal } from '../../lib/api'
import { currencySymbol } from '../../lib/locale'
import {
  getGoals, updateGoal, contributeToGoal,
  formatCurrency, effectiveTarget,
} from '../../lib/api'

const MATCH_OPTIONS = [0, 10, 25, 50, 100]

interface Props {
  familyId: string
  child:    ChildRecord
}

export function GoalBoostingTab({ familyId, child }: Props) {
  const [goals,     setGoals]     = useState<Goal[]>([])
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState<string | null>(null)
  const [saving,    setSaving]    = useState<string | null>(null)
  // contribution input state keyed by goal.id
  const [contribAmt, setContribAmt] = useState<Record<string, string>>({})
  const [contributing, setContributing] = useState<string | null>(null)
  const [contribMsg,   setContribMsg]   = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await getGoals(familyId, child.id)
      setGoals(res.goals.filter(g => g.status === 'ACTIVE' || !g.status))
    } catch (e: unknown) {
      setErr((e as Error).message ?? 'Failed to load goals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [familyId, child.id])

  async function handleMatchChange(goal: Goal, pct: number) {
    setSaving(goal.id)
    try {
      const updated = await updateGoal(goal.id, { parent_match_pct: pct } as Partial<Goal>)
      setGoals(prev => prev.map(g => g.id === updated.id ? updated : g))
    } finally {
      setSaving(null)
    }
  }

  async function handleContribute(goal: Goal) {
    const raw = contribAmt[goal.id] ?? ''
    const pence = Math.round(parseFloat(raw) * 100)
    if (!isFinite(pence) || pence <= 0) return
    setContributing(goal.id)
    try {
      const updated = await contributeToGoal(goal.id, pence)
      setGoals(prev => prev.map(g => g.id === updated.id ? updated : g))
      setContribAmt(prev => ({ ...prev, [goal.id]: '' }))
      setContribMsg(prev => ({ ...prev, [goal.id]: `+${formatCurrency(pence, goal.currency)} added!` }))
      setTimeout(() => setContribMsg(prev => ({ ...prev, [goal.id]: '' })), 3000)
    } catch (e: unknown) {
      setContribMsg(prev => ({ ...prev, [goal.id]: (e as Error).message ?? 'Error' }))
    } finally {
      setContributing(null)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-[14px] text-[var(--color-text-muted)]">Loading goals…</div>
  }

  if (err) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-[14px] text-red-600">{err}</p>
        <button onClick={load} className="text-[13px] text-[var(--brand-primary)] underline">Retry</button>
      </div>
    )
  }

  if (goals.length === 0) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-[28px]">🌱</p>
        <p className="text-[15px] font-semibold text-[var(--color-text)]">{child.display_name} has no active goals</p>
        <p className="text-[13px] text-[var(--color-text-muted)]">They can plant a goal from their Savings Grove.</p>
      </div>
    )
  }

  const currency = goals[0]?.currency ?? 'GBP'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[16px] font-bold text-[var(--color-text)]">🌳 {child.display_name}'s Savings Grove</h2>
        <span className="text-[12px] text-[var(--color-text-muted)]">— {goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
      </div>

      {goals.map(goal => {
        const effTarget = effectiveTarget(goal)
        const saved     = goal.current_saved_pence ?? 0
        const pct       = Math.min(100, Math.round((saved / goal.target_amount) * 100))
        const isSaving  = saving === goal.id
        const isContrib = contributing === goal.id
        const msg       = contribMsg[goal.id]

        return (
          <div
            key={goal.id}
            className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden"
          >
            {/* Goal header */}
            <div className="px-4 pt-4 pb-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-[14px] font-bold text-[var(--color-text)]">{goal.title}</p>
                  {goal.category && (
                    <span className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
                      {goal.category}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text)] tabular-nums">{formatCurrency(goal.target_amount, currency)}</p>
                  {goal.deadline && (
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      by {new Date(goal.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>

              {/* Product URL */}
              {goal.product_url && (
                <a
                  href={goal.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--brand-primary)] underline underline-offset-2 hover:opacity-80"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  Vet this item
                </a>
              )}

              {/* Progress */}
              <div className="space-y-1">
                <div className="w-full h-3 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--brand-primary)] rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(saved, currency)} saved</span>
                  <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{pct}%</span>
                </div>
              </div>
            </div>

            {/* Parental Match */}
            <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-2">
              <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Parental Match</p>
              <div className="flex flex-wrap gap-2">
                {MATCH_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => handleMatchChange(goal, opt)}
                    disabled={isSaving}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                      goal.parent_match_pct === opt
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)]'
                    }`}
                  >
                    {opt === 0 ? 'None' : `${opt}%`}
                  </button>
                ))}
              </div>
              {goal.parent_match_pct > 0 && (
                <p className="text-[11px] text-emerald-600 font-semibold">
                  🤝 {child.display_name} only needs to earn {formatCurrency(effTarget, currency)} — you'll top up the rest!
                </p>
              )}
            </div>

            {/* One-time contribution */}
            <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-2">
              <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Gift a contribution</p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--color-text-muted)]">
                    {currencySymbol(currency)}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={contribAmt[goal.id] ?? ''}
                    onChange={e => setContribAmt(prev => ({ ...prev, [goal.id]: e.target.value }))}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] pl-7 pr-3 py-2 text-[13px] tabular-nums text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  />
                </div>
                <button
                  onClick={() => handleContribute(goal)}
                  disabled={isContrib || !contribAmt[goal.id]}
                  className="shrink-0 rounded-xl bg-emerald-500 text-white font-bold px-4 py-2 text-[13px] hover:bg-emerald-600 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isContrib ? '…' : 'Gift'}
                </button>
              </div>
              {msg && (
                <p className={`text-[12px] font-semibold ${msg.startsWith('+') ? 'text-emerald-600' : 'text-red-600'}`}>
                  {msg}
                </p>
              )}
              {goal.parent_fixed_contribution > 0 && (
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Total gifted: {formatCurrency(goal.parent_fixed_contribution, currency)}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
