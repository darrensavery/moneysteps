import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** One short sentence — this is not a place for documentation. */
  content: string
  children: ReactNode
  className?: string
}

const SHOW_DELAY_MS = 300
const BUBBLE_MAX_WIDTH = 300
const VIEWPORT_MARGIN = 8

/**
 * Lightweight tooltip following the designmotionhq "Tooltip Design" rules:
 * a 300ms hover delay (no false triggers on a cursor graze), an arrow
 * anchored to the trigger, a flip off the nearest viewport edge, dismissal
 * from every input path (mouse leave, Escape, blur, tap outside), and a
 * single-sentence, width-capped bubble.
 *
 * Rendered via a portal into document.body, positioned with `fixed` coords
 * computed from the trigger's bounding rect — an absolutely-positioned child
 * would get silently clipped by any ancestor with `overflow-hidden` (e.g.
 * PremiumShell's rounded card), which is what made this tooltip fail to
 * display on Orchard Mentor cards.
 */
export function Tooltip({ content, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; flipUp: boolean; arrowLeft: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function computePosition() {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    const flipUp = rect.top > 60
    const halfWidth = BUBBLE_MAX_WIDTH / 2
    const centerX = rect.left + rect.width / 2
    const clampedCenterX = Math.min(
      Math.max(centerX, VIEWPORT_MARGIN + halfWidth),
      window.innerWidth - VIEWPORT_MARGIN - halfWidth,
    )
    return {
      top: flipUp ? rect.top - 8 : rect.bottom + 8,
      left: clampedCenterX,
      flipUp,
      // Arrow stays anchored to the trigger even if the bubble itself got
      // shifted to stay on-screen.
      arrowLeft: centerX - clampedCenterX,
    }
  }

  function scheduleShow() {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => {
      setPos(computePosition())
      setOpen(true)
    }, SHOW_DELAY_MS)
  }

  function hide() {
    if (showTimer.current) clearTimeout(showTimer.current)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') hide() }
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) hide()
    }
    function onReposition() { setPos(computePosition()) }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open])

  useEffect(() => () => { if (showTimer.current) clearTimeout(showTimer.current) }, [])

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
      onClick={() => (open ? hide() : scheduleShow())}
    >
      {children}
      {open && pos && createPortal(
        <span
          role="tooltip"
          className={`fixed z-[100] max-w-[300px] w-max px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-medium leading-snug text-white bg-[var(--color-text)] shadow-lg pointer-events-none whitespace-normal ${
            pos.flipUp ? '-translate-x-1/2 -translate-y-full' : '-translate-x-1/2'
          }`}
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
          <span
            className={`absolute w-2 h-2 bg-[var(--color-text)] rotate-45 ${
              pos.flipUp ? '-bottom-1' : '-top-1'
            }`}
            style={{ left: `calc(50% + ${pos.arrowLeft}px)`, transform: 'translateX(-50%) rotate(45deg)' }}
          />
        </span>,
        document.body,
      )}
    </span>
  )
}
