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
import { FullLogo } from '@/components/ui/Logo'

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
    subtext:  "Nothing gets paid or recorded without your sign-off. You're always in control.",
  },
  {
    image:    slide4,
    alt:      'Glowing golden chain links sealed with light, resting in open palms',
    headline: 'A record nothing can quietly change',
    subtext:  'Once approved, every entry is permanent and visible to everyone who needs it - so there are never any surprises.',
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
    <div className="h-svh bg-[#0b1f22] flex flex-col overflow-hidden relative">
      {/* Full-bleed slide art with a slow Ken Burns drift */}
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0"
        >
          <motion.img
            src={slide.image}
            alt={slide.alt}
            className="w-full h-full object-cover"
            draggable={false}
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            transition={{ duration: 6, ease: 'easeOut' }}
          />
          {/* Legibility scrim — dark navy, brand-consistent */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b1f22] via-[#0b1f22cc] to-[#0b1f2233]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0b1f2299] via-transparent to-transparent h-32" />
        </motion.div>
      </AnimatePresence>

      {/* Top bar — floats over the art, logo pinned top-left as everywhere else in the app */}
      <header className="safe-top px-4 py-3 flex justify-between items-center relative z-10">
        <FullLogo iconSize={26} light />
        <button
          onClick={finish}
          className="
            rounded-full px-3 py-1.5 text-[12px] font-semibold
            border border-white/20 bg-white/10 backdrop-blur-md text-white/90
            hover:bg-white/20 active:scale-95 transition-all
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
          "
        >
          Skip
        </button>
      </header>

      {/* Back — floats at the left edge, mid-height, once there's somewhere to go back to */}
      {activeIndex > 0 && (
        <button
          onClick={goPrevious}
          aria-label="Previous slide"
          className="
            absolute left-3 top-1/2 -translate-y-1/2 z-10
            w-9 h-9 rounded-full flex items-center justify-center
            bg-white/10 backdrop-blur-md border border-white/15 text-white
            hover:bg-white/20 active:scale-95 transition-all
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
          "
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      {/* Content — anchored to the bottom of the art, sits on the scrim */}
      <main className="flex-1 flex flex-col justify-end px-6 max-w-md mx-auto w-full relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={`text-${activeIndex}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="space-y-3 pb-2"
          >
            <span className="text-[13px] font-bold tracking-wide text-[var(--brand-accent)]">
              {activeIndex + 1} of {SLIDES.length}
            </span>
            <h1 className="text-[28px] font-extrabold text-white tracking-tight leading-[1.15] text-balance">
              {slide.headline}
            </h1>
            <p className="text-[15px] text-white/75 leading-relaxed max-w-[320px]">
              {slide.subtext}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-center gap-2 py-5" role="tablist" aria-label="Onboarding slides">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goToSlide(i)}
              className={`h-2 rounded-full transition-all duration-200 ${
                i === activeIndex ? 'w-6 bg-[var(--brand-accent)]' : 'w-2 bg-white/30'
              }`}
            />
          ))}
        </div>

        <div className="w-full pb-6">
          <button
            onClick={goNext}
            className="
              w-full h-14 rounded-2xl bg-[var(--brand-primary)] text-white
              font-semibold text-[15px] tracking-tight
              flex items-center justify-center gap-2.5
              hover:opacity-90 active:scale-[0.98]
              transition-all duration-150 shadow-lg shadow-black/30
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1f22]
            "
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </main>
    </div>
  )
}
