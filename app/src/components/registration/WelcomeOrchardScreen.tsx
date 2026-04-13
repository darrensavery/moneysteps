/**
 * WelcomeOrchardScreen — shown after email verification (/auth/verify).
 *
 * High-conversion onboarding with two paths:
 *   1. "Add Your First Child" → inline form → success → dashboard
 *   2. "Skip to my Dashboard" → dashboard (empty state)
 *
 * Tone: Mentor / Orchard Lead. First-Person Plural ("We").
 * UK English. Max 1 nature emoji. No trial messaging here.
 */

import { useState } from 'react'
import { Sprout, ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addChild } from '@/lib/api'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { useTone } from '@/lib/useTone'

interface Props {
  displayName?: string
  onDone: () => void  // called when user reaches dashboard (add child or skip)
}

type Phase = 'welcome' | 'add-child' | 'success'
type EarningsMode = 'ALLOWANCE' | 'CHORES' | 'HYBRID'

interface NewChild {
  name: string
  openingBalance: string
  earningsMode: EarningsMode
}

export function WelcomeOrchardScreen({ displayName, onDone }: Props) {
  const { terminology } = useTone(0)  // parent view — no teen mode in registration
  const [phase,      setPhase]     = useState<Phase>('welcome')
  const [child,      setChild]     = useState<NewChild>({ name: '', openingBalance: '', earningsMode: 'HYBRID' })
  const [saving,     setSaving]    = useState(false)
  const [addAnother, setAddAnother] = useState(false)
  const [error,      setError]     = useState('')
  const [inviteCode, setInviteCode] = useState('')

  const firstName = displayName?.split(' ')[0] ?? 'there'

  function handleSkip() {
    track.onboardingChoiceMade({ choice: 'skip_to_dash' })
    onDone()
  }

  function handleAddChildClick() {
    track.onboardingChoiceMade({ choice: 'add_child' })
    setPhase('add-child')
  }

  async function handleSubmitChild(goToDash: boolean) {
    const name = child.name.trim()
    if (!name) { setError('Please enter a name.'); return }

    const balancePounds = parseFloat(child.openingBalance || '0')
    if (isNaN(balancePounds) || balancePounds < 0) {
      setError('Opening balance must be 0 or more.')
      return
    }
    const opening_balance_pence = Math.round(balancePounds * 100)

    setError('')
    setSaving(true)
    setAddAnother(!goToDash)
    try {
      const result = await addChild(name, child.earningsMode, opening_balance_pence)
      setInviteCode(result.invite_code)
      track.firstChildAdded({ age: 0, has_opening_balance: opening_balance_pence > 0 })
      localStorage.setItem('mc_first_child_added', '1')
      if (goToDash) {
        setPhase('success')
      } else {
        // Reset form for another child
        setChild({ name: '', openingBalance: '', earningsMode: 'HYBRID' })
        setError('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
      setAddAnother(false)
    }
  }

  if (phase === 'welcome') {
    return (
      <div className="space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3 pt-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-3xl bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] border-2 border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] flex items-center justify-center">
              <Sprout size={28} className="text-[var(--brand-primary)]" />
            </div>
          </div>
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--color-text)] leading-tight">
              Welcome to the Orchard,<br />{firstName}!
            </h1>
            <p className="text-[15px] text-[var(--color-text-muted)] mt-2 leading-relaxed max-w-xs mx-auto">
              We're glad you're here. The first seed to plant is adding your child — so we can help you both grow together.
            </p>
          </div>
        </div>

        {/* Mentor card */}
        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5 space-y-3">
          <p className="text-[13px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            From your Orchard Lead 🌱
          </p>
          <p className="text-[14px] text-[var(--color-text)] leading-relaxed">
            "Once we know who's in your Orchard, we can set up their first chore, savings goal, and harvest schedule. Everything starts here."
          </p>
        </div>

        {/* CTAs */}
        <div className="space-y-3 pb-4">
          <Button
            className="w-full h-13 text-[15px] font-semibold gap-2"
            onClick={handleAddChildClick}
          >
            Add Your First Child
            <ChevronRight size={16} />
          </Button>
          <button
            onClick={handleSkip}
            className="w-full text-[13px] text-[var(--color-text-muted)] py-2 hover:text-[var(--color-text)] transition-colors"
          >
            Skip to my Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'add-child') {
    const childFirstName = child.name.trim().split(' ')[0] || 'they'

    return (
      <div className="space-y-6">
        {/* Back + title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setPhase('welcome'); setError('') }}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[var(--color-text)]">Add a Child</h2>
            <p className="text-[13px] text-[var(--color-text-muted)]">We'll set up their Orchard profile.</p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-[var(--color-text)]">
              Name <span className="text-[var(--brand-primary)]">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Logan"
              value={child.name}
              onChange={e => setChild(c => ({ ...c, name: e.target.value }))}
              className="w-full h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>

          {/* Earnings mode */}
          <div className="space-y-2">
            <label className="text-[13px] font-semibold text-[var(--color-text)]">
              How will {childFirstName} receive {terminology.money}?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'ALLOWANCE', label: 'Allowance only' },
                { value: 'CHORES',    label: 'Chores only' },
                { value: 'HYBRID',    label: 'Both' },
              ] as { value: EarningsMode; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setChild(c => ({ ...c, earningsMode: opt.value }))}
                  className={cn(
                    'rounded-xl border-2 px-3 py-3 text-[12px] font-semibold text-center transition-all cursor-pointer leading-tight',
                    child.earningsMode === opt.value
                      ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)]/50',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opening balance */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-[var(--color-text)]">
              Opening Balance <span className="text-[var(--color-text-muted)] font-normal">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)] select-none">£</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={child.openingBalance}
                onChange={e => setChild(c => ({ ...c, openingBalance: e.target.value }))}
                className="w-full h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              />
            </div>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Any money they already have — logged as their first ledger entry.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-[13px] font-medium text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <Button
            className="w-full h-12 text-[15px] font-semibold"
            onClick={() => handleSubmitChild(true)}
            disabled={saving || !child.name.trim()}
          >
            {saving && !addAnother ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating…
              </span>
            ) : (
              <>Create + go to dashboard <ChevronRight size={16} /></>
            )}
          </Button>

          <button
            type="button"
            onClick={() => handleSubmitChild(false)}
            disabled={saving || !child.name.trim()}
            className="w-full h-11 rounded-xl border-2 border-[var(--color-border)] text-[14px] font-semibold text-[var(--color-text)] hover:border-[var(--brand-primary)]/50 hover:bg-[var(--color-surface-alt)] transition-all cursor-pointer disabled:opacity-50"
          >
            {saving && addAnother ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Saving…
              </span>
            ) : (
              'Add another child'
            )}
          </button>
        </div>
      </div>
    )
  }

  // phase === 'success'
  return (
    <div className="space-y-6 text-center pt-4">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-3xl bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] border-2 border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] flex items-center justify-center text-3xl">
          🍎
        </div>
        <div>
          <h2 className="text-[24px] font-extrabold tracking-tight text-[var(--color-text)]">
            {child.name}'s Orchard is ready!
          </h2>
          <p className="text-[14px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed max-w-xs mx-auto">
            We've planted the first seed. Share this code with {child.name} so they can join on their device.
          </p>
        </div>
      </div>

      {/* Invite code */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-5 py-5 space-y-2">
        <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          {child.name}'s Join Code
        </p>
        <p className="text-[36px] font-extrabold tracking-[0.15em] text-[var(--brand-primary)] tabular-nums select-all">
          {inviteCode}
        </p>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Valid for 7 days — they'll enter this at app.morechard.com/join
        </p>
      </div>

      <Button className="w-full h-12 text-[15px] font-semibold" onClick={onDone}>
        Go to my Dashboard
        <ChevronRight size={16} />
      </Button>
    </div>
  )
}
