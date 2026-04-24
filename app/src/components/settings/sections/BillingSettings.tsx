/**
 * BillingSettings — Billing & Subscriptions section.
 * Lead-parent only (enforced by menu, not here).
 *
 * Sub-views:
 *   menu         — three rows (Trial Status / Plan Management / Payment History)
 *   trial        — visual trial tracker
 *   plan         — current plan + upgrade options
 *   history      — payment audit log
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { CreditCard, Clock, Receipt, Zap, Shield, Star, X, Check, ExternalLink } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import {
  getTrialStatus, getBillingHistory, createCheckoutSession,
  type TrialStatus, type PaymentRecord,
} from '../../../lib/api'
import { cn } from '../../../lib/utils'

const STRIPE_PORTAL_URL = 'https://billing.stripe.com/p/login/morechard' // update once portal is live

type SubView = 'menu' | 'trial' | 'plan' | 'history'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
  initialView?: 'plan'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(pence: number, currency: string): string {
  const amount = pence / 100
  if (currency.toUpperCase() === 'GBP') return `£${amount.toFixed(2)}`
  if (currency.toUpperCase() === 'USD') return `$${amount.toFixed(2)}`
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const PLAN_LABELS: Record<string, string> = {
  LIFETIME:  'Complete — Lifetime',
  COMPLETE:  'Complete — Lifetime',
  AI_ANNUAL: 'AI Mentor — Annual',
  SHIELD:    'Shield — Lifetime',
}

// ── Compare Plans modal ────────────────────────────────────────────────────────

const COMPARE_ROWS: { feature: string; free: boolean; complete: boolean; shield: boolean }[] = [
  { feature: 'Chore tracking & ledger',    free: true,  complete: true,  shield: true  },
  { feature: 'Child 6-digit code access',  free: true,  complete: true,  shield: true  },
  { feature: 'Savings goals (Savings Grove)', free: true, complete: true, shield: true },
  { feature: 'Payment bridge (Monzo etc.)', free: true, complete: true,  shield: true  },
  { feature: 'Parent insights AI',         free: false, complete: true,  shield: true  },
  { feature: 'Rate Guide benchmarking',    free: false, complete: true,  shield: true  },
  { feature: 'Unlimited children',         free: false, complete: true,  shield: true  },
  { feature: 'AI Mentor add-on eligible',  free: false, complete: true,  shield: true  },
  { feature: 'Tamper-evident PDF exports',        free: false, complete: false, shield: true  },
  { feature: 'Digital tamper-seal on every export', free: false, complete: false, shield: true },
  { feature: 'Co-parent verified sharing',          free: false, complete: false, shield: true },
]

function ComparePlansModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--color-surface)] rounded-t-2xl pb-safe overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--color-border)]">
          <div>
            <p className="text-[16px] font-bold text-[var(--color-text)]">Compare Plans</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">Do you need your records to be verifiable?</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-4 gap-0 px-5 pt-3 pb-2">
          <div className="col-span-1" />
          <div className="text-center">
            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Free</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">Trial</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wide">Complete</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">£44.99</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Shield</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">£149.99</p>
          </div>
        </div>

        {/* Rows */}
        <div className="overflow-y-auto px-5 pb-6" style={{ maxHeight: '55vh' }}>
          {COMPARE_ROWS.map(row => (
            <div key={row.feature} className="grid grid-cols-4 gap-0 py-2.5 border-b border-[var(--color-border)] last:border-0 items-center">
              <p className="col-span-1 text-[12px] text-[var(--color-text)] pr-2 leading-snug">{row.feature}</p>
              <div className="flex justify-center">
                {row.free
                  ? <Check size={14} className="text-teal-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
              <div className="flex justify-center">
                {row.complete
                  ? <Check size={14} className="text-teal-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
              <div className="flex justify-center">
                {row.shield
                  ? <Check size={14} className="text-amber-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
            </div>
          ))}

          {/* Mediation anchor + AI footnote */}
          <div className="mt-4 space-y-2">
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed font-medium">
              UK family mediation averages £140/hr. Shield is a one-time £149.99.
            </p>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
              AI Mentor (£19.99/yr) is an optional add-on for Complete and Shield holders — see below.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trial sub-view ─────────────────────────────────────────────────────────────

function TrialView({ onBack }: { onBack: () => void }) {
  const [trial, setTrial]   = useState<TrialStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTrialStatus()
      .then(setTrial)
      .finally(() => setLoading(false))
  }, [])

  const daysLeft = trial?.days_remaining ?? null
  const pct = daysLeft !== null ? Math.max(0, Math.min(100, (daysLeft / 14) * 100)) : 100
  const urgent = daysLeft !== null && daysLeft <= 2

  return (
    <div className="space-y-4">
      <SectionHeader title="Trial Status" onBack={onBack} />

      {loading ? (
        <div className="h-32 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
      ) : trial?.has_lifetime_license ? (
        <SectionCard>
          <div className="px-4 py-5 flex items-start gap-3">
            <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
              <Shield size={17} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">Lifetime licence active</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                Full access to Morechard forever — no renewals, no trial limits.
              </p>
            </div>
          </div>
        </SectionCard>
      ) : trial?.ai_subscription_active ? (
        <SectionCard>
          <div className="px-4 py-5 flex items-start gap-3">
            <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
              <Zap size={17} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">AI Coach subscription active</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                AI Mentor features are unlocked for your family.
              </p>
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className={urgent ? 'text-amber-500' : 'text-teal-600'} />
              <p className="text-[13px] font-bold text-[var(--color-text)]">
                {trial?.is_expired
                  ? 'Trial expired'
                  : !trial?.is_activated
                  ? '14-day free trial'
                  : daysLeft === 1
                  ? '1 day remaining'
                  : `${daysLeft ?? 14} days remaining`}
              </p>
            </div>

            {/* Progress bar */}
            <div className={cn('h-2.5 rounded-full overflow-hidden', urgent ? 'bg-amber-100' : 'bg-teal-100')}>
              <div
                className={cn('h-full rounded-full transition-all', urgent ? 'bg-amber-400' : 'bg-teal-500')}
                style={{ width: `${trial?.is_expired ? 0 : pct}%` }}
              />
            </div>

            <div className="flex justify-between mt-1.5 text-[11px] text-[var(--color-text-muted)]">
              <span>Day 1</span>
              <span>Day 14</span>
            </div>

            {!trial?.is_activated && (
              <p className="text-[12px] text-[var(--color-text-muted)] mt-3 leading-snug">
                Your trial starts automatically when the first chore is approved. The 14-day clock begins at that point.
              </p>
            )}

            {trial?.is_expired && (
              <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3 leading-snug">
                Your trial has ended. Upgrade to restore write access for your family.
              </p>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
            The trial covers full access to all features. When it ends, your data is safe — you can still
            export your ledger at any time. Upgrade to a paid plan to continue using Morechard.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Plan management sub-view ───────────────────────────────────────────────────

function PlanView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
  const [trial, setTrial]         = useState<TrialStatus | null>(null)
  const [loading, setLoading]     = useState(true)
  const [buying, setBuying]       = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    getTrialStatus()
      .then(setTrial)
      .finally(() => setLoading(false))
  }, [])

  async function handleUpgrade(type: 'COMPLETE' | 'SHIELD' | 'AI_ANNUAL') {
    setBuying(type)
    try {
      const { url } = await createCheckoutSession(type)
      window.location.href = url
    } catch {
      showToast('Could not start checkout — please try again')
    } finally {
      setBuying(null)
    }
  }

  const isLifetime = trial?.has_lifetime_license
  const isShield   = trial?.has_shield
  const isAI       = trial?.ai_subscription_active

  return (
    <>
      {showCompare && <ComparePlansModal onClose={() => setShowCompare(false)} />}

      <div className="space-y-4">
        <SectionHeader title="Plan Management" onBack={onBack} />

        {loading ? (
          <div className="space-y-3">
            <div className="h-16 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
            <div className="h-48 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
          </div>
        ) : (
          <>
            {/* Current plan status */}
            <SectionCard>
              <div className="px-4 py-3">
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
                  Current plan
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    'inline-block px-2.5 py-1 rounded-full text-[12px] font-bold',
                    isShield
                      ? 'bg-amber-100 text-amber-700'
                      : isLifetime
                      ? 'bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]'
                      : isAI
                      ? 'bg-violet-100 text-violet-700'
                      : trial?.is_expired
                      ? 'bg-red-100 text-red-600'
                      : 'bg-teal-100 text-teal-700',
                  )}>
                    {isShield
                      ? 'Shield — Lifetime'
                      : isLifetime
                      ? 'Complete — Lifetime'
                      : isAI
                      ? 'AI Mentor Annual'
                      : trial?.is_expired
                      ? 'Trial expired'
                      : trial?.is_activated
                      ? `Trial — ${trial.days_remaining ?? 0} days left`
                      : 'Free trial (not started)'}
                  </span>
                  {isAI && (
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-600">
                      + AI Mentor
                    </span>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Upgrade options */}
            {!isShield && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                    Upgrade
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCompare(true)}
                    className="text-[12px] font-semibold text-[var(--brand-primary)] hover:opacity-75 transition-opacity"
                  >
                    Why professionals prefer Shield
                  </button>
                </div>

                {/* Complete plan */}
                {!isLifetime && (
                  <div className="rounded-2xl border-2 border-[var(--color-border)] overflow-hidden relative">
                    {/* Best Value badge */}
                    <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500 text-white text-[10px] font-bold">
                      <Star size={9} />
                      Best Value
                    </div>

                    <div className="px-4 pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
                          <Shield size={16} />
                        </span>
                        <div className="flex-1 min-w-0 pr-16">
                          <p className="text-[15px] font-bold text-[var(--color-text)]">Complete</p>
                          <p className="text-[20px] font-bold text-[var(--brand-primary)] leading-none mt-0.5">
                            £44.99
                            <span className="text-[12px] font-semibold text-[var(--color-text-muted)] ml-1">one-time</span>
                          </p>
                        </div>
                      </div>

                      <ul className="mt-3 space-y-1.5">
                        {[
                          'Secure your family\'s ledger with one payment — no renewals, ever',
                          'Unlimited children, unlimited chores',
                          'Parent Insights AI included',
                          'Rate Guide benchmarking for fair chore pricing',
                          'AI Mentor add-on available (£19.99/yr)',
                        ].map(item => (
                          <li key={item} className="flex items-start gap-2">
                            <Check size={12} className="shrink-0 text-teal-500 mt-0.5" />
                            <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        disabled={buying !== null}
                        onClick={() => handleUpgrade('COMPLETE')}
                        className="w-full py-2.5 rounded-xl bg-[var(--brand-primary)] text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {buying === 'COMPLETE' ? 'Loading…' : 'Get Lifetime Access'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Shield plan */}
                <div className="rounded-2xl border-2 border-amber-300 overflow-hidden bg-[color-mix(in_srgb,#f59e0b_6%,var(--color-surface))] shadow-[0_0_0_4px_color-mix(in_srgb,#f59e0b_8%,transparent)]">
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600">
                        <Shield size={16} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-bold text-[var(--color-text)]">Shield</p>
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">Professional</span>
                        </div>
                        <p className="text-[20px] font-bold text-amber-600 leading-none mt-0.5">
                          £149.99
                          <span className="text-[12px] font-semibold text-[var(--color-text-muted)] ml-1">one-time</span>
                        </p>
                        <p className="text-[11px] text-amber-700 font-medium mt-1">
                          Less than one hour of professional mediation
                        </p>
                      </div>
                    </div>

                    <p className="mt-2 mb-3 text-[12px] text-[var(--color-text-muted)] leading-snug">
                      Every export comes with a digital tamper-seal. If a single number is changed after export, the seal breaks — proving the record is authentic.
                    </p>
                    <ul className="space-y-1.5">
                      {[
                        'Everything in Complete',
                        'Tamper-evident PDF exports designed for professional review',
                        'Digital seal on every export — any change breaks it',
                        'Share verified records with co-parents, mediators, or solicitors',
                        'Professional-grade exports your whole family can rely on',
                      ].map(item => (
                        <li key={item} className="flex items-start gap-2">
                          <Check size={12} className="shrink-0 text-amber-500 mt-0.5" />
                          <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      disabled={buying !== null}
                      onClick={() => handleUpgrade('SHIELD')}
                      className="w-full py-2.5 rounded-xl bg-amber-500 text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {buying === 'SHIELD' ? 'Loading…' : 'Get Shield Protection'}
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* ── Optional Family Add-Ons ────────────────────────────────────── */}
            {!isAI && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide px-1">
                  Optional Family Add-Ons
                </p>
                <div className="rounded-2xl border border-[var(--color-border)] overflow-hidden bg-[color-mix(in_srgb,#7c3aed_3%,var(--color-surface))]">
                  <div className="flex items-start gap-3 px-4 pt-4 pb-3">
                    <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-violet-100 text-violet-600">
                      <Zap size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="text-[14px] font-bold text-[var(--color-text)]">AI Mentor</p>
                        <span className="text-[13px] font-bold text-violet-600">£19.99 / yr</span>
                      </div>
                      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                        Help your children build healthy money habits with a dedicated 24/7 AI coach — lessons grounded in their real earnings data.
                      </p>
                      {!isLifetime && !isShield && (
                        <p className="text-[11px] text-violet-600 font-medium mt-1.5">
                          Available for Complete and Shield members.
                        </p>
                      )}
                    </div>
                  </div>
                  {(isLifetime || isShield) && (
                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        disabled={buying !== null}
                        onClick={() => handleUpgrade('AI_ANNUAL')}
                        className="w-full py-2.5 rounded-xl bg-violet-500 text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {buying === 'AI_ANNUAL' ? 'Loading…' : 'Add AI Mentor — £19.99/yr'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <SectionCard>
              <div className="px-4 py-3">
                <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
                  Payments are processed securely by Stripe. Your card details are never stored by Morechard.
                  To cancel a subscription contact support.
                </p>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </>
  )
}

// ── Payment history sub-view ───────────────────────────────────────────────────

function HistoryView({ onBack }: { onBack: () => void }) {
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    getBillingHistory()
      .then(r => setPayments(r.payments))
      .catch(() => setPayments([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <SectionHeader title="Payment History" onBack={onBack} />

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map(i => (
            <div key={i} className="h-14 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
          ))}
        </div>
      ) : payments.length === 0 ? (
        <SectionCard>
          <div className="px-4 py-6 text-center">
            <Receipt size={28} className="mx-auto text-[var(--color-text-muted)] mb-2 opacity-40" />
            <p className="text-[13px] font-semibold text-[var(--color-text)]">No payments yet</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
              Your payment records will appear here after your first purchase.
            </p>
          </div>
        </SectionCard>
      ) : (
        <SectionCard>
          {payments.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0"
            >
              <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                <Receipt size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-text)]">
                  {PLAN_LABELS[p.payment_type] ?? p.payment_type}
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{formatDate(p.created_at)}</p>
              </div>
              <span className="shrink-0 text-[13px] font-bold text-[var(--color-text)]">
                {formatAmount(p.amount_paid_int, p.currency)}
              </span>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  )
}

// ── Root billing menu ──────────────────────────────────────────────────────────

export function BillingSettings({ toast, onBack, onComingSoon: _onComingSoon, initialView }: Props) {
  const [sub, setSub] = useState<SubView>(initialView ?? 'menu')
  const [localToast, setLocalToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  const showToast = useCallback((msg: string) => {
    setLocalToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setLocalToast(null), 3000)
  }, [])

  const activeToast = localToast ?? toast

  if (sub === 'trial')   return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<TrialView onBack={() => setSub('menu')} /></div>
  if (sub === 'plan')    return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<PlanView  onBack={() => setSub('menu')} showToast={showToast} /></div>
  if (sub === 'history') return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<HistoryView onBack={() => setSub('menu')} /></div>

  return (
    <div className="space-y-4">
      {activeToast && <Toast message={activeToast} />}
      <SectionHeader title="Billing & Subscriptions" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Clock size={15} />}
          label="Trial Status"
          description="Visual tracker for the 14-day Professional trial"
          onClick={() => setSub('trial')}
        />
        <SettingsRow
          icon={<CreditCard size={15} />}
          label="Plan Management"
          description="Upgrade or view your current subscription"
          onClick={() => setSub('plan')}
        />
        <SettingsRow
          icon={<Receipt size={15} />}
          label="Payment History"
          description="View past invoices and payments"
          onClick={() => setSub('history')}
        />
        <a
          href={STRIPE_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors"
        >
          <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
            <CreditCard size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Manage My Subscription</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
              Update billing, download receipts, or cancel
            </p>
          </div>
          <ExternalLink size={13} className="shrink-0 text-[var(--color-text-muted)]" />
        </a>
      </SectionCard>
    </div>
  )
}
