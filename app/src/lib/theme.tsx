/**
 * Theme engine — Morechard
 *
 * Manages light | dark | system preference.
 * Persists to localStorage ('mc_theme') for the anti-flicker script to read.
 * Syncs to the API ('theme' column in user_settings) when a user is logged in.
 * Applies 'data-theme' on <html> so CSS variable overrides take effect globally.
 *
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { updateSettings } from './api'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme   = 'light' | 'dark'

interface ThemeContextValue {
  /** What the user has chosen: light, dark, or system (follow device). */
  preference: ThemePreference
  /** What is actually rendered right now. */
  resolved: ResolvedTheme
  /** Change the theme and persist it. */
  setTheme: (t: ThemePreference) => void
  /** Whether High Contrast (WCAG AA) mode is active. */
  highContrast: boolean
  /** Change the High Contrast preference and persist it. */
  setHighContrast: (v: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved:   'light',
  setTheme:   () => {},
  highContrast: false,
  setHighContrast: () => {},
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem('mc_theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* storage blocked */ }
  return 'system'
}


function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch { return false }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return systemPrefersDark() ? 'dark' : 'light'
}

export function readStoredHighContrast(): boolean | null {
  try {
    const v = localStorage.getItem('mc_high_contrast')
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* storage blocked */ }
  return null // no explicit preference stored
}

export function systemPrefersMoreContrast(): boolean {
  try {
    return window.matchMedia('(prefers-contrast: more)').matches
  } catch { return false }
}

export function resolveHighContrast(): boolean {
  const stored = readStoredHighContrast()
  if (stored !== null) return stored
  return systemPrefersMoreContrast()
}

function applyToDOM(resolved: ResolvedTheme, highContrast: boolean) {
  document.documentElement.setAttribute('data-theme', resolved)
  if (highContrast) {
    document.documentElement.setAttribute('data-contrast', 'high')
  } else {
    document.documentElement.removeAttribute('data-contrast')
  }
  // Keep the PWA chrome colour in sync
  const meta = document.getElementById('meta-theme-color')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1b2d2e' : '#00959c')

  // Native status bar: dark theme = light icons, light theme = dark icons.
  // We don't set backgroundColor — we let the WebView sit edge-to-edge behind
  // a transparent status bar, and headers apply .safe-top to avoid overlap.
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: resolved === 'dark' ? Style.Dark : Style.Light })
      .catch(() => { /* plugin unavailable (web) */ })
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [resolved,   setResolved]        = useState<ResolvedTheme>(() =>
    resolve(readStoredPreference())
  )
  const [highContrast, setHighContrastState] = useState<boolean>(resolveHighContrast)

  // Apply immediately on mount (the anti-flicker script may have already done
  // this, but we keep React and the DOM in sync regardless).
  useEffect(() => {
    const r = resolve(preference)
    setResolved(r)
    applyToDOM(r, highContrast)
  }, [preference, highContrast])

  // Listen for OS-level changes when preference is 'system'
  useEffect(() => {
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const r = resolve('system')
      setResolved(r)
      applyToDOM(r, highContrast)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference, highContrast])

  // OS-level high-contrast fallback — only live while no explicit user
  // preference is stored (matches the `system` theme fallback pattern).
  useEffect(() => {
    if (readStoredHighContrast() !== null) return
    const mq = window.matchMedia('(prefers-contrast: more)')
    const handler = () => {
      const hc = systemPrefersMoreContrast()
      setHighContrastState(hc)
      applyToDOM(resolved, hc)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [resolved])

  const setTheme = useCallback((t: ThemePreference) => {
    setPreferenceState(t)
    try { localStorage.setItem('mc_theme', t) } catch { /* storage blocked */ }
    // Persist to API fire-and-forget — don't block the UI on a network call
    updateSettings({ theme: t }).catch(() => { /* offline — localStorage is source of truth */ })
  }, [])

  const setHighContrast = useCallback((v: boolean) => {
    setHighContrastState(v)
    try { localStorage.setItem('mc_high_contrast', v ? '1' : '0') } catch { /* storage blocked */ }
    updateSettings({ high_contrast: v }).catch(() => { /* offline — localStorage is source of truth */ })
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setTheme, highContrast, setHighContrast }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ─── ThemePicker UI ───────────────────────────────────────────────────────────
// Self-contained segment control — drop into any settings panel.

const OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light',  label: 'Light',  icon: '☀️' },
  { value: 'system', label: 'Auto',   icon: '⚙︎'  },
  { value: 'dark',   label: 'Dark',   icon: '🌙' },
]

export function ThemePicker() {
  const { preference, setTheme } = useTheme()

  return (
    <div>
      <p className="text-[13px] font-bold text-muted uppercase tracking-wide mb-2">Display</p>
      <div className="flex rounded-xl overflow-hidden border border-subtle bg-surface-alt">
        {OPTIONS.map(opt => {
          const active = preference === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={`
                flex-1 flex flex-col items-center gap-1 py-2.5 text-[12px] font-semibold
                transition-colors duration-150 cursor-pointer
                ${active
                  ? 'bg-surface text-main shadow-sm'
                  : 'text-muted hover:text-main'}
              `}
              aria-pressed={active}
            >
              <span className="text-[16px] leading-none">{opt.icon}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted mt-1.5">
        Auto follows your device's display setting.
      </p>
    </div>
  )
}

// ─── HighContrastToggle UI ────────────────────────────────────────────────────
// Self-contained switch — drop into any settings panel alongside ThemePicker.

export function HighContrastToggle() {
  const { highContrast, setHighContrast } = useTheme()

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[13px] font-semibold text-main">High Contrast</p>
        <p className="text-[11px] text-muted mt-0.5">
          Meets WCAG AA accessibility standards for text and interface contrast.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={highContrast}
        onClick={() => setHighContrast(!highContrast)}
        className={`
          tap-target-44 relative w-11 h-6 rounded-full transition-colors duration-150 cursor-pointer shrink-0
          ${highContrast ? 'bg-brand' : 'bg-surface-alt border border-subtle'}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-150
            ${highContrast ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  )
}
