import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { FullLogo } from './components/ui/Logo'
import { useState, useEffect } from 'react'
import { ThemeProvider } from './lib/theme'
import { RegistrationShell } from './components/registration/RegistrationShell'
import { WelcomeOrchardScreen } from './components/registration/WelcomeOrchardScreen'
import { LandingGate } from './screens/LandingGate'
import { LockScreen } from './screens/LockScreen'
import { ParentDashboard } from './screens/ParentDashboard'
import { ChildDashboard } from './screens/ChildDashboard'
import { JoinFamilyScreen } from './screens/JoinFamilyScreen'
import LoginScreen from './screens/LoginScreen'
import AuthCallbackScreen from './screens/AuthCallbackScreen'
import { getDeviceIdentity, setDeviceIdentity, toInitials } from './lib/deviceIdentity'
import { LocaleProvider } from './lib/locale'
import { analytics, track } from './lib/analytics'
import { verifyMagicLink, setToken, getMe } from './lib/api'
import { AppUrlListener } from './components/AppUrlListener'
import { AndroidBackController } from './components/AndroidBackController'
import { AppAutoLock } from './components/AppAutoLock'
import * as Sentry from '@sentry/react'

/**
 * MagicLinkVerifyScreen — handles /auth/verify?token=...
 * Consumes the token, marks email verified, then shows WelcomeOrchardScreen
 * (add first child or skip) before redirecting to the parent dashboard.
 */
const ML_SESSION_KEY = 'mc_ml_verified'

const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  used:    { title: 'Link already used',   body: 'This magic link has already been used. Each link can only be used once.' },
  expired: { title: 'Link expired',        body: 'Magic links expire after 15 minutes. Please request a new one.' },
  invalid: { title: 'Link not recognised', body: 'This link is invalid or was not issued by Morechard.' },
  missing: { title: 'No link token',       body: 'The sign-in link appears to be incomplete. Please use the full link from your email.' },
}

function MagicLinkVerifyScreen() {
  const [params]  = useSearchParams()
  const token     = params.get('token')
  const errorCode = params.get('error')

  // If we already verified this session, restore identity without re-calling the API
  const cached = (() => {
    try { return JSON.parse(sessionStorage.getItem(ML_SESSION_KEY) ?? 'null') } catch { return null }
  })()

  const [phase, setPhase]   = useState<'verifying' | 'welcome' | 'error'>(
    errorCode ? 'error' : cached ? 'welcome' : 'verifying'
  )
  const [errMsg, setErrMsg] = useState(errorCode ? (ERROR_MESSAGES[errorCode]?.body ?? 'Something went wrong.') : '')
  const [errTitle, setErrTitle] = useState(errorCode ? (ERROR_MESSAGES[errorCode]?.title ?? 'Sign-in failed') : '')
  const [identity, setIdentity] = useState<{
    family_id: string; user_id: string; display_name: string;
  } | null>(cached)

  useEffect(() => {
    if (errorCode || cached) return  // error already set, or already verified

    if (!token) {
      setErrTitle('No link token')
      setErrMsg('The sign-in link appears to be incomplete. Please use the full link from your email.')
      setPhase('error')
      return
    }

    verifyMagicLink(token)
      .then(async (result) => {
        // Store token only after getMe() confirms it's valid
        setToken(result.token)
        let me: Awaited<ReturnType<typeof getMe>>
        try {
          me = await getMe()
        } catch (e) {
          // Token invalid — clear it so the app doesn't get stuck
          localStorage.removeItem('mc_token')
          throw e
        }
        localStorage.setItem('mc_family_id', me.family_id)
        localStorage.setItem('mc_user_id',   me.id)
        localStorage.setItem('mc_role',      me.role)
        const id = { family_id: me.family_id, user_id: me.id, display_name: me.display_name }
        sessionStorage.setItem(ML_SESSION_KEY, JSON.stringify(id))
        setIdentity(id)
        setPhase('welcome')
      })
      .catch(e => {
        const raw: string = e.message ?? ''
        const friendly = raw.includes('JSON') || raw.includes('fetch') || raw.includes('NetworkError')
          ? 'This link has already been used or has expired. Please request a new one.'
          : raw || 'Verification failed.'
        setErrTitle('Sign-in failed')
        setErrMsg(friendly)
        setPhase('error')
      })
  }, [token, errorCode])

  function handleWelcomeDone() {
    if (!identity) return
    sessionStorage.removeItem(ML_SESSION_KEY)
    setDeviceIdentity({
      user_id:        identity.user_id,
      family_id:      identity.family_id,
      display_name:   identity.display_name,
      role:           'parent',
      parenting_role: 'LEAD_PARENT',
      initials:       toInitials(identity.display_name),
      registered_at:  new Date().toISOString(),
      auth_method:    'none',
    })
    Sentry.setUser({ id: identity.user_id })
    analytics.identify(identity.user_id, { role: 'parent', family_id: identity.family_id })
    track.registrationCompleted({ auth_method: 'none', parenting_mode: 'unknown', currency: 'unknown' })
    window.location.href = '/parent'
  }

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

  if (phase === 'error') {
    return (
      <div className="min-h-svh flex items-center justify-center bg-[var(--color-bg)] px-5">
        <div className="max-w-sm w-full text-center space-y-5">
          <FullLogo iconSize={26} />
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

  // phase === 'welcome' — Step 3 of 3 in the registration layout
  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      <header className="safe-top sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-md mx-auto px-5 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FullLogo iconSize={26} />
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                Step 3 of 3
              </span>
              <p className="text-xs font-semibold text-[var(--color-text)] leading-none mt-0.5">
                Add Child
              </p>
            </div>
          </div>
          <div className="relative h-2 w-full rounded-full bg-[var(--color-border)] overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded-full bg-teal-500 transition-all duration-500 ease-in-out" style={{ width: '100%' }} />
          </div>
        </div>
      </header>
      <main className="flex-1 px-5 py-8 max-w-md mx-auto w-full">
        <WelcomeOrchardScreen
          displayName={identity?.display_name}
          onDone={handleWelcomeDone}
        />
      </main>
      <footer className="px-5 py-4 text-center border-t border-[var(--color-border)]">
        <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide">Your data is private and secure</p>
      </footer>
    </div>
  )
}

/** Root — cold start shows landing page, returning user goes to lock screen. */
function RootGate() {
  const identity = getDeviceIdentity()
  // If identity exists, redirect immediately with no intermediate render.
  // Rendering LandingGate even for one frame causes a visible flash on
  // pull-to-refresh and after logout.
  if (identity) return <Navigate to="/lock" replace />
  return <LandingGate />
}

/** Guard dashboards — needs identity + session token, otherwise send to lock. */
function RequireSession({ children }: { children: React.ReactNode }) {
  const identity = getDeviceIdentity()
  if (!identity) return <Navigate to="/" replace />
  const token = localStorage.getItem('mc_token')
  if (!token) return <Navigate to="/lock" replace />
  return <>{children}</>
}

export default function App() {
  function handleRegistrationComplete(
    familyId: string,
    _token: string,
    displayName: string,
    userId: string,
    authMethod: 'biometrics' | 'pin' | null,
    pin: string | null,
  ) {
    setDeviceIdentity({
      user_id:        userId,
      family_id:      familyId,
      display_name:   displayName,
      role:           'parent',
      parenting_role: 'LEAD_PARENT',
      initials:       toInitials(displayName),
      registered_at:  new Date().toISOString(),
      auth_method:    authMethod ?? 'none',
      pin:            pin ?? undefined,
    })
    Sentry.setUser({ id: userId })
    Sentry.setTag('auth_method', authMethod ?? 'none')
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

  // Read app_view from localStorage so ThemeProvider can bias 'system' → 'dark'
  // for CLEAN-view users before any API call completes.
  const storedAppView = localStorage.getItem('mc_app_view') ?? 'ORCHARD'

  return (
    <LocaleProvider>
    <ThemeProvider appView={storedAppView}>
    <BrowserRouter>
      <AppUrlListener />
      <AndroidBackController />
      <AppAutoLock />
      <Routes>
        <Route path="/"         element={<RootGate />} />
        <Route path="/lock"     element={<LockScreen />} />
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
        <Route path="/auth/callback" element={<AuthCallbackScreen />} />
        <Route path="/parent" element={<RequireSession><ParentDashboard /></RequireSession>} />
        <Route path="/child"  element={<RequireSession><ChildDashboard /></RequireSession>} />
        <Route path="*"       element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
    </LocaleProvider>
  )
}
