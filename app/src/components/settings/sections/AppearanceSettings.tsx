/**
 * AppearanceSettings — Appearance & Display section.
 * ThemePicker is self-contained; Language row is [Planned].
 */

import { Info } from 'lucide-react'
import { ThemePicker } from '../../../lib/theme'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function AppearanceSettings({ toast, onBack, onComingSoon }: Props) {
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Appearance & Display" onBack={onBack} />
      <SectionCard>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <ThemePicker />
        </div>
        <SettingsRow
          icon={<Info size={15} />}
          label="Language"
          description="UK English / Polish"
          onClick={onComingSoon}
        />
      </SectionCard>
    </div>
  )
}
