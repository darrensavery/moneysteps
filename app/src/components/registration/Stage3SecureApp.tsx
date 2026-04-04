/**
 * Stage 3 — Secure your App
 *
 * Flow:
 *  1. Mount → immediately attempt biometric registration (Face ID / Touch ID)
 *  2a. Biometrics accepted → success state → onNext('biometrics')
 *  2b. Device lacks biometrics OR user dismisses → slide to PIN setup
 *  3. PIN set → onNext('pin')
 *  4. Skip → onNext(null)
 */

import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  isBiometricsAvailable,
  registerBiometrics,
} from '@/lib/biometrics'
import * as Sentry from '@sentry/react'
import type { RegistrationState } from './RegistrationShell'

interface Props {
  data: RegistrationState
  onNext: (patch: Partial<RegistrationState>, authMethod: 'biometrics' | 'pin' | null, pin?: string) => void
  onBack: () => void
}

const PIN_LENGTH = 4

type Screen = 'checking' | 'biometric-prompt' | 'biometric-success' | 'pin'

export function Stage3SecureApp({ data, onNext, onBack }: Props) {
  const [screen,     setScreen]     = useState<Screen>('checking')
  const [pin,        setPin]        = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [confirmPin, setConfirmPin] = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [pinStage,   setPinStage]   = useState<'enter' | 'confirm'>('enter')
  const [error,      setError]      = useState('')

  const enterRefs   = useRef<(HTMLInputElement | null)[]>([])
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([])

  // On mount: check availability, then immediately prompt
  useEffect(() => {
    isBiometricsAvailable().then(available => {
      if (available) {
        setScreen('biometric-prompt')
        triggerBiometrics()
      } else {
        setScreen('pin')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function triggerBiometrics() {
    if (!data.user_id || !data.display_name) return
    const result = await registerBiometrics(data.user_id, data.display_name)
    if (result.ok) {
      if ('vibrate' in navigator) navigator.vibrate([10, 50, 10])
      Sentry.setTag('auth_method', 'biometrics')
      setScreen('biometric-success')
      setTimeout(() => onNext({}, 'biometrics'), 1200)
    } else {
      // Denied or error — drop to PIN
      setScreen('pin')
      setTimeout(() => enterRefs.current[0]?.focus(), 100)
    }
  }

  // PIN handlers
  const currentPinArr  = pinStage === 'enter' ? pin : confirmPin
  const setCurrentPin  = pinStage === 'enter' ? setPin : setConfirmPin
  const currentRefs    = pinStage === 'enter' ? enterRefs : confirmRefs

  function handlePinInput(idx: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...currentPinArr]
    next[idx] = char
    setCurrentPin(next)
    setError('')

    if (idx < PIN_LENGTH - 1) {
      currentRefs.current[idx + 1]?.focus()
    } else if (pinStage === 'enter') {
      setPinStage('confirm')
      setTimeout(() => confirmRefs.current[0]?.focus(), 50)
    } else {
      const entered    = pin.join('')
      const confirmed  = next.join('')
      if (entered !== confirmed) {
        setError("Those PINs don't match — try again.")
        setConfirmPin(Array(PIN_LENGTH).fill(''))
        setTimeout(() => confirmRefs.current[0]?.focus(), 50)
      } else {
        Sentry.setTag('auth_method', 'pin')
        onNext({}, 'pin', entered)
      }
    }
  }

  function handlePinKeyDown(
    idx: number,
    arr: string[],
    setArr: (v: string[]) => void,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    e: React.KeyboardEvent,
  ) {
    if (e.key !== 'Backspace') return
    if (arr[idx]) {
      const next = [...arr]; next[idx] = ''; setArr(next)
    } else if (idx > 0) {
      refs.current[idx - 1]?.focus()
      const next = [...arr]; next[idx - 1] = ''; setArr(next)
    } else if (pinStage === 'confirm') {
      setPinStage('enter')
      setConfirmPin(Array(PIN_LENGTH).fill(''))
      setTimeout(() => enterRefs.current[PIN_LENGTH - 1]?.focus(), 50)
    }
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  if (screen === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        <p className="text-sm text-[#6b6a66]">Checking your device…</p>
      </div>
    )
  }

  if (screen === 'biometric-success') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
        <div className="w-24 h-24 rounded-full bg-teal-50 border-2 border-teal-200 flex items-center justify-center">
          <span className="text-5xl">✓</span>
        </div>
        <div>
          <h2 className="text-[22px] font-extrabold text-[#1C1C1A] tracking-tight">Face ID enabled</h2>
          <p className="text-sm text-[#6b6a66] mt-1.5">Your app is now protected. Taking you to your dashboard…</p>
        </div>
      </div>
    )
  }

  if (screen === 'biometric-prompt') {
    return (
      <div className="space-y-8">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-full bg-teal-50 p-1.5 border border-teal-200">
              <ShieldCheck size={14} className="text-teal-600" strokeWidth={2.5} />
            </div>
            <span className="text-xs font-semibold text-teal-700 tracking-wide uppercase">App security</span>
          </div>
          <h2 className="text-[26px] font-extrabold tracking-tight text-[#1C1C1A] leading-tight">
            Secure your App
          </h2>
          <p className="text-sm text-[#6b6a66] leading-relaxed">
            Use Face ID or Touch ID so only you can open Morechard on this phone.
          </p>
        </div>

        <div className="flex flex-col items-center gap-5 py-6">
          {/* Biometric icon */}
          <div className="relative">
            <div className="w-28 h-28 rounded-full bg-teal-50 border-2 border-teal-200 flex items-center justify-center animate-pulse">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Face ID lines */}
                <rect x="4" y="4" width="12" height="3" rx="1.5" fill="#0d9488"/>
                <rect x="4" y="4" width="3" height="12" rx="1.5" fill="#0d9488"/>
                <rect x="40" y="4" width="12" height="3" rx="1.5" fill="#0d9488"/>
                <rect x="49" y="4" width="3" height="12" rx="1.5" fill="#0d9488"/>
                <rect x="4" y="49" width="12" height="3" rx="1.5" fill="#0d9488"/>
                <rect x="4" y="40" width="3" height="12" rx="1.5" fill="#0d9488"/>
                <rect x="40" y="49" width="12" height="3" rx="1.5" fill="#0d9488"/>
                <rect x="49" y="40" width="3" height="12" rx="1.5" fill="#0d9488"/>
                {/* Face */}
                <circle cx="21" cy="23" r="2.5" fill="#0d9488"/>
                <circle cx="35" cy="23" r="2.5" fill="#0d9488"/>
                <path d="M20 35c2 3 14 3 16 0" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M28 23v5" stroke="#0d9488" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          <p className="text-[13px] text-[#6b6a66] text-center">
            Follow the prompt on your device…
          </p>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onBack}
            className="flex-1 h-12 rounded-xl border-2 border-[#D3D1C7] bg-white text-sm font-semibold text-[#1C1C1A] hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer">
            Back
          </button>
          <button type="button" onClick={() => setScreen('pin')}
            className="flex-[2] h-12 rounded-xl border-2 border-[#D3D1C7] bg-white text-sm font-semibold text-[#1C1C1A] hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer">
            Use a PIN instead
          </button>
        </div>
      </div>
    )
  }

  // ── PIN screen ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-full bg-teal-50 p-1.5 border border-teal-200">
            <ShieldCheck size={14} className="text-teal-600" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-semibold text-teal-700 tracking-wide uppercase">App security</span>
        </div>
        <h2 className="text-[26px] font-extrabold tracking-tight text-[#1C1C1A] leading-tight">
          Set a PIN
        </h2>
        <p className="text-sm text-[#6b6a66] leading-relaxed">
          Choose a 4-digit PIN. You'll use this to open the app when your phone is locked.
        </p>
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-3">
        <PinStep number={1} label="Choose a PIN"   active={pinStage === 'enter'}   done={pinStage === 'confirm'} />
        <div className="flex-1 h-px bg-gray-200" />
        <PinStep number={2} label="Confirm it"     active={pinStage === 'confirm'} done={false} />
      </div>

      <div className="space-y-5">
        {/* Enter */}
        <div className={cn('space-y-3', pinStage === 'confirm' && 'opacity-40 pointer-events-none')}>
          <p className="text-sm font-semibold text-[#1C1C1A]">Choose a PIN</p>
          <div className="flex gap-3">
            {pin.map((d, i) => (
              <input key={i} ref={el => { enterRefs.current[i] = el }}
                type="password" inputMode="numeric" maxLength={1} value={d}
                onChange={e => pinStage === 'enter' && handlePinInput(i, e.target.value)}
                onKeyDown={e => pinStage === 'enter' && handlePinKeyDown(i, pin, setPin, enterRefs, e)}
                autoFocus={i === 0 && pinStage === 'enter'}
                aria-label={`PIN digit ${i + 1}`}
                className={cn(
                  'w-[54px] h-[66px] text-center text-[28px] font-extrabold',
                  'border-2 rounded-xl outline-none transition-colors duration-100 bg-white',
                  d ? 'border-teal-500' : 'border-[#D3D1C7]', 'focus:border-teal-500',
                )}
              />
            ))}
          </div>
        </div>

        {/* Confirm */}
        <div className={cn('space-y-3', pinStage === 'enter' && 'opacity-40 pointer-events-none')}>
          <p className="text-sm font-semibold text-[#1C1C1A]">Type it again to confirm</p>
          <div className="flex gap-3">
            {confirmPin.map((d, i) => (
              <input key={i} ref={el => { confirmRefs.current[i] = el }}
                type="password" inputMode="numeric" maxLength={1} value={d}
                onChange={e => pinStage === 'confirm' && handlePinInput(i, e.target.value)}
                onKeyDown={e => pinStage === 'confirm' && handlePinKeyDown(i, confirmPin, setConfirmPin, confirmRefs, e)}
                aria-label={`Confirm PIN digit ${i + 1}`}
                className={cn(
                  'w-[54px] h-[66px] text-center text-[28px] font-extrabold',
                  'border-2 rounded-xl outline-none transition-colors duration-100 bg-white',
                  error ? 'border-red-400 bg-red-50' : d ? 'border-teal-500' : 'border-[#D3D1C7]',
                  'focus:border-teal-500',
                )}
              />
            ))}
          </div>
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
        <ShieldCheck size={14} className="text-teal-600 mt-0.5 shrink-0" />
        <p className="text-xs text-[#6b6a66] leading-relaxed">
          Your PIN stays on this device and is never sent to our servers.
        </p>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="flex-1 h-12 rounded-xl border-2 border-[#D3D1C7] bg-white text-sm font-semibold text-[#1C1C1A] hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer">
          Back
        </button>
        <button type="button" onClick={() => onNext({}, null)}
          className="flex-[2] h-12 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 active:scale-[0.98] transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5">
          Skip for now <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function PinStep({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
        done || active ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400',
      )}>
        {done ? '✓' : number}
      </div>
      <span className={cn('text-xs font-semibold', active ? 'text-[#1C1C1A]' : 'text-[#9b9a96]')}>{label}</span>
    </div>
  )
}
