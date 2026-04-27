/**
 * PaywallScreen — shown when the trial has expired.
 * Embeds the Stripe pricing table for all three plans.
 * Also used as the cancel_url target from Stripe Checkout.
 *
 * The Stripe pricing table handles checkout itself — no custom
 * createCheckoutSession() call needed here.
 */

import { useEffect } from 'react'
import { FullLogo } from '../components/ui/Logo'
import { getDeviceIdentity } from '../lib/deviceIdentity'

// Tell TypeScript about the Stripe web component
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'stripe-pricing-table': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'pricing-table-id': string
          'publishable-key': string
          'client-reference-id'?: string
          'customer-email'?: string
        },
        HTMLElement
      >
    }
  }
}

const PRICING_TABLE_ID  = 'prctbl_1TQYdxKGVFJVwtJFQaPnNZ4o'
const PUBLISHABLE_KEY   = 'pk_test_51THVv1KGVFJVwtJFaOZkDxHkLTLJghe7vHq9mm3VgTht8FHDdBcJ86gDXtRyInJoUNsZVtprIpxroG5cO97amkFG00vtLk0Dj0'

export function PaywallScreen() {
  const identity = getDeviceIdentity()

  // Inject the Stripe pricing table script once
  useEffect(() => {
    if (document.querySelector('script[src*="pricing-table.js"]')) return
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/pricing-table.js'
    script.async = true
    document.head.appendChild(script)
  }, [])

  return (
    <div className="min-h-svh bg-[var(--color-bg)] flex flex-col">
      {/* Header */}
      <header className="safe-top sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto px-5 pt-4 pb-3 flex items-center justify-between">
          <FullLogo iconSize={26} />
          {identity && (
            <a
              href="/parent"
              className="text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Back to app
            </a>
          )}
        </div>
      </header>

      {/* Hero */}
      <div className="px-5 pt-10 pb-6 text-center max-w-lg mx-auto w-full">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--brand-primary)] mb-2">
          Your trial has ended
        </p>
        <h1 className="text-[26px] font-bold text-[var(--color-text)] leading-tight">
          Choose your plan
        </h1>
        <p className="text-[14px] text-[var(--color-text-muted)] mt-2 leading-relaxed">
          One-time purchase. No subscriptions. Your data stays safe forever.
        </p>
      </div>

      {/* Stripe pricing table */}
      <div className="flex-1 w-full max-w-4xl mx-auto px-4 pb-12">
        <stripe-pricing-table
          pricing-table-id={PRICING_TABLE_ID}
          publishable-key={PUBLISHABLE_KEY}
          client-reference-id={identity?.user_id ?? undefined}
        />
      </div>

      {/* Footer */}
      <footer className="px-5 py-5 text-center border-t border-[var(--color-border)]">
        <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
          Payments processed securely by Stripe. Your card details are never stored by Morechard.
          <br />
          Questions? <a href="mailto:support@morechard.com" className="underline hover:text-[var(--color-text)] transition-colors">Contact support</a>
        </p>
      </footer>
    </div>
  )
}
