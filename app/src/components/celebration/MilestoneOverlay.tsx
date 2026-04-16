/**
 * MilestoneOverlay — CelebrationEngine base renderer.
 * Sequences through MilestoneConfig stages with timed transitions.
 */
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import type { MilestoneConfig, MilestoneEvent } from './types'
import { GRADUATION } from './achievements/graduation'

const CONFIGS: Record<string, MilestoneConfig> = {
  GRADUATION,
}

interface Props {
  event:      MilestoneEvent
  onComplete: () => void
}

type Phase = 'stage' | 'transition' | 'exit'

export function MilestoneOverlay({ event, onComplete }: Props) {
  const config    = CONFIGS[event.type]
  const stages    = event.appView === 'CLEAN' ? config.clean : config.orchard
  const isShimmer = config.transition === 'shimmer'

  const [stageIdx, setStageIdx] = useState(0)
  const [phase,    setPhase]    = useState<Phase>('stage')
  const [visible,  setVisible]  = useState(true)

  useEffect(() => {
    if (!config) { onComplete(); return }

    const current = stages[stageIdx]

    const tTransition = setTimeout(() => {
      if (stageIdx < stages.length - 1) {
        setPhase('transition')
        setTimeout(() => {
          setStageIdx(i => i + 1)
          setPhase('stage')
        }, 1500)
      } else {
        setPhase('exit')
        setVisible(false)
        setTimeout(onComplete, 600)
      }
    }, current.durationMs)

    return () => clearTimeout(tTransition)
  }, [stageIdx, stages, config, onComplete])

  if (!config) return null

  const current = stages[stageIdx]

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center',
        'transition-opacity duration-[600ms]',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ backgroundColor: config.bgColor }}
    >
      {isShimmer && phase === 'transition' && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-amber-400/10 to-blue-500/20 animate-pulse pointer-events-none transition-opacity duration-300" />
      )}
      {!isShimmer && phase === 'transition' && (
        <div className="absolute inset-0 bg-white/5 pointer-events-none transition-all duration-[1500ms]" />
      )}
      {phase === 'transition' && (
        <div className="absolute text-5xl animate-spin pointer-events-none" style={{ animationDuration: '2s' }}>
          {isShimmer ? '✦' : '◈'}
        </div>
      )}
      <div className={cn(
        'text-center px-8 max-w-sm transition-all duration-700',
        phase === 'stage' ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 scale-95 pointer-events-none',
      )}>
        <div className="text-6xl mb-6">{current.icon}</div>
        <p className={cn('text-[22px] font-bold leading-snug mb-3', current.headingColor)}>
          {current.heading}
        </p>
        <p className={cn('text-[15px] leading-relaxed', current.bodyColor)}>
          {current.body}
        </p>
        {current.attribution && (
          <p className="text-[12px] text-white/30 mt-4 italic">{current.attribution}</p>
        )}
      </div>
    </div>
  )
}
