import { useRef, useState, type ReactNode } from 'react'
import { tick } from '../../lib/haptics'

// How far the card must travel before it snaps fully open (vs springing back
// closed) on release — same "reveal, don't auto-fire" pattern as swipe
// actions in most native list UIs: the action still needs an explicit tap.
const OPEN_THRESHOLD = 40
const REVEAL_WIDTH = 84

interface Props {
  onAction: () => void
  actionLabel: string
  children: ReactNode
  /** Applied to the outer (non-sliding) wrapper — put rounding/overflow-hidden here. */
  className?: string
}

/** Swipe left to reveal a destructive action button (e.g. Archive) behind the card. */
export function SwipeRevealCard({ onAction, actionLabel, children, className }: Props) {
  const startX = useRef<number | null>(null)
  const startOffset = useRef(0)
  const [offsetX, setOffsetX] = useState(0) // 0 = closed, -REVEAL_WIDTH = fully open
  const dragging = startX.current !== null
  const isOpen = offsetX !== 0

  function clamp(v: number) {
    return Math.max(-REVEAL_WIDTH, Math.min(0, v))
  }

  function onStart(x: number) {
    startX.current = x
    startOffset.current = offsetX
  }

  function onMove(x: number) {
    if (startX.current === null) return
    setOffsetX(clamp(startOffset.current + (x - startX.current)))
  }

  function onEnd() {
    if (startX.current === null) return
    startX.current = null
    setOffsetX(prev => {
      const next = Math.abs(prev) > OPEN_THRESHOLD ? -REVEAL_WIDTH : 0
      if (next !== 0 && prev === 0) void tick()
      return next
    })
  }

  function close() {
    setOffsetX(0)
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* Revealed action — sits behind the card, only reachable once swiped open. */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL_WIDTH }}>
        <button
          type="button"
          tabIndex={isOpen ? 0 : -1}
          aria-hidden={!isOpen}
          onClick={() => { onAction(); close() }}
          className="flex-1 bg-red-500 text-white text-[0.6875rem] font-bold cursor-pointer"
        >
          {actionLabel}
        </button>
      </div>
      <div
        className="rounded-xl"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease',
          touchAction: 'pan-y',
          // Some card content (e.g. overdue/priority accents) uses a
          // semi-transparent background. Without an opaque backdrop here,
          // that translucency lets the revealed action button bleed
          // through even while fully closed (offsetX 0).
          backgroundColor: 'var(--color-bg)',
        }}
        // A tap while swiped open closes the reveal instead of activating
        // whatever's underneath (expand toggle, etc.) — matches native list UX.
        onClickCapture={e => { if (isOpen) { e.stopPropagation(); close() } }}
        onTouchStart={e => onStart(e.touches[0].clientX)}
        onTouchMove={e => onMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
        onMouseDown={e => onStart(e.clientX)}
        onMouseMove={e => { if (startX.current !== null) onMove(e.clientX) }}
        onMouseUp={onEnd}
        onMouseLeave={() => { if (startX.current !== null) onEnd() }}
      >
        {children}
      </div>
    </div>
  )
}
