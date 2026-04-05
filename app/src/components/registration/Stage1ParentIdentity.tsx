/**
 * Stage 1 — Parent Custodian (Identity)
 * Polished fintech UI: floating labels, real-time validation,
 * password strength meter, teal active states, haptic feedback on CTA.
 */

import { useState, useId } from 'react'
import { Users, User, Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RegistrationState } from './RegistrationShell'

interface Props {
  data: RegistrationState
  onNext: (patch: Partial<RegistrationState>) => void
}

// ── Password strength ─────────────────────────────────────────────────────────

interface StrengthResult { score: 0 | 1 | 2 | 3; label: string; color: string }

function getStrength(pw: string): StrengthResult {
  if (pw.length === 0) return { score: 0, label: '', color: '' }
  let s = 0
  if (pw.length >= 8)              s++
  if (/[A-Z]/.test(pw))           s++
  if (/[0-9!@#$%^&*]/.test(pw))   s++
  const map: StrengthResult[] = [
    { score: 0, label: '',        color: '' },
    { score: 1, label: 'Weak',    color: 'bg-red-400' },
    { score: 2, label: 'Fair',    color: 'bg-amber-400' },
    { score: 3, label: 'Strong',  color: 'bg-teal-500' },
  ]
  return map[s] as StrengthResult
}

// ── Email validation ──────────────────────────────────────────────────────────

function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }

// ── Haptic feedback ───────────────────────────────────────────────────────────

function vibrate() {
  if ('vibrate' in navigator) navigator.vibrate(10)
}

// ── Main component ────────────────────────────────────────────────────────────

export function Stage1ParentIdentity({ data, onNext }: Props) {
  const [displayName,   setDisplayName]   = useState(data.display_name ?? '')
  const [email,         setEmail]         = useState(data.email ?? '')
  const [password,      setPassword]      = useState(data.password ?? '')
  const [showPassword,  setShowPassword]  = useState(false)
  const [parentingMode, setParentingMode] = useState<'single' | 'co-parenting'>(
    data.parenting_mode ?? 'single'
  )
  const [touched, setTouch] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  const strength = getStrength(password)

  // Live validation — only show errors after field is touched or submit attempted
  const errors = {
    displayName: !displayName.trim()      ? 'Your name is required' : '',
    email:       !isValidEmail(email)     ? 'Enter a valid email address' : '',
    password:    password.length < 8     ? 'Minimum 8 characters' : '',
  }

  const showError = (field: keyof typeof errors) =>
    (touched[field] || submitted) && errors[field]

  function blur(field: string) {
    setTouch(t => ({ ...t, [field]: true }))
  }

  function handleNext() {
    setSubmitted(true)
    if (errors.displayName || errors.email || errors.password) return
    vibrate()
    onNext({
      display_name:    displayName.trim(),
      email:           email.toLowerCase().trim(),
      password,
      parenting_mode:  parentingMode,
      governance_mode: parentingMode === 'co-parenting' ? 'standard' : 'amicable',
    })
  }

  return (
    <div className="space-y-8">

      {/* ── Trust header ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-full bg-teal-50 p-1.5 border border-teal-200">
            <ShieldCheck size={14} className="text-teal-600" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-semibold text-teal-700 tracking-wide uppercase">
            Secure account creation
          </span>
        </div>
        <h2 className="text-[26px] font-extrabold tracking-tight text-gray-900 leading-tight">
          Your Identity
        </h2>
        <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
          You are the Lead Custodian of this family record. All actions are
          logged against your verified identity.
        </p>
      </div>

      {/* ── Family structure ─────────────────────────────────────────── */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-3">
          Family structure
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            active={parentingMode === 'single'}
            onClick={() => setParentingMode('single')}
            icon={<User size={22} />}
            title="Single Parent"
            description="I'm the sole lead"
          />
          <ModeCard
            active={parentingMode === 'co-parenting'}
            onClick={() => setParentingMode('co-parenting')}
            icon={<Users size={22} />}
            title="Co-Parenting"
            description="Share the journey with a co-parent."
          />
        </div>
        {parentingMode === 'co-parenting' && (
          <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3 py-2.5">
            <ShieldCheck size={13} className="text-teal-600 mt-0.5 shrink-0" />
            <p className="text-xs text-teal-800 leading-relaxed">
              Dual-approval governance will be enabled. Your co-parent joins via
              a secure invite code in Step 4.
            </p>
          </div>
        )}
      </fieldset>

      {/* ── Fields ───────────────────────────────────────────────────── */}
      <div className="space-y-5">

        {/* Name */}
        <FloatingField
          id="display_name"
          label="Your full name"
          value={displayName}
          onChange={setDisplayName}
          onBlur={() => blur('displayName')}
          autoComplete="name"
          error={showError('displayName') || ''}
        />

        {/* Email */}
        <FloatingField
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          onBlur={() => blur('email')}
          autoComplete="email"
          error={showError('email') || ''}
          hint="Used for secure identity verification and audit trails"
          trailingIcon={
            touched.email && email
              ? isValidEmail(email)
                ? <CheckCircle2 size={16} className="text-teal-500" />
                : <XCircle size={16} className="text-red-400" />
              : null
          }
        />

        {/* Password + strength */}
        <div className="space-y-2">
          <FloatingField
            id="password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            onBlur={() => blur('password')}
            autoComplete="new-password"
            error={showError('password') || ''}
            trailingIcon={
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(s => !s)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            }
          />

          {/* Strength meter */}
          {password.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-all duration-300',
                      strength.score >= i ? strength.color : 'bg-gray-200'
                    )}
                  />
                ))}
              </div>
              {strength.label && (
                <p className={cn(
                  'text-xs font-medium',
                  strength.score === 1 && 'text-red-500',
                  strength.score === 2 && 'text-amber-600',
                  strength.score === 3 && 'text-teal-600',
                )}>
                  {strength.label} password
                  {strength.score < 3 && ' — add uppercase letters or numbers'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleNext}
        className={cn(
          'w-full h-13 rounded-xl font-semibold text-base text-white',
          'bg-teal-600 hover:bg-teal-700 active:scale-[0.98] cursor-pointer',
          'transition-all duration-150 shadow-sm hover:shadow-md',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        )}
      >
        Continue
      </button>

    </div>
  )
}

// ── ModeCard ──────────────────────────────────────────────────────────────────

function ModeCard({
  active, onClick, icon, title, description,
}: {
  active: boolean; onClick: () => void
  icon: React.ReactNode; title: string; description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-2.5 rounded-2xl border-2 p-4 text-left',
        'transition-all duration-150 cursor-pointer',
        active
          ? 'border-teal-500 bg-teal-50 shadow-md'
          : 'border-gray-200 bg-white hover:border-teal-300 hover:bg-teal-50/40 hover:shadow-sm',
      )}
    >
      <span className={cn(
        'rounded-xl p-2 transition-colors',
        active ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-500 group-hover:bg-teal-100 group-hover:text-teal-600',
      )}>
        {icon}
      </span>
      <div>
        <p className={cn('text-sm font-bold', active ? 'text-teal-700' : 'text-gray-800')}>
          {title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  )
}

// ── FloatingField ─────────────────────────────────────────────────────────────

interface FloatingFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  type?: string
  autoComplete?: string
  error?: string
  hint?: string
  trailingIcon?: React.ReactNode
}

function FloatingField({
  id, label, value, onChange, onBlur, type = 'text',
  autoComplete, error, hint, trailingIcon,
}: FloatingFieldProps) {
  const [focused, setFocused] = useState(false)
  const uid = useId()
  const floated = focused || value.length > 0

  return (
    <div className="space-y-1">
      <div className="relative">
        {/* Floating label */}
        <label
          htmlFor={uid + id}
          className={cn(
            'absolute left-3.5 transition-all duration-150 pointer-events-none select-none',
            floated
              ? 'top-2 text-[10px] font-semibold tracking-wide'
              : 'top-1/2 -translate-y-1/2 text-sm',
            focused
              ? 'text-teal-600'
              : error
              ? 'text-red-500'
              : floated
              ? 'text-gray-500'
              : 'text-gray-400',
          )}
        >
          {label}
        </label>

        <input
          id={uid + id}
          type={type}
          value={value}
          autoComplete={autoComplete}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur?.() }}
          className={cn(
            'w-full rounded-xl border bg-gray-50 px-3.5 pb-2.5 pt-6 text-sm text-gray-900',
            'transition-all duration-150 outline-none',
            trailingIcon ? 'pr-10' : '',
            focused
              ? 'border-teal-500 ring-2 ring-teal-500/20'
              : error
              ? 'border-red-400 ring-2 ring-red-400/10'
              : 'border-gray-200 hover:border-gray-300',
          )}
        />

        {/* Trailing icon */}
        {trailingIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {trailingIcon}
          </div>
        )}
      </div>

      {/* Error or hint */}
      {error
        ? <p className="text-xs text-red-500 font-medium pl-1">{error}</p>
        : hint
        ? <p className="text-xs text-gray-400 pl-1">{hint}</p>
        : null
      }
    </div>
  )
}
