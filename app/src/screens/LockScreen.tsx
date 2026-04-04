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
    <div className="min-h-svh bg-[#F5F4F0] flex flex-col">

      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-[#D3D1C7] shadow-[0_1px_4px_rgba(0,0,0,.05)] px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-teal-600 flex items-center justify-center text-white text-sm font-bold">M</div>
        <span className="text-[17px] font-extrabold text-[#1C1C1A] tracking-tight">Morechard</span>
        <div className="ml-auto">
          <Lock size={16} className="text-[#9b9a96]" />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12 gap-0">

        {/* Avatar */}
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="w-[76px] h-[76px] rounded-full bg-teal-100 flex items-center justify-center border-2 border-teal-300 shadow-md">
            <span className="text-[28px] font-extrabold text-teal-700">{identity.initials}</span>
          </div>
          <div className="text-center">
            <p className="text-[19px] font-extrabold text-[#1C1C1A] tracking-tight">{identity.display_name}</p>
            <p className="text-[12px] text-[#9b9a96] mt-0.5">{identity.role === 'parent' ? 'Parent' : 'Child'}</p>
          </div>
        </div>

        {/* Biometric tap button */}
        {showBiometricButton && (
          <div className="mb-6 flex flex-col items-center gap-3">
            <button
              onClick={runBiometrics}
              disabled={bioRunning}
              className="w-[72px] h-[72px] rounded-full bg-white border-2 border-teal-300 shadow-md flex items-center justify-center hover:border-teal-500 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
              aria-label="Unlock with Face ID or Touch ID"
            >
              {bioRunning ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
              ) : (
                /* Face ID icon */
                <svg width="36" height="36" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4" y="4" width="12" height="3" rx="1.5" fill="#0d9488"/>
                  <rect x="4" y="4" width="3" height="12" rx="1.5" fill="#0d9488"/>
                  <rect x="40" y="4" width="12" height="3" rx="1.5" fill="#0d9488"/>
                  <rect x="49" y="4" width="3" height="12" rx="1.5" fill="#0d9488"/>
                  <rect x="4" y="49" width="12" height="3" rx="1.5" fill="#0d9488"/>
                  <rect x="4" y="40" width="3" height="12" rx="1.5" fill="#0d9488"/>
                  <rect x="40" y="49" width="12" height="3" rx="1.5" fill="#0d9488"/>
                  <rect x="49" y="40" width="3" height="12" rx="1.5" fill="#0d9488"/>
                  <circle cx="21" cy="23" r="2.5" fill="#0d9488"/>
                  <circle cx="35" cy="23" r="2.5" fill="#0d9488"/>
                  <path d="M20 35c2 3 14 3 16 0" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M28 23v5" stroke="#0d9488" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
            <p className="text-[13px] text-[#6b6a66]">
              {bioRunning ? 'Checking…' : 'Tap to unlock'}
            </p>
          </div>
        )}

        {/* PIN pad — shown for PIN-only users, or as fallback for biometric users */}
        {showPin && (
          <>
            <p className="text-[14px] font-semibold text-[#1C1C1A] mb-5">
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
                    ${error
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : d ? 'border-teal-500 bg-white' : 'border-[#D3D1C7] bg-white'
                    }
                    focus:border-teal-500
                  `}
                />
              ))}
            </div>
            {error && <p className="text-[13px] font-semibold text-red-600 mb-2">{error}</p>}
          </>
        )}

        {/* Log out — small, unobtrusive */}
        <button
          onClick={handleLogout}
          className="mt-10 text-[12px] text-[#9b9a96] underline underline-offset-2 cursor-pointer hover:text-[#6b6a66] transition-colors"
        >
          Not {identity.display_name.split(' ')[0]}? Log out
        </button>
      </main>
    </div>
  )
}
