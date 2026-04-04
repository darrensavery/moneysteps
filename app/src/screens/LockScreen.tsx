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
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { getDeviceIdentity, clearDeviceIdentity } from '@/lib/deviceIdentity'
import { challengeBiometrics, hasBiometricCredential } from '@/lib/biometrics'
import { analytics, track } from '@/lib/analytics'
import { FullLogo } from '@/components/ui/Logo'
import * as Sentry from '@sentry/react'

const PIN_LENGTH = 4

export function LockScreen() {
  const navigate  = useNavigate()
  const identity  = getDeviceIdentity()

  const [digits,      setDigits]      = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [error,       setError]       = useState('')
  const [unlocking,   setUnlocking]   = useState(false)
  const [bioRunning,  setBioRunning]  = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const destination = identity?.role === 'child' ? '/child' : '/parent'

  const unlock = useCallback((authMethod: 'biometrics' | 'pin' | 'none') => {
    if (!identity) return
    Sentry.setUser({ id: identity.user_id })
    analytics.identify(identity.user_id, { role: identity.role })
    track.lockScreenUnlocked({ auth_method: authMethod })
    navigate(destination, { replace: true })
  }, [navigate, destination, identity])

  const runBiometrics = useCallback(async () => {
    if (bioRunning) return
    setBioRunning(true)
    const result = await challengeBiometrics()
    setBioRunning(false)
    if (result.ok) {
      Sentry.setTag('auth_method', 'biometrics')
      if ('vibrate' in navigator) navigator.vibrate([10, 50, 10])
      unlock('biometrics')
    }
    // On denial/error — do nothing, user can tap the button or use PIN
  }, [bioRunning, unlock])

  useEffect(() => {
    if (!identity) { navigate('/', { replace: true }); return }

    // No security set — pass straight through
    if (identity.auth_method === 'none') { unlock('none'); return }

    // Biometrics → auto-challenge on mount
    if (identity.auth_method === 'biometrics' && hasBiometricCredential()) {
      runBiometrics()
    } else {
      // PIN — focus first box
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!identity) return null

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
      submitPin(next.join(''))
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

  function submitPin(entered: string) {
    if (entered.length < PIN_LENGTH) return
    if (!identity) return
    setUnlocking(true)
    if (identity.pin && identity.pin !== entered) {
      setError('Wrong PIN — try again.')
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
      setUnlocking(false)
      return
    }
    Sentry.setTag('auth_method', 'pin')
    unlock('pin')
  }

  function handleLogout() {
    if (!identity) return
    if (!window.confirm(
      `Log out of ${identity.display_name}'s account?\n\nYour family's data stays safe — you'll need to log back in to use Morechard on this phone.`
    )) return
    clearDeviceIdentity()
    navigate('/', { replace: true })
  }

  const showBiometricButton = identity.auth_method === 'biometrics' && hasBiometricCredential()
  const showPin             = identity.auth_method === 'pin' || identity.auth_method === 'biometrics'

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">

      {/* Header */}
      <header className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)] px-4 py-3 flex items-center gap-2.5">
        <FullLogo iconSize={26} />
        <div className="ml-auto">
          <Lock size={16} className="text-[var(--color-text-muted)]" />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12 gap-0">

        {/* Avatar */}
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="w-[76px] h-[76px] rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] flex items-center justify-center border-2 border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] shadow-md">
            <span className="text-[28px] font-extrabold text-[var(--brand-primary)]">{identity.initials}</span>
          </div>
          <div className="text-center">
            <p className="text-[19px] font-extrabold text-[var(--color-text)] tracking-tight">{identity.display_name}</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{identity.role === 'parent' ? 'Parent' : 'Child'}</p>
          </div>
        </div>

        {/* Biometric tap button */}
        {showBiometricButton && (
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
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {bioRunning ? 'Checking…' : 'Tap to unlock'}
            </p>
          </div>
        )}

        {/* PIN pad */}
        {showPin && (
          <>
            <p className="text-[14px] font-semibold text-[var(--color-text)] mb-5">
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
                    w-[54px] h-[66px] text-center text-[28px] font-extrabold
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
            {error && <p className="text-[13px] font-semibold text-red-600 mb-2">{error}</p>}
          </>
        )}

        {/* Log out */}
        <button
          onClick={handleLogout}
          className="mt-10 text-[12px] text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)] transition-colors"
        >
          Not {identity.display_name.split(' ')[0]}? Log out
        </button>
      </main>
    </div>
  )
}
