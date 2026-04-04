/**
 * Theme engine — Morechard
 *
 * Manages light | dark | system preference.
 * Persists to localStorage ('mc_theme') for the anti-flicker script to read.
 * Syncs to the API ('theme' column in user_settings) when a user is logged in.
 * Applies 'data-theme' on <html> so CSS variable overrides take effect globally.
 *
 * Teen-mode synergy:
 *   If the user is in teen/mature view and has never explicitly set a theme,
 *   we treat 'system' as 'dark' for their initial resolved colour.
 *   Once they consciously pick a theme we respect that choice.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
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
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved:   'light',
  setTheme:   () => {},
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

function readStoredTeenMode(): boolean {
  try {
    return parseInt(localStorage.getItem('mc_teen_mode') ?? '0', 10) === 1
  } catch { return false }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch { return false }
}

function resolve(preference: ThemePreference, teenMode: boolean): ResolvedTheme {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  // system: teen users default to dark; everyone else follows the device
  return (systemPrefersDark() || teenMode) ? 'dark' : 'light'
}

function applyToDOM(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
  // Keep the PWA chrome colour in sync
  const meta = document.getElementById('meta-theme-color')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1b2d2e' : '#00959c')
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode
  /**
   * Pass the logged-in user's teen_mode value when known.
   * Used to bias 'system' → 'dark' for the mature view.
   */
  teenMode?: number
}

export function ThemeProvider({ children, teenMode = 0 }: ThemeProviderProps) {
  const isTeen = teenMode === 1

  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [resolved,   setResolved]        = useState<ResolvedTheme>(() =>
    resolve(readStoredPreference(), isTeen)
  )

  // Apply immediately on mount (the anti-flicker script may have already done
  // this, but we keep React and the DOM in sync regardless).
  useEffect(() => {
    const r = resolve(preference, isTeen)
    setResolved(r)
    applyToDOM(r)
  }, [preference, isTeen])

  // Listen for OS-level changes when preference is 'system'
  useEffect(() => {
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const r = resolve('system', isTeen)
      setResolved(r)
      applyToDOM(r)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference, isTeen])

  const setTheme = useCallback((t: ThemePreference) => {
    setPreferenceState(t)
    try { localStorage.setItem('mc_theme', t) } catch { /* storage blocked */ }
    // Persist to API fire-and-forget — don't block the UI on a network call
    updateSettings({ theme: t }).catch(() => { /* offline — localStorage is source of truth */ })
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setTheme }}>
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
      <p className="text-[13px] font-bold text-[#6b6a66] uppercase tracking-wide mb-2">Display</p>
      <div className="flex rounded-xl overflow-hidden border border-[#D3D1C7] bg-[#f3f2ee] dark:bg-[#1e2e2f] dark:border-[#3a5254]">
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
                  ? 'bg-white dark:bg-[#243637] text-[#1C1C1A] dark:text-[#f9f7f2] shadow-sm'
                  : 'text-[#6b6a66] dark:text-[#9bb5b7] hover:text-[#1C1C1A] dark:hover:text-[#f9f7f2]'}
              `}
              aria-pressed={active}
            >
              <span className="text-[16px] leading-none">{opt.icon}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-[#6b6a66] dark:text-[#9bb5b7] mt-1.5">
        Auto follows your device's display setting.
      </p>
    </div>
  )
}
