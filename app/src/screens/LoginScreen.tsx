import { useSearchParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { requestMagicLink } from '../lib/api'

export default function LoginScreen() {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()

  const errorCode = searchParams.get('error')
  const hint      = searchParams.get('hint')

  const [email,      setEmail]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [magicSent,  setMagicSent]  = useState(false)
  const [magicError, setMagicError] = useState('')

  const workerUrl = (import.meta.env.VITE_WORKER_URL as string) ?? ''

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
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[var(--color-bg)]">
      {/* Logo */}
      <div className="mb-8 text-center">
        <h1 className="text-[28px] font-extrabold text-[var(--color-text)] tracking-tight">
          🌳 Morechard
        </h1>
        <p className="text-[14px] text-[var(--color-text-muted)] mt-1">Welcome back</p>
      </div>

      {/* Error banners */}
      {errorCode === 'no_account' && (
        <div className="w-full max-w-sm mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-800">
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
        <div className="w-full max-w-sm mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
          Google couldn't verify this email address. Try a different account.
        </div>
      )}
      {(errorCode === 'csrf' || errorCode === 'google_exchange') && (
        <div className="w-full max-w-sm mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
          Something went wrong. Please try again.
        </div>
      )}

      {/* Card */}
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] px-6 py-7 flex flex-col gap-5">

        {/* Google button — full-page navigation, not React Router */}
        <a
          href={`${workerUrl}/auth/google`}
          className="flex items-center justify-center gap-3 h-12 rounded-xl border border-[var(--color-border)] bg-white text-[15px] font-semibold text-[#3c4043] hover:bg-gray-50 active:scale-[0.98] transition-all no-underline"
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 6.6 6.3 14.7z"/>
            <path fill="#FBBC05" d="M24 46c5.5 0 10.6-1.9 14.6-5l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.7-3.1-11.8-7.5l-7 5.4C9.7 43.4 16.3 46 24 46z"/>
            <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.5 5.3-6.8 6.7l6.7 5.5C39.7 37 44 31 44 24c0-1.3-.2-2.7-.5-4z"/>
          </svg>
          Continue with Google
        </a>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-border)]" />
          <span className="text-[12px] text-[var(--color-text-muted)]">or</span>
          <div className="flex-1 h-px bg-[var(--color-border)]" />
        </div>

        {/* Magic link */}
        {magicSent ? (
          <p className="text-center text-[14px] text-[var(--color-text-muted)]">
            Check your email — we've sent a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {magicError && (
              <p className="text-[12px] text-red-500">{magicError}</p>
            )}
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="h-11 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
            >
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-[12px] text-[var(--color-text-muted)]">
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
  )
}
