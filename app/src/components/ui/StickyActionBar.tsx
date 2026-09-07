import type { ReactNode } from 'react'

interface Props {
  children:  ReactNode
  maxWidth?: number
  className?: string
}

/**
 * Fixed action bar anchored just above the bottom nav dock (Chores' "+ Add
 * chore", Activity's "Pay out", Expenses' "+ Log shared expense", Insights'
 * period toggle, etc.).
 *
 * Kept as a single shared component so every tab's bar shares the same
 * width/offset by construction instead of six hand-copied instances quietly
 * drifting from each other.
 */
export function StickyActionBar({ children, maxWidth = 520, className }: Props) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-20 flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto w-full mx-3 ${className ?? ''}`}
        style={{ maxWidth, marginBottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 68px)' }}
      >
        {children}
      </div>
    </div>
  )
}
