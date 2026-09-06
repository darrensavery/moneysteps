// app/src/components/dashboard/VoidExpenseSheet.tsx
import { useState } from 'react';
import { voidExpense } from '../../lib/api';
import { ErrorBox } from '../ui/ErrorBox';
import { BaseSheet } from '../ui/BaseSheet';
import { tick } from '../../lib/haptics';

type Props = {
  expenseId: number;
  description: string;
  onClose: () => void;
  onVoided: () => void;
};

export function VoidExpenseSheet({ expenseId, description, onClose, onVoided }: Props) {
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Touched-on-blur, not onChange — the field only complains once the user
  // has actually left it empty, not on every keystroke while typing.
  const reasonError = reasonTouched && !reason.trim() ? 'Please provide a reason.' : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setReasonTouched(true); setError('Please provide a reason.'); return; }

    setSaving(true);
    setError(null);
    try {
      await voidExpense(expenseId, { reason: reason.trim() });
      onVoided();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseSheet onClose={onClose} label="Void expense" panelClassName="w-full max-w-[560px] mx-auto bg-[var(--color-surface)] rounded-t-2xl p-6 pb-10 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Void expense</h2>
        <button onClick={() => { void tick(); onClose(); }} aria-label="Close" className="tap-target-44 text-[var(--color-text-muted)] text-2xl leading-none">&times;</button>
      </div>

      <p className="text-sm text-[var(--color-text-muted)]">
        Voiding <strong>{description}</strong> removes it from the settlement but keeps a record in the audit log.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="void-expense-reason" className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
            Reason *
          </label>
          <textarea
            id="void-expense-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onBlur={() => setReasonTouched(true)}
            placeholder="e.g. Entered incorrect amount, duplicate entry…"
            rows={3}
            required
            aria-required="true"
            aria-invalid={!!(error || reasonError)}
            aria-describedby={[reasonError && 'void-expense-field-error', error && 'void-expense-error'].filter(Boolean).join(' ') || undefined}
            className={`mt-1 w-full border rounded-xl px-4 py-3 text-sm bg-[var(--color-surface-raised)] resize-none ${reasonError ? 'border-red-400' : 'border-[var(--color-border)]'}`}
          />
          {reasonError && <p id="void-expense-field-error" className="mt-1 text-xs text-red-500">{reasonError}</p>}
        </div>

        <ErrorBox id="void-expense-error" message={error} />

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-red-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {saving ? 'Voiding…' : 'Void expense'}
        </button>
      </form>
    </BaseSheet>
  );
}
