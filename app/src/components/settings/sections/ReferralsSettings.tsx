/**
 * ReferralsSettings — Partnerships & Referrals section.
 *
 * Sub-views:
 *   menu       — three grouped rows (Peer / Professional Network ×2 / Community)
 *   peer       — "Invite a Family": live referral link + Web Share API + stats
 *   pro-legal  — For Solicitors & Mediators — mailto CTA (EN only)
 *   pro-media  — For Content Creators — mailto CTA (EN only)
 *   hardship   — Hardship Licence — mailto CTA
 *
 * Locale rules:
 *   - EN:  all four options visible
 *   - PL:  Peer + Hardship only (pro rows hidden until Polish Bar rules checked)
 */

import { useState, useEffect } from 'react'
import { Gift, Scale, Megaphone, HeartHandshake, Sparkles, Users, Copy, CheckCircle2, Share2, ExternalLink } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useLocale, isPolish } from '../../../lib/locale'
import { getReferralCode, getReferralStats } from '../../../lib/api'

type SubView = 'menu' | 'peer' | 'pro-legal' | 'pro-media' | 'hardship'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

// ── Referral data hook ─────────────────────────────────────────────────────────

function useReferral() {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [stats, setStats] = useState<{ clicks: number; sign_ups: number; conversions: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getReferralCode(), getReferralStats()])
      .then(([codeData, statsData]) => {
        setCode(codeData.code)
        setShareUrl(codeData.share_url)
        setStats(statsData)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  return { code, shareUrl, stats, loading }
}

// ── Peer referral sub-view ─────────────────────────────────────────────────────

function PeerView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
  const { locale } = useLocale()
  const pl = isPolish(locale)
  const { code, shareUrl, stats, loading } = useReferral()
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    if (!shareUrl) return
    if (navigator.share) {
      await navigator.share({ title: 'Join Morechard', url: shareUrl }).catch(() => null)
    } else {
      await navigator.clipboard.writeText(shareUrl).catch(() => null)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
      showToast(pl ? 'Link skopiowany' : 'Link copied')
    }
  }

  async function handleCopyUrl() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    showToast(pl ? 'Link skopiowany' : 'Link copied')
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title={pl ? 'Zaproś rodzinę' : 'Invite a Family'}
        subtitle={pl ? 'Podziel się Sadem z innymi' : 'Share the Grove with another family'}
        onBack={onBack}
      />

      {/* Reward banner */}
      <SectionCard>
        <div className="px-4 py-4 flex items-start gap-3">
          <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
            <Sparkles size={18} />
          </span>
          <div>
            <p className="text-[14px] font-bold text-[var(--color-text)]">
              {pl ? '3 miesiące Mentora AI gratis' : '3 months AI Mentor free'}
            </p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
              {pl
                ? 'Dla Ciebie i zaproszonej rodziny — po aktywacji licencji dożywotniej.'
                : 'For you and the family you invite — unlocked when they activate a Lifetime licence.'}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Share box */}
      <SectionCard>
        <div className="px-4 py-4">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
            {pl ? 'Twój link polecający' : 'Your referral link'}
          </p>
          {loading ? (
            <div className="h-10 rounded-lg bg-[var(--color-surface-alt)] animate-pulse" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                  <p className="text-[13px] font-mono text-[var(--color-text)] truncate">{shareUrl}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--color-surface-alt)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                  aria-label={pl ? 'Kopiuj link' : 'Copy link'}
                >
                  {copied
                    ? <CheckCircle2 size={16} className="text-green-600" />
                    : <Copy size={16} className="text-[var(--color-text-muted)]" />
                  }
                </button>
              </div>

              {/* Code pill */}
              {code && (
                <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
                  {pl ? 'Twój kod: ' : 'Your code: '}
                  <span className="font-mono font-bold text-[var(--color-text)]">{code}</span>
                </p>
              )}

              <button
                type="button"
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold hover:opacity-90 active:opacity-80 transition-opacity cursor-pointer"
              >
                <Share2 size={15} />
                {pl ? 'Udostępnij link' : 'Share this link'}
              </button>
            </>
          )}
        </div>
      </SectionCard>

      {/* Stats */}
      {stats && (
        <SectionCard>
          <div className="px-4 py-3 grid grid-cols-3 gap-3 text-center">
            {[
              { label: pl ? 'Kliknięcia' : 'Clicks',    value: stats.clicks },
              { label: pl ? 'Rejestracje' : 'Sign-ups', value: stats.sign_ups },
              { label: pl ? 'Zakupy' : 'Conversions',   value: stats.conversions },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[20px] font-bold tabular-nums text-[var(--color-text)]">{value}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* How it works */}
      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {pl ? 'Jak to działa' : 'How it works'}
          </p>
          <ol className="space-y-2 text-[12px] text-[var(--color-text)] leading-relaxed">
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">1</span>
              <span>{pl ? 'Wyślij swój unikalny link znajomej rodzinie.' : 'Send your unique link to a family you think would benefit.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">2</span>
              <span>{pl ? 'Dołączają i kupują licencję.' : 'They join and purchase a Lifetime licence.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">3</span>
              <span>{pl ? 'Obie rodziny otrzymują 3 miesiące Mentora AI gratis.' : 'Both families get 3 months of AI Mentor — on us.'}</span>
            </li>
          </ol>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Professional: Legal sub-view (EN only) ─────────────────────────────────────

function ProLegalView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="For Solicitors & Mediators"
        subtitle="Professional accounts — free of charge"
        onBack={onBack}
      />

      <SectionCard>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3 mb-3">
            <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
              <Scale size={18} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">Complimentary professional access</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                Free account with multi-client view and white-label court-report generation. No commission — no SRA disclosure required.
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Who it's for
          </p>
          <ul className="space-y-1.5 text-[12px] text-[var(--color-text)] leading-relaxed">
            <li>• Family-law solicitors (SRA-regulated or equivalent)</li>
            <li>• Accredited family mediators</li>
            <li>• McKenzie Friend network members</li>
            <li>• Citizens Advice family caseworkers</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Why no commission
          </p>
          <p className="text-[12px] text-[var(--color-text)] leading-relaxed">
            The SRA Code of Conduct requires client disclosure of any referral fees. Rather than put that burden on you and your clients, professional access is free — so your recommendation stays clean.
          </p>
        </div>
      </SectionCard>

      <SectionCard>
        <a
          href="mailto:hello@morechard.com?subject=Professional%20Access%20%E2%80%94%20Solicitor%2FMediator%20Enquiry&body=Name%3A%0AOrganisation%3A%0ASRA%20number%20or%20accreditation%3A%0AHow%20I%20plan%20to%20use%20Morechard%3A"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors"
        >
          <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
            <ExternalLink size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Register your interest</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">Opens a pre-filled email to our partnerships team</p>
          </div>
          <ExternalLink size={13} className="shrink-0 text-[var(--color-text-muted)]" />
        </a>
      </SectionCard>
    </div>
  )
}

// ── Professional: Media sub-view (EN only) ─────────────────────────────────────

function ProMediaView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="For Content Creators"
        subtitle="Affiliate programme — 20% revenue share"
        onBack={onBack}
      />

      <SectionCard>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3 mb-3">
            <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-violet-100 text-violet-700">
              <Megaphone size={18} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">Earn 20% on every licence sold</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                For parenting bloggers, YouTube creators, newsletter writers, and personal-finance educators with an engaged audience.
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            What's included
          </p>
          <ul className="space-y-1.5 text-[12px] text-[var(--color-text)] leading-relaxed">
            <li>• Unique tracking link with 90-day attribution cookie</li>
            <li>• Dashboard with real-time conversions and payouts</li>
            <li>• Monthly payouts via Stripe Connect</li>
            <li>• Asset kit: screenshots, logos, pre-written copy</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Disclosure requirements
          </p>
          <p className="text-[12px] text-[var(--color-text)] leading-relaxed">
            All affiliate content must be clearly labelled (#ad, #affiliate, "sponsored" or equivalent per ASA/FTC rules). We review links quarterly.
          </p>
        </div>
      </SectionCard>

      <SectionCard>
        <a
          href="mailto:hello@morechard.com?subject=Affiliate%20Programme%20Application&body=Name%3A%0AChannel%2FBlog%20URL%3A%0AApproximate%20audience%20size%3A%0AContent%20type%3A"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors"
        >
          <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-violet-100 text-violet-700">
            <ExternalLink size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">Apply to the programme</p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">Opens a pre-filled email to our affiliate team</p>
          </div>
          <ExternalLink size={13} className="shrink-0 text-[var(--color-text-muted)]" />
        </a>
      </SectionCard>
    </div>
  )
}

// ── Hardship licence sub-view ──────────────────────────────────────────────────

function HardshipView({ onBack }: { onBack: () => void }) {
  const { locale } = useLocale()
  const pl = isPolish(locale)

  return (
    <div className="space-y-4">
      <SectionHeader
        title={pl ? 'Licencja solidarnościowa' : 'Hardship Licence'}
        subtitle={pl ? 'Partnerstwo z organizacjami charytatywnymi' : 'Partnership with family-support charities'}
        onBack={onBack}
      />

      <SectionCard>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3 mb-3">
            <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-rose-100 text-rose-700">
              <HeartHandshake size={18} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[var(--color-text)]">
                {pl ? 'Bezpłatny dostęp dla rodzin w potrzebie' : 'Free access for families in need'}
              </p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                {pl
                  ? 'Współpracujemy z zaufanymi organizacjami, aby zapewnić darmowe licencje rodzinom w trudnej sytuacji finansowej lub prawnej.'
                  : 'We work with trusted charities to provide free Lifetime licences to families facing financial hardship or legal crisis.'}
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {pl ? 'Dla kogo' : 'Who qualifies'}
          </p>
          <ul className="space-y-1.5 text-[12px] text-[var(--color-text)] leading-relaxed">
            {pl ? (
              <>
                <li>• Organizacje wspierające ofiary przemocy domowej</li>
                <li>• Fundacje pomocy rodzinom w kryzysie finansowym</li>
                <li>• Grupy wsparcia dla samotnych rodziców</li>
              </>
            ) : (
              <>
                <li>• Domestic-abuse support organisations</li>
                <li>• Single-parent charities (e.g. Gingerbread)</li>
                <li>• Family mediation charities (e.g. Relate, National Family Mediation)</li>
                <li>• Legal-aid advice services</li>
              </>
            )}
          </ul>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {pl ? 'Jak to działa' : 'How it works'}
          </p>
          <p className="text-[12px] text-[var(--color-text)] leading-relaxed">
            {pl
              ? 'Organizacje partnerskie otrzymują pulę licencji do bezpłatnego przekazania podopiecznym. Umowa o współpracy, bez rozliczeń finansowych.'
              : 'Partner organisations receive a capped pool of free licences to distribute to their service users. Memorandum of understanding, no commercial exchange.'}
          </p>
        </div>
      </SectionCard>

      <SectionCard>
        <a
          href={pl
            ? 'mailto:hello@morechard.com?subject=Licencja%20solidarno%C5%9Bciowa%20%E2%80%94%20Zapytanie%20organizacji&body=Nazwa%20organizacji%3A%0AStrona%20internetowa%3A%0AOpis%20dzia%C5%82alno%C5%9Bci%3A'
            : 'mailto:hello@morechard.com?subject=Hardship%20Licence%20%E2%80%94%20Charity%20Enquiry&body=Organisation%20name%3A%0AWebsite%3A%0ACharity%20number%3A%0AHow%20we%20support%20families%3A'}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors"
        >
          <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-rose-100 text-rose-700">
            <Users size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">
              {pl ? 'Jestem z organizacji' : 'I represent a charity'}
            </p>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
              {pl ? 'Otwiera wstępnie wypełniony e-mail do naszego zespołu' : 'Opens a pre-filled email to our partnerships team'}
            </p>
          </div>
          <ExternalLink size={13} className="shrink-0 text-[var(--color-text-muted)]" />
        </a>
      </SectionCard>
    </div>
  )
}

// ── Root Referrals menu ────────────────────────────────────────────────────────

export function ReferralsSettings({ toast, onBack, onComingSoon: _onComingSoon }: Props) {
  const [sub, setSub] = useState<SubView>('menu')
  const [localToast, setLocalToast] = useState<string | null>(null)
  const { locale } = useLocale()
  const pl = isPolish(locale)

  function showToast(msg: string) {
    setLocalToast(msg)
    setTimeout(() => setLocalToast(null), 3000)
  }

  const activeToast = localToast ?? toast

  if (sub === 'peer')      return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<PeerView onBack={() => setSub('menu')} showToast={showToast} /></div>
  if (sub === 'pro-legal') return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<ProLegalView onBack={() => setSub('menu')} /></div>
  if (sub === 'pro-media') return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<ProMediaView onBack={() => setSub('menu')} /></div>
  if (sub === 'hardship')  return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<HardshipView onBack={() => setSub('menu')} /></div>

  return (
    <div className="space-y-4">
      {activeToast && <Toast message={activeToast} />}
      <SectionHeader
        title={pl ? 'Polecenia i partnerstwa' : 'Referrals & Partnerships'}
        subtitle={pl ? 'Podziel się Morechard i pomóż innym rodzinom' : 'Share Morechard and help more families grow'}
        onBack={onBack}
      />

      {/* Group 1 — Share & Rewards (always visible) */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
          {pl ? 'Udostępnij i zyskaj' : 'Share & Rewards'}
        </p>
        <SectionCard>
          <SettingsRow
            icon={<Gift size={15} />}
            label={pl ? 'Zaproś rodzinę' : 'Invite a Family'}
            description={pl ? '3 miesiące Mentora AI gratis — dla Ciebie i zaproszonej rodziny' : '3 months AI Mentor free — for you and the family you invite'}
            onClick={() => setSub('peer')}
          />
        </SectionCard>
      </div>

      {/* Group 2 — Professional Network (EN only) */}
      {!pl && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
            Professional Network
          </p>
          <SectionCard>
            <SettingsRow
              icon={<Scale size={15} />}
              label="For Solicitors & Mediators"
              description="Free professional accounts — no commission, no disclosure"
              onClick={() => setSub('pro-legal')}
            />
            <SettingsRow
              icon={<Megaphone size={15} />}
              label="For Content Creators"
              description="Affiliate programme — 20% revenue share"
              onClick={() => setSub('pro-media')}
            />
          </SectionCard>
        </div>
      )}

      {/* Group 3 — Community Support (always visible) */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5 px-1">
          {pl ? 'Wsparcie społeczności' : 'Community Support'}
        </p>
        <SectionCard>
          <SettingsRow
            icon={<HeartHandshake size={15} />}
            label={pl ? 'Licencja solidarnościowa' : 'Hardship Licence'}
            description={pl ? 'Partnerstwo z organizacjami pomagającymi rodzinom' : 'Partner with a charity to provide free licences to families in need'}
            onClick={() => setSub('hardship')}
          />
        </SectionCard>
      </div>

      {/* Footer note */}
      <div className="px-1 pt-1">
        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          {pl
            ? 'Kliknij "Zaproś rodzinę", aby wygenerować swój unikalny link polecający. Programy partnerskie dla profesjonalistów i organizacji charytatywnych są w budowie.'
            : 'Tap "Invite a Family" to get your unique referral link. Professional and charity partnership programmes open soon — tap through to register interest.'}
        </p>
      </div>
    </div>
  )
}
