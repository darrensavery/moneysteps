/**
 * settings/shared.tsx — Shared atoms for all Settings section components.
 *
 * Exported: useToast, Toast, SettingsRow, SectionCard, SectionHeader, ReadOnlyBadge
 */

import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronLeft, Lock } from 'lucide-react'
import { cn } from '../../lib/utils'

// ── Swipe-back hook ───────────────────────────────────────────────────────────
// Fires onBack when the user swipes right ≥40px with < 60px vertical drift.

function useSwipeBack(onBack: (() => void) | undefined) {
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!onBack) return
    const back = onBack

    function onTouchStart(e: TouchEvent) {
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
    }

    function onTouchEnd(e: TouchEvent) {
      if (startX.current === null || startY.current === null) return
      const dx = e.changedTouches[0].clientX - startX.current
      const dy = Math.abs(e.changedTouches[0].clientY - startY.current)
      if (dx > 40 && dy < 60) back()
      startX.current = null
      startY.current = null
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [onBack])
}

// ── Toast ─────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return { toast, showToast }
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[#1a2e2e] text-white text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
      🌱 {message}
    </div>
  )
}

// ── Row atoms ─────────────────────────────────────────────────────────────────

export function SettingsRow({
  icon, label, description, onClick, destructive = false, disabled = false, badge, rightSlot,
}: {
  icon?: React.ReactNode
  label: string
  description?: string
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  badge?: string
  rightSlot?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors',
        'border-b border-[var(--color-border)] last:border-0',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] cursor-pointer',
      )}
    >
      {icon && (
        <span className={cn(
          'shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
          destructive ? 'bg-red-600 text-white' : 'bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]',
        )}>
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[var(--color-text)]">
          {label}
        </p>
        {description && (
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      {badge && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
          {badge}
        </span>
      )}
      {rightSlot ?? <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />}
    </button>
  )
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
      {children}
    </div>
  )
}

export function SectionHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  useSwipeBack(onBack)
  return (
    <div className="flex items-center gap-3 mb-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors shrink-0"
        >
          <ChevronLeft size={16} className="text-[var(--color-text-muted)]" />
        </button>
      )}
      <div>
        <h2 className="text-[16px] font-bold text-[var(--color-text)]">{title}</h2>
        {subtitle && <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

export function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
      <Lock size={9} /> Read only
    </span>
  )
}
