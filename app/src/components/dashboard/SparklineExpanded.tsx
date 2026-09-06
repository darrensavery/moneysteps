import { useRef, useState, useCallback } from 'react'
import { motion, animate, useMotionValue } from 'framer-motion'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import type { MilestoneMarker } from '../../lib/api'

interface ChoreEvent { point_index: number; first_pass: boolean }

interface Props {
  label:           string;
  value:           number | null;
  points:          number[];
  milestones:      MilestoneMarker[];
  choreEvents:     ChoreEvent[];
  hasLearningLab:  boolean;
  nextModuleTitle: string | null;
  onClose:         () => void;
}

// Internal SVG coordinate space — aspect ratio is kept via viewBox + meet
// X-axis: 0…1000, Y-axis: 0…500 (0 = top = 100%, 500 = bottom = 0%)
const VW = 1000
const VH = 500
const Y_LABELS = [100, 75, 50, 25, 0]

function pctToSvgY(pct: number): number {
  return VH - (pct / 100) * VH
}

function idxToSvgX(idx: number, total: number): number {
  if (total <= 1) return VW / 2
  return (idx / (total - 1)) * VW
}

// Returns an array of polyline strings — one per contiguous non-zero segment.
// Zero values are treated as "no data" so leading/trailing gaps don't draw.
function buildSegments(pts: number[]): string[] {
  const segments: string[] = []
  let current: string[] = []
  for (let i = 0; i < pts.length; i++) {
    if (pts[i] > 0) {
      current.push(`${idxToSvgX(i, pts.length).toFixed(1)},${pctToSvgY(pts[i]).toFixed(1)}`)
    } else {
      if (current.length >= 2) segments.push(current.join(' '))
      current = []
    }
  }
  if (current.length >= 2) segments.push(current.join(' '))
  return segments
}

function buildPolyline(pts: number[]): string {
  // Legacy single-segment for area fill (zeros become baseline)
  if (pts.length < 2) return ''
  return pts.map((v, i) => `${idxToSvgX(i, pts.length).toFixed(1)},${pctToSvgY(Math.max(v, 1)).toFixed(1)}`).join(' ')
}

// Build X-axis tick labels — spread evenly across the bucket count
function buildXLabels(numPoints: number, numBuckets: number): { idx: number; label: string }[] {
  // Show ~5 labels across the range
  const step = Math.max(1, Math.round(numPoints / 5))
  const labels: { idx: number; label: string }[] = []
  for (let i = 0; i < numPoints; i += step) {
    // Represent as "bucket N of numBuckets" → convert to rough week offset
    const weekOffset = Math.round((i / (numPoints - 1)) * (numBuckets - 1))
    const weeksAgo   = numBuckets - 1 - weekOffset
    labels.push({ idx: i, label: weeksAgo === 0 ? 'Now' : `${weeksAgo}w ago` })
  }
  // Ensure last point is always "Now"
  if (labels[labels.length - 1]?.idx !== numPoints - 1) {
    labels.push({ idx: numPoints - 1, label: 'Now' })
  }
  return labels
}

export function SparklineExpanded({
  label, value, points, milestones, choreEvents, hasLearningLab, nextModuleTitle, onClose,
}: Props) {
  useAndroidBack(true, onClose)

  const segments   = buildSegments(points)
  const polylineFull = buildPolyline(points)   // for area fill only
  const areaBottom = pctToSvgY(0)
  const areaPoints = polylineFull
    ? `${polylineFull} ${VW},${areaBottom} 0,${areaBottom}`
    : ''

  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [tooltip,   setTooltip]   = useState('')
  const overlayRef = useRef<SVGRectElement>(null)
  const dotX = useMotionValue(0)
  const dotY = useMotionValue(0)

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGRectElement>) => {
    if (!overlayRef.current || points.length < 2) return
    const rect = overlayRef.current.getBoundingClientRect()
    const relX  = (e.clientX - rect.left) / rect.width
    const idx   = Math.max(0, Math.min(points.length - 1, Math.round(relX * (points.length - 1))))
    const svgX  = idxToSvgX(idx, points.length)
    const svgY  = pctToSvgY(points[idx])
    animate(dotX, svgX, { type: 'spring', stiffness: 400, damping: 30 })
    animate(dotY, svgY, { type: 'spring', stiffness: 400, damping: 30 })
    setActiveIdx(idx)
    const milestone = milestones.find(m => m.point_index === idx)
    const chores    = choreEvents.filter(c => c.point_index === idx)
    if (milestone) {
      setTooltip(`🎓 ${milestone.module_title}`)
    } else if (chores.length > 0) {
      const fp = chores.filter(c => c.first_pass).length
      setTooltip(`${chores.length} chore${chores.length > 1 ? 's' : ''} · ${fp} first-pass`)
    } else {
      const v = points[idx]
      setTooltip(v >= 80 ? 'Great work 🌱' : v >= 50 ? 'Solid effort' : v > 0 ? 'Room to grow' : 'No data')
    }
  }, [points, milestones, choreEvents, dotX, dotY])

  const handlePointerLeave = useCallback(() => setActiveIdx(null), [])

  // Chore dots — one entry per bucket
  const choreByBucket = new Map<number, { total: number; firstPass: number }>()
  for (const c of choreEvents) {
    const ex = choreByBucket.get(c.point_index) ?? { total: 0, firstPass: 0 }
    choreByBucket.set(c.point_index, { total: ex.total + 1, firstPass: ex.firstPass + (c.first_pass ? 1 : 0) })
  }

  // Module completion curtain — draw from last milestone rightward
  const lastMilestone = milestones.length > 0 ? milestones[milestones.length - 1] : null
  const curtainX = lastMilestone ? idxToSvgX(lastMilestone.point_index, points.length) : null

  const xLabels = buildXLabels(points.length, 28)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-[var(--color-border)] shrink-0">
        <div>
          <p className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight">{label}</p>
          <p className="text-[0.75rem] text-[var(--color-text-muted)] mt-0.5">
            All-time trend · {hasLearningLab ? 'tap any point · 🎓 = module unlocked' : 'tap to inspect'}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close"
          className="tap-target-44 w-9 h-9 flex items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* ── Score + hover tooltip ── */}
      <div className="flex items-baseline gap-3 px-5 pt-3 pb-1 shrink-0">
        <span className="text-[2rem] font-black tabular-nums leading-none" style={{ color: 'var(--brand-primary)' }}>
          {value !== null ? `${value}%` : '—'}
        </span>
        <span className="text-[0.8125rem] text-[var(--color-text-muted)]">{label.toLowerCase()} score</span>
        {activeIdx !== null && (
          <span className="ml-auto text-[0.75rem] font-semibold text-[var(--color-text)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-2.5 py-1 whitespace-nowrap">
            {tooltip}
          </span>
        )}
      </div>

      {/* ── Chart area — HTML layout with SVG inside ── */}
      <div className="flex-1 min-h-0 flex px-4 pb-1 pt-1 gap-0">

        {/* Y-axis labels — fixed-width HTML column, no SVG distortion */}
        <div className="flex flex-col justify-between shrink-0 w-10 pr-2 pb-6">
          {Y_LABELS.map(pct => (
            <span key={pct} className="text-[0.625rem] tabular-nums text-right text-[var(--color-text-muted)] leading-none">
              {pct}%
            </span>
          ))}
        </div>

        {/* SVG chart — uses xMidYMid meet so circles stay round */}
        <div className="flex-1 flex flex-col min-w-0">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full flex-1 min-h-0"
            style={{ display: 'block' }}
          >
            <defs>
              <linearGradient id="ex-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.16}/>
                <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0}/>
              </linearGradient>
              {/* Separate gradient for circle markers so they aren't distorted */}
            </defs>

            {/* Horizontal grid lines */}
            {Y_LABELS.map(pct => (
              <line key={pct}
                x1={0} y1={pctToSvgY(pct)} x2={VW} y2={pctToSvgY(pct)}
                stroke="var(--color-border)"
                strokeWidth={pct === 0 || pct === 100 ? 1.5 : 1}
                opacity={0.45}
              />
            ))}

            {/* Post-module curtain */}
            {hasLearningLab && curtainX !== null && (
              <>
                <rect x={curtainX} y={0} width={VW - curtainX} height={VH}
                  fill="var(--brand-primary)" opacity={0.04}/>
                <line x1={curtainX} y1={0} x2={curtainX} y2={VH}
                  stroke="var(--brand-accent)" strokeWidth={3} strokeDasharray="10 6" opacity={0.5}/>
              </>
            )}

            {/* Area fill */}
            {areaPoints && <polygon points={areaPoints} fill="url(#ex-grad)"/>}

            {/* Line — one polyline per contiguous data segment */}
            {segments.map((seg, si) => (
              <polyline key={si} points={seg} fill="none"
                stroke="var(--brand-primary)" strokeWidth={5}
                strokeLinecap="round" strokeLinejoin="round"/>
            ))}

            {/* Chore event dots — only drawn where we have a real score value */}
            {points.length > 1 && Array.from(choreByBucket.entries()).map(([idx, info]) => {
              const score = points[idx] ?? 0
              if (score === 0) return null
              const cx = idxToSvgX(idx, points.length)
              const cy = pctToSvgY(score)
              const allFP = info.firstPass === info.total
              return (
                <circle key={`ce-${idx}`}
                  cx={cx} cy={cy} r={18}
                  fill={allFP ? 'var(--brand-primary)' : '#f59e0b'}
                  opacity={0.5}
                  stroke="var(--color-surface)" strokeWidth={6}
                />
              )
            })}

            {/* Module milestone markers */}
            {hasLearningLab && milestones.map((m, mi) => {
              const cx = idxToSvgX(m.point_index, points.length)
              const cy = pctToSvgY(points[m.point_index] ?? 80) - 30
              return (
                <text key={mi} x={cx} y={cy} textAnchor="middle" fontSize={32}>🎓</text>
              )
            })}

            {/* Active crosshair */}
            {activeIdx !== null && (
              <motion.line x1={dotX} x2={dotX} y1={0} y2={VH}
                stroke="var(--brand-primary)" strokeWidth={2} strokeDasharray="8 5" opacity={0.4}/>
            )}

            {/* Active dot — fixed radius in viewBox units */}
            {activeIdx !== null && (
              <motion.circle cx={dotX} cy={dotY} r={18}
                fill="var(--brand-primary)"
                stroke="var(--color-surface)" strokeWidth={6}
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}/>
            )}

            {/* Invisible hit area */}
            <rect ref={overlayRef} x={0} y={0} width={VW} height={VH}
              fill="none" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />
          </svg>

          {/* X-axis labels — HTML row below the SVG */}
          <div className="relative h-6 shrink-0">
            {xLabels.map(({ idx, label: lbl }) => {
              const pct = (idx / (points.length - 1)) * 100
              return (
                <span key={idx}
                  className="absolute text-[0.625rem] text-[var(--color-text-muted)] -translate-x-1/2 top-1"
                  style={{ left: `${pct}%` }}>
                  {lbl}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 py-2.5 border-t border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-primary)]"/>
          <span className="text-[0.625rem] text-[var(--color-text-muted)]">{label} score</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-primary)] opacity-50"/>
          <span className="text-[0.625rem] text-[var(--color-text-muted)]">Chore (first-pass)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-warning opacity-50"/>
          <span className="text-[0.625rem] text-[var(--color-text-muted)]">Chore (revised)</span>
        </div>
        {hasLearningLab && (
          <div className="flex items-center gap-1.5">
            <span className="text-[0.625rem]">🎓</span>
            <span className="text-[0.625rem] text-[var(--color-text-muted)]">Module unlocked</span>
          </div>
        )}
      </div>

      {/* ── Next-module recommendation ── */}
      {hasLearningLab && nextModuleTitle && (
        <div className="mx-5 mb-4 rounded-xl px-4 py-3 border shrink-0"
          style={{
            background:  'color-mix(in srgb, var(--brand-primary) 8%, var(--color-surface))',
            borderColor: 'color-mix(in srgb, var(--brand-primary) 20%, transparent)',
          }}>
          <p className="text-[0.625rem] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-primary)' }}>
            ✦ Recommended next
          </p>
          <p className="text-[0.8125rem] text-[var(--color-text)] leading-snug">
            To strengthen this metric, try <strong>"{nextModuleTitle}"</strong> in the Learning Lab.
          </p>
        </div>
      )}
    </motion.div>
  )
}
