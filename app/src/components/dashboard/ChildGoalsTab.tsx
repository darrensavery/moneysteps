import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { tick } from '../../lib/haptics'
import type { BalanceSummary, Goal, Chore, ChildNudge } from '../../lib/api'
import { getBalance, getGoals, getChores, purchaseGoal, deleteGoal, formatCurrency, effectiveTarget } from '../../lib/api'
import { ChildNudgeBanner } from '../child/ChildNudgeBanner'
import { GrowingTree } from '../ui/GrowingTree'
import { SavingsGrove } from './SavingsGrove'
import { Button } from '../ui/button'

interface Props {
  familyId:        string
  childId:         string
  currency:        string
  appView:         'ORCHARD' | 'CLEAN'
  nudge?:          ChildNudge | null
  onNudgeDismiss?: () => void
}

export function ChildGoalsTab({ familyId, childId, currency, appView, nudge, onNudgeDismiss }: Props) {
  const [balance,  setBalance]  = useState<BalanceSummary | null>(null)
  const [goals,    setGoals]    = useState<Goal[]>([])
  const [chores,   setChores]   = useState<Chore[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showGrove, setShowGrove] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [goalBarPct, setGoalBarPct] = useState(0)
  const barTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // `silent` skips the loading swap AND the bar reset-to-zero animation, so
  // background polls update data in place rather than visibly "refreshing"
  // (the progress bar would otherwise snap to 0 and re-fill every 30s).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [b, g, c] = await Promise.all([
        getBalance(familyId, childId),
        getGoals(familyId, childId).then(r => r.goals).catch(() => [] as Goal[]),
        getChores({ family_id: familyId, child_id: childId }).then(r => r.chores).catch(() => [] as Chore[]),
      ])
      setBalance(b)
      setGoals(g)
      setChores(c)
      const top = g.filter(x => x.status === 'ACTIVE' || !x.status)[0]
      if (top) {
        const eff = effectiveTarget(top)
        // BUG-026 fix: when jars are enabled the purchase draws from the Save jar,
        // so progress should show Save balance — not total available (which includes Spend/Give).
        const progressBalance = (b.jars?.enabled && b.jars.save != null) ? b.jars.save : (b.available ?? 0)
        const pct = Math.min(100, Math.round((progressBalance / eff) * 100))
        if (silent) {
          // Update in place — CSS transition handles any change smoothly.
          setGoalBarPct(pct)
        } else {
          // Initial / user-triggered load: play the fill-from-zero animation.
          if (barTimer.current) clearTimeout(barTimer.current)
          setGoalBarPct(0)
          barTimer.current = setTimeout(() => setGoalBarPct(pct), 80)
        }
      }
    } catch { /* silently degrade */ }
    finally { setLoading(false) }
  }, [familyId, childId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const weeklyAllowancePence = useMemo(() => chores.reduce((sum, c) => {
    if (c.frequency === 'weekly') return sum + c.reward_amount
    if (c.frequency === 'daily' || c.frequency === 'school_days') return sum + c.reward_amount * 5
    return sum
  }, 0), [chores])

  const bestChore = useMemo(() => {
    const active = chores.filter(c => !c.archived)
    if (!active.length) return null
    return active.reduce((a, b) => a.reward_amount >= b.reward_amount ? a : b)
  }, [chores])

  function effortLabel(targetPence: number): string {
    if (bestChore && bestChore.reward_amount > 0) {
      const n = Math.ceil(targetPence / bestChore.reward_amount)
      return `${n} × ${bestChore.title}`
    }
    if (weeklyAllowancePence > 0) {
      const weeks = Math.ceil(targetPence / weeklyAllowancePence)
      return `${weeks} week${weeks !== 1 ? 's' : ''} of saving`
    }
    return formatCurrency(targetPence, currency)
  }

  async function handlePurchase(goalId: string) {
    void tick()
    setPurchasing(goalId)
    try {
      await purchaseGoal(goalId)
      await load()
    } finally {
      setPurchasing(null)
    }
  }

  async function handleDelete(goalId: string, goalTitle: string) {
    if (!confirm(`Stop saving for "${goalTitle}"? Any money you've saved goes back to your balance.`)) return
    void tick()
    setDeleting(goalId)
    try {
      await deleteGoal(goalId)
      await load()
    } finally {
      setDeleting(null)
    }
  }

  const activeGoals   = goals.filter(g => g.status === 'ACTIVE' || !g.status)
  const activeTopGoal = activeGoals[0] ?? null
  const cur = currency

  if (loading && goals.length === 0) return (
    <div className="py-16 text-center text-[0.875rem] text-[var(--color-text-muted)]">Loading…</div>
  )

  return (
    <div className="space-y-4 pb-28">
      {/* AI Mentor goals nudge */}
      {nudge && onNudgeDismiss && (
        <ChildNudgeBanner nudge={nudge} appView={appView} onDismiss={onNudgeDismiss} />
      )}

      <div className="bg-[var(--color-surface)] rounded-2xl card-depth border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-text)]">{appView === 'CLEAN' ? 'My Goals' : '🎯 My Goals'}</h2>
        </div>

        {activeGoals.length === 0 ? (
          <div className="px-4 pb-5 text-center flex flex-col items-center">
            <GrowingTree pct={0} size={64} showLabel className="mb-1" />
            <p className="text-[0.8125rem] font-semibold text-[var(--color-text)]">No goals yet</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">Tap "Add Goal" to start saving for something exciting!</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {activeTopGoal && (() => {
              const avail = balance?.available ?? 0
              const effTarget = effectiveTarget(activeTopGoal)
              const pct = Math.min(100, Math.round((avail / effTarget) * 100))
              const remaining = Math.max(0, effTarget - avail)
              const isReady = avail >= effTarget

              const weeklyIncome = weeklyAllowancePence || (bestChore ? bestChore.reward_amount * 4 : 0)
              const weeksLeft = weeklyIncome > 0 && remaining > 0
                ? Math.ceil(remaining / weeklyIncome)
                : null
              const arrivalDate = weeksLeft
                ? new Date(Date.now() + weeksLeft * 7 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : null

              const daysOverdue = activeTopGoal.deadline
                ? Math.floor((Date.now() - new Date(activeTopGoal.deadline).getTime()) / 86_400_000)
                : -1
              const isOverdue = daysOverdue >= 0

              return (
                <div className="px-4 py-4 space-y-3">
                  <div className="flex items-center gap-4">
                    <GrowingTree pct={pct} size={72} showLabel />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate">{activeTopGoal.title}</span>
                        <button
                          onClick={() => setEditingGoal(activeTopGoal)}
                          aria-label={`Edit ${activeTopGoal.title}`}
                          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer p-1 -m-1"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/>
                          </svg>
                        </button>
                      </div>
                      {activeTopGoal.parent_match_pct > 0 && (
                        <div className="text-[0.6875rem] text-emerald-600 font-semibold mt-0.5">
                          🤝 Parent matches {activeTopGoal.parent_match_pct}% — you only need {formatCurrency(effTarget, cur)}!
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    {/* Zeigarnik nudge: an almost-finished goal pulses gently so the
                        near-complete state keeps nagging for attention, same ring
                        animation already used for badges. */}
                    <div className={`w-full h-4 bg-[var(--color-surface-alt)] rounded-full overflow-hidden ${pct >= 80 && !isReady ? 'badge-ring-pulse' : ''}`}>
                      <div
                        className="h-full bg-[var(--brand-primary)] rounded-full progress-fill-glow"
                        style={{ width: `${goalBarPct}%`, transition: 'width 1.1s cubic-bezier(0.25, 1, 0.5, 1)' }}
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">{formatCurrency(avail, cur)} saved</span>
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">{pct}% • {formatCurrency(effTarget, cur)}</span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3.5 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-[0.75rem]">
                      <span>💪</span>
                      <span className="text-[var(--color-text-muted)]">Total cost:</span>
                      <span className="font-semibold text-[var(--color-text)]">{effortLabel(activeTopGoal.target_amount)}</span>
                    </div>
                    {remaining > 0 && (
                      <div className="flex items-center gap-2 text-[0.75rem]">
                        <span>{appView === 'CLEAN' ? '💸' : '🌿'}</span>
                        <span className="text-[var(--color-text-muted)]">Still need:</span>
                        <span className="font-semibold text-[var(--color-text)]">{effortLabel(remaining)}</span>
                      </div>
                    )}
                    {arrivalDate && (
                      <div className="flex items-center gap-2 text-[0.75rem]">
                        <span>📅</span>
                        <span className="text-[var(--color-text-muted)]">Estimated arrival:</span>
                        <span className="font-semibold text-[var(--brand-accent)]">{arrivalDate}</span>
                      </div>
                    )}
                    {activeTopGoal.deadline && (
                      isOverdue ? (
                        <div className="flex items-center gap-2 text-[0.75rem]">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
                            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
                          </svg>
                          <span className="text-amber-600 font-semibold">
                            {daysOverdue === 0 ? "You planned to save by today" : `You planned to save by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} ago`}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[0.75rem]">
                          <span>🗓️</span>
                          <span className="text-[var(--color-text-muted)]">Save by:</span>
                          <span className="font-semibold text-[var(--color-text)]">
                            {new Date(activeTopGoal.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                      )
                    )}
                  </div>

                  {isReady && (
                    <button
                      onClick={() => handlePurchase(activeTopGoal.id)}
                      disabled={purchasing === activeTopGoal.id}
                      className="w-full rounded-xl bg-emerald-500 text-white font-bold py-2.5 text-[0.8125rem] hover:bg-emerald-600 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {purchasing === activeTopGoal.id
                        ? (appView === 'CLEAN' ? 'Saving…' : '🎉 Saving…')
                        : (appView === 'CLEAN' ? 'Mark as Purchased!' : '🎉 Mark as Purchased!')}
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(activeTopGoal.id, activeTopGoal.title)}
                    disabled={deleting === activeTopGoal.id}
                    className="w-full text-center text-[0.6875rem] font-semibold text-[var(--color-text-muted)] hover:text-red-500 disabled:opacity-60 transition-colors cursor-pointer py-1"
                  >
                    {deleting === activeTopGoal.id ? 'Removing…' : 'Stop saving for this'}
                  </button>
                </div>
              )
            })()}

            {activeGoals.length > 1 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">All goals — effort comparison</p>
                <div className="grid grid-cols-1 gap-2">
                  {activeGoals.map((g, i) => (
                    <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${i === 0 ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)]' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
                      <span className="text-base">{i === 0 ? '🎯' : '⭕'}</span>
                      <span className="flex-1 text-[0.75rem] font-semibold text-[var(--color-text)] truncate">{g.title}</span>
                      <span className="text-[0.6875rem] text-[var(--color-text-muted)] shrink-0">{effortLabel(g.target_amount)}</span>
                      <button
                        onClick={() => setEditingGoal(g)}
                        aria-label={`Edit ${g.title}`}
                        className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer px-1"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(g.id, g.title)}
                        disabled={deleting === g.id}
                        aria-label={`Stop saving for ${g.title}`}
                        className="shrink-0 text-[var(--color-text-muted)] hover:text-red-500 disabled:opacity-60 transition-colors cursor-pointer px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add goal — fixed above bottom nav dock */}
      <div className="fixed bottom-0 inset-x-0 z-20 flex justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[520px] mx-3"
          style={{ marginBottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 68px)' }}
        >
          <Button onClick={() => setShowGrove(true)} className="w-full shadow-lg">
            {appView === 'CLEAN' ? '+ Add Goal' : '🎯 Add Goal'}
          </Button>
        </div>
      </div>

      {(showGrove || editingGoal) && (
        <SavingsGrove
          familyId={familyId}
          childId={childId}
          currency={cur}
          chores={chores}
          appView={appView}
          weeklyAllowancePence={weeklyAllowancePence}
          goal={editingGoal}
          onCreated={() => { setShowGrove(false); setEditingGoal(null); load() }}
          onClose={() => { setShowGrove(false); setEditingGoal(null) }}
        />
      )}
    </div>
  )
}
