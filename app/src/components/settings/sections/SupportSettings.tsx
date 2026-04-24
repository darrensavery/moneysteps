/**
 * SupportSettings — About & Support section (fully functional).
 *
 * Sub-views:
 *   menu      — top-level: search, subscription mgmt, what's new, contact, version, legal
 *   whats-new — changelog / release notes feed
 */

import { useState } from 'react'
import {
  Search, Sparkles, MessageCircle,
  FileText, ShieldCheck, ChevronRight, ExternalLink,
  Tag, Wrench,
} from 'lucide-react'
import { Toast, SectionCard, SectionHeader } from '../shared'

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
                  <span className="text-[14px] font-bold text-[var(--color-text)]">
                    v{release.version}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TAG_STYLES[release.tag]}`}>
                    {TAG_ICONS[release.tag]} {release.tag}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)]">{release.date}</span>
              </div>

              {/* Items */}
              <ul className="space-y-1.5">
                {release.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--brand-primary)] opacity-60" />
                    <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
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
      <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[var(--color-text)]">{label}</p>
        {description && (
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{description}</p>
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

      {/* ── Search / Contact — open Freshdesk widget ── */}
      <button
        type="button"
        onClick={() => window.fdWidget?.open()}
        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
      >
        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_15%,transparent)] text-[var(--brand-primary)]">
          <Search size={17} />
        </span>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[14px] font-bold text-[var(--color-text)]">Search the Help Desk</p>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">Browse guides, FAQs, and tutorials</p>
        </div>
        <ChevronRight size={14} className="shrink-0 text-[var(--brand-primary)]" />
      </button>

      {/* ── Contact support ── */}
      <SectionCard>
        <button
          type="button"
          onClick={() => window.fdWidget?.open()}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
        >
          <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
            <MessageCircle size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Contact Support</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">Submit a ticket — we reply within 24h</p>
          </div>
          <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
        </button>
      </SectionCard>

      {/* ── App updates ── */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
          Updates
        </p>
        <SectionCard>
          <button
            type="button"
            onClick={() => setSub('whats-new')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
          >
            <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
              <Sparkles size={15} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[var(--color-text)]">What's New</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                Recent updates and improvements
              </p>
            </div>
            <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
          </button>
        </SectionCard>
      </div>

      {/* ── Legal footer ── */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
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
          <p className="text-[13px] font-semibold text-[var(--color-text-muted)]">App version</p>
          <p className="text-[13px] font-bold text-[var(--color-text)] tabular-nums">{version}</p>
        </div>
      </SectionCard>
    </div>
  )
}
