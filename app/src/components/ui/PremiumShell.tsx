/**
 * PremiumShell — shared design system for AI Mentor / Orchard Pro cards.
 *
 * Exports:
 *   PremiumShell      — wrapper with animated conic-gradient border + glow
 *   MentorAvatar      — 36×36 leaf-icon circle, accent-tinted
 *   ProBadge          — gold "✦ Pro" pill (top-right of card)
 *   injectPremiumStyles — idempotent <style> injection (call once in useEffect)
 *
 * Usage:
 *   useEffect(() => { injectPremiumStyles() }, [])
 *   <PremiumShell><MentorAvatar /> ... <ProBadge /></PremiumShell>
 *
 * Mandatory for EVERY card that carries "Orchard Mentor" branding.
 * See memory: project_premium_shell.md for full design token reference.
 */

/**
 * Single source of truth for the "Orchard Mentor" dark-card palette — the
 * shell's background is a fixed dark surface regardless of light/dark theme,
 * so these live as plain constants (not CSS custom properties) and get
 * imported wherever a mentor card renders its own text, rather than each
 * consumer re-declaring the same hex values inline.
 */
export const MENTOR_COLORS = {
  label:  '#6b9e87',   // "ORCHARD MENTOR" eyebrow label
  heading:'#f0fdf4',   // card heading text
  body:   '#a7c4b5',   // card body copy
  accent: '#0d9488',   // teal — avatar stroke, numbered list markers, icons
  gold:   '#d4a017',   // gold — Pro badge text, border gradient
  bright: '#4ade80',   // bright-green inline highlight (e.g. a child's name)
} as const

export const PREMIUM_STYLES = `
@keyframes premiumBorderSpin {
  0%   { --border-angle: 0deg; }
  100% { --border-angle: 360deg; }
}
@property --border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.premium-shell {
  --border-angle: 0deg;
  animation: premiumBorderSpin 4s linear infinite;
  background:
    linear-gradient(#0f1a14, #0f1a14) padding-box,
    conic-gradient(
      from var(--border-angle),
      #0d9488 0%,
      #d4a017 30%,
      #0d9488 60%,
      #d4a017 80%,
      #0d9488 100%
    ) border-box;
  border: 1.5px solid transparent;
}
@media (prefers-reduced-motion: reduce) {
  .premium-shell {
    animation: none;
    background:
      linear-gradient(#0f1a14, #0f1a14) padding-box,
      linear-gradient(135deg, #0d9488 0%, #d4a017 50%, #0d9488 100%) border-box;
  }
}
`

let stylesInjected = false
export function injectPremiumStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = PREMIUM_STYLES
  document.head.appendChild(el)
  stylesInjected = true
}

/** Animated teal→gold border card wrapper. Always dark surface (#0f1a14). */
export function PremiumShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative rounded-2xl premium-shell overflow-hidden"
      style={{ boxShadow: '0 0 32px rgba(13,148,136,0.15), 0 4px 16px rgba(0,0,0,0.3)' }}
    >
      {/* Radial glow layer */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(13,148,136,0.12) 0%, transparent 70%)' }}
      />
      {children}
    </div>
  )
}

/** Leaf-icon avatar circle. accent defaults to brand teal. */
export function MentorAvatar({ accent = MENTOR_COLORS.accent }: { accent?: string }) {
  return (
    <div
      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
      style={{
        background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15), transparent 60%), ${accent}22`,
        border: `1.5px solid ${accent}55`,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
      </svg>
    </div>
  )
}

/** Gold "✦ Pro" badge — always top-right of a PremiumShell card. */
export function ProBadge() {
  return (
    <span
      className="shrink-0 text-[0.5625rem] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
      style={{
        background: 'rgba(212,160,23,0.15)',
        color:      MENTOR_COLORS.gold,
        border:     '1px solid rgba(212,160,23,0.3)',
        letterSpacing: '0.1em',
      }}
    >
      ✦ Pro
    </span>
  )
}

/**
 * EU AI Act Article 50 disclosure — shown on every card whose content is
 * genuinely AI-generated (never on deterministic rule-based fallback text).
 */
export function AiDisclosurePill() {
  return (
    <span
      className="text-[0.5625rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
      style={{
        background: 'rgba(255,255,255,0.08)',
        color:      'rgba(164,196,181,0.85)',
        border:     '1px solid rgba(255,255,255,0.1)',
      }}
    >
      AI-generated
    </span>
  )
}
