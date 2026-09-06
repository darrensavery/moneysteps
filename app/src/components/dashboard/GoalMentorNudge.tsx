/**
 * GoalMentorNudge — per-goal AI Mentor nudge card rendered inside GoalBoostingTab.
 * Only mounted when has_ai_mentor === true.
 *
 * Shows two nudges (stacked, no separator):
 *  1. Velocity nudge — deadline gap / on-track signal
 *  2. Pillar-grounded behavioural observation
 */

import { useEffect } from 'react'
import type { Goal } from '../../lib/api'
import { effectiveTarget, formatCurrency } from '../../lib/api'
import { PremiumShell, MentorAvatar, ProBadge, injectPremiumStyles } from '../ui/PremiumShell'

interface Props {
  goal:      Goal
  childName: string
}

// ── Velocity nudge ──────────────────────────────────────────────────────────

function velocityNudge(goal: Goal, currency: string): string | null {
  if (!goal.deadline) return null

  const daysRemaining = Math.floor(
    (new Date(goal.deadline).getTime() - Date.now()) / 86_400_000,
  )
  if (daysRemaining <= 0) return null

  const effTarget  = effectiveTarget(goal)
  if (effTarget <= 0) return null
  const saved      = goal.current_saved_pence ?? 0
  const gapPence   = effTarget - saved
  const pct        = Math.min(100, Math.round((saved / effTarget) * 100))

  if (pct >= 75 || (daysRemaining > 90 && pct > 25)) {
    const daysLabel = daysRemaining === 1 ? '1 day' : `${daysRemaining} days`
    return `On track — ${formatCurrency(gapPence, currency)} to go with ${daysLabel} remaining.`
  }

  if (daysRemaining <= 90 && pct < 50) {
    const weeksRemaining = daysRemaining / 7
    const requiredPerWeek = Math.ceil(gapPence / weeksRemaining)
    return `We've spotted a gap. Earning ${formatCurrency(requiredPerWeek, currency)} a week would close it in time — a ${goal.parent_match_pct > 0 ? 'match boost' : 'one-time gift'} could help.`
  }

  return null
}

// ── Pillar nudge ────────────────────────────────────────────────────────────

function pillarNudge(goal: Goal, childName: string): string | null {
  const saved = goal.current_saved_pence ?? 0
  if (saved === 0) return null

  const effTarget = effectiveTarget(goal)
  const pct       = Math.min(100, Math.round((saved / effTarget) * 100))

  if (pct < 25) {
    return `Every task completed gets ${childName} closer — the effort is real, even when the bar feels slow to move.`
  }
  if (pct < 75) {
    return `${childName} is in the longest part of the wait. This is where the habit forms — consistent saving over easy spending.`
  }
  if (pct < 100) {
    return `${childName}'s close. Every small purchase they skip now is a direct vote for this goal.`
  }
  if (goal.parent_match_pct > 0) {
    return `Your ${goal.parent_match_pct}% match is teaching ${childName} that capital can multiply effort — a foundation for understanding growth.`
  }
  if (goal.parent_fixed_contribution > 0) {
    return `Your direct contribution shows ${childName} that generosity and support are part of how healthy finances work.`
  }

  return null
}

// ── Component ───────────────────────────────────────────────────────────────

export function GoalMentorNudge({ goal, childName }: Props) {
  useEffect(() => { injectPremiumStyles() }, [])

  const currency = goal.currency ?? 'GBP'
  const velocity = velocityNudge(goal, currency)
  const pillar   = pillarNudge(goal, childName)

  if (!velocity && !pillar) return null

  return (
    <PremiumShell>
      <div className="px-4 pt-4 pb-3 relative z-10">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <MentorAvatar />
            <span
              className="text-[0.625rem] font-bold tracking-widest uppercase"
              style={{ color: '#9ca3af' }}
            >
              Orchard Mentor
            </span>
          </div>
          <ProBadge />
        </div>

        {/* Velocity nudge */}
        {velocity && (
          <p className="text-[0.8125rem] leading-relaxed mb-2" style={{ color: '#a7c4b5' }}>
            {velocity}
          </p>
        )}

        {/* Pillar nudge — dimmer, smaller */}
        {pillar && (
          <p className="text-[0.75rem] leading-relaxed" style={{ color: '#6b9e87' }}>
            {pillar}
          </p>
        )}

      </div>
    </PremiumShell>
  )
}
