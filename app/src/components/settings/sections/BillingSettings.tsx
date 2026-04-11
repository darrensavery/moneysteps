/**
 * BillingSettings — Billing & Subscriptions section.
 * All rows are [Planned]. Lead-parent only (enforced by menu, not here).
 */

import { CreditCard } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function BillingSettings({ toast, onBack, onComingSoon }: Props) {
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Billing & Subscriptions" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<CreditCard size={15} />}
          label="Trial Status"
          description="Visual tracker for the 14-day Professional trial"
          onClick={onComingSoon}
        />
        <SettingsRow
          icon={<CreditCard size={15} />}
          label="Plan Management"
          description="Upgrade, downgrade or cancel subscription"
          onClick={onComingSoon}
        />
        <SettingsRow
          icon={<CreditCard size={15} />}
          label="Payment History"
          description="View past invoices for Seedling or Professional tiers"
          onClick={onComingSoon}
        />
      </SectionCard>
    </div>
  )
}
