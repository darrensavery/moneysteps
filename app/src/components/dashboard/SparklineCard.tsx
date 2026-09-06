import { useRef, useState, useCallback } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import type { TrendEntry, MilestoneMarker } from '../../lib/api'

interface Props {
  label:       string;
  value:       number | null;
  trend:       TrendEntry | null;
  points:      number[];
  isDiscovery: boolean;
  onExpand:    () => void;
  milestones?: MilestoneMarker[];
}

function trendStyle(direction: TrendEntry['direction'] | null) {
  if (direction === 'up')   return { stroke: 'var(--brand-primary)', glow: '0 4px 16px rgba(0,149,156,0.18)' }
  if (direction === 'down') return { stroke: '#dc2626',              glow: '0 4px 16px rgba(220,38,38,0.12)' }
  return                           { stroke: 'var(--brand-accent)',  glow: '0 4px 16px rgba(230,178,34,0.18)' }
}

function toPolylinePoints(data: number[], w: number, h: number): string {
  if (data.length < 2) return ''
  return data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / 100) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function toAreaPoints(data: number[], w: number, h: number): string {
  if (data.length < 2) return ''
  const line = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / 100) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return `${line} ${w},${h} 0,${h}`
}

export function SparklineCard({
  label, value, trend, points, isDiscovery, onExpand, milestones = [],
}: Props) {
  const { stroke, glow } = trendStyle(trend?.direction ?? null)
  const direction = trend?.direction ?? null
  const delta     = trend?.delta ?? null

  const W = 70, H = 32
  const polyPoints = toPolylinePoints(points, W, H)
  const areaPoints = toAreaPoints(points, W, H)
  const gradId     = `sg-${label.replace(/\s+/g, '')}`

  const [activeIdx, setActiveIdx]     = useState<number | null>(null)
  const [tooltipText, setTooltipText] = useState('')
  const overlayRef = useRef<SVGRectElement>(null)
  const dotX = useMotionValue(0)
  const dotY = useMotionValue(0)

  const getTooltipText = useCallback((idx: number) => {
    const v = points[idx] ?? 0
    const milestone = milestones.find(m => m.point_index === idx)
    if (milestone) return `${milestone.module_title} · ↑ ${milestone.delta_after}%`
    if (v >= 80) return 'Great day! 🌱'
    if (v >= 50) return 'Solid effort'
    return 'Room to grow'
  }, [points, milestones])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGRectElement>) => {
    if (!overlayRef.current || points.length < 2) return
    const rect = overlayRef.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const idx  = Math.max(0, Math.min(points.length - 1, Math.round(relX * (points.length - 1))))
    const x    = (idx / (points.length - 1)) * W
    const y    = H - (points[idx] / 100) * H
    animate(dotX, x, { type: 'spring', stiffness: 300, damping: 20 })
    animate(dotY, y, { type: 'spring', stiffness: 300, damping: 20 })
    setActiveIdx(idx)
    setTooltipText(getTooltipText(idx))
  }, [points, dotX, dotY, getTooltipText])

  const handlePointerLeave = useCallback(() => setActiveIdx(null), [])

  let pill: React.ReactNode = null
  if (!isDiscovery && delta !== null) {
    if (direction === 'up')
      pill = <span className="inline-flex items-center gap-0.5 text-[0.5rem] font-bold rounded px-1 py-0.5 bg-success/10 text-success">↑ {Math.abs(delta)}%</span>
    else if (direction === 'down')
      pill = <span className="inline-flex items-center gap-0.5 text-[0.5rem] font-bold rounded px-1 py-0.5 bg-danger/10 text-danger">↓ {Math.abs(delta)}%</span>
    else
      pill = <span className="inline-flex items-center gap-0.5 text-[0.5rem] font-bold rounded px-1 py-0.5 bg-[rgba(156,163,175,0.1)] text-[var(--color-text-muted)]">→</span>
  }

  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-2 flex flex-col items-center gap-1.5 relative overflow-hidden cursor-pointer"
      style={{ boxShadow: isDiscovery ? 'none' : glow }}
    >
      {/* Expand icon — only shown when there is real data to display */}
      {!isDiscovery && points.length >= 2 && (
        <button
          onClick={e => { e.stopPropagation(); onExpand() }}
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded opacity-50 hover:opacity-100 transition-opacity cursor-pointer text-[var(--color-text-muted)]"
          aria-label={`Expand ${label}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
          </svg>
        </button>
      )}

      <div className="w-full relative">
        {activeIdx !== null && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[0.5rem] font-semibold text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none shadow-sm">
            {tooltipText}
          </div>
        )}

        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 32 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3}/>
              <stop offset="100%" stopColor={stroke} stopOpacity={0}/>
            </linearGradient>
          </defs>

          {!isDiscovery && areaPoints && (
            <motion.polygon
              points={areaPoints}
              fill={`url(#${gradId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}

          {!isDiscovery && polyPoints && (
            <motion.polyline
              points={polyPoints}
              fill="none"
              stroke={stroke}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {!isDiscovery && milestones.map((m, mi) => {
            const x = points.length > 1 ? (m.point_index / (points.length - 1)) * W : W / 2
            const y = points[m.point_index] !== undefined ? H - (points[m.point_index] / 100) * H - 5 : 5
            return <text key={mi} x={x} y={y} textAnchor="middle" fontSize={7} fill={stroke} opacity={0.85}>🎓</text>
          })}

          {activeIdx !== null && (
            <motion.line x1={dotX} x2={dotX} y1={0} y2={H}
              stroke={stroke} strokeWidth={1} strokeDasharray="2 2" opacity={0.4}/>
          )}

          {activeIdx !== null && (
            <motion.circle
              cx={dotX}
              cy={dotY}
              r={3}
              fill={stroke}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            />
          )}

          <rect
            ref={overlayRef}
            x={0} y={0} width={W} height={H}
            fill="none"
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          />
        </svg>
      </div>

      <span
        className="text-[0.75rem] font-extrabold tabular-nums"
        style={{ color: isDiscovery ? 'var(--color-text-muted)' : stroke }}
      >
        {isDiscovery || value === null ? '—' : `${value}%`}
      </span>

      <span className="text-[0.6875rem] font-bold text-[var(--color-text-muted)] leading-tight">{label}</span>

      {isDiscovery
        ? <span className="text-[0.5rem] text-[var(--color-text-muted)]">Establishing…</span>
        : pill
      }
    </div>
  )
}
