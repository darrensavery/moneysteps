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
    <div className="min-h-svh bg-[#F5F4F0] flex flex-col">

      {/* Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-teal-600 flex items-center justify-center text-white text-sm font-bold shrink-0">M</div>
        <span className="text-[17px] font-extrabold text-[#1C1C1A] tracking-tight">Morechard</span>
      </header>

      {/* Main — true centre with equal flex space above and below */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 max-w-md mx-auto w-full">

        {/* All content in a single compact column */}
        <div className="flex flex-col items-center gap-6 w-full py-8">

          {/* Orchard illustration */}
          <div className="relative flex items-end justify-center gap-3 h-32">
            <Tree size="sm" swayOffset={0}   />
            <Tree size="lg" swayOffset={3}   />
            <Tree size="md" swayOffset={1.5} />
            <div className="absolute bottom-0 left-[-12px] right-[-12px] h-px bg-[#D3D1C7]" />
          </div>

          {/* Text */}
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
              🔒 Private by design — your data stays on your device and is never sold.
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}

// ── Tree ──────────────────────────────────────────────────────────────────────

// Apple tree dimensions per size
const TREE_CFG: Record<TreeSize, {
  svgW:    number
  svgH:    number
  cx:      number   // canopy centre x
  cy:      number   // canopy centre y
  rx:      number   // canopy x-radius
  ry:      number   // canopy y-radius
  trunkW:  number
  trunkH:  number
  apples:  { x: number; y: number; r: number }[]
}> = {
  sm: {
    svgW: 44, svgH: 64, cx: 22, cy: 26, rx: 18, ry: 16, trunkW: 6, trunkH: 16,
    apples: [{ x: 15, y: 22, r: 2.2 }, { x: 27, y: 18, r: 2 }, { x: 24, y: 30, r: 1.8 }],
  },
  md: {
    svgW: 54, svgH: 80, cx: 27, cy: 32, rx: 22, ry: 20, trunkW: 8, trunkH: 20,
    apples: [{ x: 18, y: 27, r: 2.5 }, { x: 32, y: 22, r: 2.2 }, { x: 30, y: 38, r: 2.2 }, { x: 20, y: 38, r: 2 }],
  },
  lg: {
    svgW: 66, svgH: 96, cx: 33, cy: 38, rx: 28, ry: 25, trunkW: 10, trunkH: 24,
    apples: [{ x: 22, y: 32, r: 3 }, { x: 40, y: 26, r: 2.8 }, { x: 44, y: 42, r: 2.5 }, { x: 24, y: 46, r: 2.8 }, { x: 34, y: 50, r: 2.5 }],
  },
}

function Tree({ size, swayOffset }: { size: TreeSize; swayOffset: number }) {
  const cfg    = TREE_CFG[size]
  const svgW   = cfg.svgW
  const svgH   = cfg.svgH

  // Canopy bottom y — where trunk meets canopy
  const canopyBottomY = cfg.cy + cfg.ry
  const trunkX        = cfg.cx - cfg.trunkW / 2
  const trunkY        = canopyBottomY - 2   // overlap 2px so no gap
  // Leaf fall starts from canopy mid-area
  const leafStartY    = cfg.cy + cfg.ry * 0.2

  const [swaying, setSwaying] = useState(false)
  const [leaves,  setLeaves]  = useState<Leaf[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leafId   = useRef(0)

  useEffect(() => {
    const trigger = () => {
      setSwaying(true)
      setTimeout(() => setSwaying(false), 1200)
      timerRef.current = setTimeout(trigger, 10000)
    }
    timerRef.current = setTimeout(trigger, swayOffset * 1000 + 2000)
    return () => clearTimeout(timerRef.current)
  }, [swayOffset])

  function handleMouseEnter() {
    const count = Math.random() > 0.4 ? 2 : 1
    const newLeaves: Leaf[] = Array.from({ length: count }, (_, i) => ({
      id:    leafId.current++,
      x:     (Math.random() - 0.5) * cfg.rx * 1.2,
      delay: i * 140,
      drift: (Math.random() - 0.5) * 2,
    }))
    setLeaves(prev => [...prev, ...newLeaves])
    setSwaying(true)
    setTimeout(() => setSwaying(false), 900)
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
        animation:       swaying ? 'treeSway 0.55s ease-in-out 3' : undefined,
        transformOrigin: 'bottom center',
      }}
      onMouseEnter={handleMouseEnter}
    >
      {leaves.map(leaf => (
        <FallingLeaf
          key={leaf.id}
          startX={cfg.cx + leaf.x}
          startY={leafStartY}
          drift={leaf.drift}
          delay={leaf.delay}
          onDone={() => removeLeaf(leaf.id)}
        />
      ))}

      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} overflow="visible">
        {/* Trunk — drawn first so canopy overlaps the top of it */}
        <rect
          x={trunkX} y={trunkY}
          width={cfg.trunkW} height={cfg.trunkH + 2}
          rx="2" fill="#92613a"
        />
        {/* Canopy shadow / depth — slightly larger, darker ellipse behind */}
        <ellipse cx={cfg.cx + 1} cy={cfg.cy + 2} rx={cfg.rx} ry={cfg.ry} fill="#059669" opacity="0.35" />
        {/* Main canopy */}
        <ellipse cx={cfg.cx} cy={cfg.cy} rx={cfg.rx} ry={cfg.ry} fill="#34d399" />
        {/* Highlight lobe — upper-left bright patch */}
        <ellipse
          cx={cfg.cx - cfg.rx * 0.25}
          cy={cfg.cy - cfg.ry * 0.3}
          rx={cfg.rx * 0.55}
          ry={cfg.ry * 0.45}
          fill="#6ee7b7"
          opacity="0.55"
        />
        {/* Apples */}
        {cfg.apples.map((a, i) => (
          <g key={i}>
            <circle cx={a.x} cy={a.y} r={a.r} fill="#ef4444" />
            {/* tiny stalk */}
            <line x1={a.x} y1={a.y - a.r} x2={a.x} y2={a.y - a.r - 2} stroke="#92613a" strokeWidth="0.8" strokeLinecap="round" />
          </g>
        ))}
        {/* Canopy outline */}
        <ellipse cx={cfg.cx} cy={cfg.cy} rx={cfg.rx} ry={cfg.ry} fill="none" stroke="#059669" strokeWidth="1" />
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
