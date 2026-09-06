import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { exchangeSlt, setToken, postMarketingConsent, postAnalyticsConsent } from '../lib/api'
import { setDeviceIdentity, getDeviceIdentity, toInitials } from '../lib/deviceIdentity'
import { getLocale, isPolish } from '../lib/locale'
import { FullLogo } from '../components/ui/Logo'

type ScreenState = 'loading' | 'error'


export default function AuthCallbackScreen() {
  const [searchParams]    = useSearchParams()
  const navigate          = useNavigate()
  const [state, setState]   = useState<ScreenState>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  // Guard against React StrictMode's double-invocation of useEffect in dev.
  // The first run consumes the SLT; the ref prevents a second exchange attempt.
  const exchangeStarted = useRef(false)

  const locale = getLocale()

  const bridgeText = isPolish(locale) ? 'Logowanie do Sadu…' : 'Consulting the Orchard Lead…'

  useEffect(() => {
    if (exchangeStarted.current) return
    exchangeStarted.current = true

    const slt = searchParams.get('slt')

    // Scrub token from URL before any async work
    window.history.replaceState({}, '', '/auth/callback')

    if (!slt) {
      setState('error')
      return
    }

    exchangeSlt(slt)
      .then(async result => {
        await setToken(result.token)

        // Flush any pending marketing consent recorded during registration
        const pendingConsent = localStorage.getItem('mc_pending_consent')
        if (pendingConsent !== null) {
          localStorage.removeItem('mc_pending_consent')
          postMarketingConsent(pendingConsent === 'true').catch(err => {
            console.error('[consent] failed to record marketing consent:', err)
          })
        }

        // Flush pending analytics consent — server records it and recomputes the
        // family-effective child flag (the lead is the first vote in the veto model).
        const pendingAnalytics = localStorage.getItem('mc_pending_analytics_consent')
        if (pendingAnalytics !== null) {
          localStorage.removeItem('mc_pending_analytics_consent')
          postAnalyticsConsent(pendingAnalytics === 'true').catch(err => {
            console.error('[consent] failed to record analytics consent:', err)
          })
        }

        // Preserve existing auth setup (PIN hash, biometrics choice, avatar) if the
        // user already has a device identity — this happens when a returning parent
        // re-authenticates via magic link after their session expired.
        const existingIdentity = getDeviceIdentity()
        setDeviceIdentity({
          user_id:        result.user.id,
          family_id:      result.user.family_id,
          display_name:   result.user.display_name,
          role:           'parent',
          parenting_role: result.user.parenting_role,
          initials:       toInitials(result.user.display_name),
          registered_at:  existingIdentity?.registered_at ?? new Date().toISOString(),
          auth_method:    existingIdentity?.auth_method ?? 'none',
          pin_hash:       existingIdentity?.pin_hash,
          avatar_id:      existingIdentity?.avatar_id,
          google_picture: result.user.google_picture ?? existingIdentity?.google_picture ?? undefined,
        })
        // Full browser navigation — tears down React tree so RootGate
        // re-reads mc_device_identity from localStorage on remount.
        window.location.replace('/parent')
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setState('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)] px-6">
        <p className="text-[1rem] text-[var(--color-text-muted)] text-center">
          Sign-in failed. Please try again.
        </p>
        {errorMsg && (
          <p className="text-[0.75rem] text-red-400 text-center max-w-xs break-all">{errorMsg}</p>
        )}
        <button
          onClick={() => navigate('/auth/login')}
          className="h-11 px-6 rounded-xl bg-[var(--brand-primary)] text-white text-[0.875rem] font-semibold cursor-pointer active:scale-[0.98] transition-all"
        >
          Try signing in again
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)]">
      <FullLogo iconSize={28} />
      <Loader2 className="w-7 h-7 text-[var(--brand-primary)] animate-spin" />
      <p className="text-[0.875rem] text-[var(--color-text-muted)]">{bridgeText}</p>
    </div>
  )
}
