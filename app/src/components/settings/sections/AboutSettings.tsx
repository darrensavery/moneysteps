/**
 * AboutSettings — About & Support section.
 * Version display + [UI Shell] rows.
 */

import { Info } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'

declare const __APP_VERSION__: string | undefined

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function AboutSettings({ toast, onBack, onComingSoon }: Props) {
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="About & Support" onBack={onBack} />
      <SectionCard>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <p className="text-[13px] font-semibold text-[var(--color-text-muted)]">Version</p>
          <p className="text-[14px] font-bold text-[var(--color-text)] mt-0.5">
            {__APP_VERSION__ ?? '—'}
          </p>
        </div>
        <SettingsRow
          icon={<Info size={15} />}
          label="Privacy Policy"
          description="How we handle your family's data"
          onClick={onComingSoon}
        />
        <SettingsRow
          icon={<Info size={15} />}
          label="Terms of Use"
          description="The Legal Grove"
          onClick={onComingSoon}
        />
        <SettingsRow
          icon={<Info size={15} />}
          label="Support Desk"
          description="Get help with Morechard"
          onClick={onComingSoon}
        />
      </SectionCard>
    </div>
  )
}
