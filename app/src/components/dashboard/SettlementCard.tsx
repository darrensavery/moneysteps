// app/src/components/dashboard/SettlementCard.tsx
import { useState } from 'react';
import { apiUrl, authHeaders } from '../../lib/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { ErrorBox } from '../ui/ErrorBox';

type Expense = {
  id: number;
  description: string;
  category: string;
  total_amount: number;
  logged_by_name: string;
  split_bp: number;
};

type ReconcileResult = {
  period: string;
  net_pence: number;
  currency: string;
  expenses: Expense[];
  message?: string;
};

type Props = {
  period: string;
  onClose: () => void;
  onReconciled: () => void;
};

function formatAmount(pence: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';
  return `${symbol}${(pence / 100).toFixed(2)}`;
}

export function SettlementCard({ period, onClose, onReconciled }: Props) {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useAndroidBack(true, onClose);

  async function handleReconcile() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/shared-expenses/reconcile'), {
        method: 'POST',
        headers: await authHeaders('application/json'),
        body: JSON.stringify({ period }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error ?? 'Reconcile failed');
      }
      setResult(await res.json() as ReconcileResult);
      onReconciled();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function buildShareText(r: ReconcileResult): string {
    const lines = [
      `Morechard Shared Expenses — ${r.period}`,
      '─────────────────────────',
      ...r.expenses.map(e =>
        `• ${e.description}: ${formatAmount(e.total_amount, r.currency)} (logged by ${e.logged_by_name})`
      ),
      '─────────────────────────',
      r.net_pence === 0
        ? 'You are square — no payment needed.'
        : r.net_pence < 0
          ? `Net: you are owed ${formatAmount(Math.abs(r.net_pence), r.currency)}`
          : `Net: you owe ${formatAmount(r.net_pence, r.currency)}`,
    ];
    return lines.join('\n');
  }

  async function handleShare(r: ReconcileResult) {
    const text = buildShareText(r);
    if (navigator.share) {
      await navigator.share({ title: `Shared expenses ${r.period}`, text });
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-[560px] bg-[var(--color-surface)] rounded-t-2xl p-6 pb-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Reconcile {period}</h2>
          <button onClick={onClose} className="tap-target-44 text-[var(--color-text-muted)] text-2xl leading-none">&times;</button>
        </div>

        {!result && (
          <>
            <p className="text-sm text-[var(--color-text-muted)]">
              This will mark all committed expenses for {period} as settled and generate a summary you can share.
            </p>
            <ErrorBox message={error} />
            <button
              onClick={handleReconcile}
              disabled={loading}
              className="w-full bg-[var(--brand-primary)] text-white font-semibold py-3 rounded-xl disabled:opacity-50"
            >
              {loading ? 'Calculating…' : 'Generate settlement summary'}
            </button>
          </>
        )}

        {result && (
          <>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] card-depth p-4 flex flex-col gap-2">
              {result.expenses.map(e => (
                <div key={e.id} className="flex justify-between text-sm">
                  <span className="text-[var(--color-text-muted)]">{e.description}</span>
                  <span className="font-semibold tabular-nums">{formatAmount(e.total_amount, result.currency)}</span>
                </div>
              ))}
              <div className="border-t border-[var(--color-border)] pt-2 mt-1 flex justify-between font-bold text-base">
                <span>
                  {result.net_pence === 0
                    ? 'You are square'
                    : result.net_pence < 0
                      ? 'You are owed'
                      : 'You owe'}
                </span>
                {result.net_pence !== 0 && (
                  <span className={result.net_pence < 0 ? 'text-green-600' : 'text-red-500'}>
                    {formatAmount(Math.abs(result.net_pence), result.currency)}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => handleShare(result)}
              className="w-full border border-[var(--brand-primary)] text-[var(--brand-primary)] font-semibold py-3 rounded-xl transition-colors disabled:opacity-70"
              disabled={copied}
            >
              {copied ? '✓ Copied to clipboard' : 'Share summary'}
            </button>
            <button onClick={onClose} className="text-sm text-[var(--color-text-muted)] text-center">
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
