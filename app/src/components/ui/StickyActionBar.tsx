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
 * A bare `position: fixed` button with only its own background left a
 * transparent strip between the button and the nav — scrolled list content
 * could visibly (and tappably) peek through that strip at any scroll
 * position, not just once fully scrolled to the end. This gives the whole
 * zone down to the viewport bottom an opaque backdrop matching the page
 * background, so nothing can ever show through or be silently tapped there.
 */
export function StickyActionBar({ children, maxWidth = 520, className }: Props) {
  return (
    <div
      className="fixed bottom-0 inset-x-0 z-20 flex justify-center bg-[var(--color-bg)]"
      style={{ paddingBottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 68px)' }}
    >
      <div className={`w-full mx-3 ${className ?? ''}`} style={{ maxWidth }}>
        {children}
      </div>
    </div>
  )
}
