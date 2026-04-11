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
          <div className="relative flex items-end justify-center gap-3 h-32">
            <Tree size="sm" swayOffset={0}   flip />
            <Tree size="lg" swayOffset={3}        />
            <Tree size="md" swayOffset={1.5}      />
            <div className="absolute bottom-0 left-[-12px] right-[-12px] h-px bg-[var(--color-border)]" />
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

            <p className="text-center text-[13px] text-[var(--color-text-muted)]">
              Already have an account?{' '}
              <button
                onClick={() => navigate('/auth/login')}
                className="text-[var(--brand-primary)] font-semibold underline underline-offset-2 cursor-pointer"
              >
                Sign In
              </button>
            </p>

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
 * Cloud-puff apple tree — original circle style.
 *
 * Canopy = 7 overlapping circles in a dome.
 * Trunk  = tapered, slightly flared at base.
 * Apples = small red circles in the lower canopy.
 *
 * ViewBox: 60 × 90.
 * flip=true mirrors the SVG horizontally so trees face different directions.
 */

// Puff circles (cx, cy, r) — canopy pulled down ~4px closer to trunk vs original
const PUFFS = [
  { cx: 30, cy: 30, r: 14 },   // centre — largest
  { cx: 14, cy: 34, r: 11 },   // left
  { cx: 46, cy: 34, r: 11 },   // right
  { cx: 10, cy: 24, r:  9 },   // far left
  { cx: 50, cy: 24, r:  9 },   // far right
  { cx: 22, cy: 18, r: 10 },   // upper left
  { cx: 38, cy: 18, r: 10 },   // upper right
]

const APPLES = [
  { cx: 20, cy: 36, r: 2.4 },
  { cx: 34, cy: 32, r: 2.2 },
  { cx: 42, cy: 40, r: 2.2 },
  { cx: 26, cy: 44, r: 2.4 },
]

// Trunk: wide flared base, tapers up, splits into two branches
const TRUNK_PATH = `
  M 23 90
  C 21 75 20 65 22 58
  C 20 52 16 46 14 42
  C 17 44 20 46 22 50
  C 22 45 23 42 24 40
  C 25 42 26 45 26 50
  C 28 46 31 44 34 42
  C 32 46 28 52 28 58
  C 30 65 31 75 37 90
  Z
`

const SIZE_SCALE: Record<TreeSize, number> = { sm: 0.72, md: 0.88, lg: 1.05 }

function Tree({ size, swayOffset, flip = false }: { size: TreeSize; swayOffset: number; flip?: boolean }) {
  const scale  = SIZE_SCALE[size]
  const svgW   = Math.round(60 * scale)
  const svgH   = Math.round(90 * scale)
  const leafStartY = Math.round(34 * scale)
  const cx         = Math.round(30 * scale)

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
        viewBox="0 0 60 90"
        overflow="visible"
        style={flip ? { transform: 'scaleX(-1)' } : undefined}
      >
        {/* ── Trunk ── */}
        <path d={TRUNK_PATH} fill="#92613a" />

        {/* ── Canopy shadow (offset dark layer) ── */}
        <g transform="translate(1,2)" opacity="0.25">
          {PUFFS.map((p, i) => <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill="#065f46" />)}
        </g>

        {/* ── Canopy fill ── */}
        {PUFFS.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill="#34d399" />
        ))}

        {/* ── Highlight on upper-left puffs ── */}
        {PUFFS.slice(0, 4).map((p, i) => (
          <circle key={i} cx={p.cx - p.r * 0.2} cy={p.cy - p.r * 0.25} r={p.r * 0.5} fill="#6ee7b7" opacity="0.5" />
        ))}

        {/* ── Canopy outlines ── */}
        {PUFFS.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill="none" stroke="#059669" strokeWidth="0.7" />
        ))}

        {/* ── Apples ── */}
        {APPLES.map((a, i) => (
          <g key={i}>
            <circle cx={a.cx} cy={a.cy} r={a.r} fill="#ef4444" />
            <line x1={a.cx} y1={a.cy - a.r} x2={a.cx} y2={a.cy - a.r - 2.5} stroke="#92613a" strokeWidth="0.9" strokeLinecap="round" />
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
        <path d="M4 9C4 9 1 6 1 3.5a3 3 0 0 1 6 0C7 6 4 9 4 9z" fill="#6ee7b7" opacity="0.9"/>
        <path d="M4 9V4" stroke="#059669" strokeWidth="0.7" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
