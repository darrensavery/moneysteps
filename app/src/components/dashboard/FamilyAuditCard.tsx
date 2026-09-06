// app/src/components/dashboard/FamilyAuditCard.tsx
//
// Monthly, family-wide AI rollup card — sits above the per-child Insights
// dashboard. Fetched once per InsightsTab mount (family-scoped, not
// re-fetched when the parent switches the selected child).

import { useEffect, useState } from 'react'
import { getFamilyAudit } from '../../lib/api'
import type { FamilyAuditData } from '../../lib/api'
import { PremiumShell, MentorAvatar, ProBadge, AiDisclosurePill, injectPremiumStyles } from '../ui/PremiumShell'

interface Props {
  familyId: string
}

const STAT_LABELS = [
  { key: 'total_earned_pence', label: 'Earned' },
  { key: 'total_spent_pence',  label: 'Spent'  },
  { key: 'total_saved_pence',  label: 'Saved'  },
  { key: 'total_given_pence',  label: 'Given'  },
] as const

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}

export function FamilyAuditCard({ familyId }: Props) {
  const [data, setData]       = useState<FamilyAuditData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { injectPremiumStyles() }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getFamilyAudit(familyId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [familyId])

  if (loading || !data || data.is_empty || !data.totals) return null

  return (
    <PremiumShell>
      <div className="px-4 pt-4 pb-3.5 relative z-10">

        {/* Header row — matches DiscoveryCard / LiveBriefingCard exactly */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <MentorAvatar />
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[0.625rem] font-bold tracking-widest uppercase" style={{ color: '#6b9e87' }}>
                  Orchard Mentor
                </span>
                {data.source === 'ai' && <AiDisclosurePill />}
              </div>
              <p className="text-[0.9375rem] font-extrabold tracking-tight" style={{ color: '#f0fdf4' }}>
                This Month, Family-Wide
              </p>
            </div>
          </div>
          <ProBadge />
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3.5">
          {STAT_LABELS.map(({ key, label }) => (
            <div key={key} className="text-center">
              <p className="text-[0.8125rem] font-extrabold tabular-nums" style={{ color: '#f0fdf4' }}>
                {formatPence(data.totals![key])}
              </p>
              <p className="text-[0.5625rem] uppercase tracking-wide" style={{ color: 'rgba(167,196,181,0.6)' }}>
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-[0.8125rem] leading-relaxed" style={{ color: '#e2f5ee' }}>{data.observation}</p>
          <p className="text-[0.75rem] leading-relaxed" style={{ color: '#a7c4b5' }}>{data.behavioral_root}</p>
          <p className="text-[0.75rem] leading-relaxed font-semibold" style={{ color: '#6b9e87' }}>{data.the_action}</p>
        </div>

      </div>
    </PremiumShell>
  )
}
