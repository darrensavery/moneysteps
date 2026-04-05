import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useState, useEffect } from 'react'
import { ThemeProvider } from './lib/theme'
import { RegistrationShell } from './components/registration/RegistrationShell'
import { WelcomeOrchardScreen } from './components/registration/WelcomeOrchardScreen'
import { LandingGate } from './screens/LandingGate'
import { LockScreen } from './screens/LockScreen'
import { ParentDashboard } from './screens/ParentDashboard'
import { ChildDashboard } from './screens/ChildDashboard'
import { JoinFamilyScreen } from './screens/JoinFamilyScreen'
import { getDeviceIdentity, setDeviceIdentity, toInitials } from './lib/deviceIdentity'
import { analytics, track } from './lib/analytics'
import { verifyMagicLink, setToken, getMe } from './lib/api'
import * as Sentry from '@sentry/react'

/**
 * MagicLinkVerifyScreen — handles /auth/verify?token=...
 * Consumes the token, marks email verified, then shows WelcomeOrchardScreen
 * (add first child or skip) before redirecting to the parent dashboard.
 */
function MagicLinkVerifyScreen() {
  const [params]  = useSearchParams()
  const token     = params.get('token')
  const [phase, setPhase]   = useState<'verifying' | 'welcome' | 'error'>('verifying')
  const [errMsg, setErrMsg] = useState('')
  const [identity, setIdentity] = useState<{
    family_id: string; user_id: string; display_name: string;
  } | null>(null)

  useEffect(() => {
    if (!token) { setPhase('error'); setErrMsg('No token found in link.'); return }

    verifyMagicLink(token)
      .then(async (result) => {
        setToken(result.token)
        const me = await getMe()
        localStorage.setItem('mc_family_id', me.family_id)
        localStorage.setItem('mc_user_id',   me.id)
        localStorage.setItem('mc_role',      me.role)
        setIdentity({ family_id: me.family_id, user_id: me.id, display_name: me.display_name })
        setPhase('welcome')
      })
      .catch(e => {
        setErrMsg(e.message ?? 'Verification failed.')
        setPhase('error')
      })
  }, [token])

  function handleWelcomeDone() {
    if (!identity) return
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
        <div className="max-w-sm w-full text-center space-y-4">
          <p className="text-[28px]">⚠️</p>
          <h2 className="text-lg font-bold text-[var(--color-text)]">Link invalid or expired</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{errMsg}</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Magic links expire after 15 minutes. Please{' '}
            <a href="/register" className="text-[var(--brand-primary)] underline">register again</a>
            {' '}or request a new link from the login page.
          </p>
        </div>
      </div>
    )
  }

  // phase === 'welcome' — Step 3 of 3 in the registration layout
  return (
    <div className="min-h-svh bg-white flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-md mx-auto px-5 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="rounded-xl bg-teal-600 p-1.5">
                <ShieldCheck size={15} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="font-extrabold text-sm text-gray-900 tracking-tight">Morechard</span>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Step 3 of 3
              </span>
              <p className="text-xs font-semibold text-gray-700 leading-none mt-0.5">
                Add Child
              </p>
            </div>
          </div>
          <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
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
      <footer className="px-5 py-4 text-center border-t border-gray-100">
        <p className="text-[11px] text-gray-400 tracking-wide">Your data is private and secure</p>
      </footer>
    </div>
  )
}

/** Root — cold start shows landing page, returning user goes to lock screen. */
function RootGate() {
  const identity = getDeviceIdentity()
  return identity ? <Navigate to="/lock" replace /> : <LandingGate />
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

  // Read teen_mode from localStorage so ThemeProvider can bias 'system' → 'dark'
  // for mature-view users before any API call completes.
  const storedTeenMode = parseInt(localStorage.getItem('mc_teen_mode') ?? '0', 10)

  return (
    <ThemeProvider teenMode={storedTeenMode}>
    <BrowserRouter>
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
        <Route path="/auth/verify" element={<MagicLinkVerifyScreen />} />
        <Route path="/parent" element={<RequireSession><ParentDashboard /></RequireSession>} />
        <Route path="/child"  element={<RequireSession><ChildDashboard /></RequireSession>} />
        <Route path="*"       element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}
