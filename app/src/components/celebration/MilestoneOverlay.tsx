/**
 * MilestoneOverlay — CelebrationEngine base renderer.
 * Child must tap Continue to advance between stages and dismiss.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '../../lib/utils'
import type { MilestoneEvent } from './types'
import { CONFIGS } from './registry'
import { StreakRing } from './StreakRing'

interface Props {
  event:      MilestoneEvent
  onComplete: () => void
}

type Phase = 'stage' | 'transition' | 'exit'

function spawnConfetti(container: HTMLDivElement) {
  const cols = ['#00959c', '#3fcf9b', '#e6b222', '#ffe39a', '#1d8f6f']
  for (let i = 0; i < 28; i++) {
    const leaf = document.createElement('div')
    const size = 10 + Math.random() * 8
    leaf.style.cssText = [
      'position:absolute', 'top:-28px',
      `width:${size}px`, `height:${size}px`,
      `left:${6 + Math.random() * 88}%`,
      `background:${cols[i % cols.length]}`,
      'border-radius:0 100% 0 100%',
      'opacity:0',
      `animation:mc-leaf-drop ${2.6 + Math.random() * 1.4}s cubic-bezier(.3,.2,.5,1) ${Math.random() * 0.5}s 1 forwards`,
      `--dx:${(Math.random() * 120) - 60}px`,
    ].join(';')
    container.appendChild(leaf)
  }
}

export function MilestoneOverlay({ event, onComplete }: Props) {
  const config    = CONFIGS[event.type] ?? null
  const stages    = config ? (event.appView === 'CLEAN' ? config.clean : config.orchard) : []
  const isShimmer = config?.transition === 'shimmer'
  const hasPayoff = config?.tier === 'landmark' || config?.tier === 'standard'

  const [stageIdx,     setStageIdx]     = useState(0)
  const [phase,        setPhase]        = useState<Phase>('stage')
  const [visible,      setVisible]      = useState(true)
  const [showButton,   setShowButton]   = useState(false)
  const [btnReady,     setBtnReady]     = useState(false)

  const containerRef     = useRef<HTMLDivElement>(null)
  const flashRef         = useRef<HTMLDivElement>(null)
  const buttonRef        = useRef<HTMLButtonElement>(null)
  const confettiSpawned  = useRef(false)
  const onCompleteRef    = useRef(onComplete)
  const buttonTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  useEffect(() => { onCompleteRef.current = onComplete })

  const triggerPayoff = useCallback(() => {
    if (!confettiSpawned.current && containerRef.current && hasPayoff) {
      confettiSpawned.current = true
      if (reducedMotion) return
      if (flashRef.current) {
        flashRef.current.style.animation = 'none'
        void flashRef.current.offsetWidth
        flashRef.current.style.animation = 'mc-flash .42s ease-out 1 forwards'
      }
      spawnConfetti(containerRef.current)
    }
  }, [hasPayoff, reducedMotion])

  // Reset button visibility on each new stage
  useEffect(() => {
    if (!config || stages.length === 0) { onCompleteRef.current(); return }
    confettiSpawned.current = false
    setShowButton(false)
    setBtnReady(false)

    const current = stages[stageIdx]
    const isStreakRing = current?.variant === 'streak-ring'

    // Delay before showing the button:
    // - streak-ring: wait for ring animation to finish (~2.5s)
    // - other stages: short delay for entrance animation to settle
    const delay = isStreakRing ? 2600 : 900

    if (buttonTimerRef.current) clearTimeout(buttonTimerRef.current)
    buttonTimerRef.current = setTimeout(() => {
      setShowButton(true)
      setTimeout(() => setBtnReady(true), 80)
      // For CLEAN-mode streak-ring, confetti fires via StreakRing's onComplete.
      // All other payoff stages (orchard streak-ring, badge variants) need it here.
      const isCleanStreakRing = current?.variant === 'streak-ring' && event.appView === 'CLEAN'
      if (!isCleanStreakRing) {
        triggerPayoff()
      }
    }, delay)

    return () => {
      if (buttonTimerRef.current) clearTimeout(buttonTimerRef.current)
    }
  }, [stageIdx, config, triggerPayoff, event.appView])

  // Move focus onto the Continue button as soon as it's interactive, so
  // keyboard users always have a focused, actionable control on each stage.
  useEffect(() => {
    if (btnReady) buttonRef.current?.focus()
  }, [btnReady])

  const advance = useCallback(() => {
    if (stageIdx < stages.length - 1) {
      setPhase('transition')
      setTimeout(() => {
        setStageIdx(i => i + 1)
        setPhase('stage')
      }, 600)
    } else {
      setPhase('exit')
      setVisible(false)
      setTimeout(() => onCompleteRef.current(), 500)
    }
  }, [stageIdx, stages.length])

  const dismiss = useCallback(() => {
    setPhase('exit')
    setVisible(false)
    setTimeout(() => onCompleteRef.current(), 200)
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dismiss])

  if (!config) return null

  const current    = stages[stageIdx]
  const isStreakRing = current.variant === 'streak-ring' && event.appView === 'CLEAN'
  const isLastStage  = stageIdx === stages.length - 1

  const btnLabel = isLastStage ? "Let's go! 🎉" : 'Continue'

  return (
    <>
      <style>{`
        @keyframes mc-flash {
          0%   { opacity:0; transform:scale(.2) }
          18%  { opacity:1 }
          100% { opacity:0; transform:scale(1.5) }
        }
        @keyframes mc-leaf-drop {
          0%   { opacity:0; transform:translateY(-30px) translateX(0) rotate(0) }
          8%   { opacity:1 }
          100% { opacity:0; transform:translateY(600px) translateX(var(--dx,30px)) rotate(540deg) }
        }
        @keyframes mc-fade-up {
          from { opacity:0; transform:translateY(14px) }
          to   { opacity:1; transform:translateY(0) }
        }
        @keyframes mc-icon-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,149,156,0.55), 0 0 28px 8px rgba(0,149,156,0.18) }
          50%       { box-shadow: 0 0 0 14px rgba(0,149,156,0), 0 0 40px 14px rgba(0,149,156,0.10) }
        }
        @keyframes mc-btn-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,149,156,0.55) }
          60%       { box-shadow: 0 0 0 10px rgba(0,149,156,0) }
        }
        @keyframes mc-orb-drift {
          0%   { transform: translateY(0) scale(1) }
          50%  { transform: translateY(-18px) scale(1.04) }
          100% { transform: translateY(0) scale(1) }
        }
      `}</style>

      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={current.heading}
        className={cn(
          'fixed inset-0 z-[100] flex items-center justify-center overflow-hidden',
          'transition-opacity duration-500',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ backgroundColor: config.bgColor }}
        onClick={showButton ? advance : undefined}
      >
        {/* Atmospheric radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 70% 55% at 50% 38%, rgba(0,149,156,0.28) 0%, rgba(62,207,155,0.10) 40%, transparent 75%)',
        }} />

        {/* Floating ambient orbs */}
        {!reducedMotion && (
          <>
            <div style={{
              position: 'absolute', width: 220, height: 220, borderRadius: '50%',
              top: '8%', left: '-12%', pointerEvents: 'none',
              background: 'radial-gradient(circle, rgba(0,149,156,0.14) 0%, transparent 70%)',
              animation: 'mc-orb-drift 7s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', width: 180, height: 180, borderRadius: '50%',
              bottom: '10%', right: '-8%', pointerEvents: 'none',
              background: 'radial-gradient(circle, rgba(230,178,34,0.12) 0%, transparent 70%)',
              animation: 'mc-orb-drift 9s ease-in-out infinite 1.5s',
            }} />
          </>
        )}

        <div
          ref={flashRef}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0,
            background: 'radial-gradient(circle at 50% 40%,rgba(255,255,255,.95),rgba(230,178,34,.5) 35%,transparent 70%)',
          }}
        />

        {/* Stage transition shimmer */}
        {isShimmer && phase === 'transition' && (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-amber-400/10 to-blue-500/20 animate-pulse pointer-events-none" />
        )}
        {!isShimmer && phase === 'transition' && (
          <div className="absolute inset-0 bg-white/5 pointer-events-none" />
        )}
        {phase === 'transition' && (
          <div className="absolute text-5xl animate-spin pointer-events-none" style={{ animationDuration: '2s' }}>
            {isShimmer ? '✦' : '◈'}
          </div>
        )}

        {/* Main content */}
        <div className={cn(
          'text-center px-8 max-w-sm transition-all duration-500 flex flex-col items-center',
          phase === 'stage' ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 scale-95 pointer-events-none',
        )}>
          {isStreakRing ? (
            <div style={{ animation: 'mc-fade-up .55s cubic-bezier(.2,1,.4,1) .1s both' }}>
              <StreakRing
                previousValue={event.meta?.previousStreak ?? 0}
                newValue={event.meta?.newStreak ?? 0}
                onComplete={triggerPayoff}
              />
            </div>
          ) : (
            <div
              className="text-6xl mb-6 flex items-center justify-center"
              style={{
                width: 96, height: 96, borderRadius: '50%',
                background: 'radial-gradient(circle at 45% 40%, rgba(255,255,255,0.10) 0%, rgba(0,149,156,0.08) 60%, transparent 100%)',
                border: '1.5px solid rgba(255,255,255,0.10)',
                animation: reducedMotion
                  ? 'none'
                  : 'mc-fade-up .55s cubic-bezier(.2,1,.4,1) .1s both, mc-icon-glow 3s ease-in-out infinite 0.8s',
              }}
            >
              {current.icon}
            </div>
          )}

          <p
            className={cn('text-[22px] font-bold leading-snug mb-3', current.headingColor)}
            style={{ animation: 'mc-fade-up .55s cubic-bezier(.2,1,.4,1) .22s both' }}
          >
            {current.heading}
          </p>
          <p
            className={cn('text-[15px] leading-relaxed', current.bodyColor)}
            style={{ animation: 'mc-fade-up .55s cubic-bezier(.2,1,.4,1) .34s both' }}
          >
            {current.body}
          </p>
          {current.attribution && (
            <p
              className="text-[12px] text-white/30 mt-4 italic"
              style={{ animation: 'mc-fade-up .55s cubic-bezier(.2,1,.4,1) .44s both' }}
            >
              {current.attribution}
            </p>
          )}

          {/* Continue / Let's go button */}
          <div style={{
            marginTop: 36,
            opacity: btnReady ? 1 : 0,
            transform: btnReady ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity .35s ease, transform .35s ease',
            pointerEvents: showButton ? 'auto' : 'none',
          }}>
            <button
              ref={buttonRef}
              onClick={e => { e.stopPropagation(); advance() }}
              style={{
                background: 'linear-gradient(135deg, #00959c 0%, #1d8f6f 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '14px 40px',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: '.01em',
                cursor: 'pointer',
                minWidth: 180,
                animation: reducedMotion ? 'none' : 'mc-btn-pulse 2.2s ease-in-out infinite .5s',
              }}
            >
              {btnLabel}
            </button>
          </div>

          {/* Tap-anywhere hint — fades out once button appears */}
          {!showButton && (
            <p style={{
              marginTop: 32,
              fontSize: 12, letterSpacing: '.10em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.18)',
              animation: 'mc-fade-up .4s ease .6s both',
            }}>
              one moment…
            </p>
          )}
        </div>
      </div>
    </>
  )
}
