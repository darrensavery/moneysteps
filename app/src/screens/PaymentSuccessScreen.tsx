/**
 * PaymentSuccessScreen — landing page after a successful Stripe Checkout.
 * Stripe appends ?session_id=... — the webhook grants the license server-side
 * asynchronously, so we poll getTrialStatus() until a license is confirmed
 * (or give up after ~15 s) before redirecting to the dashboard.
 */

import { useEffect, useState } from 'react'
import { FullLogo } from '../components/ui/Logo'
import { CheckCircle, Loader2 } from 'lucide-react'
import { getTrialStatus } from '../lib/api'

type Phase = 'confirming' | 'confirmed' | 'timeout'

export function PaymentSuccessScreen() {
  const [phase, setPhase] = useState<Phase>('confirming')
  const [countdown, setCountdown] = useState(5)

  // Poll until license is granted (webhook may take a few seconds)
  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const MAX = 10       // 10 × 1.5 s = 15 s max
    const DELAY = 1500

    async function poll() {
      if (cancelled) return
      try {
        const status = await getTrialStatus()
        if (status.has_lifetime_license || status.has_ai_mentor || status.has_shield) {
          if (!cancelled) setPhase('confirmed')
          return
        }
      } catch {
        // network blip — keep trying
      }
      attempts++
      if (attempts >= MAX) {
        if (!cancelled) setPhase('timeout')
        return
      }
      setTimeout(poll, DELAY)
    }

    poll()
    return () => { cancelled = true }
  }, [])

  // Countdown redirect once confirmed (or timed out)
  useEffect(() => {
    if (phase === 'confirming') return
    const interval = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) {
          clearInterval(interval)
          window.location.href = '/parent'
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [phase])

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col items-center justify-center px-5">
      <div className="max-w-sm w-full text-center space-y-6">
        <FullLogo iconSize={28} />

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 shadow-sm space-y-4">
          {phase === 'confirming' ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10">
                <Loader2 className="h-7 w-7 text-teal-500 animate-spin" />
              </div>
              <div>
                <h1 className="text-[20px] font-bold text-[var(--color-text)]">Confirming payment…</h1>
                <p className="text-[13px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
                  Activating your licence — this takes just a moment.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10">
                <CheckCircle className="h-7 w-7 text-teal-500" />
              </div>
              <div>
                <h1 className="text-[20px] font-bold text-[var(--color-text)]">
                  {phase === 'confirmed' ? 'You\'re all set' : 'Payment received'}
                </h1>
                <p className="text-[13px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
                  {phase === 'confirmed'
                    ? 'Full access has been unlocked for your family.'
                    : 'Your purchase is confirmed. Your plan will update shortly.'}
                </p>
              </div>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Returning to Morechard in {countdown}…
              </p>
            </>
          )}
        </div>

        {phase !== 'confirming' && (
          <button
            type="button"
            onClick={() => { window.location.href = '/parent' }}
            className="w-full rounded-xl bg-[var(--brand-primary)] py-3 text-[14px] font-bold text-white hover:opacity-90 active:opacity-80 transition-opacity"
          >
            Go to dashboard
          </button>
        )}
      </div>
    </div>
  )
}
