// app/src/components/ui/ConfirmDialog.tsx
// Shared in-app confirm dialog for destructive/consequential actions — replaces
// native window.confirm() so styling, focus handling, and copy match the rest
// of the app (see the original inline version this was extracted from in
// ChildGoalsTab, "safer destructive actions").
import { Button } from './button'

interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
      >
        <div>
          <p className="text-[1.125rem] font-extrabold text-[var(--color-text)] tracking-tight">
            {title}
          </p>
          {description && (
            <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-1 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" size="lg" className="flex-1" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} size="lg" className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
