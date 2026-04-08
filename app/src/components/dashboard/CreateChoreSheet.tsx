/**
 * CreateChoreSheet — bottom-sheet for creating a new chore.
 *
 * Features:
 *  - Quick-pick reward amounts (50p, £1, £2, £5)
 *  - Frequency picker + weekly day selector
 *  - Optional due date
 *  - Collapsed description expander ("Detailed instructions")
 *  - Integrity toggles: Require Proof / Auto-approve
 *  - Uses family currency (passed from parent, defaults GBP)
 */

import { useState, useRef, useEffect } from 'react'
import type { ChildRecord } from '../../lib/api'
import { createChore } from '../../lib/api'

interface Props {
  familyId: string
  child: ChildRecord
  currency: string          // 'GBP' | 'PLN'
  onCreated: () => void
  onClose: () => void
}

interface Form {
  title: string
  reward_amount: string
  frequency: string
  weekly_day: number
  description: string
  due_date: string
  proof_required: boolean
  auto_approve: boolean
}

const BLANK: Form = {
  title: '', reward_amount: '', frequency: 'as_needed', weekly_day: 1,
  description: '', due_date: '', proof_required: false, auto_approve: false,
}

const FREQUENCY_OPTIONS = [
  { label: 'One-off',     value: 'as_needed',   recurring: false },
  { label: 'Daily',       value: 'daily',        recurring: true  },
  { label: 'Weekly',      value: 'weekly',       recurring: true  },
  { label: 'Fortnightly', value: 'bi_weekly',    recurring: true  },
  { label: 'Monthly',     value: 'monthly',      recurring: true  },
  { label: 'School days', value: 'school_days',  recurring: true  },
]

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Quick-pick amounts per currency (in pence / groszy)
const QUICK_AMOUNTS: Record<string, { label: string; value: number }[]> = {
  GBP: [
    { label: '50p', value: 50   },
    { label: '£1',  value: 100  },
    { label: '£2',  value: 200  },
    { label: '£5',  value: 500  },
  ],
  PLN: [
    { label: '1 zł',  value: 100  },
    { label: '2 zł',  value: 200  },
    { label: '5 zł',  value: 500  },
    { label: '10 zł', value: 1000 },
  ],
}

function currencySymbol(c: string) { return c === 'PLN' ? 'zł' : '£' }

export function CreateChoreSheet({ familyId, child, currency, onCreated, onClose }: Props) {
  const [form, setForm]             = useState<Form>(BLANK)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showDesc, setShowDesc]     = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const quickAmounts = QUICK_AMOUNTS[currency] ?? QUICK_AMOUNTS.GBP
  const sym = currencySymbol(currency)

  // Focus title on open
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [])

  function setField<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function pickQuick(pence: number) {
    setField('reward_amount', (pence / 100).toFixed(2))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.reward_amount) return
    setSaving(true)
    setError(null)
    try {
      // For weekly chores, encode the chosen day as due_date sentinel
      const weeklyDay = form.frequency === 'weekly' ? String(form.weekly_day) : undefined
      await createChore({
        family_id: familyId,
        assigned_to: child.id,
        title: form.title.trim(),
        reward_amount: Math.round(parseFloat(form.reward_amount) * 100),
        currency,
        frequency: form.frequency,
        description: form.description.trim() || undefined,
        due_date: weeklyDay ?? (form.due_date || undefined),
        proof_required: form.proof_required,
        auto_approve: form.auto_approve,
      } as Parameters<typeof createChore>[0])
      onCreated()
    } catch (err: unknown) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-[var(--color-surface)] rounded-t-3xl shadow-2xl max-w-[560px] w-full mx-auto flex flex-col max-h-[92svh]">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="px-5 pt-2 pb-4 flex items-center justify-between shrink-0 border-b border-[var(--color-border)]">
          <div>
            <p className="text-[18px] font-extrabold text-[var(--color-text)] tracking-tight leading-tight">
              New task
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">
              for <span className="font-semibold text-[var(--brand-primary)]">{child.display_name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-5 space-y-5">

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3">
              <p className="text-[13px] text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* ── Task title ─────────────────────────────────────── */}
          <div>
            <label className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">
              Task
            </label>
            <input
              ref={titleRef}
              className="w-full border border-[var(--color-border)] rounded-xl px-4 py-3 text-[15px] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
              placeholder="e.g. Organising the bookshelf"
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              required
            />
          </div>

          {/* ── Reward ─────────────────────────────────────────── */}
          <div>
            <label className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">
              Reward
            </label>

            {/* Quick-pick row */}
            <div className="flex gap-2 mb-2.5">
              {quickAmounts.map(q => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => pickQuick(q.value)}
                  className={`flex-1 py-2 rounded-xl text-[13px] font-bold border transition-all cursor-pointer
                    ${form.reward_amount === (q.value / 100).toFixed(2)
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* Custom amount input */}
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] font-bold text-[var(--color-text-muted)]">
                {sym}
              </span>
              <input
                className="w-full border border-[var(--color-border)] rounded-xl pl-9 pr-4 py-3 text-[15px] font-semibold tabular-nums bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
                placeholder="0.00"
                type="number"
                min="0.01"
                step="0.01"
                value={form.reward_amount}
                onChange={e => setField('reward_amount', e.target.value)}
                required
              />
            </div>
          </div>

          {/* ── Frequency ──────────────────────────────────────── */}
          <div>
            <label className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">
              Frequency
            </label>
            <div className="grid grid-cols-3 gap-2">
              {FREQUENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField('frequency', opt.value)}
                  className={`py-2.5 px-2 rounded-xl text-[12px] font-semibold border transition-all cursor-pointer text-center
                    ${form.frequency === opt.value
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Weekly day picker */}
            {form.frequency === 'weekly' && (
              <div className="mt-2.5">
                <p className="text-[11px] text-[var(--color-text-muted)] mb-1.5">Which day?</p>
                <div className="flex gap-1.5">
                  {DAYS_SHORT.map((day, i) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setField('weekly_day', i + 1)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer
                        ${form.weekly_day === i + 1
                          ? 'bg-[var(--brand-primary)] text-white'
                          : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:opacity-80'
                        }`}
                    >
                      {day[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Due date (optional, not shown for recurring) ───── */}
          {(form.frequency === 'as_needed') && (
            <div>
              <label className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 block">
                Due date <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="date"
                className="w-full border border-[var(--color-border)] rounded-xl px-4 py-3 text-[15px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
                value={form.due_date}
                onChange={e => setField('due_date', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          )}

          {/* ── Integrity toggles ───────────────────────────────── */}
          <div className="space-y-3">
            <label className="text-[12px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
              Integrity
            </label>

            {/* Require Proof */}
            <button
              type="button"
              onClick={() => setField('proof_required', !form.proof_required)}
              className={`w-full flex items-start gap-3.5 p-4 rounded-2xl border-2 text-left transition-all cursor-pointer
                ${form.proof_required
                  ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:border-[var(--color-text-muted)]'
                }`}
            >
              <span className="text-[22px] mt-0.5 shrink-0">📷</span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-[var(--color-text)]">Require proof</p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                  {child.display_name} must upload a photo before the task can be submitted.
                </p>
              </div>
              <TogglePill on={form.proof_required} />
            </button>

            {/* Auto-approve */}
            <button
              type="button"
              onClick={() => setField('auto_approve', !form.auto_approve)}
              className={`w-full flex items-start gap-3.5 p-4 rounded-2xl border-2 text-left transition-all cursor-pointer
                ${form.auto_approve
                  ? 'border-[var(--brand-accent)] bg-[color-mix(in_srgb,var(--brand-accent)_8%,transparent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:border-[var(--color-text-muted)]'
                }`}
            >
              <span className="text-[22px] mt-0.5 shrink-0">⚡</span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-[var(--color-text)]">Auto-approve</p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                  Trust-based: funds deposit immediately on completion — no review needed.
                </p>
              </div>
              <TogglePill on={form.auto_approve} accent />
            </button>
          </div>

          {/* ── Description expander ───────────────────────────── */}
          <div>
            <button
              type="button"
              onClick={() => setShowDesc(v => !v)}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
            >
              <span className={`inline-block transition-transform duration-150 ${showDesc ? 'rotate-90' : ''}`}>▶</span>
              {showDesc ? 'Hide' : 'Add'} detailed instructions
            </button>
            {showDesc && (
              <textarea
                className="mt-2 w-full border border-[var(--color-border)] rounded-xl px-4 py-3 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] resize-none transition"
                placeholder="Step-by-step instructions, standards expected, what good looks like…"
                rows={3}
                value={form.description}
                onChange={e => setField('description', e.target.value)}
              />
            )}
          </div>

          {/* bottom padding so last field clears the sticky CTA */}
          <div className="h-2" />
        </form>

        {/* Sticky CTA */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.reward_amount}
            className="w-full h-14 bg-[var(--brand-primary)] disabled:opacity-40 text-white font-bold text-[16px] rounded-2xl shadow-md hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <SpinnerIcon />
                Creating…
              </span>
            ) : (
              `Assign to ${child.display_name} →`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TogglePill({ on, accent = false }: { on: boolean; accent?: boolean }) {
  const activeColor = accent ? 'bg-[var(--brand-accent)]' : 'bg-[var(--brand-primary)]'
  return (
    <div
      className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative mt-0.5
        ${on ? activeColor : 'bg-[var(--color-border)]'}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
          ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </div>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  )
}
