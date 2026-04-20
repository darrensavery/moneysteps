/**
 * Stage 2 — Family Setup
 *
 * Collects: locale (en-GB | en-US | pl) and base_currency (GBP | USD | PLN)
 * These are independent choices — language does not determine currency.
 * For co-parenting only: governance_mode (amicable | standard)
 * Single-parent accounts always use amicable — no choice shown.
 *
 * Smart detection: uses navigator.language to pre-suggest cards,
 * but the user must tap to confirm. No selection = Continue is disabled.
 */

import { useState, useEffect } from 'react'
import { Info, Scale, Zap, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { detectLocale, type AppLocale } from '@/lib/locale'
import type { RegistrationState } from './RegistrationShell'

interface Props {
  data: RegistrationState
  onNext: (patch: Partial<RegistrationState>) => void
  onBack: () => void
}

type Currency = 'GBP' | 'USD' | 'PLN'

function detectCurrency(): Currency | null {
  try {
    const lang = navigator.language ?? ''
    if (lang.startsWith('pl') || lang.includes('-PL')) return 'PLN'
    if (lang.startsWith('en-US'))                       return 'USD'
    if (lang.startsWith('en-GB') || lang.includes('-GB')) return 'GBP'
    if (lang.startsWith('en'))                          return 'GBP'
  } catch { /* ignore */ }
  return null
}

const LANGUAGE_OPTIONS: { value: AppLocale; flag: string; label: string; subLabel: string }[] = [
  { value: 'en-GB', flag: '🇬🇧', label: 'English', subLabel: 'UK'     },
  { value: 'en-US', flag: '🇺🇸', label: 'English', subLabel: 'US'     },
  { value: 'pl',    flag: '🇵🇱', label: 'Polski',  subLabel: 'Poland' },
]

const CURRENCY_OPTIONS: { value: Currency; symbol: string; label: string; subLabel: string }[] = [
  { value: 'GBP', symbol: '£',  label: 'British Pound', subLabel: 'GBP' },
  { value: 'USD', symbol: '$',  label: 'US Dollar',     subLabel: 'USD' },
  { value: 'PLN', symbol: 'zł', label: 'Polish Zloty',  subLabel: 'PLN' },
]

export function Stage2FamilyConstitution({ data, onNext, onBack }: Props) {
  const [locale,      setLocale]      = useState<AppLocale | null>(data.locale ?? null)
  const [currency,    setCurrency]    = useState<Currency | null>(data.base_currency ?? null)
  const [sugLocale,   setSugLocale]   = useState<AppLocale | null>(null)
  const [sugCurrency, setSugCurrency] = useState<Currency | null>(null)
  const [govMode,     setGovMode]     = useState<'amicable' | 'standard'>(
    data.governance_mode ?? (data.parenting_mode === 'co-parenting' ? 'standard' : 'amicable')
  )
  const [showGovInfo, setShowGovInfo] = useState(false)
  const [attempted,   setAttempted]   = useState(false)

  const isCoParenting = data.parenting_mode === 'co-parenting'

  useEffect(() => {
    if (data.locale || data.base_currency) return
    setSugLocale(detectLocale())
    const detectedCurrency = detectCurrency()
    if (detectedCurrency) setSugCurrency(detectedCurrency)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleNext() {
    setAttempted(true)
    if (!locale || !currency) return
    onNext({
      locale,
      base_currency:   currency,
      governance_mode: isCoParenting ? govMode : 'amicable',
    })
  }

  const canContinue = !!locale && !!currency
  const moneyWord = locale === 'pl' ? 'kieszonkowe' : locale === 'en-US' ? 'allowance' : 'pocket money'

  return (
    <div className="space-y-7">

      {/* Header */}
      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">Family Setup</h2>
        <p className="text-[#6b6a66] text-sm leading-relaxed">
          Confirm your language and currency. Tap a card to lock in your choice.
        </p>
      </div>

      {/* Language selection */}
      <section className="space-y-3">
        <span className="text-sm font-semibold text-[#1C1C1A]">Language</span>

        <div className="grid grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map(opt => (
            <SelectionCard
              key={opt.value}
              active={locale === opt.value}
              suggested={sugLocale === opt.value && !locale}
              onClick={() => setLocale(opt.value)}
              symbol={opt.flag}
              label={opt.label}
              subLabel={opt.subLabel}
              confirmLabel={opt.value === 'en-GB' ? 'Use UK English' : opt.value === 'en-US' ? 'Use US English' : 'Użyj Polskiego'}
            />
          ))}
        </div>

        {attempted && !locale && (
          <p className="text-xs font-semibold text-red-600 pl-1">Please choose a language to continue.</p>
        )}
      </section>

      {/* Currency selection */}
      <section className="space-y-3">
        <span className="text-sm font-semibold text-[#1C1C1A]">Base currency</span>

        <div className="grid grid-cols-3 gap-2">
          {CURRENCY_OPTIONS.map(opt => (
            <SelectionCard
              key={opt.value}
              active={currency === opt.value}
              suggested={sugCurrency === opt.value && !currency}
              onClick={() => setCurrency(opt.value)}
              symbol={opt.symbol}
              label={opt.label}
              subLabel={opt.subLabel}
              confirmLabel={opt.value === 'GBP' ? 'Use £ Pounds' : opt.value === 'USD' ? 'Use $ Dollars' : 'Użyj zł Złotych'}
            />
          ))}
        </div>

        {attempted && !currency && (
          <p className="text-xs font-semibold text-red-600 pl-1">Please choose a currency to continue.</p>
        )}

        {/* Ledger integrity notice */}
        <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5">
          <Lock size={15} className="text-[#6b6a66] mt-0.5 shrink-0" />
          <ul className="space-y-1.5">
            <li className="text-[13px] text-[#1C1C1A] font-medium leading-snug">
              Your {moneyWord} history is locked to one currency.
            </li>
            <li className="text-[13px] text-[#6b6a66] leading-snug">
              Moving country? Add a Relocation Audit to your ledger at any time in Settings.
            </li>
          </ul>
        </div>
      </section>

      {/* Approval model — co-parenting only */}
      {isCoParenting && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#1C1C1A]">Approval style</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowGovInfo(v => !v)}
                className="rounded-full p-1 text-[#9b9a96] hover:text-[#1C1C1A] hover:bg-gray-100 transition-colors"
                aria-label="Learn about approval styles"
              >
                <Info size={15} />
              </button>

              {showGovInfo && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGovInfo(false)} />
                  <div className="absolute left-0 top-8 z-50 w-72 rounded-2xl border border-gray-200 bg-white shadow-xl p-4 space-y-3">
                    <div>
                      <p className="text-sm font-bold text-[#1C1C1A]">How should payments be approved?</p>
                      <p className="text-xs text-[#6b6a66] mt-1 leading-relaxed">
                        This controls whether one parent can approve payments alone, or whether both of you need to agree.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-1">
                        <p className="text-xs font-bold text-[#1C1C1A] flex items-center gap-1.5">
                          <Zap size={11} className="text-amber-500" /> Quick approval
                        </p>
                        <p className="text-xs text-[#6b6a66] leading-relaxed">
                          Either parent can approve and it's recorded straight away. The other parent gets a notification.
                        </p>
                      </div>
                      <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-1">
                        <p className="text-xs font-bold text-[#1C1C1A] flex items-center gap-1.5">
                          <Scale size={11} className="text-teal-600" /> Both parents agree
                        </p>
                        <p className="text-xs text-[#6b6a66] leading-relaxed">
                          Every payment needs a sign-off from both of you before it's recorded. Creates a full, verifiable history.
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#9b9a96] border-t border-gray-100 pt-2 leading-relaxed">
                      You can change this later — it requires agreement from both parents and is logged permanently.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <GovernanceCard
              active={govMode === 'amicable'}
              onClick={() => setGovMode('amicable')}
              icon={<Zap size={20} />}
              title="Quick approval"
              subtitle="Either parent"
              description="Either parent can approve a payment and it's recorded straight away. The other parent is notified."
            />
            <GovernanceCard
              active={govMode === 'standard'}
              onClick={() => setGovMode('standard')}
              icon={<Scale size={20} />}
              title="Both parents agree"
              subtitle="Dual sign-off"
              description="Every payment waits for both parents to approve before it's recorded. Best if you want a complete, shared paper trail."
            />
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 h-12 rounded-xl border-2 border-[#D3D1C7] bg-white text-sm font-semibold text-[#1C1C1A] hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canContinue}
          className={cn(
            'flex-[2] h-12 rounded-xl text-sm font-semibold transition-all duration-150',
            canContinue
              ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-sm active:scale-[0.98] cursor-pointer'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed',
          )}
        >
          Continue
        </button>
      </div>
    </div>
  )
}

// ── SelectionCard ─────────────────────────────────────────────────────────────

function SelectionCard({
  active, suggested, onClick, symbol, label, subLabel, confirmLabel,
}: {
  active: boolean
  suggested: boolean
  onClick: () => void
  symbol: string
  label: string
  subLabel: string
  confirmLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-start gap-2 rounded-2xl border-2 p-3 text-left transition-all duration-150 cursor-pointer w-full',
        active
          ? 'border-teal-500 bg-teal-50 shadow-md'
          : suggested
          ? 'border-dashed border-teal-400 bg-teal-50/30'
          : 'border-[#D3D1C7] bg-white hover:border-teal-300 hover:bg-teal-50/40 hover:shadow-sm',
      )}
    >
      {/* Suggested pill / confirmed tick */}
      {active ? (
        <span className="absolute top-2 right-2 flex items-center gap-0.5 text-[10px] font-semibold text-teal-700 bg-teal-100 rounded-full px-1.5 py-0.5">
          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Set
        </span>
      ) : suggested ? (
        <span className="absolute top-2 right-2 text-[9px] font-semibold text-teal-600 bg-white border border-teal-300 rounded-full px-1.5 py-0.5 leading-tight text-center max-w-[52px]">
          {confirmLabel}
        </span>
      ) : null}

      <span className={cn(
        'text-[22px] font-extrabold tabular-nums leading-none',
        active ? 'text-teal-700' : 'text-[#1C1C1A]',
      )}>
        {symbol}
      </span>
      <div>
        <p className={cn('text-xs font-bold leading-tight', active ? 'text-teal-700' : 'text-[#1C1C1A]')}>{label}</p>
        <p className="text-[10px] text-[#9b9a96] mt-0.5">{subLabel}</p>
      </div>
    </button>
  )
}

// ── GovernanceCard ────────────────────────────────────────────────────────────

function GovernanceCard({
  active, onClick, icon, title, subtitle, description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-4 rounded-2xl border-2 p-4 text-left transition-all duration-150 cursor-pointer w-full',
        active
          ? 'border-teal-500 bg-teal-50 shadow-md'
          : 'border-[#D3D1C7] bg-white hover:border-teal-300 hover:bg-teal-50/40 hover:shadow-sm',
      )}
    >
      <span className={cn(
        'rounded-xl p-2 mt-0.5 shrink-0 transition-colors',
        active ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-500',
      )}>
        {icon}
      </span>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn('text-sm font-bold', active ? 'text-teal-700' : 'text-[#1C1C1A]')}>{title}</p>
          <span className="text-[11px] text-[#9b9a96] border border-[#D3D1C7] rounded-full px-2 py-0.5">{subtitle}</span>
        </div>
        <p className="text-xs text-[#6b6a66] leading-relaxed">{description}</p>
      </div>
    </button>
  )
}
