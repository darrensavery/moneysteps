import { useSearchParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { requestMagicLink } from '../lib/api'
import { FullLogo } from '@/components/ui/Logo'

export default function LoginScreen() {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()

  const errorCode = searchParams.get('error')
  const hint      = searchParams.get('hint')

  const [email,      setEmail]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [magicSent,  setMagicSent]  = useState(false)
  const [magicError, setMagicError] = useState('')

  const workerUrl = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'https://api.morechard.com'

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    setSending(true)
    setMagicError('')
    try {
      await requestMagicLink(email.trim())
      setMagicSent(true)
    } catch (err) {
      setMagicError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-svh bg-[var(--color-bg)] flex flex-col overflow-y-auto">

      {/* Header — matches LandingGate exactly */}
      <header className="sticky top-0 bg-[var(--color-surface)]/80 backdrop-blur border-b border-[var(--color-border)] px-4 py-3 flex items-center">
        <FullLogo iconSize={28} />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-5 max-w-md mx-auto w-full">
        <div className="flex flex-col items-center gap-6 w-full py-4">

          {/* Badge */}
          <div className="text-center space-y-3">
            <p className="text-[11px] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] rounded-full px-3 py-1 tracking-widest uppercase inline-block">
              Welcome back
            </p>
            <h1 className="text-[32px] font-extrabold text-[var(--color-text)] tracking-tight leading-[1.1]">
              Sign in to your<br />Orchard
            </h1>
          </div>

          {/* Error banners */}
          {errorCode === 'no_account' && (
            <div className="w-full rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-800">
              We couldn't find an account for{' '}
              <strong>{hint ? decodeURIComponent(hint) : 'this email'}</strong>.{' '}
              <button
                onClick={() => navigate('/register')}
                className="underline underline-offset-2 font-semibold cursor-pointer"
              >
                Create a new Orchard?
              </button>
            </div>
          )}
          {errorCode === 'unverified' && (
            <div className="w-full rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
              Google couldn't verify this email address. Try a different account.
            </div>
          )}
          {(errorCode === 'csrf' || errorCode === 'google_exchange') && (
            <div className="w-full rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
              Something went wrong. Please try again.
            </div>
          )}

          {/* Buttons */}
          <div className="w-full space-y-3">

            {/* Google — styled like the primary CTA */}
            <a
              href={`${workerUrl}/auth/google`}
              className="
                w-full h-14 rounded-2xl bg-[var(--brand-primary)] text-white
                font-semibold text-[15px] tracking-tight
                flex items-center justify-center gap-2.5
                hover:opacity-90 active:scale-[0.98]
                transition-all duration-150 shadow-md hover:shadow-lg
                no-underline
              "
            >
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="white" fillOpacity=".9" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
              </svg>
              Continue with Google
            </a>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-[var(--color-border)]" />
              <span className="text-[12px] text-[var(--color-text-muted)]">or sign in with email</span>
              <div className="flex-1 h-px bg-[var(--color-border)]" />
            </div>

            {/* Magic link */}
            {magicSent ? (
              <div className="w-full h-14 rounded-2xl border-2 border-[var(--color-border)] flex items-center justify-center">
                <p className="text-[14px] text-[var(--color-text-muted)]">
                  Check your email for a sign-in link ✓
                </p>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="
                    w-full h-14 rounded-2xl px-4 text-[15px]
                    bg-[var(--color-surface)] text-[var(--color-text)]
                    border-2 border-[var(--color-border)]
                    placeholder:text-[var(--color-text-muted)]
                    focus:outline-none focus:border-[var(--brand-primary)]
                    transition-colors
                  "
                />
                {magicError && (
                  <p className="text-[12px] text-red-500 px-1">{magicError}</p>
                )}
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="
                    w-full h-14 rounded-2xl bg-[var(--color-surface)] text-[var(--color-text)]
                    font-semibold text-[15px]
                    flex items-center justify-center gap-2.5
                    border-2 border-[var(--color-border)]
                    hover:border-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_5%,transparent)]
                    active:scale-[0.98] transition-all duration-150 disabled:opacity-40
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
                    cursor-pointer
                  "
                >
                  {sending ? 'Sending…' : 'Send sign-in link'}
                </button>
              </form>
            )}

            <p className="text-center text-[11px] text-[var(--color-text-muted)]">
              New here?{' '}
              <button
                onClick={() => navigate('/register')}
                className="text-[var(--brand-primary)] font-semibold underline underline-offset-2 cursor-pointer"
              >
                Create a Family Account
              </button>
            </p>

          </div>
        </div>
      </main>
    </div>
  )
}
