/**
 * WCAG 2.1 relative-luminance / contrast-ratio math (spec formula), plus the
 * concrete hex values used by High Contrast mode. Used by contrastRatio.test.ts
 * to assert every HC pair clears its WCAG AA threshold before it ships.
 */

function srgbChannelToLinear(c8bit: number): number {
  const c = c8bit / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '')
  const r = parseInt(n.substring(0, 2), 16)
  const g = parseInt(n.substring(2, 4), 16)
  const b = parseInt(n.substring(4, 6), 16)
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  const lighter = Math.max(lA, lB)
  const darker  = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}

// ── High Contrast token table ──────────────────────────────────────────────
// Every "text" pair must clear 4.5:1 (WCAG 1.4.3 AA).
// Every "non-text" pair (borders, focus rings, icons) must clear 3:1 (WCAG 1.4.11).
export const HC_LIGHT = {
  bg:          '#FFFFFF',
  surface:     '#FFFFFF',
  surfaceAlt:  '#F2F2F2',
  border:      '#707070',   // non-text, vs bg
  text:        '#0A0A0A',   // text, vs bg
  textMuted:   '#595959',   // text, vs bg
  brand:       '#006A70',   // text/icon, vs bg — darkened from #00959C for AA
  accent:      '#8A6400',   // text/icon, vs bg — darkened from #E6B222 for AA
  success:     '#0F7A38',   // text, vs bg — darkened from #16A34A for AA
  danger:      '#DC2626',   // text, vs bg — verified ≥4.5:1 as-is
  warning:     '#8A5A00',   // text, vs bg — darkened from #F59E0B for AA
} as const

export const HC_DARK = {
  bg:          '#050505',
  surface:     '#101010',
  surfaceAlt:  '#1A1A1A',
  border:      '#8C8C8C',   // non-text, vs bg
  text:        '#FAFAFA',   // text, vs bg
  textMuted:   '#A8A8A8',   // text, vs bg
  brand:       '#00959C',   // text/icon, vs bg — original brand teal already clears AA on near-black
  accent:      '#E6B222',   // text/icon, vs bg — original gold already clears AA on near-black
  success:     '#22C55E',
  danger:      '#F87171',
  warning:     '#FBBF24',
} as const
