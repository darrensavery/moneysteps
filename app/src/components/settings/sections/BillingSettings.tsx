/**
 * BillingSettings — Billing section (lead-parent only).
 *
 * Sub-views:
 *   menu    — three rows (Trial Status / Plan Management / Payment History)
 *   trial   — visual trial tracker
 *   plan    — current plan + upgrade options
 *   history — payment audit log
 *
 * All plans are one-time purchases. No subscriptions exist.
 * Provider-specific URLs (e.g. Stripe portal) are intentionally excluded —
 * direct users to support for billing queries.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { CreditCard, Clock, Receipt, Zap, Shield, Star, X, Check, Mail, AlertTriangle } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import {
  getTrialStatus, getBillingHistory, createCheckoutSession, cancelPlan,
  type TrialStatus, type PaymentRecord,
} from '../../../lib/api'
import { cn } from '../../../lib/utils'

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
  COMPLETE:    'Morechard Core',
  COMPLETE_AI: 'Morechard Core AI',
  SHIELD_AI:   'Morechard Shield',
  AI_UPGRADE:  'AI Mentor + Learning Lab',
  // legacy labels for payment history display
  LIFETIME:    'Morechard Core (Legacy)',
  AI_ANNUAL:   'AI Mentor (Legacy)',
  SHIELD:      'Morechard Shield (Legacy)',
}

// ── Compare Plans modal ────────────────────────────────────────────────────────

const COMPARE_ROWS: {
  feature:    string
  complete:   boolean
  completeAi: boolean
  shieldAi:   boolean
}[] = [
  { feature: 'Chore tracking & ledger',            complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Child 6-digit code access',           complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Savings goals (Savings Grove)',       complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Payment bridge (Monzo etc.)',         complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Rate Guide benchmarking',             complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Unlimited children',                  complete: true,  completeAi: true,  shieldAi: true  },
  { feature: 'Parent Insights AI',                  complete: false, completeAi: true,  shieldAi: true  },
  { feature: 'AI Mentor (financial coaching)',      complete: false, completeAi: true,  shieldAi: true  },
  { feature: 'Learning Lab (20-module curriculum)', complete: false, completeAi: true,  shieldAi: true  },
  { feature: 'Tamper-evident PDF exports',          complete: false, completeAi: false, shieldAi: true  },
  { feature: 'Digital tamper-seal per export',      complete: false, completeAi: false, shieldAi: true  },
  { feature: 'Co-parent verified sharing',          complete: false, completeAi: false, shieldAi: true  },
  { feature: 'Court-admissible hashed records',     complete: false, completeAi: false, shieldAi: true  },
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
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--color-border)]">
          <div>
            <p className="text-[16px] font-bold text-[var(--color-text)]">Compare Plans</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">All plans are one-time purchases — no renewals.</p>
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
            <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wide">Core</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">£44.99</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">Core AI</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">£64.99</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Shield</p>
            <p className="text-[11px] font-semibold text-[var(--color-text)] mt-0.5">£149.99</p>
          </div>
        </div>

        <div className="overflow-y-auto px-5 pb-6" style={{ maxHeight: '55vh' }}>
          {COMPARE_ROWS.map(row => (
            <div key={row.feature} className="grid grid-cols-4 gap-0 py-2.5 border-b border-[var(--color-border)] last:border-0 items-center">
              <p className="col-span-1 text-[12px] text-[var(--color-text)] pr-2 leading-snug">{row.feature}</p>
              <div className="flex justify-center">
                {row.complete
                  ? <Check size={14} className="text-teal-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
              <div className="flex justify-center">
                {row.completeAi
                  ? <Check size={14} className="text-violet-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
              <div className="flex justify-center">
                {row.shieldAi
                  ? <Check size={14} className="text-amber-500" />
                  : <span className="w-3.5 h-px bg-[var(--color-border)] block mt-1.5" />}
              </div>
            </div>
          ))}

          <div className="mt-4 space-y-2">
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed font-medium">
              UK family mediation averages £140/hr. Morechard Shield is a one-time £149.99.
            </p>
            <p className="text-[11px] text-violet-700 bg-violet-50 rounded-lg px-3 py-2 leading-relaxed font-medium">
              Already on Core? Add AI Mentor + Learning Lab for £29.99 — one-time.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trial sub-view ─────────────────────────────────────────────────────────────

function TrialView({ onBack }: { onBack: () => void }) {
  const [trial, setTrial]     = useState<TrialStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTrialStatus()
      .then(setTrial)
      .finally(() => setLoading(false))
  }, [])

  const daysLeft = trial?.days_remaining ?? null
  const pct      = daysLeft !== null ? Math.max(0, Math.min(100, (daysLeft / 14) * 100)) : 100
  const urgent   = daysLeft !== null && daysLeft <= 2

  const planLabel = trial?.has_shield
    ? 'Morechard Shield'
    : trial?.has_ai_mentor
    ? 'Morechard Core AI'
    : trial?.has_lifetime_license
    ? 'Morechard Core'
    : null

  return (
    <div className="space-y-4">
      <SectionHeader title="Trial Status" onBack={onBack} />

      {loading ? (
        <div className="h-32 rounded-xl bg-[var(--color-surface-alt)] animate-pulse" />
      ) : planLabel ? (
        <SectionCard>
          <div className="px-4 py-5 flex items-start gap-3">
            <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
              <Shield size={17} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">{planLabel} — active</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                One-time purchase. Full access, no renewals, no trial limits.
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
                Your trial starts automatically when the first chore is approved.
              </p>
            )}

            {trial?.is_expired && (
              <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3 leading-snug">
                Your trial has ended. Purchase a plan to restore access for your family.
              </p>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
            The trial covers full access to all features including AI Mentor and Learning Lab.
            When it ends, your data is safe — you can still export your ledger at any time.
            Purchase a plan to continue using Morechard.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Plan management sub-view ───────────────────────────────────────────────────

type PurchasableSku = 'COMPLETE' | 'COMPLETE_AI' | 'SHIELD_AI' | 'AI_UPGRADE'

function PlanView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
  const [trial, setTrial]               = useState<TrialStatus | null>(null)
  const [payments, setPayments]         = useState<PaymentRecord[]>([])
  const [loading, setLoading]           = useState(true)
  const [buying, setBuying]             = useState<string | null>(null)
  const [showCompare, setShowCompare]   = useState(false)
  const [cancelling, setCancelling]     = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  useEffect(() => {
    Promise.all([getTrialStatus(), getBillingHistory()])
      .then(([t, h]) => { setTrial(t); setPayments(h.payments) })
      .finally(() => setLoading(false))
  }, [])

  async function handlePurchase(sku: PurchasableSku) {
    setBuying(sku)
    try {
      const { url } = await createCheckoutSession(sku)
      window.location.href = url
    } catch {
      showToast('Could not start checkout — please try again')
    } finally {
      setBuying(null)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      await cancelPlan()
      showToast('Refund issued — your plan has been cancelled')
      setShowCancelConfirm(false)
      // Refresh trial status
      const t = await getTrialStatus()
      setTrial(t)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Refund failed — please contact support')
    } finally {
      setCancelling(false)
    }
  }

  // Determine if user is within 14-day cooling-off window
  const mostRecentPurchase = payments[0]
  const withinCoolingOff = mostRecentPurchase
    ? (Date.now() - new Date(mostRecentPurchase.created_at).getTime()) < 14 * 24 * 60 * 60 * 1000
    : false
  const coolingOffDeadline = mostRecentPurchase
    ? new Date(new Date(mostRecentPurchase.created_at).getTime() + 14 * 24 * 60 * 60 * 1000)
    : null

  const hasBase    = trial?.has_lifetime_license
  const hasAi      = trial?.has_ai_mentor
  const hasShield  = trial?.has_shield

  // Derive current plan label
  const currentPlan = hasShield
    ? 'Morechard Shield'
    : hasAi
    ? 'Morechard Core AI'
    : hasBase
    ? 'Morechard Core'
    : trial?.is_expired
    ? 'Trial expired'
    : trial?.is_activated
    ? `Trial — ${trial.days_remaining ?? 0} days left`
    : 'Free trial (not started)'

  const planColor = hasShield
    ? 'bg-amber-100 text-amber-700'
    : hasAi
    ? 'bg-violet-100 text-violet-700'
    : hasBase
    ? 'bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]'
    : trial?.is_expired
    ? 'bg-red-100 text-red-600'
    : 'bg-teal-100 text-teal-700'

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
            {/* Current plan */}
            <SectionCard>
              <div className="px-4 py-3">
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
                  Current plan
                </p>
                <span className={cn('inline-block px-2.5 py-1 rounded-full text-[12px] font-bold', planColor)}>
                  {currentPlan}
                </span>
              </div>
            </SectionCard>

            {/* Upgrade options — shown only when there's something left to purchase */}
            {!hasShield && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                    {hasBase ? 'Upgrade' : 'Choose a plan'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCompare(true)}
                    className="text-[12px] font-semibold text-[var(--brand-primary)] hover:opacity-75 transition-opacity"
                  >
                    Compare all plans
                  </button>
                </div>

                {/* Complete — shown only when no base license yet */}
                {!hasBase && (
                  <div className="rounded-2xl border-2 border-[var(--color-border)] overflow-hidden relative">
                    <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500 text-white text-[10px] font-bold">
                      <Star size={9} />
                      Starter
                    </div>
                    <div className="px-4 pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
                          <Shield size={16} />
                        </span>
                        <div className="flex-1 min-w-0 pr-16">
                          <p className="text-[15px] font-bold text-[var(--color-text)]">Morechard Core</p>
                          <p className="text-[20px] font-bold text-[var(--brand-primary)] leading-none mt-0.5">
                            £44.99
                            <span className="text-[12px] font-semibold text-[var(--color-text-muted)] ml-1">one-time</span>
                          </p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {[
                          'Full chore tracker, ledger & savings goals',
                          'Unlimited children',
                          'Rate Guide benchmarking',
                          'Payment bridge (Monzo, Revolut, PayPal)',
                          'AI Mentor + Learning Lab available — just £20 more with Core AI (£64.99)',
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
                        onClick={() => handlePurchase('COMPLETE')}
                        className="w-full py-2.5 rounded-xl bg-[var(--brand-primary)] text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {buying === 'COMPLETE' ? 'Loading…' : 'Get Morechard Core — £44.99'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Complete AI — shown when no base yet, or when base exists but no AI */}
                {!hasAi && (
                  <div className="rounded-2xl border-2 border-violet-300 overflow-hidden bg-[color-mix(in_srgb,#7c3aed_4%,var(--color-surface))] relative">
                    {!hasBase && (
                      <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-bold">
                        <Star size={9} />
                        Best Value
                      </div>
                    )}
                    <div className="px-4 pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-violet-100 text-violet-600">
                          <Zap size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[15px] font-bold text-[var(--color-text)]">Morechard Core AI</p>
                            <span className="px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 text-[10px] font-bold uppercase tracking-wide">Includes AI</span>
                          </div>
                          <p className="text-[20px] font-bold text-violet-600 leading-none mt-0.5">
                            {hasBase ? '£29.99' : '£64.99'}
                            <span className="text-[12px] font-semibold text-[var(--color-text-muted)] ml-1">one-time</span>
                          </p>
                          {hasBase && (
                            <p className="text-[11px] text-violet-600 font-medium mt-1">
                              Upgrade price — you already have Morechard Core
                            </p>
                          )}
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {(hasBase ? [
                          'AI Mentor — personalised financial coaching for your children',
                          'Learning Lab — 20-module financial literacy curriculum',
                          'Lessons grounded in your children\'s real earnings data',
                        ] : [
                          'Everything in Morechard Core',
                          'AI Mentor — personalised financial coaching for your children',
                          'Learning Lab — 20-module financial literacy curriculum',
                          'Lessons grounded in your children\'s real earnings data',
                        ]).map(item => (
                          <li key={item} className="flex items-start gap-2">
                            <Check size={12} className="shrink-0 text-violet-500 mt-0.5" />
                            <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        disabled={buying !== null}
                        onClick={() => handlePurchase(hasBase ? 'AI_UPGRADE' : 'COMPLETE_AI')}
                        className="w-full py-2.5 rounded-xl bg-violet-500 text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {buying === 'COMPLETE_AI' || buying === 'AI_UPGRADE'
                          ? 'Loading…'
                          : hasBase
                          ? 'Add AI Mentor + Learning Lab — £29.99'
                          : 'Get Morechard Core AI — £64.99'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Shield AI */}
                <div className="rounded-2xl border-2 border-amber-300 overflow-hidden bg-[color-mix(in_srgb,#f59e0b_6%,var(--color-surface))] shadow-[0_0_0_4px_color-mix(in_srgb,#f59e0b_8%,transparent)]">
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600">
                        <Shield size={16} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-bold text-[var(--color-text)]">Morechard Shield</p>
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
                      Every export carries a cryptographic hash. If a single figure is altered after export, the seal breaks — proving the record is authentic to solicitors and mediators.
                    </p>
                    <ul className="space-y-1.5">
                      {[
                        'Everything in Morechard Core AI',
                        'Court-admissible hashed PDF exports',
                        'Digital tamper-seal on every export',
                        'Share verified records with co-parents, mediators, or solicitors',
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
                      onClick={() => handlePurchase('SHIELD_AI')}
                      className="w-full py-2.5 rounded-xl bg-amber-500 text-white text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {buying === 'SHIELD_AI' ? 'Loading…' : 'Get Morechard Shield — £149.99'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cooling-off cancellation — only shown when paid plan active, within 14 days, and trial not already expired */}
            {(hasBase || hasAi || hasShield) && withinCoolingOff && coolingOffDeadline && !(trial?.is_expired) && (
              <SectionCard>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                    <p className="text-[12px] font-semibold text-[var(--color-text)]">14-day cooling-off period</p>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
                    You can cancel and receive a full refund until{' '}
                    <span className="font-semibold text-[var(--color-text)]">
                      {coolingOffDeadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>.
                  </p>
                  {!showCancelConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(true)}
                      className="text-[12px] font-semibold text-red-500 hover:text-red-600 transition-colors"
                    >
                      Cancel plan & request refund
                    </button>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <p className="text-[12px] text-red-600 font-medium">
                        Are you sure? Your licence will be revoked immediately and a full refund issued to your original payment method.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={cancelling}
                          onClick={handleCancel}
                          className="flex-1 py-2 rounded-xl bg-red-500 text-white text-[12px] font-bold hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          {cancelling ? 'Processing…' : 'Yes, cancel & refund'}
                        </button>
                        <button
                          type="button"
                          disabled={cancelling}
                          onClick={() => setShowCancelConfirm(false)}
                          className="flex-1 py-2 rounded-xl bg-[var(--color-surface-alt)] text-[var(--color-text)] text-[12px] font-bold hover:opacity-80 transition-opacity"
                        >
                          Keep my plan
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            <SectionCard>
              <div className="px-4 py-3">
                <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
                  All purchases are one-time payments — no subscriptions, no renewals.
                  Payments are processed securely. Your card details are never stored by Morechard.
                  For billing queries, contact support.
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
  const [sub, setSub]             = useState<SubView>(initialView ?? 'menu')
  const [localToast, setLocalToast] = useState<string | null>(null)
  const toastTimerRef             = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      <SectionHeader title="Billing" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Clock size={15} />}
          label="Trial Status"
          description="View your 14-day trial or current plan"
          onClick={() => setSub('trial')}
        />
        <SettingsRow
          icon={<CreditCard size={15} />}
          label="Plans & Upgrades"
          description="Purchase or upgrade your plan"
          onClick={() => setSub('plan')}
        />
        <SettingsRow
          icon={<Receipt size={15} />}
          label="Payment History"
          description="View past purchases"
          onClick={() => setSub('history')}
        />
        <SettingsRow
          icon={<Mail size={15} />}
          label="Billing Support"
          description="Contact us for refunds or billing queries"
          onClick={() => window.open('mailto:support@morechard.com', '_blank')}
        />
      </SectionCard>
    </div>
  )
}
