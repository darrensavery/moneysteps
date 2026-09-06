// app/src/components/dashboard/StreakChip.tsx
import { cn } from '../../lib/utils'

interface Props {
  currentStreak:    number
  graceRemaining:   number
  consistencyScore: number
  appView:          'ORCHARD' | 'CLEAN'
}

export function StreakChip({ currentStreak, graceRemaining, consistencyScore, appView }: Props) {
  if (currentStreak < 2) return null

  const isTeal = graceRemaining > 0
  const label   = appView === 'CLEAN' ? 'streak' : 'days in a row'

  return (
    <div className={cn(
      'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.75rem] font-semibold',
      isTeal
        ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
        : 'bg-amber-500/20 text-amber-100 border border-amber-500/40',
    )}>
      <span>🔥</span>
      <span className="tabular-nums">{currentStreak} {label}</span>
      {graceRemaining > 0 && (
        <span className="text-white/40 text-[0.625rem]">
          ({graceRemaining} {appView === 'CLEAN' ? 'grace' : 'rain'})
        </span>
      )}
      {consistencyScore > 0 && (
        <span className={cn(
          'ml-1 text-[0.625rem] tabular-nums',
          consistencyScore >= 80 ? 'text-teal-400' : 'text-white/30',
        )}>
          {consistencyScore}%
        </span>
      )}
    </div>
  )
}
