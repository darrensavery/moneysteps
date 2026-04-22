import { useState } from 'react';
import { tick } from '../../lib/haptics';
import { markPaid, markPaidBatch, formatCurrency } from '../../lib/api';

type Props = {
  familyId: string;
  completionIds: string[];
  totalMinorUnits: number;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
};

export function PaymentConfirmSheet({
  familyId, completionIds, totalMinorUnits, currency, onDone, onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleYes() {
    // Fire haptic synchronously — before any await — so the gesture
    // context is still valid on Android Chrome.
    void tick();
    setBusy(true);
    setErr(null);
    try {
      if (completionIds.length === 1) {
        await markPaid(completionIds[0]);
      } else {
        await markPaidBatch(familyId, completionIds);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="text-center pt-2">
        <div className="text-[20px] font-bold">Did the payment go through?</div>
        <div className="mt-1 text-[13px] text-neutral-500">
          We can&apos;t check with your bank — just tap Yes if the transfer was sent.
        </div>
        <div className="mt-3 text-[17px] font-semibold">
          {formatCurrency(totalMinorUnits, currency)}
          {completionIds.length > 1 && (
            <span className="ml-2 text-[13px] font-normal text-neutral-500">
              ({completionIds.length} rewards)
            </span>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[13px] text-rose-900">
          Couldn&apos;t update — {err}. Tap retry.
        </div>
      )}

      <button
        type="button"
        onClick={handleYes}
        disabled={busy}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Saving…' : err ? 'Retry' : 'Yes, sent ✓'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full rounded-2xl bg-neutral-100 py-3.5 font-semibold text-neutral-700"
      >
        Not yet
      </button>
    </div>
  );
}
