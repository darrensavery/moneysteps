import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { KeyboardEvent, WheelEvent } from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Blurs a focused number input on mouse-wheel scroll.
 *
 * Native `<input type="number">` silently increments/decrements its value
 * when the cursor is over it and the page (or a parent scroll container) is
 * scrolled — a well-known browser gotcha that's especially dangerous on
 * money fields, since the amount can change without the user noticing.
 * Attach as `onWheel={blurOnWheel}`.
 */
export function blurOnWheel(e: WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur()
}

/**
 * Blocks keystrokes that are valid in a native number input but never valid
 * in a money amount — scientific notation (`e`/`E`) and sign characters
 * (`+`/`-`), since amounts here are always positive. Attach as
 * `onKeyDown={blockInvalidAmountKeys}`.
 */
export function blockInvalidAmountKeys(e: KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
}
