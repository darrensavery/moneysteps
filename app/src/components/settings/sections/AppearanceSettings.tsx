/**
 * AppearanceSettings — Appearance & Display section.
 * ThemePicker is self-contained; LanguagePicker reads/writes via useLocale().
 */

import { useLocale, type AppLocale } from '../../../lib/locale'
import { ThemePicker, HighContrastToggle } from '../../../lib/theme'
import { Toast, SectionCard, SectionHeader } from '../shared'
import { cn } from '../../../lib/utils'

interface Props {
  toast:  string | null
  onBack: () => void
}

const LANGUAGE_OPTIONS: { value: AppLocale; flag: string; label: string }[] = [
  { value: 'en-GB', flag: '🇬🇧', label: 'UK English' },
  { value: 'en-US', flag: '🇺🇸', label: 'US English' },
  { value: 'pl',    flag: '🇵🇱', label: 'Polish'     },
]

export function AppearanceSettings({ toast, onBack }: Props) {
  const { locale, setLocale } = useLocale()

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Appearance & Display" onBack={onBack} />
      <SectionCard>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <ThemePicker />
        </div>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <HighContrastToggle />
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2.5">Language</p>
          <div className="flex rounded-xl border border-[var(--color-border)] overflow-hidden">
            {LANGUAGE_OPTIONS.map(({ value, flag, label }, i) => (
              <button
                key={value}
                type="button"
                onClick={() => setLocale(value)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-center transition-colors cursor-pointer',
                  i < LANGUAGE_OPTIONS.length - 1 && 'border-r border-[var(--color-border)]',
                  locale === value
                    ? 'bg-teal-600 text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-teal-50 hover:text-teal-700',
                )}
              >
                <span className="text-base leading-none">{flag}</span>
                <span className="text-[11px] font-semibold leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
