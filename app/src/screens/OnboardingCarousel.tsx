/**
 * OnboardingCarousel — first-launch explainer, shown once before LandingGate.
 *
 * Routed at /onboarding. RootGate in App.tsx sends fresh (no device identity,
 * hasSeenOnboarding() === false) users here. Skip or "Get Started" both mark
 * the flag seen and navigate back to "/", letting RootGate re-decide the next
 * screen (falls through to LandingGate) rather than hardcoding it here.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { markOnboardingSeen } from '@/lib/onboarding'

import slide1 from '@/assets/onboarding/slide-1.svg'
import slide2 from '@/assets/onboarding/slide-2.svg'
import slide3 from '@/assets/onboarding/slide-3.svg'
import slide4 from '@/assets/onboarding/slide-4.svg'

interface Slide {
  image:    string
  alt:      string
  headline: string
  subtext:  string
}

const SLIDES: Slide[] = [
  {
    image:    slide1,
    alt:      'A child completing a chore, glowing with warm light',
    headline: 'Chores that actually pay',
    subtext:  'Every task is tracked as real, earned money - not just a checklist to cross off.',
  },
  {
    image:    slide2,
    alt:      'A child looking up at a glowing orb of light above their palm',
    headline: 'Money lessons that actually stick',
    subtext:  'The AI Mentor turns their own earning and spending into real financial lessons - not a generic course.',
  },
  {
    image:    slide3,
    alt:      'A parent reviewing a glowing ledger held in both hands',
    headline: 'You approve everything',
    subtext:  "Nothing hits the ledger without your sign-off. You're always in control.",
  },
  {
    image:    slide4,
    alt:      'Glowing golden chain links sealed with light, resting in open palms',
    headline: 'A record nothing can quietly change',
    subtext:  "Every entry is locked the moment it's approved - permanent, tamper-proof, and visible to everyone who needs it.",
  },
]

export function OnboardingCarousel() {
  const navigate = useNavigate()
  const [activeIndex, setActiveIndex] = useState(0)
  const isLast = activeIndex === SLIDES.length - 1
  const slide = SLIDES[activeIndex]

  function finish() {
    markOnboardingSeen()
    navigate('/', { replace: true })
  }

  function goNext() {
    if (isLast) {
      finish()
    } else {
      setActiveIndex(i => i + 1)
    }
  }

  function goPrevious() {
    setActiveIndex(i => Math.max(0, i - 1))
  }

  function goToSlide(index: number) {
    setActiveIndex(index)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrevious()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <div className="h-svh bg-[var(--color-bg)] flex flex-col overflow-hidden">
      <header className="safe-top px-4 py-3 flex justify-end">
        <button
          onClick={finish}
          className="text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Skip
        </button>
      </header>

      <main className="flex-1 flex flex-col px-5 max-w-md mx-auto w-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_e, info) => {
                if (info.offset.x < -60) goNext()
                else if (info.offset.x > 60 && activeIndex > 0) goToSlide(activeIndex - 1)
              }}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-6 w-full py-4"
            >
              <img
                src={slide.image}
                alt={slide.alt}
                className="w-full max-w-[280px] h-auto rounded-2xl"
                draggable={false}
              />
              <div className="text-center space-y-3">
                <h1 className="text-[28px] font-extrabold text-[var(--color-text)] tracking-tight leading-[1.15]">
                  {slide.headline}
                </h1>
                <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed max-w-[300px] mx-auto">
                  {slide.subtext}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-center gap-2 py-4" role="tablist" aria-label="Onboarding slides">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goToSlide(i)}
              className={`h-2 rounded-full transition-all duration-200 ${
                i === activeIndex
                  ? 'w-6 bg-[var(--brand-primary)]'
                  : 'w-2 bg-[var(--color-border)]'
              }`}
            />
          ))}
        </div>

        <div className="w-full pb-6 flex gap-3">
          {activeIndex > 0 && (
            <button
              onClick={goPrevious}
              aria-label="Previous slide"
              className="
                h-14 px-6 rounded-2xl border-2 border-[var(--color-border)] text-[var(--color-text)]
                font-semibold text-[15px] tracking-tight
                hover:bg-[var(--color-surface-alt)] active:scale-[0.98]
                transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
              "
            >
              Back
            </button>
          )}
          <button
            onClick={goNext}
            className="
              flex-1 h-14 rounded-2xl bg-[var(--brand-primary)] text-white
              font-semibold text-[15px] tracking-tight
              flex items-center justify-center gap-2.5
              hover:opacity-90 active:scale-[0.98]
              transition-all duration-150 shadow-md hover:shadow-lg
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
            "
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </main>
    </div>
  )
}
