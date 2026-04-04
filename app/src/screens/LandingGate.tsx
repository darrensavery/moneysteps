/**
 * LandingGate — first screen on a fresh install (no mc_device_identity).
 *
 * Routing is handled by RootGate in App.tsx:
 *   - No identity → this screen
 *   - Has identity → /lock
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate }                  from 'react-router-dom'
import { Users }                        from 'lucide-react'
import { track }                        from '@/lib/analytics'
import { FullLogo }                      from '@/components/ui/Logo'

type TreeSize = 'sm' | 'md' | 'lg'

interface Leaf {
  id:    number
  x:     number  // offset from canopy centre (px)
  delay: number  // ms before animating
  drift: number  // horizontal drift direction
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function LandingGate() {
  const navigate = useNavigate()

  return (
    <div className="h-svh bg-[var(--color-bg)] flex flex-col overflow-y-auto">

      {/* Header */}
      <header className="sticky top-0 bg-[var(--color-surface)]/80 backdrop-blur border-b border-[var(--color-border)] px-4 py-3 flex items-center">
        <FullLogo iconSize={28} />
      </header>

      {/* Main — true centre with equal flex space above and below */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 max-w-md mx-auto w-full">

        {/* All content in a single compact column */}
        <div className="flex flex-col items-center gap-6 w-full py-4">

          {/* Orchard illustration */}
          <div className="relative flex items-end justify-center gap-4 h-36">
            <Tree size="sm" swayOffset={0}   />
            <Tree size="lg" swayOffset={3}   />
            <Tree size="md" swayOffset={1.5} />
            <div className="absolute bottom-0 left-[-16px] right-[-16px] h-px bg-[var(--color-border)]" />
          </div>

          {/* Text */}
          <div className="text-center space-y-3">
            <p className="text-[11px] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] rounded-full px-3 py-1 tracking-widest uppercase inline-block">
              Welcome to the Orchard
            </p>
            <h1 className="text-[32px] font-extrabold text-[var(--color-text)] tracking-tight leading-[1.1]">
              Grow your family's<br />financial future
            </h1>
            <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed max-w-[300px] mx-auto">
              Chores, pocket money, and savings goals — with a transparent record both parents can trust.
            </p>
          </div>

          {/* CTAs */}
          <div className="w-full space-y-3">
            <button
              onClick={() => { track.registrationStarted(); navigate('/register') }}
              className="
                w-full h-14 rounded-2xl bg-[var(--brand-primary)] text-white
                font-semibold text-[15px] tracking-tight
                flex items-center justify-center gap-2.5
                hover:opacity-90 active:scale-[0.98]
                transition-all duration-150 shadow-md hover:shadow-lg
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
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
                w-full h-14 rounded-2xl bg-[var(--color-surface)] text-[var(--color-text)]
                font-semibold text-[15px]
                flex items-center justify-center gap-2.5
                border-2 border-[var(--color-border)]
                hover:border-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_5%,transparent)]
                active:scale-[0.98] transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2
              "
            >
              <Users size={18} strokeWidth={2.5} />
              Join your Family
            </button>

            <p className="text-center text-[11px] text-[var(--color-text-muted)]">
              🔒 Private by design — your data stays on your device and is never sold.
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}

// ── Tree ──────────────────────────────────────────────────────────────────────

/**
 * Rounded-cluster tree matching the reference illustration style:
 *
 * Canopy = overlapping ovals arranged in a dome — shadow layer (dark green),
 *          mid layer (medium green), highlight clusters (light green on top-left).
 * Trunk  = single tapered trunk, wider at base, straight rise into canopy.
 * Apples = small red dots in the lower-mid canopy.
 *
 * ViewBox: 64 × 96. All three sizes share the same paths, scaled via SVG transform.
 */

// Shadow layer — slightly offset down-right, dark green
const SHADOW: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 32, cy: 42, rx: 18, ry: 14 },
  { cx: 18, cy: 35, rx: 14, ry: 12 },
  { cx: 46, cy: 35, rx: 14, ry: 12 },
  { cx: 32, cy: 26, rx: 16, ry: 13 },
  { cx: 20, cy: 22, rx: 12, ry: 11 },
  { cx: 44, cy: 22, rx: 12, ry: 11 },
  { cx: 32, cy: 14, rx: 11, ry: 10 },
]

// Mid layer — main canopy fill, medium green
const MID: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 32, cy: 40, rx: 18, ry: 14 },
  { cx: 17, cy: 33, rx: 14, ry: 12 },
  { cx: 47, cy: 33, rx: 14, ry: 12 },
  { cx: 32, cy: 24, rx: 16, ry: 13 },
  { cx: 19, cy: 20, rx: 12, ry: 11 },
  { cx: 45, cy: 20, rx: 12, ry: 11 },
  { cx: 32, cy: 12, rx: 11, ry: 10 },
]

// Highlight layer — light green ovals offset up-left on each cluster
const HI: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 28, cy: 36, rx: 8,  ry: 6.5 },
  { cx: 13, cy: 29, rx: 6,  ry: 5   },
  { cx: 28, cy: 19, rx: 7,  ry: 6   },
  { cx: 16, cy: 16, rx: 5,  ry: 4.5 },
  { cx: 29, cy:  8, rx: 5,  ry: 4.5 },
]

const APPLES = [
  { cx: 22, cy: 38, r: 2.2 },
  { cx: 36, cy: 34, r: 2.0 },
  { cx: 44, cy: 40, r: 2.0 },
  { cx: 30, cy: 44, r: 2.2 },
]

// Trunk: narrow neck at canopy, flares out to a wide base
const TRUNK_PATH = `
  M 21 96
  C 22 82 24 70 26 60
  C 25 56 25 53 26 51
  C 29 50 35 50 38 51
  C 39 53 39 56 38 60
  C 40 70 42 82 43 96
  Z
`

const SIZE_SCALE: Record<TreeSize, number> = { sm: 0.68, md: 0.85, lg: 1.0 }

function Tree({ size, swayOffset }: { size: TreeSize; swayOffset: number }) {
  const scale  = SIZE_SCALE[size]
  const svgW   = Math.round(64 * scale)
  const svgH   = Math.round(96 * scale)
  // Leaves fall from the lower-centre of the canopy
  const leafStartY = Math.round(38 * scale)
  const cx         = Math.round(32 * scale)

  const [swaying, setSwaying] = useState(false)
  const [leaves,  setLeaves]  = useState<Leaf[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leafId   = useRef(0)

  useEffect(() => {
    const trigger = () => {
      setSwaying(true)
      setTimeout(() => setSwaying(false), 1650)
      timerRef.current = setTimeout(trigger, 10000)
    }
    timerRef.current = setTimeout(trigger, swayOffset * 1000 + 2000)
    return () => clearTimeout(timerRef.current)
  }, [swayOffset])

  function handleMouseEnter() {
    const count = Math.random() > 0.4 ? 2 : 1
    const newLeaves: Leaf[] = Array.from({ length: count }, (_, i) => ({
      id:    leafId.current++,
      x:     (Math.random() - 0.5) * svgW * 0.5,
      delay: i * 140,
      drift: (Math.random() - 0.5) * 2,
    }))
    setLeaves(prev => [...prev, ...newLeaves])
    setSwaying(true)
    setTimeout(() => setSwaying(false), 1650)
  }

  function removeLeaf(id: number) {
    setLeaves(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div
      className="relative flex-shrink-0 cursor-pointer select-none"
      style={{
        width:  svgW,
        height: svgH,
        animation:       swaying ? 'treeSway 1.6s linear 1' : undefined,
        transformOrigin: 'bottom center',
      }}
      onMouseEnter={handleMouseEnter}
    >
      {leaves.map(leaf => (
        <FallingLeaf
          key={leaf.id}
          startX={cx + leaf.x}
          startY={leafStartY}
          drift={leaf.drift}
          delay={leaf.delay}
          onDone={() => removeLeaf(leaf.id)}
        />
      ))}

      <svg
        width={svgW} height={svgH}
        viewBox="0 0 64 96"
        overflow="visible"
      >
        {/* ── Trunk ── */}
        <path d={TRUNK_PATH} fill="#7a5230" />
        <path d="M 27 95 C 27 80 27 68 28 58 C 28 54 28.5 52 29 51 C 29 60 29 75 29 95 Z" fill="#9b6b40" opacity="0.6" />

        {/* ── Shadow layer (darkest, offset down-right) ── */}
        <g transform="translate(1.5, 2)" opacity="0.35">
          {SHADOW.map((p, i) => (
            <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="#2d6a2d" />
          ))}
        </g>

        {/* ── Mid canopy (main fill) ── */}
        {MID.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="#4a9e4a" />
        ))}

        {/* ── Light edge stroke on each cluster ── */}
        {MID.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry}
            fill="none" stroke="#5cb85c" strokeWidth="0.6" opacity="0.6" />
        ))}

        {/* ── Highlight clusters (upper-left of each puff) ── */}
        {HI.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="#7acc5a" opacity="0.75" />
        ))}

        {/* ── Apples ── */}
        {APPLES.map((a, i) => (
          <g key={i}>
            <circle cx={a.cx} cy={a.cy} r={a.r} fill="#d94040" />
            <circle cx={a.cx - 0.5} cy={a.cy - 0.7} r={a.r * 0.38} fill="#f07070" opacity="0.7" />
            <line x1={a.cx} y1={a.cy - a.r} x2={a.cx} y2={a.cy - a.r - 2.2}
              stroke="#7a5230" strokeWidth="0.8" strokeLinecap="round" />
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Falling leaf ──────────────────────────────────────────────────────────────

function FallingLeaf({ startX, startY, drift, delay, onDone }: {
  startX: number
  startY: number
  drift:  number
  delay:  number
  onDone: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (ref.current) {
        ref.current.style.animation = 'leafFall 1.5s ease-in forwards'
      }
      setTimeout(onDone, 1600)
    }, delay)
    return () => clearTimeout(t)
  }, [delay, onDone])

  return (
    <div
      ref={ref}
      style={{
        position:      'absolute',
        top:           startY,
        left:          startX - 4,   // centre the 8px leaf
        pointerEvents: 'none',
        '--drift':     `${drift * 20}px`,
      } as React.CSSProperties}
    >
      <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
        <path d="M4 9C4 9 1 6 1 3.5a3 3 0 0 1 6 0C7 6 4 9 4 9z" fill="#7acc5a" opacity="0.9"/>
        <path d="M4 9V4" stroke="#4a9e4a" strokeWidth="0.7" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
