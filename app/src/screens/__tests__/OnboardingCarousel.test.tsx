import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OnboardingCarousel } from '../OnboardingCarousel'
import { ONBOARDING_SEEN_KEY } from '../../lib/onboarding'

// `AnimatePresence mode="wait"` defers mounting the incoming slide until the
// outgoing slide's exit animation resolves. In jsdom there's no real
// animation frame to drive that, so synchronous `fireEvent.click` in these
// tests would never see the next slide. The production animation contract
// (mode="wait") is intentional per the brief — only the test harness needs
// framer-motion's transition machinery replaced with a synchronous
// pass-through so we can assert on real slide-change behavior without
// waiting on animation timing.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => {
          // Strip framer-motion-only props so they don't leak onto the DOM node.
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            drag: _drag,
            dragConstraints: _dragConstraints,
            dragElastic: _dragElastic,
            onDragEnd: _onDragEnd,
            ...domProps
          } = props
          return <div {...domProps}>{children}</div>
        },
    }
  ),
}))

function renderCarousel() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <OnboardingCarousel />
    </MemoryRouter>
  )
}

describe('OnboardingCarousel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the first slide headline on mount', () => {
    renderCarousel()
    expect(screen.getByText('Chores that actually pay')).toBeInTheDocument()
  })

  it('shows 4 pagination dots', () => {
    renderCarousel()
    expect(screen.getAllByRole('tab', { name: /go to slide/i })).toHaveLength(4)
  })

  it('advances to the next slide when Next is tapped', () => {
    renderCarousel()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Money lessons that actually stick')).toBeInTheDocument()
  })

  it('shows "Get Started" instead of "Next" on the final slide', () => {
    renderCarousel()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('You approve everything')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument()
  })

  it('jumps directly to a slide when its dot is tapped', () => {
    renderCarousel()
    fireEvent.click(screen.getByRole('tab', { name: 'Go to slide 3' }))
    expect(screen.getByText('25 lessons kids actually finish')).toBeInTheDocument()
  })

  it('marks onboarding seen and does not stay on /onboarding when Skip is tapped', () => {
    renderCarousel()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')
  })

  it('marks onboarding seen when Get Started is tapped on the final slide', () => {
    renderCarousel()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Get Started' }))
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')
  })
})
