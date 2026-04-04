import { useState, useEffect, useCallback } from 'react'
import type { BalanceSummary, Goal, ChildRecord } from '../../lib/api'
import {
  getBalance, getGoals, createGoal, updateGoal, deleteGoal, formatCurrency,
} from '../../lib/api'

interface Props {
  familyId: string
  child: ChildRecord
}

const GOAL_CATEGORIES = ['General', 'Toy', 'Game', 'Trip', 'Clothing', 'Tech', 'Other']

export function InsightsTab({ familyId, child }: Props) {
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [goals, setGoals]     = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  // Goal form
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [editGoal, setEditGoal]         = useState<Goal | null>(null)
  const [goalTitle, setGoalTitle]       = useState('')
  const [goalAmount, setGoalAmount]     = useState('')
  const [goalCategory, setGoalCategory] = useState('General')
  const [goalDeadline, setGoalDeadline] = useState('')
  const [goalMatchRate, setGoalMatchRate] = useState('0')
  const [savingGoal, setSavingGoal]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [b, g] = await Promise.all([
      getBalance(familyId, child.id),
      getGoals(familyId, child.id).then(r => r.goals.filter(g => !g.archived)),
    ])
    setBalance(b)
    setGoals(g)
    setLoading(false)
  }, [familyId, child.id])

  useEffect(() => { load() }, [load])

  function openNewGoal() {
    setEditGoal(null)
    setGoalTitle('')
    setGoalAmount('')
    setGoalCategory('General')
    setGoalDeadline('')
    setGoalMatchRate('0')
    setShowGoalForm(true)
  }

  function openEditGoal(goal: Goal) {
    setEditGoal(goal)
    setGoalTitle(goal.title)
    setGoalAmount((goal.target_amount / 100).toFixed(2))
    setGoalCategory(goal.category)
    setGoalDeadline(goal.deadline ?? '')
    setGoalMatchRate(String(goal.match_rate ?? 0))
    setShowGoalForm(true)
  }

  async function handleSaveGoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!goalTitle.trim() || !goalAmount) return
    setSavingGoal(true)
    try {
      const body = {
        title: goalTitle.trim(),
        target_amount: Math.round(parseFloat(goalAmount) * 100),
        currency: 'GBP',
        category: goalCategory,
        deadline: goalDeadline || null,
        match_rate: parseFloat(goalMatchRate) || 0,
        family_id: familyId,
        child_id: child.id,
      }
      if (editGoal) {
        await updateGoal(editGoal.id, body)
      } else {
        await createGoal(body)
      }
      setShowGoalForm(false)
      await load()
    } finally {
      setSavingGoal(false)
    }
  }

  async function handleDeleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return
    await deleteGoal(id)
    await load()
  }

  if (loading) return <div className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</div>

  return (
    <div className="space-y-4">
      {/* Balance card */}
      {balance && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
          <p className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Balance</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[36px] font-extrabold text-[var(--color-text)] tabular-nums leading-none">
              {formatCurrency(balance.available, 'GBP')}
            </span>
            <span className="text-[14px] text-[var(--color-text-muted)]">available</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <Stat label="Earned"    value={formatCurrency(balance.earned,    'GBP')} color="text-green-700" />
            <Stat label="Pending"   value={formatCurrency(balance.pending,   'GBP')} color="text-amber-700" />
            <Stat label="Paid out"  value={formatCurrency(balance.paid_out,  'GBP')} color="text-[var(--color-text-muted)]" />
            <Stat label="Reversals" value={formatCurrency(balance.reversals, 'GBP')} color="text-red-600" />
          </div>
        </div>
      )}

      {/* Goals */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[15px] font-bold text-[var(--color-text)]">Savings goals</p>
          <button
            onClick={openNewGoal}
            className="text-[13px] font-semibold text-[var(--brand-primary)] hover:underline cursor-pointer"
          >
            + New goal
          </button>
        </div>

        {goals.length === 0 && !showGoalForm && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 text-center">
            <p className="text-[14px] text-[var(--color-text-muted)]">No goals set yet.</p>
          </div>
        )}

        <div className="space-y-2.5">
          {goals.map(goal => {
            const saved = balance ? Math.min(balance.available, goal.target_amount) : 0
            const pct = goal.target_amount > 0 ? Math.min(100, Math.round((saved / goal.target_amount) * 100)) : 0
            return (
              <div key={goal.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-[var(--color-text)]">{goal.title}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)]">{goal.category}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[15px] font-bold tabular-nums text-[var(--color-text)]">{formatCurrency(goal.target_amount, goal.currency)}</p>
                    {goal.deadline && (
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        by {new Date(goal.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="h-3 bg-[var(--color-surface-alt)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--brand-primary)] rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
                    <span>{pct}% saved</span>
                    {goal.match_rate > 0 && (
                      <span className="text-[var(--brand-primary)] font-semibold">+{goal.match_rate}% match</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => openEditGoal(goal)} className="text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">Edit</button>
                  <button onClick={() => handleDeleteGoal(goal.id)} className="text-[12px] font-semibold text-red-500 hover:text-red-700 cursor-pointer">Delete</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Goal form */}
        {showGoalForm && (
          <form onSubmit={handleSaveGoal} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 space-y-3 mt-2.5">
            <p className="text-[15px] font-bold text-[var(--color-text)]">{editGoal ? 'Edit goal' : 'New goal'}</p>
            <input
              required
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              placeholder="Goal title"
              value={goalTitle}
              onChange={e => setGoalTitle(e.target.value)}
            />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">£</span>
                <input
                  required type="number" min="0.01" step="0.01"
                  className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  placeholder="Target"
                  value={goalAmount}
                  onChange={e => setGoalAmount(e.target.value)}
                />
              </div>
              <select
                className="border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                value={goalCategory}
                onChange={e => setGoalCategory(e.target.value)}
              >
                {GOAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[12px] text-[var(--color-text-muted)] block mb-1">Deadline (optional)</label>
                <input
                  type="date"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  value={goalDeadline}
                  onChange={e => setGoalDeadline(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="text-[12px] text-[var(--color-text-muted)] block mb-1">Parent match %</label>
                <input
                  type="number" min="0" max="100" step="1"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  value={goalMatchRate}
                  onChange={e => setGoalMatchRate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowGoalForm(false)} className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer">Cancel</button>
              <button type="submit" disabled={savingGoal} className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer">
                {savingGoal ? 'Saving…' : editGoal ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[var(--color-surface-alt)] rounded-lg px-3 py-2">
      <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
      <p className={`text-[14px] font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
