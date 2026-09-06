/**
 * LockScreen — shown when the app is opened or returns from the background.
 *
 * Flow:
 *  - Biometrics registered → auto-trigger challenge on mount, show "Tap to unlock" as fallback
 *  - PIN only → show PIN pad directly
 *  - No security set → pass straight through (skipped during setup)
 *
 * No profile switcher. One user per device.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { getDeviceIdentity, clearDeviceIdentity, verifyPinHash } from '@/lib/deviceIdentity'
import { AvatarSVG } from '@/lib/avatars'
import { challengeBiometrics, hasBiometricCredential, clearBiometricCredential } from '@/lib/biometrics'
import { analytics, track } from '@/lib/analytics'
import { FullLogo } from '@/components/ui/Logo'
import { childLogin, setToken, logout } from '@/lib/api'
import { isAuthenticated } from '@/lib/authState'
import * as Sentry from '@sentry/react'

const PIN_LENGTH    = 4
const MAX_ATTEMPTS  = 5
const LOCKOUT_MS    = 30_000 // 30 seconds

export function LockScreen() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const isManualLock  = searchParams.get('manual') === '1'
  const identity      = getDeviceIdentity()

  const [digits,              setDigits]             = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [error,               setError]              = useState('')
  const [unlocking,           setUnlocking]          = useState(false)
  const [bioRunning,          setBioRunning]         = useState(false)
  const [showAuth,            setShowAuth]           = useState(!isManualLock)
  const [pinAttempts,         setPinAttempts]        = useState(0)
  const [lockedUntil,         setLockedUntil]        = useState<number | null>(null)
  // Tracks whether the JWT was absent when this screen mounted — drives re-auth logic
  const [tokenMissingOnMount] = useState(() => !isAuthenticated())
  // Parent-specific: shown after biometrics/PIN succeed but JWT is gone (rare — ~annual)
  const [sessionExpiredForParent, setSessionExpiredForParent] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const destination = identity?.role === 'child' ? '/child' : '/parent'

  const unlock = useCallback(async (authMethod: 'biometrics' | 'pin' | 'none', rawPin?: string) => {
    if (!identity) return

    // JWT is missing (expired) — re-authenticate before entering the app
    if (tokenMissingOnMount) {
      if (identity.role === 'child') {
        // Children: silently get a new JWT using the just-verified PIN
        if (!rawPin) {
          setError('Could not reconnect — please ask a parent to reset your code.')
          setUnlocking(false)
          setDigits(Array(PIN_LENGTH).fill(''))
          return
        }
        try {
          const result = await childLogin(identity.family_id, identity.user_id, rawPin)
          await setToken(result.token)
        } catch {
          setError('Could not reconnect — check your internet and try again.')
          setUnlocking(false)
          setDigits(Array(PIN_LENGTH).fill(''))
          setTimeout(() => inputRefs.current[0]?.focus(), 50)
          return
        }
      } else {
        // Parents: can't silently re-auth without email — show session-expired prompt
        setSessionExpiredForParent(true)
        setUnlocking(false)
        return
      }
    }

    Sentry.setUser({ id: identity.user_id })
    analytics.identify(identity.user_id, { role: identity.role })
    track.lockScreenUnlocked({ auth_method: authMethod })
    navigate(destination, { replace: true })
  }, [navigate, destination, identity, tokenMissingOnMount])

  const runBiometrics = useCallback(async () => {
    if (bioRunning) return
    setBioRunning(true)
    const result = await challengeBiometrics()
    setBioRunning(false)
    if (result.ok) {
      Sentry.setTag('auth_method', 'biometrics')
      if ('vibrate' in navigator) navigator.vibrate([10, 50, 10])
      await unlock('biometrics')
    }
    // On denial/error — do nothing, user can tap the button or use PIN
  }, [bioRunning, unlock])

  useEffect(() => {
    if (!identity) { navigate('/', { replace: true }); return }

    // No security set — pass straight through.
    // Clean up any stale mc_biometric_id that doesn't match auth_method='none' so
    // the conjunctive tamper-guard below doesn't trap a legitimate none-auth user.
    if (identity.auth_method === 'none' && hasBiometricCredential()) {
      clearBiometricCredential()
    }
    if (identity.auth_method === 'none' && !identity.pin_hash && !hasBiometricCredential()) {
      void unlock('none')
      return
    }

    // Manual lock — skip auto-auth; user taps "Tap to unlock" first
    if (isManualLock) return

    // Biometrics → auto-challenge on mount
    if (identity.auth_method === 'biometrics' && hasBiometricCredential()) {
      void runBiometrics()
    } else {
      // PIN — focus first box
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!identity) return null

  // Parent's JWT expired (happens at most once a year with 365-day tokens).
  // Show a clear recovery screen instead of dumping them back to the landing page.
  if (sessionExpiredForParent) {
    return (
      <div className="min-h-svh bg-[var(--color-bg)] flex flex-col items-center justify-center px-6 gap-6">
        <FullLogo iconSize={26} />
        <div className="max-w-sm w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-7 text-center space-y-3 shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Session expired</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
            Your sign-in has expired. Request a new link — your family data is safe.
          </p>
        </div>
        <div className="max-w-sm w-full flex flex-col gap-2.5">
          <a
            href="/auth/login"
            className="block w-full rounded-xl bg-[var(--brand-primary)] py-3 text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
          >
            Get a new sign-in link
          </a>
          <button
            onClick={handleLogout}
            className="w-full text-sm text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)] transition-colors"
          >
            Log out of this device
          </button>
        </div>
      </div>
    )
  }

  function handleInput(idx: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...digits]
    next[idx] = char
    setDigits(next)
    setError('')
    if (idx < PIN_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus()
    } else {
      void submitPin(next.join(''))
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        const next = [...digits]; next[idx] = ''; setDigits(next)
      } else if (idx > 0) {
        inputRefs.current[idx - 1]?.focus()
        const next = [...digits]; next[idx - 1] = ''; setDigits(next)
      }
    }
  }

  async function submitPin(entered: string) {
    if (entered.length < PIN_LENGTH) return
    if (!identity) return

    // Check lockout
    if (lockedUntil && Date.now() < lockedUntil) {
      const secsLeft = Math.ceil((lockedUntil - Date.now()) / 1000)
      setError(`Too many attempts — wait ${secsLeft}s`)
      setDigits(Array(PIN_LENGTH).fill(''))
      return
    }

    setUnlocking(true)

    const stored = identity.pin_hash
    if (!stored) {
      // No hash stored — let through (auth_method may be 'none' or biometrics fallback)
      Sentry.setTag('auth_method', 'pin')
      await unlock('pin', entered)
      return
    }

    const match = await verifyPinHash(entered, stored)
    if (!match) {
      const newAttempts = pinAttempts + 1
      setPinAttempts(newAttempts)
      if (newAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MS
        setLockedUntil(until)
        setPinAttempts(0)
        setError(`Too many attempts — locked for ${LOCKOUT_MS / 1000}s`)
      } else {
        setError(`Wrong PIN — ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} left`)
      }
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
      setUnlocking(false)
      return
    }

    setPinAttempts(0)
    setLockedUntil(null)
    Sentry.setTag('auth_method', 'pin')
    // Pass raw PIN so unlock() can silently re-issue the child's JWT if it expired
    await unlock('pin', entered)
  }

  async function handleLogout() {
    if (!identity) return
    if (!window.confirm(
      `Log out of ${identity.display_name}'s account?\n\nYour family's data stays safe — you'll need to log back in to use Morechard on this phone.`
    )) return
    clearDeviceIdentity()
    await logout().catch(() => undefined)
    navigate('/', { replace: true })
  }

  const showBiometricButton = identity.auth_method === 'biometrics' && hasBiometricCredential()
  const showPin             = identity.auth_method === 'pin' || identity.auth_method === 'biometrics'

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">

      {/* Header */}
      <header className="safe-top sticky top-0 z-10 glass-header px-4 py-3 flex items-center gap-2.5">
        <FullLogo iconSize={26} />
        <div className="ml-auto">
          <Lock size={16} className="text-[var(--color-text-muted)]" />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12 gap-0">

        {/* Avatar */}
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="w-[76px] h-[76px] rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] flex items-center justify-center border-2 border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] shadow-md overflow-hidden">
            {identity.avatar_id
              ? <AvatarSVG id={identity.avatar_id} size={76} />
              : <span className="text-[1.75rem] font-extrabold text-[var(--brand-primary)]">{identity.initials}</span>
            }
          </div>
          <div className="text-center">
            <p className="text-[1.1875rem] font-extrabold text-[var(--color-text)] tracking-tight">{identity.display_name}</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">{identity.role === 'parent' ? 'Parent' : 'Child'}</p>
          </div>
        </div>

        {/* Manual-lock splash — just show "Tap to unlock", no auth UI yet */}
        {!showAuth && (
          <button
            onClick={() => {
              setShowAuth(true)
              if (identity.auth_method === 'biometrics' && hasBiometricCredential()) {
                setTimeout(() => void runBiometrics(), 50)
              } else {
                setTimeout(() => inputRefs.current[0]?.focus(), 100)
              }
            }}
            className="mb-6 h-12 px-8 rounded-2xl bg-[var(--brand-primary)] text-white text-[0.875rem] font-semibold active:scale-[0.97] transition-transform cursor-pointer"
          >
            Tap to unlock
          </button>
        )}

        {/* Biometric tap button */}
        {showAuth && showBiometricButton && (
          <div className="mb-6 flex flex-col items-center gap-3">
            <button
              onClick={runBiometrics}
              disabled={bioRunning}
              className="w-[72px] h-[72px] rounded-full bg-[var(--color-surface)] border-2 border-[color-mix(in_srgb,var(--brand-primary)_35%,transparent)] shadow-md flex items-center justify-center hover:border-[var(--brand-primary)] active:scale-95 transition-all cursor-pointer disabled:opacity-60"
              aria-label="Unlock with Face ID or Touch ID"
            >
              {bioRunning ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
              ) : (
                /* Face ID icon — uses currentColor so it inherits brand-primary */
                <svg width="36" height="36" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--brand-primary)' }}>
                  <rect x="4"  y="4"  width="12" height="3"  rx="1.5" fill="currentColor"/>
                  <rect x="4"  y="4"  width="3"  height="12" rx="1.5" fill="currentColor"/>
                  <rect x="40" y="4"  width="12" height="3"  rx="1.5" fill="currentColor"/>
                  <rect x="49" y="4"  width="3"  height="12" rx="1.5" fill="currentColor"/>
                  <rect x="4"  y="49" width="12" height="3"  rx="1.5" fill="currentColor"/>
                  <rect x="4"  y="40" width="3"  height="12" rx="1.5" fill="currentColor"/>
                  <rect x="40" y="49" width="12" height="3"  rx="1.5" fill="currentColor"/>
                  <rect x="49" y="40" width="3"  height="12" rx="1.5" fill="currentColor"/>
                  <circle cx="21" cy="23" r="2.5" fill="currentColor"/>
                  <circle cx="35" cy="23" r="2.5" fill="currentColor"/>
                  <path d="M20 35c2 3 14 3 16 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M28 23v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
            <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
              {bioRunning ? 'Checking…' : 'Tap to unlock'}
            </p>
          </div>
        )}

        {/* PIN pad */}
        {showAuth && showPin && (
          <>
            <p className="text-[0.875rem] font-semibold text-[var(--color-text)] mb-5">
              {showBiometricButton ? 'Or enter your PIN' : 'Enter your PIN to get back in'}
            </p>
            <div className="flex gap-3 mb-4">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  disabled={unlocking}
                  aria-label={`PIN digit ${i + 1}`}
                  className={`
                    w-[54px] h-[66px] text-center text-[1.75rem] font-extrabold
                    border-2 rounded-xl outline-none transition-colors duration-100
                    bg-[var(--color-surface)] text-[var(--color-text)]
                    ${error
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : d ? 'border-[var(--brand-primary)]' : 'border-[var(--color-border)]'
                    }
                    focus:border-[var(--brand-primary)]
                  `}
                />
              ))}
            </div>
            {error && <p className="text-[0.8125rem] font-semibold text-red-600 mb-2">{error}</p>}
          </>
        )}

        {/* Fallback: unrecognised auth state — fail closed, force re-login */}
        {showAuth && !showBiometricButton && !showPin && (
          <div className="mb-4 flex flex-col items-center gap-3 text-center max-w-[260px]">
            <p className="text-[0.8125rem] text-[var(--color-text-muted)] leading-snug">
              Your security settings couldn't be read. Log out and sign in again to continue.
            </p>
            <button
              onClick={handleLogout}
              className="h-11 px-6 rounded-2xl border border-[var(--color-border)] text-[0.875rem] font-semibold text-[var(--color-text)] cursor-pointer hover:bg-[var(--color-surface-raised)] transition-colors"
            >
              Log out
            </button>
          </div>
        )}

        {/* Log out */}
        <button
          onClick={handleLogout}
          className="mt-10 text-[0.75rem] text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)] transition-colors"
        >
          Not {identity.display_name.split(' ')[0]}? Log out
        </button>
      </main>
    </div>
  )
}
