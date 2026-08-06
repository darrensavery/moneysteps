import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveHighContrast, systemPrefersMoreContrast } from './theme'

describe('resolveHighContrast / systemPrefersMoreContrast', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the stored preference when one exists, ignoring OS setting', () => {
    localStorage.setItem('mc_high_contrast', '0')
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-contrast'), // OS says "more contrast"
      addEventListener: () => {}, removeEventListener: () => {},
    }))

    expect(systemPrefersMoreContrast()).toBe(true)
    // Explicit stored preference wins over the OS setting.
    expect(resolveHighContrast()).toBe(false)
  })

  it('falls back to OS prefers-contrast when nothing is stored', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-contrast'),
      addEventListener: () => {}, removeEventListener: () => {},
    }))

    expect(resolveHighContrast()).toBe(true)
  })
})
