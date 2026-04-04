import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { RegistrationShell } from './components/registration/RegistrationShell'
import { LandingGate } from './screens/LandingGate'
import { LockScreen } from './screens/LockScreen'
import { ParentDashboard } from './screens/ParentDashboard'
import { ChildDashboard } from './screens/ChildDashboard'
import { JoinFamilyScreen } from './screens/JoinFamilyScreen'
import { getDeviceIdentity, setDeviceIdentity, toInitials } from './lib/deviceIdentity'
import { analytics, track } from './lib/analytics'
import * as Sentry from '@sentry/react'

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
      user_id:       userId,
      family_id:     familyId,
      display_name:  displayName,
      role:          'parent',
      initials:      toInitials(displayName),
      registered_at: new Date().toISOString(),
      auth_method:   authMethod ?? 'none',
      pin:           pin ?? undefined,
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
        <Route path="/parent" element={<RequireSession><ParentDashboard /></RequireSession>} />
        <Route path="/child"  element={<RequireSession><ChildDashboard /></RequireSession>} />
        <Route path="*"       element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  )
}
