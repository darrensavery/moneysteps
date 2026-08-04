import { useEffect, type CSSProperties, type ReactNode } from 'react'
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

export function BaseSheet({ onClose, children, panelClassName, panelStyle, zIndex = 50, label }: Props) {
  function close() {
    void tick()
    onClose()
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

  return (
    <div
      data-testid="sheet-backdrop"
      style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}
      onClick={close}
    >
      <div
        ref={sheetRef}
        onClick={e => e.stopPropagation()}
        className={panelClassName}
        style={{ width: '100%', transition: 'transform 300ms', ...panelStyle }}
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
