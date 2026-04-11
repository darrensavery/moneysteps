/**
 * PinManagementSettings — Set, change, or reset parent 4-digit PIN.
 *
 * States:
 *   verify-current  — collect account password (master key)
 *   set-new         — enter + confirm new 4-digit PIN
 *   forgot          — collect account password to reset PIN (no current PIN check)
 */

import { useState, useCallback } from 'react'
import type { MeResult } from '../../../lib/api'
import { setParentPin, resetPinWithPassword } from '../../../lib/api'
import { isBiometricsAvailable, hasBiometricCredential, registerBiometrics } from '../../../lib/biometrics'
import { SectionHeader } from '../shared'

const PIN_LENGTH = 4

type PinState = 'verify-current' | 'set-new' | 'forgot'

interface Props {
  profile: MeResult | null
  onBack:  () => void
}

// ── Dot row ───────────────────────────────────────────────────────────────────

function DotRow({ digits, shake, label }: { digits: string[]; shake: boolean; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold text-[var(--color-text-muted)] text-center uppercase tracking-wide">{label}</p>
      <div className={`flex justify-center gap-4 ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
        {digits.map((d, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
              d
                ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]'
                : 'bg-transparent border-[var(--color-border)]'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ── Digit pad ─────────────────────────────────────────────────────────────────

function DigitPad({ onDigit, onBackspace }: { onDigit: (d: string) => void; onBackspace: () => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {['1','2','3','4','5','6','7','8','9'].map(d => (
        <button
          key={d}
          type="button"
          onClick={() => onDigit(d)}
          className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
        >
          {d}
        </button>
      ))}
      <div />
      <button
        type="button"
        onClick={() => onDigit('0')}
        className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
      >
        0
      </button>
      <button
        type="button"
        onClick={onBackspace}
        className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[18px] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
        aria-label="Backspace"
      >
        ⌫
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PinManagementSettings({ profile, onBack }: Props) {
  const hasPinAlready = profile?.has_pin ?? false

  const [pinState,    setPinState]    = useState<PinState>('verify-current')
  const [password,    setPassword]    = useState('')
  const [pwError,     setPwError]     = useState('')

  // PIN entry
  const [newDigits,   setNewDigits]   = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [confDigits,  setConfDigits]  = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [pinError,    setPinError]    = useState('')
  const [pinShake,    setPinShake]    = useState(false)
  const [pinBusy,     setPinBusy]     = useState(false)

  // Biometric nudge after save
  const [showBioNudge, setShowBioNudge] = useState(false)

  // Which API fn to call — 'set' for normal flow, 'reset' for forgot flow
  const [apiFn, setApiFn] = useState<'set' | 'reset'>('set')

  // ── Password step ──────────────────────────────────────────────────────────

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setApiFn(pinState === 'forgot' ? 'reset' : 'set')
    setPinState('set-new')
  }

  // ── PIN digit handler ──────────────────────────────────────────────────────

  const handleDigit = useCallback((digit: string) => {
    if (pinBusy) return
    setPinError('')

    setNewDigits(prevNew => {
      const newFull = prevNew.every(d => d !== '')
      if (!newFull) {
        const next = [...prevNew]
        const idx  = next.findIndex(d => d === '')
        if (idx === -1) return prevNew
        next[idx] = digit
        return next
      }
      // newDigits full — write to confDigits
      setConfDigits(prevConf => {
        const next = [...prevConf]
        const idx  = next.findIndex(d => d === '')
        if (idx === -1) return prevConf
        next[idx] = digit
        if (idx === PIN_LENGTH - 1) {
          // Both full — auto-submit
          const newPin  = prevNew.join('')
          const confPin = next.join('')
          // apiFn and password are stable during digit entry — set before set-new state is entered
          setTimeout(() => handleConfirmFull(newPin, confPin), 0)
        }
        return next
      })
      return prevNew
    })
  }, [pinBusy])

  const handleBackspace = useCallback(() => {
    if (pinBusy) return
    setConfDigits(prevConf => {
      const confFilled = prevConf.findLastIndex((d: string) => d !== '')
      if (confFilled >= 0) {
        const next = [...prevConf]; next[confFilled] = ''; return next
      }
      // No conf digits — remove from new
      setNewDigits(prevNew => {
        const newFilled = prevNew.findLastIndex((d: string) => d !== '')
        if (newFilled >= 0) {
          const next = [...prevNew]; next[newFilled] = ''; return next
        }
        return prevNew
      })
      return prevConf
    })
  }, [pinBusy])

  async function handleConfirmFull(newPin: string, confPin: string) {
    if (newPin !== confPin) {
      setPinShake(true)
      setPinError("PINs don't match")
      setNewDigits(Array(PIN_LENGTH).fill(''))
      setConfDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => setPinShake(false), 600)
      return
    }
    setPinBusy(true)
    setPinError('')
    try {
      if (apiFn === 'reset') {
        await resetPinWithPassword(password, newPin)
      } else {
        await setParentPin(password, newPin)
      }
      // Success
      if (await isBiometricsAvailable() && !hasBiometricCredential()) {
        setShowBioNudge(true)
      } else {
        onBack()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPwError(msg)
      setPinState(apiFn === 'reset' ? 'forgot' : 'verify-current')
      setNewDigits(Array(PIN_LENGTH).fill(''))
      setConfDigits(Array(PIN_LENGTH).fill(''))
    } finally {
      setPinBusy(false)
    }
  }

  // ── Biometric nudge ────────────────────────────────────────────────────────

  async function handleEnableBiometrics() {
    await registerBiometrics(
      profile?.id ?? '',
      profile?.display_name ?? 'Parent',
    ).catch(() => {})
    onBack()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (showBioNudge) {
    return (
      <div className="space-y-4">
        <SectionHeader title="PIN Updated" onBack={onBack} />
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
          <p className="text-[15px] font-bold text-[var(--color-text)]">Enable Face ID for faster access?</p>
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            Instead of entering your PIN every time, use biometrics to approve sensitive actions in seconds.
          </p>
          <button
            type="button"
            onClick={handleEnableBiometrics}
            className="w-full py-3 rounded-xl text-[14px] font-bold bg-[var(--brand-primary)] text-white cursor-pointer"
          >
            Enable Face ID / Touch ID
          </button>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  // ── verify-current / forgot — password collection step ────────────────────

  if (pinState === 'verify-current' || pinState === 'forgot') {
    const isForgot = pinState === 'forgot'
    const title    = isForgot ? 'Forgot PIN' : hasPinAlready ? 'Change PIN' : 'Set Up PIN'
    const heading  = isForgot
      ? 'Reset PIN with password'
      : hasPinAlready
        ? 'Enter your account password to change your PIN'
        : 'Enter your account password to enable PIN'

    return (
      <div className="space-y-4">
        <SectionHeader title={title} onBack={onBack} />
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{heading}</p>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setPwError('') }}
              placeholder="Account password"
              autoComplete="current-password"
              autoFocus
              className={`w-full px-3 py-2.5 text-[14px] rounded-xl border bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${pwError ? 'border-red-400' : 'border-[var(--color-border)]'}`}
            />
            {pwError && <p className="text-[12px] text-red-500">{pwError}</p>}
            <button
              type="submit"
              disabled={!password.trim()}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>

          {/* Forgot PIN link — only in verify-current when PIN already set */}
          {!isForgot && hasPinAlready && (
            <button
              type="button"
              onClick={() => { setPassword(''); setPwError(''); setPinState('forgot') }}
              className="w-full text-center text-[12px] text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)]"
            >
              Forgot PIN? Reset with password
            </button>
          )}
        </form>
      </div>
    )
  }

  // ── set-new — 4-dot double entry ──────────────────────────────────────────

  const newFull = newDigits.every(d => d !== '')

  return (
    <div className="space-y-4">
      <SectionHeader
        title={apiFn === 'reset' ? 'Reset PIN' : hasPinAlready ? 'Change PIN' : 'Set Up PIN'}
        onBack={() => {
          setNewDigits(Array(PIN_LENGTH).fill(''))
          setConfDigits(Array(PIN_LENGTH).fill(''))
          setPinError('')
          setPinState(apiFn === 'reset' ? 'forgot' : 'verify-current')
        }}
      />

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-6">
        <div className="space-y-4">
          <DotRow digits={newDigits}  shake={false}    label="New PIN" />
          <DotRow digits={confDigits} shake={pinShake} label="Confirm PIN" />
        </div>

        <div className="h-4 flex items-center justify-center">
          {pinError && <p className="text-[12px] font-semibold text-red-500">{pinError}</p>}
          {pinBusy  && <p className="text-[12px] text-[var(--color-text-muted)]">Saving…</p>}
        </div>

        <DigitPad
          onDigit={handleDigit}
          onBackspace={handleBackspace}
        />
      </div>

      <p className="text-center text-[11px] text-[var(--color-text-muted)] px-4 leading-relaxed">
        {newFull ? 'Now confirm your PIN' : 'Enter a 4-digit PIN you\'ll remember'}
      </p>
    </div>
  )
}
