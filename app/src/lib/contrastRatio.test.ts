import { describe, it, expect } from 'vitest'
import { contrastRatio, HC_LIGHT, HC_DARK } from './contrastRatio'

const TEXT_MIN = 4.5
const NON_TEXT_MIN = 3.0

describe('High Contrast token table — WCAG 2.1 AA', () => {
  it('light mode: every text token clears 4.5:1 against its background', () => {
    for (const key of ['text', 'textMuted', 'brand', 'accent', 'success', 'danger', 'warning'] as const) {
      expect(contrastRatio(HC_LIGHT[key], HC_LIGHT.bg)).toBeGreaterThanOrEqual(TEXT_MIN)
    }
  })

  it('light mode: border clears 3:1 against its background', () => {
    expect(contrastRatio(HC_LIGHT.border, HC_LIGHT.bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })

  it('dark mode: every text token clears 4.5:1 against its background', () => {
    for (const key of ['text', 'textMuted', 'brand', 'accent', 'success', 'danger', 'warning'] as const) {
      expect(contrastRatio(HC_DARK[key], HC_DARK.bg)).toBeGreaterThanOrEqual(TEXT_MIN)
    }
  })

  it('dark mode: border clears 3:1 against its background', () => {
    expect(contrastRatio(HC_DARK.border, HC_DARK.bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })
})
