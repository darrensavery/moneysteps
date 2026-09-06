import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useDragToClose } from '../../hooks/useDragToClose'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { tick } from '../../lib/haptics'

interface Props {
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  panelStyle?: CSSProperties
  zIndex?: number
  /** Accessible name for the dialog, read by screen readers when it opens. */
  label: string
}

// iOS-style deceleration curve — matches the "premium" sheet feel referenced
// in the motion pattern proposal (fast start, gentle settle, no overshoot).
const SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const CLOSE_DURATION_MS = 300

export function BaseSheet({ onClose, children, panelClassName, panelStyle, zIndex = 50, label }: Props) {
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering')

  function close() {
    void tick()
    setPhase('closing')
  }

  const { sheetRef, handleProps } = useDragToClose(close)
  useAndroidBack(true, close)
  useFocusTrap(sheetRef, true)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Flip to 'open' a frame after mount so the initial 'entering' style is
  // actually painted first, giving the panel/backdrop something to animate from.
  // Guarded so a close() fired in that same frame (e.g. an instant Escape/tap)
  // isn't clobbered back to 'open' once this fires.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase(p => (p === 'entering' ? 'open' : p)))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (phase !== 'closing') return
    const timeout = setTimeout(onClose, CLOSE_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [phase, onClose])

  const isOpen = phase === 'open'

  return (
    <div
      data-testid="sheet-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        opacity: isOpen ? 1 : 0,
        transition: `opacity ${CLOSE_DURATION_MS}ms ease-out`,
      }}
      onClick={close}
    >
      <div
        ref={sheetRef}
        onClick={e => e.stopPropagation()}
        className={panelClassName}
        style={{
          width: '100%',
          transform: `translateY(${isOpen ? '0' : '100%'})`,
          transition: `transform ${CLOSE_DURATION_MS}ms ${SHEET_EASING}`,
          ...panelStyle,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>
        {children}
      </div>
    </div>
  )
}
