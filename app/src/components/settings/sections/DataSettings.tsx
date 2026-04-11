/**
 * DataSettings — Data & Exports section.
 * Data Pruning row is Lead-parent only.
 */

import { Database, AlertTriangle } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

interface Props {
  isLead:       boolean
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function DataSettings({ isLead, toast, onBack, onComingSoon }: Props) {
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Data & Exports" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Database size={15} />}
          label="Download Ledger"
          description="Full family transaction history (CSV / PDF)"
          onClick={onComingSoon}
        />
        {isLead && (
          <SettingsRow
            icon={<AlertTriangle size={15} />}
            label="Data Pruning"
            description="Clean up records older than 2 years (immutable ledger protection)"
            onClick={onComingSoon}
            destructive
          />
        )}
      </SectionCard>
    </div>
  )
}
