import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { lazy, Suspense, useState, useEffect } from 'react'
import { ThemeProvider } from './lib/theme'
import { getDeviceIdentity, setDeviceIdentity, toInitials, hashPin } from './lib/deviceIdentity'
import { LocaleProvider } from './lib/locale'
import { analytics, track, applyInheritedChildConsent } from './lib/analytics'
import { apiUrl } from './lib/api'
import { primeAuthState, isAuthenticated } from './lib/authState'
import { Capacitor } from '@capacitor/core'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { AppUrlListener } from './components/AppUrlListener'
import { PushNotificationListener } from './components/PushNotificationListener'
import { AndroidBackController } from './components/AndroidBackController'
import { AppAutoLock } from './components/AppAutoLock'
import { hasSeenOnboarding }  from './lib/onboarding'

/**
 * One-time native migration: an existing install may still have the JWT in
 * localStorage from before this change. Write it into secure storage FIRST,
 * verify the write succeeded, and only THEN delete the localStorage copy —
 * if the secure-storage write fails, leaving localStorage intact gives the
 * app another chance to migrate on the next boot instead of hard-logging
 * the user out.
 */
async function migrateNativeTokenIfNeeded(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const legacy = localStorage.getItem('mc_token')
  if (!legacy) return
  try {
    await SecureStoragePlugin.set({ key: 'mc_token', value: legacy })
    const { value } = await SecureStoragePlugin.get({ key: 'mc_token' })
    if (value === legacy) {
      localStorage.removeItem('mc_token')
    }
    // else: write didn't verify — leave localStorage alone, retry next boot
  } catch {
    // secure storage unavailable this boot — leave localStorage alone, retry next boot
  }
}
// Sentry is deferred via requestIdleCallback in main.tsx — import lazily here too
// so vendor-sentry stays out of the initial module graph
async function getSentry() { return import('@sentry/react') }

const FullLogo             = lazy(() => import('./components/ui/Logo').then(m => ({ default: m.FullLogo })))
const RegistrationShell    = lazy(() => import('./components/registration/RegistrationShell').then(m => ({ default: m.RegistrationShell })))
const LandingGate          = lazy(() => import('./screens/LandingGate').then(m => ({ default: m.LandingGate })))
const ParentDashboard      = lazy(() => import('./screens/ParentDashboard').then(m => ({ default: m.ParentDashboard })))
const ChildDashboard       = lazy(() => import('./screens/ChildDashboard').then(m => ({ default: m.ChildDashboard })))
const JoinFamilyScreen     = lazy(() => import('./screens/JoinFamilyScreen').then(m => ({ default: m.JoinFamilyScreen })))
const LoginScreen          = lazy(() => import('./screens/LoginScreen'))
const AuthCallbackScreen   = lazy(() => import('./screens/AuthCallbackScreen'))
const PaywallScreen        = lazy(() => import('./screens/PaywallScreen').then(m => ({ default: m.PaywallScreen })))
const PaymentSuccessScreen = lazy(() => import('./screens/PaymentSuccessScreen').then(m => ({ default: m.PaymentSuccessScreen })))
const DemoRegisterScreen   = lazy(() => import('./components/demo/DemoRegisterScreen'))
const VerifyLedgerHashScreen = lazy(() => import('./screens/VerifyLedgerHashScreen').then(m => ({ default: m.VerifyLedgerHashScreen })))
const LockScreen             = lazy(() => import('./screens/LockScreen').then(m => ({ default: m.LockScreen })))
const OnboardingCarousel     = lazy(() => import('./screens/OnboardingCarousel').then(m => ({ default: m.OnboardingCarousel })))

/**
 * MagicLinkVerifyScreen — handles /auth/verify?token=...
 *
 * When a token is present, the browser is navigated directly to the worker
 * endpoint (/api/auth/verify?token=...). The worker validates the token and
 * redirects to /auth/callback?slt=... which AuthCallbackScreen handles.
 *
 * When the worker rejects a token it redirects back here with ?error=<code>
 * (e.g. expired, used, invalid) so this screen can show a friendly message.
 */
const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  used:    { title: 'Link already used',   body: 'This magic link has already been used. Each link can only be used once.' },
  expired: { title: 'Link expired',        body: 'Magic links expire after 15 minutes. Please request a new one.' },
  invalid: { title: 'Link not recognised', body: 'This link is invalid or was not issued by Morechard.' },
  missing: { title: 'No link token',       body: 'The sign-in link appears to be incomplete. Please use the full link from your email.' },
}

function MagicLinkVerifyScreen() {
  const [params]    = useSearchParams()
  const token       = params.get('token')
  const errorCode   = params.get('error')

  const [phase, setPhase]     = useState<'verifying' | 'error'>(errorCode ? 'error' : 'verifying')
  const [errMsg, setErrMsg]   = useState(errorCode ? (ERROR_MESSAGES[errorCode]?.body ?? 'Something went wrong.') : '')
  const [errTitle, setErrTitle] = useState(errorCode ? (ERROR_MESSAGES[errorCode]?.title ?? 'Sign-in failed') : '')

  useEffect(() => {
    if (errorCode) return  // error code already in URL — worker redirected here with ?error=

    if (!token) {
      setErrTitle('No link token')
      setErrMsg('The sign-in link appears to be incomplete. Please use the full link from your email.')
      setPhase('error')
      return
    }

    // Navigate the browser to the worker endpoint. The worker validates the token
    // and issues a 302 to /auth/callback?slt=... — AuthCallbackScreen handles the rest.
    window.location.replace(apiUrl(`/api/auth/verify?token=${encodeURIComponent(token)}`))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'verifying') {
    return (
      <div className="min-h-svh flex items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--color-text-muted)] font-medium">Verifying your email…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-[var(--color-bg)] px-5">
      <div className="max-w-sm w-full text-center space-y-5">
        <Suspense fallback={null}><FullLogo iconSize={26} /></Suspense>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-7 space-y-3 shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{errTitle || 'Sign-in failed'}</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">{errMsg}</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <a
            href="/auth/login"
            className="block w-full rounded-xl bg-[var(--brand-primary)] py-3 text-sm font-semibold text-white text-center active:scale-[0.98] transition-transform"
          >
            Request a new link
          </a>
          <a href="/register" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            Create a new account
          </a>
        </div>
      </div>
    </div>
  )
}

/** Root — cold start shows onboarding then landing page, returning user goes to lock screen. */
function RootGate() {
  const identity = getDeviceIdentity()
  // If identity exists, redirect immediately with no intermediate render.
  // Rendering LandingGate even for one frame causes a visible flash on
  // pull-to-refresh and after logout.
  if (identity) return <Navigate to="/lock" replace />
  if (!hasSeenOnboarding()) return <Navigate to="/onboarding" replace />
  return <LandingGate />
}

/** Guard dashboards — needs identity + session token, otherwise send to lock. */
function RequireSession({ children }: { children: React.ReactNode }) {
  const identity = getDeviceIdentity()
  if (!identity) return <Navigate to="/" replace />
  if (!isAuthenticated()) return <Navigate to="/lock" replace />
  return <>{children}</>
}

function SuspenseFallback() {
  return (
    <div className="min-h-svh flex items-center justify-center bg-[var(--color-bg)]">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent" />
    </div>
  )
}

export default function App() {
  async function handleRegistrationComplete(
    familyId: string,
    _token: string | null,
    displayName: string,
    userId: string,
    authMethod: 'biometrics' | 'pin' | null,
    pin: string | null,
  ) {
    const pin_hash = (authMethod === 'pin' && pin) ? await hashPin(pin) : undefined
    setDeviceIdentity({
      user_id:        userId,
      family_id:      familyId,
      display_name:   displayName,
      role:           'parent',
      parenting_role: 'LEAD_PARENT',
      initials:       toInitials(displayName),
      registered_at:  new Date().toISOString(),
      auth_method:    authMethod ?? 'none',
      pin_hash,
    })
    getSentry().then(S => { S.setUser({ id: userId }); S.setTag('auth_method', authMethod ?? 'none') })
    analytics.identify(userId, { role: 'parent', family_id: familyId })
    track.registrationCompleted({
      auth_method:     authMethod ?? 'none',
      parenting_mode:  'unknown',   // RegistrationShell can pass this when ready
      currency:        'unknown',
    })
    // Token stored by RegistrationShell — go straight to dashboard
    window.location.href = '/parent'
  }

  // Capture ?ref= referral code on first load and persist to localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && ref.length >= 6) {
      localStorage.setItem('morechard_referral_code', ref.toUpperCase())
      import('./lib/api').then(({ trackReferralClick }) =>
        trackReferralClick(ref.toUpperCase()).catch(() => null)
      )
    }
  }, [])

  // Child devices: refresh the family-effective analytics decision on boot so a
  // parent's later opt-in or veto propagates (events only — replay stays off).
  useEffect(() => {
    const id = getDeviceIdentity()
    if (id?.role !== 'child' || !isAuthenticated()) return
    import('./lib/api').then(({ getAnalyticsEffective }) =>
      getAnalyticsEffective()
        .then(({ child_analytics }) => applyInheritedChildConsent(child_analytics))
        .catch(() => null)
    )
  }, [])

  // Boot gate: prime in-memory auth state (and migrate any legacy native
  // localStorage token) before the router can render a guarded route —
  // RequireSession/isAuthenticated() would otherwise see a false "logged out"
  // on native during the async priming window.
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    migrateNativeTokenIfNeeded()
      .then(() => primeAuthState())
      .finally(() => setCheckingAuth(false))
  }, [])

  if (checkingAuth) {
    return <SuspenseFallback />
  }

  return (
    <LocaleProvider>
    <ThemeProvider>
    <BrowserRouter>
      <AppUrlListener />
      <PushNotificationListener />
      <AndroidBackController />
      <AppAutoLock />
      <Suspense fallback={<SuspenseFallback />}>
        <Routes>
          <Route path="/"           element={<RootGate />} />
          <Route path="/onboarding" element={<OnboardingCarousel />} />
          <Route path="/lock"       element={<LockScreen />} />
          <Route path="/join"     element={<JoinFamilyScreen />} />
          <Route
            path="/register"
            element={
              <RegistrationShell
                onComplete={(familyId, token, displayName, userId, authMethod, pin) =>
                  handleRegistrationComplete(familyId, token, displayName, userId, authMethod, pin)
                }
              />
            }
          />
          <Route path="/auth/verify"    element={<MagicLinkVerifyScreen />} />
          <Route path="/auth/login"    element={<LoginScreen />} />
          <Route path="/demo-register" element={<DemoRegisterScreen />} />
          <Route path="/auth/callback" element={<AuthCallbackScreen />} />
          <Route path="/paywall"          element={<PaywallScreen />} />
          <Route path="/payment-success"  element={<PaymentSuccessScreen />} />
          <Route path="/verify"        element={<VerifyLedgerHashScreen />} />
          <Route path="/verify/:hash" element={<VerifyLedgerHashScreen />} />
          <Route path="/parent" element={<RequireSession><ParentDashboard /></RequireSession>} />
          <Route path="/child"  element={<RequireSession><ChildDashboard /></RequireSession>} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ThemeProvider>
    </LocaleProvider>
  )
}
