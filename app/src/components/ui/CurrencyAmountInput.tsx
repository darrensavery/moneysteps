import { useState, type InputHTMLAttributes } from 'react'
import { blurOnWheel, blockInvalidAmountKeys } from '../../lib/utils'

interface Props {
  id?: string
  /** Whole-currency-unit amount in minor units (pence/cents). */
  valuePence: number
  onChangePence: (pence: number) => void
  symbol: string
  className?: string
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onFocus' | 'onBlur' | 'type'>
}

function grouped(wholeUnits: string): string {
  const [intPart, decPart] = wholeUnits.split('.')
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas
}

/**
 * Amount input that live-formats with thousand separators once the field is
 * blurred (designmotionhq "Input Masking") — a raw four-figure number reads
 * as a bug next to the rest of the app's formatted currency display. Stays
 * a plain editable number while focused, so typing never fights a cursor
 * jump caused by commas being inserted mid-edit.
 */
export function CurrencyAmountInput({ id, valuePence, onChangePence, symbol, className = '', inputProps }: Props) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')

  const committed = (valuePence / 100).toFixed(0)
  const display = focused ? raw : grouped(committed)

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[var(--color-text-muted)]">
        {symbol}
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={() => { setRaw(committed); setFocused(true) }}
        onBlur={() => setFocused(false)}
        onChange={e => {
          const next = e.target.value.replace(/,/g, '')
          if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
          setRaw(next)
          onChangePence(Math.round((parseFloat(next || '0') || 0) * 100))
        }}
        onWheel={blurOnWheel}
        onKeyDown={blockInvalidAmountKeys}
        className={`border border-[var(--color-border)] rounded-xl pl-7 pr-4 py-2 text-[0.875rem] bg-[var(--color-surface)] w-28 tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${className}`}
        {...inputProps}
      />
    </div>
  )
}
