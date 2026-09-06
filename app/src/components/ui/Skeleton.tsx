// Reusable loading placeholders — sized to match the real list-card layouts
// they stand in for, so the loading→content swap doesn't cause a layout jump.
// Uses Tailwind's built-in `animate-pulse` (no new dependency).

interface SkeletonRowProps {
  /** Reserve space for a leading icon/avatar circle. */
  withIcon?: boolean
  /** Reserve space for a trailing amount/price on the right. */
  withTrailing?: boolean
}

export function SkeletonRow({ withIcon = true, withTrailing = true }: SkeletonRowProps) {
  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center gap-3 animate-pulse"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {withIcon && <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--color-surface-alt)]" />}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 rounded-full bg-[var(--color-surface-alt)]" style={{ width: '60%' }} />
        <div className="h-2.5 rounded-full bg-[var(--color-surface-alt)]" style={{ width: '35%' }} />
      </div>
      {withTrailing && <div className="shrink-0 h-4 w-12 rounded-full bg-[var(--color-surface-alt)]" />}
    </div>
  )
}

interface SkeletonListProps extends SkeletonRowProps {
  count?: number
  className?: string
}

/** A short stack of `SkeletonRow`s, standing in for a tab's card list while it loads. */
export function SkeletonList({ count = 3, className = 'space-y-2.5', ...rowProps }: SkeletonListProps) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <SkeletonRow key={i} {...rowProps} />)}
    </div>
  )
}
