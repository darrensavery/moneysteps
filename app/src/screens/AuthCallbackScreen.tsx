import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { exchangeSlt, setToken } from '../lib/api'
import { setDeviceIdentity, toInitials } from '../lib/deviceIdentity'
import { getLocale, isPolish } from '../lib/locale'
import { FullLogo } from '../components/ui/Logo'

type ScreenState = 'loading' | 'error'


export default function AuthCallbackScreen() {
  const [searchParams]    = useSearchParams()
  const navigate          = useNavigate()
  const [state, setState]   = useState<ScreenState>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const locale = getLocale()

  const bridgeText = isPolish(locale) ? 'Logowanie do Sadu…' : 'Consulting the Orchard Lead…'

  useEffect(() => {
    const slt = searchParams.get('slt')

    // Scrub token from URL before any async work
    window.history.replaceState({}, '', '/auth/callback')

    if (!slt) {
      setState('error')
      return
    }

    let cancelled = false

    exchangeSlt(slt)
      .then(result => {
        if (cancelled) return
        setToken(result.token)
        setDeviceIdentity({
          user_id:        result.user.id,
          family_id:      result.user.family_id,
          display_name:   result.user.display_name,
          role:           'parent',
          parenting_role: result.user.parenting_role,
          initials:       toInitials(result.user.display_name),
          registered_at:  new Date().toISOString(),
          auth_method:    'none',
          google_picture: result.user.google_picture ?? undefined,
        })
        // Full browser navigation — tears down React tree so RootGate
        // re-reads mc_device_identity from localStorage on remount.
        window.location.replace('/parent')
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err))
          setState('error')
        }
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)] px-6">
        <p className="text-[16px] text-[var(--color-text-muted)] text-center">
          Sign-in failed. Please try again.
        </p>
        {errorMsg && (
          <p className="text-[12px] text-red-400 text-center max-w-xs break-all">{errorMsg}</p>
        )}
        <button
          onClick={() => navigate('/auth/login')}
          className="h-11 px-6 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold cursor-pointer active:scale-[0.98] transition-all"
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
      <p className="text-[14px] text-[var(--color-text-muted)]">{bridgeText}</p>
    </div>
  )
}
