// app/src/lib/locale.ts
import { useState, useCallback } from 'react'
import { updateSettings } from './api'

export type AppLocale = 'en-GB' | 'en-US' | 'pl'

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect the best AppLocale from the browser's navigator.language.
 * Handles: en-US, en-GB, en-AU, en, pl, pl-PL, and all variants.
 * Falls back to 'en-GB' for anything unrecognised.
 */
export function detectLocale(): AppLocale {
  try {
    const lang = navigator.language ?? ''
    if (lang.startsWith('pl'))    return 'pl'
    if (lang.startsWith('en-US')) return 'en-US'
    if (lang.startsWith('en'))    return 'en-GB'  // en-GB, en-AU, plain 'en' → en-GB
  } catch { /* storage blocked or SSR */ }
  return 'en-GB'
}

// ── Storage ───────────────────────────────────────────────────────────────────

const VALID: AppLocale[] = ['en-GB', 'en-US', 'pl']

/**
 * Read mc_locale from localStorage.
 * Falls back to browser detection if absent or contains a legacy value ('en'/'pl-PL').
 */
export function getLocale(): AppLocale {
  try {
    const stored = localStorage.getItem('mc_locale') as AppLocale | null
    if (stored && VALID.includes(stored)) return stored
  } catch { /* storage blocked */ }
  return detectLocale()
}

/**
 * Write mc_locale to localStorage only.
 * The useLocale() hook handles the D1 sync — do not call this directly from components.
 */
export function setLocaleStorage(l: AppLocale): void {
  try {
    localStorage.setItem('mc_locale', l)
  } catch { /* storage blocked */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip region tag: 'en-GB' → 'en', 'en-US' → 'en', 'pl' → 'pl' */
export function getLanguage(l: AppLocale): 'en' | 'pl' {
  return l === 'pl' ? 'pl' : 'en'
}

/**
 * Convenience guard for all existing === 'pl' checks in the codebase.
 * Prefer this over string comparison so narrowing to 'pl' stays in one place.
 */
export function isPolish(l: AppLocale): boolean {
  return l === 'pl'
}

/** Map a currency code to its display symbol. */
export function currencySymbol(currency: string): string {
  if (currency === 'PLN') return 'zł'
  if (currency === 'USD') return '$'
  return '£'  // GBP default
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useLocale — single source of truth for reading and changing the app locale.
 *
 * - Initialised lazily from localStorage (one read at mount, not per render).
 * - setLocale: writes localStorage synchronously, then persists to D1 async.
 *   The UI reflects the change immediately; the API call is fire-and-forget.
 */
export function useLocale(): { locale: AppLocale; setLocale: (l: AppLocale) => Promise<void> } {
  const [locale, setLocaleState] = useState<AppLocale>(getLocale)

  const setLocale = useCallback(async (l: AppLocale) => {
    setLocaleState(l)
    setLocaleStorage(l)
    await updateSettings({ locale: l }).catch(() => {/* offline — localStorage written, syncs on next load */})
  }, [])

  return { locale, setLocale }
}
