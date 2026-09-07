/**
 * JoinFamilyScreen — invite-code entry for children and co-parents.
 *
 * Flow:
 *   Step 1 (code)     — 6-char invite code input, auto-submit on 6th char
 *   Step 2 (details)  — child: display name only / co-parent: name + email + password
 *   Step 3 (secure)   — biometric / PIN setup (mirrors Stage3SecureApp)
 *   Done              — write DeviceIdentity → navigate to dashboard
 *
 * Conditional routing: if a DeviceIdentity already exists, redirect to /lock.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate }                  from 'react-router-dom'
import { ShieldCheck, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { FullLogo }                     from '@/components/ui/Logo'
import { cn }                           from '@/lib/utils'
import { getDeviceIdentity, setDeviceIdentity, toInitials, hashPin } from '@/lib/deviceIdentity'
import { isBiometricsAvailable, registerBiometrics }        from '@/lib/biometrics'
import { analytics, track, applyInheritedChildConsent } from '@/lib/analytics'
import { apiUrl, setToken }             from '@/lib/api'
import { TurnstileWidget }              from '@/components/ui/TurnstileWidget'
import * as Sentry                      from '@sentry/react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'code' | 'details' | 'securing' | 'done'
type SecureScreen = 'checking' | 'biometric-prompt' | 'biometric-success' | 'pin'

const PIN_LENGTH = 4
const CODE_LENGTH = 6

interface RedeemResponse {
  token:       string
  role:        'child' | 'co-parent'
  user_id:     string
  family_id:   string
  display_name?: string
  /** Family-effective analytics decision (veto model) — present for child joins. */
  child_analytics?: boolean
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function JoinFamilyScreen() {
  const navigate = useNavigate()

  // Personal-device rule: if already registered, skip straight to lock screen.
  useEffect(() => {
    if (getDeviceIdentity()) navigate('/lock', { replace: true })
  }, [navigate])

  const [step,        setStep]        = useState<Step>('code')

  // Code step state — array of chars (one per box), same pattern as the PIN
  // entry below; `code` is the derived joined string other logic reads.
  const [codeChars,   setCodeChars]   = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const code = codeChars.join('')
  const [codeError,   setCodeError]   = useState('')
  const [codeShake,   setCodeShake]   = useState(false)
  const [checking,    setChecking]    = useState(false)
  const codeRefs = useRef<(HTMLInputElement | null)[]>([])

  // Resolved after code check
  const [inviteRole,  setInviteRole]  = useState<'child' | 'co-parent' | null>(null)

  // Details step state
  const [displayName, setDisplayName] = useState('')
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined)

  // Redeemed identity (filled after successful /auth/invite/redeem)
  const [redeemedData, setRedeemedData] = useState<RedeemResponse | null>(null)

  // Security step state
  const [secureScreen, setSecureScreen] = useState<SecureScreen>('checking')
  const [pin,          setPin]          = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [confirmPin,   setConfirmPin]   = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [pinStage,     setPinStage]     = useState<'enter' | 'confirm'>('enter')
  const [pinError,     setPinError]     = useState('')
  const enterRefs   = useRef<(HTMLInputElement | null)[]>([])
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([])
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null)
  const secureHeadingRef  = useRef<HTMLHeadingElement>(null)

  // ── Auto-focus code input on mount ─────────────────────────────────────────
  useEffect(() => {
    if (step === 'code') {
      setTimeout(() => codeRefs.current[0]?.focus(), 80)
    }
  }, [step])

  // ── Focus the step heading whenever the step changes, so screen reader
  //    users get a clear signal a new step loaded (code step focuses its
  //    input directly above, so only details/securing need a heading focus).
  useEffect(() => {
    if (step === 'details') detailsHeadingRef.current?.focus()
  }, [step])

  useEffect(() => {
    secureHeadingRef.current?.focus()
  }, [secureScreen])

  // ── Step 1: code input ─────────────────────────────────────────────────────

  // Segmented-box entry — mirrors the PIN box pattern below (auto-advance,
  // backspace-to-previous), so the two 6th and 4th shared screen no longer
  // feel like two different input systems.
  function handleCodeBoxInput(idx: number, value: string) {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!raw) return
    const char = raw.slice(-1)
    const next = [...codeChars]
    next[idx] = char
    setCodeChars(next)
    setCodeError('')

    if ('vibrate' in navigator) navigator.vibrate(8)

    if (idx < CODE_LENGTH - 1) {
      codeRefs.current[idx + 1]?.focus()
    } else {
      const full = next.join('')
      if (full.length === CODE_LENGTH) validateCode(full)
    }
  }

  function handleCodeBoxKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key !== 'Backspace') return
    if (codeChars[idx]) {
      const next = [...codeChars]; next[idx] = ''; setCodeChars(next)
    } else if (idx > 0) {
      codeRefs.current[idx - 1]?.focus()
      const next = [...codeChars]; next[idx - 1] = ''; setCodeChars(next)
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return
    const next = Array(CODE_LENGTH).fill('')
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setCodeChars(next)
    setCodeError('')
    codeRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus()
    if (pasted.length === CODE_LENGTH) validateCode(pasted)
  }

  async function validateCode(codeToCheck: string) {
    setChecking(true)
    setCodeError('')

    try {
      // Peek at the invite to get its role without redeeming yet.
      // Worker: POST /auth/invite/peek { code } → { role }
      // Fallback: if peek isn't wired, we infer from the redeem response.
      // For now use a lightweight check endpoint (same as redeem but with peek=true).
      const res = await fetch(apiUrl('/auth/invite/peek'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: codeToCheck }),
      })

      if (res.ok) {
        const data = await res.json() as { role: 'child' | 'co-parent' }
        setInviteRole(data.role)
        setStep('details')
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        triggerShake()
        setCodeError(body.error ?? 'That code didn\'t work. Check it and try again.')
        if ('vibrate' in navigator) navigator.vibrate([50, 30, 50, 30, 50])
        Sentry.captureMessage('Join: invalid invite code entered', { level: 'info' })
      }
    } catch {
      triggerShake()
      setCodeError('Something went wrong. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  function triggerShake() {
    setCodeShake(true)
    setTimeout(() => setCodeShake(false), 600)
  }

  // ── Step 2: details → redeem ───────────────────────────────────────────────

  async function handleDetailSubmit() {
    const name = displayName.trim()
    if (!name) { setDetailError('Please enter a name.'); return }
    if (inviteRole === 'co-parent') {
      if (!email.trim())    { setDetailError('Please enter your email.'); return }
      if (password.length < 8) { setDetailError('Password must be at least 8 characters.'); return }
    }

    setSubmitting(true)
    setDetailError('')

    try {
      const body: Record<string, string> = {
        code:         code,
        display_name: name,
      }
      if (inviteRole === 'co-parent') {
        body['email']    = email.trim().toLowerCase()
        body['password'] = password
      }
      if (turnstileToken) body['turnstile_token'] = turnstileToken

      const res = await fetch(apiUrl('/auth/invite/redeem'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setDetailError(err.error ?? 'Something went wrong. Please try again.')
        Sentry.captureMessage('Join: invite redeem failed', {
          level: 'warning',
          extra: { role: inviteRole },
        })
        return
      }

      const data = await res.json() as RedeemResponse
      await setToken(data.token)
      setRedeemedData({ ...data, display_name: name })
      setStep('securing')
      // Biometric check kicks off via useEffect watching step === 'securing'
    } catch {
      setDetailError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 3: security setup ─────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'securing' || !redeemedData) return
    setSecureScreen('checking')
    isBiometricsAvailable().then(available => {
      if (available) {
        setSecureScreen('biometric-prompt')
        triggerBiometrics()
      } else {
        setSecureScreen('pin')
        setTimeout(() => enterRefs.current[0]?.focus(), 100)
      }
    })
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  async function triggerBiometrics() {
    if (!redeemedData) return
    const userId = redeemedData.user_id
    const name   = redeemedData.display_name ?? displayName.trim()
    const result = await registerBiometrics(userId, name)
    if (result.ok) {
      if ('vibrate' in navigator) navigator.vibrate([10, 50, 10])
      Sentry.setTag('auth_method', 'biometrics')
      setSecureScreen('biometric-success')
      setTimeout(() => finaliseIdentity('biometrics', null), 1200)
    } else {
      setSecureScreen('pin')
      setTimeout(() => enterRefs.current[0]?.focus(), 100)
    }
  }

  async function finaliseIdentity(authMethod: 'biometrics' | 'pin' | 'none', pinValue: string | null) {
    if (!redeemedData) return
    const name = redeemedData.display_name ?? displayName.trim()
    const role = redeemedData.role === 'co-parent' ? 'parent' as const : 'child' as const
    const pin_hash = (authMethod === 'pin' && pinValue) ? await hashPin(pinValue) : undefined

    setDeviceIdentity({
      user_id:        redeemedData.user_id,
      family_id:      redeemedData.family_id,
      display_name:   name,
      role,
      parenting_role: redeemedData.role === 'co-parent' ? 'CO_PARENT' : undefined,
      initials:       toInitials(name),
      registered_at:  new Date().toISOString(),
      auth_method:    authMethod,
      pin_hash,
    })

    // Child devices inherit the family-effective analytics decision (events only,
    // replay always off). Apply before identify so capture is live if allowed.
    // Co-parents arrive with no consent and stay off until they opt in via Settings.
    if (role === 'child') {
      applyInheritedChildConsent(redeemedData.child_analytics ?? false)
    }

    Sentry.setUser({ id: redeemedData.user_id })
    Sentry.setTag('auth_method', authMethod)
    analytics.identify(redeemedData.user_id, { role, family_id: redeemedData.family_id })
    track.joinCompleted({ role: redeemedData.role })

    const destination = role === 'parent' ? '/parent' : '/child'
    window.location.href = destination
  }

  // ── PIN handlers ───────────────────────────────────────────────────────────

  const currentPinArr = pinStage === 'enter' ? pin : confirmPin
  const setCurrentPin = pinStage === 'enter' ? setPin : setConfirmPin
  const currentRefs   = pinStage === 'enter' ? enterRefs : confirmRefs

  function handlePinInput(idx: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...currentPinArr]
    next[idx] = char
    setCurrentPin(next)
    setPinError('')

    if (idx < PIN_LENGTH - 1) {
      currentRefs.current[idx + 1]?.focus()
    } else if (pinStage === 'enter') {
      setPinStage('confirm')
      setTimeout(() => confirmRefs.current[0]?.focus(), 50)
    } else {
      const entered    = pin.join('')
      const confirmed  = next.join('')
      if (entered !== confirmed) {
        setPinError("Those PINs don't match — try again.")
        setConfirmPin(Array(PIN_LENGTH).fill(''))
        setTimeout(() => confirmRefs.current[0]?.focus(), 50)
      } else {
        Sentry.setTag('auth_method', 'pin')
        finaliseIdentity('pin', entered)
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">

      <header className="safe-top sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,.05)] px-4 py-3 flex items-center gap-2.5">
        <FullLogo iconSize={26} />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-12 max-w-md mx-auto w-full">

        {/* ── Step 1: code ───────────────────────────────────────────────── */}
        {step === 'code' && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h1 className="text-[1.625rem] font-extrabold text-main tracking-tight mb-2">
                Join a Family
              </h1>
              <p className="text-[0.875rem] text-muted leading-relaxed">
                Enter the 6-character code shared by the person who set up your account.
              </p>
            </div>

            <div className="space-y-3">
              <div
                className={cn('flex justify-center gap-2', codeShake && 'animate-shake')}
                role="group"
                aria-label="6-character invite code"
                aria-invalid={!!codeError}
                aria-describedby={codeError ? 'join-code-error' : undefined}
              >
                {codeChars.map((char, i) => (
                  <input
                    key={i}
                    ref={el => { codeRefs.current[i] = el }}
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={1}
                    value={char}
                    onChange={e => handleCodeBoxInput(i, e.target.value)}
                    onKeyDown={e => handleCodeBoxKeyDown(i, e)}
                    onPaste={handleCodePaste}
                    disabled={checking}
                    aria-label={`Invite code character ${i + 1}`}
                    className={cn(
                      'w-11 h-14 rounded-xl border-2 text-center text-[1.375rem] font-extrabold text-main',
                      'bg-white outline-none transition-colors duration-100',
                      codeError ? 'border-red-400 bg-red-50 text-red-600' : char ? 'border-teal-500' : 'border-subtle',
                      'focus:border-teal-500',
                      checking && 'opacity-60',
                    )}
                  />
                ))}
              </div>

              {codeError && (
                <p id="join-code-error" role="alert" className="text-[0.8125rem] font-semibold text-red-600 text-center">{codeError}</p>
              )}

              {checking && (
                <p className="text-[0.8125rem] text-muted text-center">Checking code…</p>
              )}

              <button
                onClick={() => validateCode(code)}
                disabled={code.length < 6 || checking}
                className="
                  w-full h-14 rounded-2xl bg-teal-600 text-white
                  font-semibold text-[0.9375rem] tracking-tight
                  hover:bg-teal-700 active:scale-[0.98] disabled:opacity-40
                  transition-all duration-150 shadow-md cursor-pointer
                "
              >
                {checking ? 'Checking…' : 'Continue'}
              </button>

              <button
                onClick={() => navigate('/')}
                className="w-full text-center text-[0.8125rem] text-muted underline underline-offset-2 cursor-pointer hover:text-main transition-colors py-1"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: details ────────────────────────────────────────────── */}
        {step === 'details' && (
          <div className="w-full space-y-6">
            <div className="text-center">
              <h1 ref={detailsHeadingRef} tabIndex={-1} className="text-[1.625rem] font-extrabold text-main tracking-tight mb-2 outline-none">
                {inviteRole === 'child' ? 'What\'s your name?' : 'Create your account'}
              </h1>
              <p className="text-[0.875rem] text-muted leading-relaxed">
                {inviteRole === 'child'
                  ? 'Use the name your parent gave you, or a nickname — your choice.'
                  : 'Set up your account so you can manage the family together.'}
              </p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                autoFocus
                placeholder={inviteRole === 'child' ? 'Your nickname or first name' : 'Your name'}
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setDetailError('') }}
                required
                aria-required="true"
                aria-invalid={!!detailError}
                aria-describedby={detailError ? 'join-detail-error' : undefined}
                className="
                  w-full h-14 rounded-xl border-2 border-subtle px-4 text-[1rem]
                  text-main bg-white outline-none focus:border-teal-500 transition-colors
                "
              />

              {inviteRole === 'co-parent' && (
                <>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setDetailError('') }}
                    required
                    aria-required="true"
                    aria-invalid={!!detailError}
                    aria-describedby={detailError ? 'join-detail-error' : undefined}
                    className="
                      w-full h-14 rounded-xl border-2 border-subtle px-4 text-[1rem]
                      text-main bg-white outline-none focus:border-teal-500 transition-colors
                    "
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password (min 8 characters)"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setDetailError('') }}
                      required
                      aria-required="true"
                      aria-invalid={!!detailError}
                      aria-describedby={detailError ? 'join-detail-error' : undefined}
                      className="
                        w-full h-14 rounded-xl border-2 border-subtle pl-4 pr-11 text-[1rem]
                        text-main bg-white outline-none focus:border-teal-500 transition-colors
                      "
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </>
              )}

              {detailError && (
                <p id="join-detail-error" role="alert" className="text-[0.8125rem] font-semibold text-red-600 text-center">{detailError}</p>
              )}

              <TurnstileWidget onVerify={setTurnstileToken} />

              <button
                onClick={handleDetailSubmit}
                disabled={submitting}
                className="
                  w-full h-14 rounded-2xl bg-teal-600 text-white
                  font-semibold text-[0.9375rem] tracking-tight
                  hover:bg-teal-700 active:scale-[0.98] disabled:opacity-40
                  transition-all duration-150 shadow-md cursor-pointer
                  flex items-center justify-center gap-2
                "
              >
                {submitting ? 'Joining…' : 'Join Family'} {!submitting && <ChevronRight size={16} />}
              </button>

              <button
                onClick={() => { setStep('code'); setDetailError('') }}
                className="w-full text-center text-[0.8125rem] text-muted underline underline-offset-2 cursor-pointer hover:text-main transition-colors py-1"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: biometric/PIN setup ────────────────────────────────── */}
        {step === 'securing' && (
          <div className="w-full">

            {secureScreen === 'checking' && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                <p className="text-sm text-muted">Checking your device…</p>
              </div>
            )}

            {secureScreen === 'biometric-success' && (
              <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
                <div className="w-24 h-24 rounded-full bg-teal-50 border-2 border-teal-200 flex items-center justify-center">
                  <span className="text-5xl">✓</span>
                </div>
                <div>
                  <h2 ref={secureHeadingRef} tabIndex={-1} className="text-[1.375rem] font-extrabold text-main tracking-tight outline-none">Face ID enabled</h2>
                  <p className="text-sm text-muted mt-1.5">Your app is now protected. Taking you in…</p>
                </div>
              </div>
            )}

            {secureScreen === 'biometric-prompt' && (
              <div className="space-y-8">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="rounded-full bg-teal-50 p-1.5 border border-teal-200">
                      <ShieldCheck size={14} className="text-teal-600" strokeWidth={2.5} />
                    </div>
                    <span className="text-xs font-semibold text-teal-700 tracking-wide uppercase">App security</span>
                  </div>
                  <h2 ref={secureHeadingRef} tabIndex={-1} className="text-[1.625rem] font-extrabold tracking-tight text-main leading-tight outline-none">
                    Secure your App
                  </h2>
                  <p className="text-sm text-muted leading-relaxed">
                    Use Face ID or Touch ID so only you can open Morechard on this phone.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-5 py-6">
                  <div className="w-28 h-28 rounded-full bg-teal-50 border-2 border-teal-200 flex items-center justify-center animate-pulse">
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                      <rect x="4"  y="4"  width="12" height="3"  rx="1.5" fill="#0d9488"/>
                      <rect x="4"  y="4"  width="3"  height="12" rx="1.5" fill="#0d9488"/>
                      <rect x="40" y="4"  width="12" height="3"  rx="1.5" fill="#0d9488"/>
                      <rect x="49" y="4"  width="3"  height="12" rx="1.5" fill="#0d9488"/>
                      <rect x="4"  y="49" width="12" height="3"  rx="1.5" fill="#0d9488"/>
                      <rect x="4"  y="40" width="3"  height="12" rx="1.5" fill="#0d9488"/>
                      <rect x="40" y="49" width="12" height="3"  rx="1.5" fill="#0d9488"/>
                      <rect x="49" y="40" width="3"  height="12" rx="1.5" fill="#0d9488"/>
                      <circle cx="21" cy="23" r="2.5" fill="#0d9488"/>
                      <circle cx="35" cy="23" r="2.5" fill="#0d9488"/>
                      <path d="M20 35c2 3 14 3 16 0" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M28 23v5" stroke="#0d9488" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <p className="text-[0.8125rem] text-muted text-center">Follow the prompt on your device…</p>
                </div>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setSecureScreen('pin')}
                    className="flex-1 h-12 rounded-xl border-2 border-subtle bg-white text-sm font-semibold text-main hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer">
                    Use a PIN instead
                  </button>
                </div>
              </div>
            )}

            {secureScreen === 'pin' && (
              <div className="space-y-8">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="rounded-full bg-teal-50 p-1.5 border border-teal-200">
                      <ShieldCheck size={14} className="text-teal-600" strokeWidth={2.5} />
                    </div>
                    <span className="text-xs font-semibold text-teal-700 tracking-wide uppercase">App security</span>
                  </div>
                  <h2 ref={secureHeadingRef} tabIndex={-1} className="text-[1.625rem] font-extrabold tracking-tight text-main leading-tight outline-none">Set a PIN</h2>
                  <p className="text-sm text-muted leading-relaxed">
                    Choose a 4-digit PIN. You'll use this to open the app when your phone is locked.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <PinStep number={1} label="Choose a PIN"  active={pinStage === 'enter'}   done={pinStage === 'confirm'} />
                  <div className="flex-1 h-px bg-gray-200" />
                  <PinStep number={2} label="Confirm it"    active={pinStage === 'confirm'} done={false} />
                </div>

                <div className="space-y-5">
                  <div className={cn('space-y-3', pinStage === 'confirm' && 'opacity-40 pointer-events-none')}>
                    <p className="text-sm font-semibold text-main">Choose a PIN</p>
                    <div className="flex gap-3">
                      {pin.map((d, i) => (
                        <input key={i} ref={el => { enterRefs.current[i] = el }}
                          type="text" inputMode="numeric" maxLength={1} value={d}
                          onChange={e => pinStage === 'enter' && handlePinInput(i, e.target.value)}
                          onKeyDown={e => pinStage === 'enter' && handlePinKeyDown(i, pin, setPin, enterRefs, e)}
                          autoFocus={i === 0 && pinStage === 'enter'}
                          aria-label={`PIN digit ${i + 1}`}
                          className={cn(
                            'w-[54px] h-[66px] text-center text-[1.75rem] font-extrabold text-main',
                            'border-2 rounded-xl outline-none transition-colors duration-100 bg-white',
                            d ? 'border-teal-500' : 'border-subtle', 'focus:border-teal-500',
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <div className={cn('space-y-3', pinStage === 'enter' && 'opacity-40 pointer-events-none')}>
                    <p className="text-sm font-semibold text-main">Type it again to confirm</p>
                    <div className="flex gap-3">
                      {confirmPin.map((d, i) => (
                        <input key={i} ref={el => { confirmRefs.current[i] = el }}
                          type="text" inputMode="numeric" maxLength={1} value={d}
                          onChange={e => pinStage === 'confirm' && handlePinInput(i, e.target.value)}
                          onKeyDown={e => pinStage === 'confirm' && handlePinKeyDown(i, confirmPin, setConfirmPin, confirmRefs, e)}
                          aria-label={`Confirm PIN digit ${i + 1}`}
                          aria-invalid={!!pinError}
                          aria-describedby={pinError ? 'join-pin-mismatch-error' : undefined}
                          className={cn(
                            'w-[54px] h-[66px] text-center text-[1.75rem] font-extrabold text-main',
                            'border-2 rounded-xl outline-none transition-colors duration-100 bg-white',
                            pinError ? 'border-red-400 bg-red-50 text-red-700' : d ? 'border-teal-500' : 'border-subtle',
                            'focus:border-teal-500',
                          )}
                        />
                      ))}
                    </div>
                    {pinError && <p id="join-pin-mismatch-error" role="alert" className="text-xs font-semibold text-red-600">{pinError}</p>}
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                  <ShieldCheck size={14} className="text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted leading-relaxed">
                    Your PIN stays on this device and is never sent to our servers.
                  </p>
                </div>

                <button type="button" onClick={() => finaliseIdentity('none', null)}
                  className="w-full h-12 rounded-xl border-2 border-subtle bg-white text-sm font-semibold text-main hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5">
                  Skip for now <ChevronRight size={16} />
                </button>
              </div>
            )}

          </div>
        )}

      </main>
    </div>
  )
}

// ── PIN step indicator ────────────────────────────────────────────────────────

function PinStep({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
        done || active ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400',
      )}>
        {done ? '✓' : number}
      </div>
      <span className={cn('text-xs font-semibold', active ? 'text-main' : 'text-muted')}>{label}</span>
    </div>
  )
}
