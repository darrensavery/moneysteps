import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** One short sentence — this is not a place for documentation. */
  content: string
  children: ReactNode
  className?: string
}

const SHOW_DELAY_MS = 300

/**
 * Lightweight tooltip following the designmotionhq "Tooltip Design" rules:
 * a 300ms hover delay (no false triggers on a cursor graze), an arrow
 * anchored to the trigger, a flip off the nearest viewport edge, dismissal
 * from every input path (mouse leave, Escape, blur, tap outside), and a
 * single-sentence, width-capped bubble.
 */
export function Tooltip({ content, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const [flipUp, setFlipUp] = useState(true)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleShow() {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect()
      // Flip below the trigger when there isn't room above it.
      setFlipUp(!rect || rect.top > 60)
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
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
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
      {open && (
        <span
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 z-50 max-w-[300px] w-max px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-medium leading-snug text-white bg-[var(--color-text)] shadow-lg pointer-events-none whitespace-normal ${
            flipUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {content}
          <span
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-[var(--color-text)] rotate-45 ${
              flipUp ? '-bottom-1' : '-top-1'
            }`}
          />
        </span>
      )}
    </span>
  )
}
