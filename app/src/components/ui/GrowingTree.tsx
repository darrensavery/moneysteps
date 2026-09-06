/**
 * GrowingTree — 5-stage animated SVG that grows as a savings goal progresses.
 *
 * Stages (keyed to pct):
 *   0–19%   Seed      — bare soil mound
 *   20–39%  Sprout    — tiny stem + first two leaves
 *   40–59%  Sapling   — thin trunk + small canopy
 *   60–79%  YoungTree — fuller trunk + layered canopy
 *   80–100% FullOak   — complete Morechard-style tree (matches brand tree image)
 *
 * The tree uses the same natural green palette as the attached brand asset:
 *   Trunk  — #6b4226 (warm brown)
 *   Canopy — #4caf50 (mid green), #388e3c (deep), #81c784 (highlight)
 *
 * Usage: <GrowingTree pct={65} size={80} />
 */

import React, { useMemo } from 'react'

type Stage = 'seed' | 'sprout' | 'sapling' | 'young' | 'full'

function getStage(pct: number): Stage {
  if (pct < 20) return 'seed'
  if (pct < 40) return 'sprout'
  if (pct < 60) return 'sapling'
  if (pct < 80) return 'young'
  return 'full'
}

const TRUNK  = '#6b4226'
const TRUNK_DARK = '#4e2f1a'
const G_MID  = '#4caf50'
const G_DEEP = '#388e3c'
const G_LITE = '#81c784'
const SOIL   = '#8d6e63'

// Each stage returns an SVG fragment rendered inside a 100×120 viewBox.
function Seed() {
  return (
    <>
      {/* Soil mound */}
      <ellipse cx="50" cy="105" rx="28" ry="8" fill={SOIL} opacity="0.7" />
      {/* Tiny seed bump */}
      <ellipse cx="50" cy="99" rx="6" ry="4" fill={TRUNK} />
    </>
  )
}

function Sprout() {
  return (
    <>
      <ellipse cx="50" cy="108" rx="28" ry="7" fill={SOIL} opacity="0.6" />
      {/* Stem */}
      <rect x="48.5" y="75" width="3" height="34" rx="1.5" fill={TRUNK} />
      {/* Left leaf */}
      <ellipse cx="41" cy="76" rx="10" ry="6" fill={G_MID} transform="rotate(-30 41 76)" />
      {/* Right leaf */}
      <ellipse cx="59" cy="74" rx="10" ry="6" fill={G_DEEP} transform="rotate(30 59 74)" />
      {/* Tip bud */}
      <circle cx="50" cy="72" r="4" fill={G_LITE} />
    </>
  )
}

function Sapling() {
  return (
    <>
      <ellipse cx="50" cy="110" rx="24" ry="6" fill={SOIL} opacity="0.5" />
      {/* Trunk */}
      <path d="M47 110 Q46 90 48 60 L52 60 Q54 90 53 110Z" fill={TRUNK} />
      {/* Small canopy — single layer */}
      <ellipse cx="50" cy="52" rx="22" ry="18" fill={G_DEEP} />
      <ellipse cx="50" cy="48" rx="18" ry="14" fill={G_MID} />
      <ellipse cx="50" cy="44" rx="12" ry="10" fill={G_LITE} />
    </>
  )
}

function YoungTree() {
  return (
    <>
      <ellipse cx="50" cy="112" rx="26" ry="6" fill={SOIL} opacity="0.4" />
      {/* Trunk with subtle taper */}
      <path d="M45 112 Q43 88 47 55 L53 55 Q57 88 55 112Z" fill={TRUNK} />
      <path d="M47 90 Q46 80 48 60 L52 60 Q54 80 53 90Z" fill={TRUNK_DARK} opacity="0.4" />
      {/* Canopy — two layers */}
      <ellipse cx="50" cy="46" rx="30" ry="22" fill={G_DEEP} />
      <ellipse cx="38" cy="52" rx="18" ry="14" fill={G_DEEP} />
      <ellipse cx="62" cy="50" rx="18" ry="14" fill={G_MID} />
      <ellipse cx="50" cy="40" rx="24" ry="18" fill={G_MID} />
      <ellipse cx="50" cy="34" rx="16" ry="12" fill={G_LITE} />
    </>
  )
}

function FullOak() {
  return (
    <>
      <ellipse cx="50" cy="114" rx="28" ry="6" fill={SOIL} opacity="0.35" />
      {/* Trunk — wider, tapered */}
      <path d="M43 114 Q40 86 46 52 L54 52 Q60 86 57 114Z" fill={TRUNK} />
      <path d="M47 95 Q46 82 48 58 L52 58 Q54 82 53 95Z" fill={TRUNK_DARK} opacity="0.35" />
      {/* Root flares */}
      <path d="M43 114 Q36 110 32 116" stroke={TRUNK} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M57 114 Q64 110 68 116" stroke={TRUNK} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Canopy — three layered blob groups matching photo */}
      {/* Base layer — deep shadow */}
      <ellipse cx="50" cy="58" rx="38" ry="28" fill={G_DEEP} />
      <ellipse cx="28" cy="62" rx="20" ry="16" fill={G_DEEP} />
      <ellipse cx="72" cy="60" rx="20" ry="16" fill={G_DEEP} />
      {/* Mid layer */}
      <ellipse cx="50" cy="50" rx="34" ry="26" fill={G_MID} />
      <ellipse cx="30" cy="52" rx="18" ry="14" fill={G_MID} />
      <ellipse cx="70" cy="50" rx="18" ry="14" fill={G_MID} />
      {/* Highlight layer — top */}
      <ellipse cx="42" cy="36" rx="20" ry="16" fill={G_LITE} />
      <ellipse cx="60" cy="32" rx="18" ry="14" fill={G_LITE} />
      <ellipse cx="50" cy="26" rx="16" ry="13" fill="#a5d6a7" />
      {/* Top highlight specular */}
      <ellipse cx="46" cy="22" rx="8" ry="6" fill="#c8e6c9" opacity="0.7" />
    </>
  )
}

const STAGE_COMPONENTS: Record<Stage, () => React.ReactElement> = {
  seed:   Seed,
  sprout: Sprout,
  sapling: Sapling,
  young:  YoungTree,
  full:   FullOak,
}

const STAGE_LABELS: Record<Stage, string> = {
  seed:    'Seed',
  sprout:  'Sprout',
  sapling: 'Sapling',
  young:   'Growing',
  full:    'Full Oak',
}

interface Props {
  /** Progress 0–100 */
  pct: number
  /** Height in px (width scales ~83%). Default 80. */
  size?: number
  /** Show stage label below the tree */
  showLabel?: boolean
  className?: string
}

export function GrowingTree({ pct, size = 80, showLabel = false, className = '' }: Props) {
  const stage = useMemo(() => getStage(Math.max(0, Math.min(100, pct))), [pct])
  const StageComponent = STAGE_COMPONENTS[stage]
  const width = Math.round(size * 0.83)

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <svg
        width={width}
        height={size}
        viewBox="0 0 100 120"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={`Goal tree: ${STAGE_LABELS[stage]}`}
        style={{ overflow: 'visible' }}
      >
        <StageComponent />
      </svg>
      {showLabel && (
        <span className="text-[0.625rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
          {STAGE_LABELS[stage]}
        </span>
      )}
    </div>
  )
}

export { STAGE_LABELS, getStage }
export type { Stage }
