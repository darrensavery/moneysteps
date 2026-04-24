/**
 * RegistrationShell — orchestrates the 3-step parent setup flow.
 *
 * Step 1 — About You       (name, email, password, single/co-parenting)
 * Step 2 — Family Setup    (currency, approval style if co-parenting)
 * Step 3 — Secure your App (optional 4-digit PIN)
 * Step 4 — Invite Partner  (co-parenting only — generate invite code)
 *
 * Children are added AFTER registration from the parent dashboard.
 * This avoids any "add child" API calls before the account fully exists.
 */

import { useState } from 'react'
import { FullLogo } from '../ui/Logo'
import { Stage1ParentIdentity }     from './Stage1ParentIdentity'
import { Stage2FamilyConstitution } from './Stage2FamilyConstitution'
import { Stage3SecureApp }          from './Stage3SecureApp'
import { Stage4CoParentBridge }     from './Stage4CoParentBridge'
import { WelcomeNudge }             from './WelcomeNudge'
import { createFamily, requestMagicLink, saveRegistrationStep } from '@/lib/api'
import { detectLocale, type AppLocale } from '@/lib/locale'

// ── Shared state ─────────────────────────────────────────────────────────────

export interface ChildRecord {
  child_id:     string
  display_name: string
  invite_code:  string
  expires_at:   number
}

export interface RegistrationState {
  // Step 1
  display_name?:    string
  email?:           string
  password?:        string
  parenting_mode?:  'single' | 'co-parenting'
  governance_mode?: 'amicable' | 'standard'

  // Step 2
  base_currency?: 'GBP' | 'USD' | 'PLN'   // add USD
  locale?:        AppLocale                 // new — no longer derived from currency

  // Step 3 — children added here; pin stored locally only
  children?: ChildRecord[]

  // Step 4
  coparent_invite_code?: string
  coparent_expires_at?:  number
  coparent_skipped?:     boolean

  // Internal
  family_id?: string
  user_id?:   string
}

// ── Step labels ───────────────────────────────────────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: 'About You',
  2: 'Family Setup',
  3: 'Secure your App',
  4: 'Invite your Partner',
}

// ── Shell ─────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (familyId: string, token: string, displayName: string, userId: string, authMethod: 'biometrics' | 'pin' | null, pin: string | null) => void
}

export function RegistrationShell({ onComplete }: Props) {
  const [step,         setStep]         = useState(1)
  const [done,         setDone]         = useState(false)
  const [awaitingEmail, setAwaitingEmail] = useState(false)  // waiting for magic link click
  const [state,        setState]        = useState<RegistrationState>({})
  const [error,        setError]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [authMethod,   setAuthMethod]   = useState<'biometrics' | 'pin' | null>(null)
  const [pin,          setPin]          = useState<string | null>(null)

  const isCoParenting = state.parenting_mode === 'co-parenting'
  const totalSteps    = isCoParenting ? 4 : 3
  const progress      = Math.round((step / totalSteps) * 100)

  async function advanceStep(patch: Partial<RegistrationState>) {
    setError('')
    setSaving(true)

    const merged: RegistrationState = { ...state, ...patch }
    setState(merged)

    try {
      if (step === 1) {
        // Step 1 just collects identity — advance to Step 2 (currency) first
        setSaving(false)
        setStep(2)
        return
      }

      if (step === 2) {
        // Create account only once — skip if already done (user went back)
        if (!merged.family_id) {
          const referredByCode = localStorage.getItem('morechard_referral_code') ?? undefined
          const familyResult = await createFamily({
            display_name:      merged.display_name!,
            email:             merged.email!,
            password:          merged.password!,
            locale:            merged.locale ?? detectLocale(),
            parenting_mode:    merged.parenting_mode!,
            governance_mode:   merged.governance_mode ?? 'amicable',
            base_currency:     merged.base_currency ?? 'GBP',
            ...(referredByCode ? { referred_by_code: referredByCode } : {}),
          })
          // Clear referral code after successful family creation
          localStorage.removeItem('morechard_referral_code')

          merged.family_id = familyResult.family_id
          merged.user_id   = familyResult.user_id
          setState(merged)

          // Send magic link — user must verify email before continuing
          await requestMagicLink(merged.email!)
        }

        // Show "check your email" screen — steps 3+ run after email verified
        setSaving(false)
        setAwaitingEmail(true)
        return
      }

      // Step 3 — Secure your App: no server call, just advance
      if (step === 3) {
        if (!isCoParenting) {
          setDone(true)
        } else {
          setStep(4)
        }
        setSaving(false)
        return
      }

      // Step 4 — Co-Parent Bridge
      await saveRegistrationStep(4, { coparent_invited: !merged.coparent_skipped })
      setDone(true)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleStep3(patch: Partial<RegistrationState>, method: 'biometrics' | 'pin' | null, pinValue?: string) {
    setAuthMethod(method)
    if (pinValue) setPin(pinValue)
    advanceStep(patch)
  }

  function goBack() {
    setStep(s => Math.max(1, s - 1))
    setError('')
  }

  function handleNudgeDismiss() {
    onComplete(
      state.family_id!,
      localStorage.getItem('mc_token')!,
      state.display_name!,
      state.user_id!,
      authMethod,
      pin,
    )
  }

  if (done) {
    return (
      <RegistrationLayout step={null} totalSteps={totalSteps} progress={100}>
        <WelcomeNudge data={state} onFinish={handleNudgeDismiss} />
      </RegistrationLayout>
    )
  }

  if (awaitingEmail) {
    return (
      <RegistrationLayout step={2} totalSteps={totalSteps} progress={Math.round((2 / totalSteps) * 100)}>
        <CheckEmailScreen
          email={state.email!}
          onResend={async () => {
            await requestMagicLink(state.email!)
          }}
        />
      </RegistrationLayout>
    )
  }

  return (
    <RegistrationLayout step={step} totalSteps={totalSteps} progress={progress}>
      {error && (
        <div className="fixed top-[72px] left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="w-full max-w-md rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-lg pointer-events-auto">
            {error}
          </div>
        </div>
      )}

      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white border border-gray-200 p-8 shadow-lg">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
            <p className="text-sm font-medium text-[#6b6a66]">Setting things up…</p>
          </div>
        </div>
      )}

      {step === 1 && (
        <Stage1ParentIdentity
          data={state}
          onNext={patch => advanceStep(patch)}
        />
      )}
      {step === 2 && (
        <Stage2FamilyConstitution
          data={state}
          onNext={patch => advanceStep(patch)}
          onBack={goBack}
        />
      )}
      {step === 3 && (
        <Stage3SecureApp
          data={state}
          onNext={handleStep3}
          onBack={goBack}
        />
      )}
      {step === 4 && (
        <Stage4CoParentBridge
          data={state}
          onNext={patch => advanceStep(patch)}
          onBack={goBack}
        />
      )}
    </RegistrationLayout>
  )
}

// ── CheckEmailScreen ──────────────────────────────────────────────────────────

function CheckEmailScreen({ email, onResend }: { email: string; onResend: () => Promise<void> }) {
  const [resent,    setResent]    = useState(false)
  const [resending, setResending] = useState(false)

  async function handleResend() {
    setResending(true)
    try {
      await onResend()
      setResent(true)
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-full bg-teal-50 p-5">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-teal-600">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Check your email</h2>
          <p className="text-gray-500 text-sm mt-1 leading-relaxed max-w-xs mx-auto">
            We've sent a magic link to <strong className="text-gray-900">{email}</strong>.
            Click the link to verify your account and continue setup.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-left space-y-2">
        <p className="text-sm font-semibold text-gray-800">What to expect:</p>
        <ul className="text-sm text-gray-500 space-y-1.5">
          <li className="flex items-start gap-2"><span className="text-teal-600 mt-0.5">✓</span> An email from Morechard with a secure link</li>
          <li className="flex items-start gap-2"><span className="text-teal-600 mt-0.5">✓</span> The link is valid for 15 minutes</li>
          <li className="flex items-start gap-2"><span className="text-teal-600 mt-0.5">✓</span> Clicking it will bring you back here to finish setup</li>
        </ul>
      </div>

      <p className="text-sm text-gray-500">
        Didn't receive it? Check your spam folder, or{' '}
        {resent ? (
          <span className="text-teal-600 font-semibold">link resent!</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-teal-600 font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'resend the link'}
          </button>
        )}
      </p>
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

function RegistrationLayout({ step, totalSteps, progress, children }: {
  step: number | null
  totalSteps: number
  progress: number
  children: React.ReactNode
}) {
  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      <header className="safe-top sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-md mx-auto px-5 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FullLogo iconSize={26} />
            </div>
            {step !== null && (
              <div className="text-right">
                <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Step {step} of {totalSteps}
                </span>
                <p className="text-xs font-semibold text-[var(--color-text)] leading-none mt-0.5">
                  {STEP_LABELS[step]}
                </p>
              </div>
            )}
          </div>
          <div className="relative h-2 w-full rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-teal-500 transition-all duration-500 ease-in-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 py-8 max-w-md mx-auto w-full">
        {children}
      </main>

      <footer className="safe-bottom px-5 py-4 text-center border-t border-[var(--color-border)]">
        <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide">
          Your data is private and secure
        </p>
      </footer>
    </div>
  )
}
