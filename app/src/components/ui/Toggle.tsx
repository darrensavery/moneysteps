interface Props {
  checked: boolean
  onChange: () => void
  /** Accessible name — required since the switch carries no visible label of its own. */
  label: string
  /** True while an async request triggered by this toggle is in flight — shows a
   *  spinner in the knob instead of leaving the state ambiguous mid-request. */
  pending?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Shared switch primitive — designmotionhq "Toggle Anatomy": morph (not snap)
 * over 250ms ease-out, rail color + knob position + knob shadow animate
 * together, rail is 2x the knob diameter with the knob inset by its own
 * radius, and it exposes role/aria-checked so Space/click both work.
 */
export function Toggle({ checked, onChange, label, pending = false, disabled = false, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={onChange}
      className={`
        tap-target-44 relative w-11 h-6 rounded-full border shrink-0 cursor-pointer
        transition-colors duration-[250ms] ease-out disabled:cursor-not-allowed disabled:opacity-70
        ${checked ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]' : 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'}
        ${className ?? ''}
      `}
    >
      <span
        className={`
          absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white
          flex items-center justify-center
          transition-[transform,box-shadow] duration-[250ms] ease-out
          ${checked ? 'translate-x-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)]' : 'translate-x-0 shadow-sm'}
        `}
      >
        {pending && (
          <span
            className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[var(--color-border)] border-t-[var(--brand-primary)] animate-spin"
            aria-hidden="true"
          />
        )}
      </span>
    </button>
  )
}
