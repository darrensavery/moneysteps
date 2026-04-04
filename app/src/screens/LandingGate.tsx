/**
 * LandingGate — first screen on a fresh install (no mc_device_identity).
 *
 * Routing is handled by RootGate in App.tsx:
 *   - No identity → this screen
 *   - Has identity → /lock
 *
 * Two paths:
 *   A) "Create Family Account" → /register
 *   B) "Join your Family"      → /join  (co-parent or child with invite code)
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate }                  from 'react-router-dom'
import { Users }                        from 'lucide-react'
import { track }                        from '@/lib/analytics'

// ── Types ─────────────────────────────────────────────────────────────────────

type TreeSize = 'sm' | 'md' | 'lg'

interface Leaf {
  id:      number
  x:       number   // starting x offset within the tree (px)
  delay:   number   // ms
  drift:   number   // horizontal drift multiplier
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function LandingGate() {
  const navigate = useNavigate()

  return (
    <div className="min-h-svh bg-[#F5F4F0] flex flex-col">

      {/* Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-teal-600 flex items-center justify-center text-white text-sm font-bold shrink-0">M</div>
        <span className="text-[17px] font-extrabold text-[#1C1C1A] tracking-tight">Morechard</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-8 max-w-md mx-auto w-full gap-7">

        {/* Orchard illustration */}
        <div className="relative flex items-end justify-center gap-2 h-28">
          <Tree size="sm" swayDelay="0s"    swayOffset={0}   />
          <Tree size="lg" swayDelay="0.2s"  swayOffset={3}   />
          <Tree size="md" swayDelay="0.4s"  swayOffset={1.5} />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-[#D3D1C7]" />
        </div>

        {/* Text block */}
        <div className="text-center space-y-3">
          <p className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 tracking-widest uppercase inline-block">
            Welcome to the Orchard
          </p>
          <h1 className="text-[32px] font-extrabold text-[#1C1C1A] tracking-tight leading-[1.1]">
            Grow your family's<br />financial future
          </h1>
          <p className="text-[15px] text-[#6b6a66] leading-relaxed max-w-[300px] mx-auto">
            Chores, pocket money, and savings goals — with a transparent record both parents can trust.
          </p>
          <p className="text-[12px] text-[#9b9a96]">🔒 Private by design</p>
        </div>

        {/* CTAs */}
        <div className="w-full space-y-3">
          <button
            onClick={() => { track.registrationStarted(); navigate('/register') }}
            className="
              w-full h-14 rounded-2xl bg-teal-600 text-white
              font-semibold text-[15px] tracking-tight
              flex items-center justify-center gap-2.5
              hover:bg-teal-700 active:scale-[0.98]
              transition-all duration-150 shadow-md hover:shadow-lg
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2
            "
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22V12"/>
              <path d="M12 12C12 12 7 10 7 5a5 5 0 0 1 10 0c0 5-5 7-5 7z"/>
            </svg>
            Create Family Account
          </button>

          <button
            onClick={() => { track.joinStarted(); navigate('/join') }}
            className="
              w-full h-14 rounded-2xl bg-white text-[#1C1C1A]
              font-semibold text-[15px]
              flex items-center justify-center gap-2.5
              border-2 border-[#D3D1C7]
              hover:border-teal-400 hover:bg-teal-50/40
              active:scale-[0.98] transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2
            "
          >
            <Users size={18} strokeWidth={2.5} />
            Join your Family
          </button>

          <p className="text-center text-[11px] text-[#9b9a96]">
            Your data stays on your device and is never sold.
          </p>
        </div>

      </main>
    </div>
  )
}

// ── Tree with breeze + hover-leaf ─────────────────────────────────────────────

function Tree({ size, swayDelay, swayOffset }: {
  size:       TreeSize
  swayDelay:  string
  swayOffset: number   // seconds offset for the 10s breeze timer
}) {
  const heights:  Record<TreeSize, string> = { sm: 'h-16', md: 'h-20', lg: 'h-24' }
  const canopies: Record<TreeSize, number> = { sm: 28,     md: 34,     lg: 40     }
  const trunks:   Record<TreeSize, string> = { sm: 'h-5 w-2', md: 'h-6 w-2.5', lg: 'h-7 w-3' }

  const [swaying, setSwaying]   = useState(false)
  const [leaves,  setLeaves]    = useState<Leaf[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leafId   = useRef(0)

  // Breeze every 10s (staggered by swayOffset seconds)
  useEffect(() => {
    const initialDelay = swayOffset * 1000
    const trigger = () => {
      setSwaying(true)
      setTimeout(() => setSwaying(false), 1200)
      timerRef.current = setTimeout(trigger, 10000)
    }
    timerRef.current = setTimeout(trigger, initialDelay + 2000) // first breeze after 2s + offset
    return () => clearTimeout(timerRef.current)
  }, [swayOffset])

  // Drop 1–2 leaves on hover
  function handleMouseEnter() {
    const count = Math.random() > 0.4 ? 2 : 1
    const newLeaves: Leaf[] = Array.from({ length: count }, (_, i) => ({
      id:    leafId.current++,
      x:     (Math.random() - 0.5) * canopies[size] * 0.6,
      delay: i * 120,
      drift: (Math.random() - 0.5) * 2,
    }))
    setLeaves(prev => [...prev, ...newLeaves])
    // Also trigger a sway
    setSwaying(true)
    setTimeout(() => setSwaying(false), 900)
  }

  function removeLeaf(id: number) {
    setLeaves(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-end ${heights[size]} cursor-pointer select-none`}
      onMouseEnter={handleMouseEnter}
      style={{
        animation:      swaying ? `treeSway 0.6s ease-in-out 3` : undefined,
        animationDelay: swayDelay,
        transformOrigin: 'bottom center',
      }}
    >
      {/* Falling leaves */}
      {leaves.map(leaf => (
        <FallingLeaf
          key={leaf.id}
          x={leaf.x}
          delay={leaf.delay}
          drift={leaf.drift}
          canopySize={canopies[size]}
          onDone={() => removeLeaf(leaf.id)}
        />
      ))}

      {/* Canopy */}
      <svg width={canopies[size]} height={canopies[size]} viewBox="0 0 40 40" fill="none" className="shrink-0">
        <circle cx="20" cy="20" r="18" fill="#d1fae5" />
        <circle cx="20" cy="20" r="18" fill="none" stroke="#6ee7b7" strokeWidth="1.5" />
        <circle cx="14" cy="18" r="2"   fill="#34d399" opacity="0.7" />
        <circle cx="24" cy="14" r="1.5" fill="#34d399" opacity="0.5" />
        <circle cx="26" cy="24" r="2"   fill="#34d399" opacity="0.6" />
      </svg>

      {/* Trunk */}
      <div className={`${trunks[size]} rounded-sm bg-[#a78a6e] shrink-0`} />
    </div>
  )
}

// ── Falling leaf ──────────────────────────────────────────────────────────────

function FallingLeaf({ x, delay, drift, canopySize, onDone }: {
  x:          number
  delay:      number
  drift:      number
  canopySize: number
  onDone:     () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (ref.current) {
        ref.current.style.animation = `leafFall 1.4s ease-in forwards`
      }
      // Remove from DOM after animation
      setTimeout(onDone, 1500)
    }, delay)
    return () => clearTimeout(t)
  }, [delay, onDone])

  return (
    <div
      ref={ref}
      style={{
        position:    'absolute',
        top:         canopySize * 0.3,
        left:        `calc(50% + ${x}px)`,
        transform:   'translateX(-50%)',
        '--drift':   `${drift * 18}px`,
        pointerEvents: 'none',
      } as React.CSSProperties}
    >
      {/* Tiny leaf SVG */}
      <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
        <path d="M4 9C4 9 1 6 1 3.5a3 3 0 0 1 6 0C7 6 4 9 4 9z" fill="#6ee7b7" opacity="0.85"/>
        <path d="M4 9V4" stroke="#34d399" strokeWidth="0.6" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
