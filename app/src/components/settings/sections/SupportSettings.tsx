/**
 * SupportSettings — About & Support section (fully functional).
 *
 * Sub-views:
 *   menu      — top-level: search, subscription mgmt, what's new, contact, version, legal
 *   whats-new — changelog / release notes feed
 */

import { useState, useEffect, useRef } from 'react'
import {
  Search, Sparkles,
  FileText, ShieldCheck, ChevronRight, ExternalLink,
  Tag, Wrench,
} from 'lucide-react'
import { Toast, SectionCard, SectionHeader } from '../shared'
import { apiUrl, authHeaders } from '../../../lib/api'
import { useFocusTrap } from '../../../hooks/useFocusTrap'

declare const __APP_VERSION__: string | undefined

// ── Constants ──────────────────────────────────────────────────────────────────

const PRIVACY_URL          = 'https://morechard.com/privacy-policy'
const TERMS_URL            = 'https://morechard.com/terms'

// ── What's New feed ────────────────────────────────────────────────────────────

type ReleaseEntry = {
  version: string
  date:    string
  tag:     'New' | 'Improved' | 'Fixed'
  items:   string[]
}

const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: '1.7',
    date:    'April 2026',
    tag:     'New',
    items: [
      'Support centre with help desk search',
      'Stripe Customer Portal for self-serve billing',
      'Rate Guide — market rate benchmarking for chores',
    ],
  },
  {
    version: '1.6',
    date:    'March 2026',
    tag:     'New',
    items: [
      'Payment Bridge — deep-link payouts via Monzo, Revolut & PayPal',
      'AI Orchard Mentor weekly briefings for parents',
      '"Copy for Child" coaching cards (Seedling & Professional tones)',
    ],
  },
  {
    version: '1.5',
    date:    'February 2026',
    tag:     'Improved',
    items: [
      'Savings Grove goal planning module',
      'Delete account (Uproot) with full anonymisation',
      'Sentry error tracking added',
    ],
  },
  {
    version: '1.4',
    date:    'January 2026',
    tag:     'Fixed',
    items: [
      'Android App Links deep-link verification',
      'WebAuthn Face ID / Touch ID reliability improvements',
      'Co-parent invite expiry bug resolved',
    ],
  },
]

const TAG_STYLES: Record<ReleaseEntry['tag'], string> = {
  New:      'bg-teal-100 text-teal-700',
  Improved: 'bg-violet-100 text-violet-700',
  Fixed:    'bg-amber-100 text-amber-700',
}

const TAG_ICONS: Record<ReleaseEntry['tag'], React.ReactNode> = {
  New:      <Sparkles size={10} />,
  Improved: <Wrench   size={10} />,
  Fixed:    <Tag      size={10} />,
}

// ── What's New sub-view ────────────────────────────────────────────────────────

function WhatsNewView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="What's New" onBack={onBack} />

      <div className="space-y-3">
        {RELEASE_NOTES.map(release => (
          <SectionCard key={release.version}>
            <div className="px-4 pt-3.5 pb-3">
              {/* Header row */}
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[0.875rem] font-bold text-[var(--color-text)]">
                    v{release.version}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TAG_STYLES[release.tag]}`}>
                    {TAG_ICONS[release.tag]} {release.tag}
                  </span>
                </div>
                <span className="text-[0.6875rem] text-[var(--color-text-muted)]">{release.date}</span>
              </div>

              {/* Items */}
              <ul className="space-y-1.5">
                {release.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--brand-primary)] opacity-60" />
                    <span className="text-[0.75rem] text-[var(--color-text-muted)] leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-relaxed">
            Morechard is actively developed. Updates are released regularly — check back often for new features and improvements.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Reusable link-row ──────────────────────────────────────────────────────────

function LinkRow({
  icon, label, description, href, external = true, accent,
}: {
  icon:         React.ReactNode
  label:        string
  description?: string
  href:         string
  external?:    boolean
  accent?:      'primary' | 'violet'
}) {
  const iconBg = accent === 'violet'
    ? 'bg-violet-100 text-violet-700'
    : 'bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'

  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors"
    >
      <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">{label}</p>
        {description && (
          <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      <ExternalLink size={13} className="shrink-0 text-[var(--color-text-muted)]" />
    </a>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type SubView = 'menu' | 'whats-new'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function SupportSettings({ toast, onBack }: Props) {
  const [sub, setSub] = useState<SubView>('menu')
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactText, setContactText] = useState('')
  const [contactSubmitting, setContactSubmitting] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const [contactSent, setContactSent] = useState(false)

  const contactModalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(contactModalRef, showContactModal)

  useEffect(() => {
    if (!showContactModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowContactModal(false); setContactText('') }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showContactModal])

  async function submitContactRequest() {
    const description = contactText.trim()
    if (!description) return
    setContactSubmitting(true)
    setContactError(null)
    try {
      const res = await fetch(apiUrl('/api/support-agent/request'), {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, screen: 'SupportSettings' }),
      })
      if (!res.ok) throw new Error('Request failed')
      setContactSent(true)
    } catch {
      setContactError('Could not send your message — please try again.')
    } finally {
      setContactSubmitting(false)
    }
  }

  if (sub === 'whats-new') {
    return (
      <div className="space-y-4">
        {toast && <Toast message={toast} />}
        <WhatsNewView onBack={() => setSub('menu')} />
      </div>
    )
  }

  const version = __APP_VERSION__ ?? '—'

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Help & Support" onBack={onBack} />

      {/* ── Search the help desk ── */}
      <SectionCard>
        <LinkRow
          icon={<Search size={15} />}
          label="Search the Help Desk"
          description="Browse guides, FAQs, and tutorials"
          href="https://support.morechard.com"
        />
      </SectionCard>

      {/* ── Contact support ── */}
      <SectionCard>
        <button
          type="button"
          onClick={() => { setShowContactModal(true); setContactSent(false); setContactError(null); setContactText('') }}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
        >
          <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
            <Search size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">Contact Support</p>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5 leading-snug">
              Send us a message — we'll get back to you by email
            </p>
          </div>
          <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
        </button>
      </SectionCard>

      {/* ── App updates ── */}
      <div>
        <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
          Updates
        </p>
        <SectionCard>
          <button
            type="button"
            onClick={() => setSub('whats-new')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
          >
            <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
              <Sparkles size={15} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[0.875rem] font-semibold text-[var(--color-text)]">What's New</p>
              <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                Recent updates and improvements
              </p>
            </div>
            <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
          </button>
        </SectionCard>
      </div>

      {/* ── Legal footer ── */}
      <div>
        <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
          Legal
        </p>
        <SectionCard>
          <LinkRow
            icon={<ShieldCheck size={15} />}
            label="Privacy Policy"
            description="How we handle your family's data"
            href={PRIVACY_URL}
          />
          <LinkRow
            icon={<FileText size={15} />}
            label="Terms of Use"
            description="The rules of the Orchard"
            href={TERMS_URL}
          />
        </SectionCard>
      </div>

      {/* ── Version ── */}
      <SectionCard>
        <div className="px-4 py-3.5 flex items-center justify-between">
          <p className="text-[0.8125rem] font-semibold text-[var(--color-text-muted)]">App version</p>
          <p className="text-[0.8125rem] font-bold text-[var(--color-text)] tabular-nums">{version}</p>
        </div>
      </SectionCard>

      {/* Contact Support Modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div
            ref={contactModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Contact support"
            tabIndex={-1}
            className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">Contact Support</p>
              <button
                onClick={() => { setShowContactModal(false); setContactText('') }}
                className="tap-target-44 text-[var(--color-text-muted)] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {contactSent ? (
              <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
                Thanks — we've received your message and will get back to you by email.
              </p>
            ) : (
              <>
                <label htmlFor="support-contact-message" className="sr-only">What's going on?</label>
                <textarea
                  id="support-contact-message"
                  value={contactText}
                  onChange={(e) => setContactText(e.target.value)}
                  placeholder="What's going on?"
                  rows={4}
                  required
                  aria-required="true"
                  aria-invalid={!!contactError}
                  aria-describedby={contactError ? 'support-contact-error' : undefined}
                  className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-[0.8125rem] text-[var(--color-text)] bg-[var(--color-surface)]"
                />
                {contactError && (
                  <p id="support-contact-error" role="alert" className="text-[0.75rem] text-red-600">{contactError}</p>
                )}
                <button
                  type="button"
                  disabled={contactSubmitting || !contactText.trim()}
                  onClick={submitContactRequest}
                  className="w-full py-3 rounded-xl bg-[var(--brand-primary)] text-white text-[0.875rem] font-bold disabled:opacity-50 cursor-pointer"
                >
                  {contactSubmitting ? 'Sending…' : 'Send'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
