/**
 * ChildNudgeBanner — inline AI Mentor coaching card for child-facing screens.
 *
 * Uses the PremiumShell design system (teal→gold animated border, dark surface)
 * to match the parent InsightsTab briefing card aesthetic.
 *
 * Text is selected by app_view:
 *   ORCHARD → nature metaphors, warm language (proxy for ≈8–12 yr olds)
 *   CLEAN   → direct financial language, peer-level honesty (proxy for 12+)
 *
 * Dismissed nudges are soft-deleted server-side (is_dismissed = 1).
 */

import { useEffect } from 'react'
import { injectPremiumStyles, PremiumShell, MentorAvatar, AiDisclosurePill } from '../ui/PremiumShell'
import { dismissChildNudge } from '../../lib/api'
import type { ChildNudge } from '../../lib/api'

const PILLAR_LABELS: Record<string, string> = {
  LABOR_VALUE:           'Labour & earning',
  DELAYED_GRATIFICATION: 'Patience & goals',
  OPPORTUNITY_COST:      'Smart choices',
  CAPITAL_MANAGEMENT:    'Growing money',
  SOCIAL_RESPONSIBILITY: 'Giving back',
}

// Celebratory nudges use gold; all others use teal.
function accentForTone(tone: string): string {
  return tone === 'celebratory' ? '#d4a017' : '#0d9488'
}

interface Props {
  nudge:     ChildNudge
  appView:   'ORCHARD' | 'CLEAN'
  onDismiss: () => void
}

export function ChildNudgeBanner({ nudge, appView, onDismiss }: Props) {
  useEffect(() => { injectPremiumStyles() }, [])

  const text        = appView === 'CLEAN' ? nudge.clean_text : nudge.orchard_text
  const accent      = accentForTone(nudge.tone)
  const pillarLabel = PILLAR_LABELS[nudge.pillar] ?? nudge.pillar

  async function handleDismiss() {
    onDismiss()                                           // optimistic UI removal
    dismissChildNudge(nudge.id).catch(() => {})           // best-effort server sync
  }

  return (
    <PremiumShell>
      <div className="relative px-4 pt-4 pb-3.5 z-10">

        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <MentorAvatar accent={accent} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[0.625rem] font-black uppercase tracking-wider" style={{ color: accent }}>
                Your Orchard Mentor
              </p>
              {nudge.source === 'ai' && <AiDisclosurePill />}
            </div>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: 'rgba(167,196,181,0.7)' }}>
              {pillarLabel}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss nudge"
            className="tap-target-44 shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 active:opacity-50 cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.07)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="#a7c4b5" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Nudge text */}
        <p className="text-[0.8125rem] leading-relaxed" style={{ color: '#e2f5ee' }}>
          {text}
        </p>

        {/* Attribution footer — the AI-generated distinction is now carried by the header pill above */}
        <p className="text-[0.625rem] mt-3 text-center" style={{ color: 'rgba(107,158,135,0.6)' }}>
          ✦ Your Orchard Mentor · Personalised coaching
        </p>

      </div>
    </PremiumShell>
  )
}
