/**
 * useGatekeeper — Challenge the parent for biometrics or PIN before sensitive actions.
 *
 * Usage:
 *   const { challenge, GatekeeperModal } = useGatekeeper()
 *   // In JSX: <GatekeeperModal />
 *   // On action: challenge(() => doTheSensitiveThing())
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { challengeBiometrics, hasBiometricCredential } from '../lib/biometrics'
import { verifyPin } from '../lib/api'

const GRACE_MS    = 5 * 60 * 1000   // 5 minutes
const GRACE_KEY   = 'mc_gk_verified_at'
const PIN_LENGTH  = 4

function isWithinGrace(): boolean {
  const stored = sessionStorage.getItem(GRACE_KEY)
  if (!stored) return false
  return Date.now() - parseInt(stored, 10) < GRACE_MS
}

function markVerified(): void {
  sessionStorage.setItem(GRACE_KEY, String(Date.now()))
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useGatekeeper() {
  const navigate = useNavigate()

  const [open,        setOpen]        = useState(false)
  const [digits,      setDigits]      = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [errorMsg,    setErrorMsg]    = useState('')
  const [shake,       setShake]       = useState(false)
  const [locked,      setLocked]      = useState(false)
  const [lockSeconds, setLockSeconds] = useState(0)
  const [submitting,  setSubmitting]  = useState(false)

  const pendingRef   = useRef<(() => void) | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up countdown on unmount
  useEffect(() => () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  // ── Challenge entry point ────────────────────────────────────────
  const challenge = useCallback(async (onSuccess: () => void) => {
    if (isWithinGrace()) { onSuccess(); return }

    pendingRef.current = onSuccess

    // Try biometrics first if registered
    if (hasBiometricCredential()) {
      const result = await challengeBiometrics()
      if (result.ok) {
        markVerified()
        onSuccess()
        return
      }
      // Denied or unavailable — fall through to PIN modal
    }

    // Show PIN modal
    setDigits(Array(PIN_LENGTH).fill(''))
    setErrorMsg('')
    setShake(false)
    setLocked(false)
    setLockSeconds(0)
    setOpen(true)
  }, [])

  // ── PIN submission ───────────────────────────────────────────────
  const submitPin = useCallback(async (pin: string) => {
    if (submitting || locked) return
    setSubmitting(true)
    setErrorMsg('')
    try {
      await verifyPin(pin)
      markVerified()
      setOpen(false)
      setDigits(Array(PIN_LENGTH).fill(''))
      pendingRef.current?.()
      pendingRef.current = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      // Parse 429 — message is "Too many attempts. Try again in N seconds."
      const lockMatch = msg.match(/(\d+)\s*seconds?/)
      if (lockMatch) {
        const secs = parseInt(lockMatch[1], 10)
        setLocked(true)
        setLockSeconds(secs)
        setDigits(Array(PIN_LENGTH).fill(''))
        setErrorMsg('')
        countdownRef.current = setInterval(() => {
          setLockSeconds(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current!)
              countdownRef.current = null
              setLocked(false)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } else {
        // 401 wrong PIN — shake
        setShake(true)
        setErrorMsg('Incorrect PIN')
        setDigits(Array(PIN_LENGTH).fill(''))
        setTimeout(() => setShake(false), 600)
      }
    } finally {
      setSubmitting(false)
    }
  }, [submitting, locked])

  // ── Digit pad handler ────────────────────────────────────────────
  const handleDigit = useCallback((digit: string) => {
    if (locked || submitting) return
    setDigits(prev => {
      const next = [...prev]
      const idx  = next.findIndex(d => d === '')
      if (idx === -1) return prev
      next[idx] = digit
      if (idx === PIN_LENGTH - 1) {
        setTimeout(() => submitPin(next.join('')), 0)
      }
      return next
    })
    setErrorMsg('')
  }, [locked, submitting, submitPin])

  const handleBackspace = useCallback(() => {
    if (locked || submitting) return
    setDigits(prev => {
      const next = [...prev]
      let idx = -1
      for (let i = PIN_LENGTH - 1; i >= 0; i--) {
        if (next[i] !== '') { idx = i; break }
      }
      if (idx === -1) return prev
      next[idx] = ''
      return next
    })
  }, [locked, submitting])

  const handleClose = useCallback(() => {
    setOpen(false)
    pendingRef.current = null
    setDigits(Array(PIN_LENGTH).fill(''))
    setErrorMsg('')
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setLocked(false)
    setLockSeconds(0)
  }, [])

  // ── GatekeeperModal component ────────────────────────────────────
  function GatekeeperModal() {
    if (!open) return null

    const padDisabled = locked || submitting

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-t-3xl sm:rounded-3xl shadow-2xl px-6 pt-6 pb-8">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[16px] font-bold text-[var(--color-text)]">Confirm it's you</h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[22px] leading-none cursor-pointer"
              aria-label="Cancel"
            >
              ×
            </button>
          </div>

          {/* Dot indicators */}
          <div
            className={`flex justify-center gap-4 mb-3 transition-transform ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
          >
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

          {/* Error / lockout message */}
          <div className="h-5 flex items-center justify-center mb-4">
            {locked ? (
              <p className="text-[12px] font-semibold text-amber-600">
                Locked for {lockSeconds}s…
              </p>
            ) : errorMsg ? (
              <p className="text-[12px] font-semibold text-red-500">{errorMsg}</p>
            ) : null}
          </div>

          {/* Digit pad */}
          <div
            className={`grid grid-cols-3 gap-2 transition-opacity ${padDisabled ? 'opacity-40 pointer-events-none' : ''}`}
          >
            {['1','2','3','4','5','6','7','8','9'].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => handleDigit(d)}
                className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
              >
                {d}
              </button>
            ))}
            {/* Bottom row: empty, 0, backspace */}
            <div />
            <button
              type="button"
              onClick={() => handleDigit('0')}
              className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[18px] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
              aria-label="Backspace"
            >
              ⌫
            </button>
          </div>

          {/* Forgot PIN link */}
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => {
                handleClose()
                navigate('/parent?settings=security&view=pin')
              }}
              className="text-[12px] text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)]"
            >
              Forgot PIN? Manage in Settings
            </button>
          </div>

        </div>
      </div>
    )
  }

  return { challenge, GatekeeperModal }
}
