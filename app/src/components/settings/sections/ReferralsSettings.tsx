/**
 * ReferralsSettings — Referrals section.
 * Single [Planned] row.
 */

import { Gift } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function ReferralsSettings({ toast, onBack, onComingSoon }: Props) {
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Referrals" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Gift size={15} />}
          label="Refer a Family"
          description="Share the grove — generate a unique referral link or discount code for other families"
          onClick={onComingSoon}
        />
      </SectionCard>
    </div>
  )
}
