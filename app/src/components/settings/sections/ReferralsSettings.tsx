/**
 * ReferralsSettings — Partnerships & Referrals section.
 *
 * Four partnership types, each as UI shell only (no backend wiring yet).
 * Each row fires a "Coming Soon" / "Notify me" toast.
 *
 * Sub-views:
 *   menu       — three grouped rows (Peer / Professional Network ×2 / Community)
 *   peer       — "Invite a Family" overview: 3 months AI Mentor both sides
 *   pro-legal  — For Solicitors & Mediators — free professional accounts (EN only)
 *   pro-media  — For Content Creators — affiliate programme (EN only)
 *   hardship   — Hardship Licence — charity partnerships
 *
 * Locale rules:
 *   - EN:  all four options visible
 *   - PL:  Peer + Hardship only (pro rows hidden until Polish Bar rules checked)
 */

import { useState } from 'react'
import { Gift, Scale, Megaphone, HeartHandshake, Sparkles, Mail, Users } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useLocale, isPolish } from '../../../lib/locale'

type SubView = 'menu' | 'peer' | 'pro-legal' | 'pro-media' | 'hardship'

interface Props {
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

// ── Peer referral sub-view ─────────────────────────────────────────────────────

function PeerView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
  const { locale } = useLocale()
  const pl = isPolish(locale)

  return (
    <div className="space-y-4">
      <SectionHeader
        title={pl ? 'Zaproś rodzinę' : 'Invite a Family'}
        subtitle={pl ? 'Podziel się Sadem z innymi' : 'Share the Grove with another family'}
        onBack={onBack}
      />

      <SectionCard>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3 mb-3">
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
        </div>
      </SectionCard>

      <SectionCard>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {pl ? 'Jak to działa' : 'How it works'}
          </p>
          <ol className="space-y-2 text-[12px] text-[var(--color-text)] leading-relaxed">
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">1</span>
              <span>{pl ? 'Wygeneruj swój unikalny link polecający.' : 'Generate your unique referral link.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">2</span>
              <span>{pl ? 'Podziel się nim z rodziną lub przyjaciółmi.' : 'Share it with a family you think would benefit.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold flex items-center justify-center">3</span>
              <span>{pl ? 'Gdy dołączą i kupią licencję — obie rodziny otrzymują 3 miesiące Mentora AI gratis.' : 'When they join and buy a Lifetime licence, both families get 3 months of AI Mentor — on us.'}</span>
            </li>
          </ol>
        </div>
      </SectionCard>

      <SectionCard>
        <SettingsRow
          icon={<Gift size={15} />}
          label={pl ? 'Powiadom mnie, gdy będzie dostępne' : 'Notify me when ready'}
          description={pl ? 'Pracujemy nad tym — powiadomimy Cię e-mailem.' : 'We\'re building this — we\'ll email you the moment it\'s live.'}
          onClick={() => showToast(pl ? '🌱 Dodamy Cię do listy' : '🌱 You\'re on the list')}
        />
      </SectionCard>
    </div>
  )
}

// ── Professional: Legal sub-view (EN only) ─────────────────────────────────────

function ProLegalView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
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
        <SettingsRow
          icon={<Mail size={15} />}
          label="Register your interest"
          description="We'll contact you when professional onboarding opens."
          onClick={() => showToast('🌿 We\'ll be in touch')}
        />
      </SectionCard>
    </div>
  )
}

// ── Professional: Media sub-view (EN only) ─────────────────────────────────────

function ProMediaView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
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
        <SettingsRow
          icon={<Mail size={15} />}
          label="Apply to the programme"
          description="Tell us about your audience — we'll review and come back to you."
          onClick={() => showToast('🌿 Application noted')}
        />
      </SectionCard>
    </div>
  )
}

// ── Hardship licence sub-view ──────────────────────────────────────────────────

function HardshipView({ onBack, showToast }: { onBack: () => void; showToast: (m: string) => void }) {
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
        <SettingsRow
          icon={<Users size={15} />}
          label={pl ? 'Jestem z organizacji' : 'I represent a charity'}
          description={pl ? 'Opowiedz nam o Waszej pracy — oddzwonimy.' : 'Tell us about your organisation — we\'ll reach out.'}
          onClick={() => showToast(pl ? '💚 Dziękujemy za zgłoszenie' : '💚 Thank you — we\'ll be in touch')}
        />
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
  if (sub === 'pro-legal') return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<ProLegalView onBack={() => setSub('menu')} showToast={showToast} /></div>
  if (sub === 'pro-media') return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<ProMediaView onBack={() => setSub('menu')} showToast={showToast} /></div>
  if (sub === 'hardship')  return <div className="space-y-4">{activeToast && <Toast message={activeToast} />}<HardshipView onBack={() => setSub('menu')} showToast={showToast} /></div>

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
            ? 'Wszystkie programy partnerskie są w budowie. Kliknij poszczególne opcje, aby zgłosić zainteresowanie — powiadomimy Cię, gdy będą gotowe.'
            : 'All partnership programmes are in development. Tap through to register interest — we\'ll notify you when each one goes live.'}
        </p>
      </div>
    </div>
  )
}
