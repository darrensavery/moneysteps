/**
 * settings/shared.tsx — Shared atoms for all Settings section components.
 *
 * Exported: useToast, Toast, SettingsRow, SectionCard, SectionHeader, ReadOnlyBadge
 */

import { useState } from 'react'
import { ChevronRight, ChevronLeft, Lock } from 'lucide-react'
import { cn } from '../../lib/utils'

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
  icon, label, description, onClick, destructive = false, disabled = false, badge,
}: {
  icon?: React.ReactNode
  label: string
  description?: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  badge?: string
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
      <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
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

export function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        type="button"
        onClick={onBack}
        className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
      >
        <ChevronLeft size={16} className="text-[var(--color-text-muted)]" />
      </button>
      <h2 className="text-[16px] font-bold text-[var(--color-text)]">{title}</h2>
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
