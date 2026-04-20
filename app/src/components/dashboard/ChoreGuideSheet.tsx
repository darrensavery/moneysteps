// app/src/components/dashboard/ChoreGuideSheet.tsx
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMarketRates } from '../../hooks/useMarketRates';
import { suggestChore } from '../../lib/api';
import type { MarketRate } from '../../lib/api';
import { currencySymbol } from '../../lib/locale';

const TIER_ORDER = ['oaks', 'saplings', 'seeds', 'discoverable'] as const;
const TIER_HEADINGS: Record<string, string> = {
  oaks:         '🌳 Great Oaks',
  saplings:     '🌿 Growing Saplings',
  seeds:        '🌱 Small Seeds',
  discoverable: '🔍 Discoverable',
};

function formatAmount(amount: number | null, symbol: string): string {
  if (amount == null) return '—';
  return `${symbol}${(amount / 100).toFixed(2)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional: module slug passed when navigating from a Learning Lab module */
  context?: string | null;
  currency?: string;
}

export function ChoreGuideSheet({ open, onClose, context = null, currency = 'GBP' }: Props) {
  const { rates, loading, error } = useMarketRates(currency);

  const symbol      = currencySymbol(currency);
  const regionLabel = currency === 'PLN' ? 'Poland' : currency === 'USD' ? 'the US' : 'your area';

  const [suggested, setSuggested] = useState<string | null>(null); // id of just-suggested
  const [sending,   setSending]   = useState<string | null>(null);  // id currently sending
  const [success,   setSuccess]   = useState(false);

  const grouped = useMemo(() => {
    const map: Record<string, MarketRate[]> = {};
    for (const tier of TIER_ORDER) map[tier] = [];
    for (const rate of rates) map[rate.value_tier]?.push(rate);
    return map;
  }, [rates]);

  async function handleSuggest(rate: MarketRate) {
    if (sending || suggested === rate.id) return;
    setSending(rate.id);
    try {
      await suggestChore({
        canonical_name: rate.canonical_name,
        median_amount:  rate.median_amount ?? 0,
        currency,
        context,
      });
      setSuggested(rate.id);
      setSuccess(true);
    } catch {
      // fail silently — user can retry
    } finally {
      setSending(null);
    }
  }

  if (!open) return null;

  // Success state
  if (success) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--color-bg)] px-8 text-center">
        <p className="text-5xl mb-4">🌳</p>
        <h2 className="text-xl font-semibold text-[--color-text] mb-2">Proposal sent!</h2>
        <p className="text-sm text-[--color-text-muted] mb-8">
          Your parent will see that you're ready to grow some Great Oaks.
        </p>
        <button
          onClick={() => { setSuccess(false); onClose(); }}
          className="rounded-xl bg-[--brand-primary] text-[--color-text-on-brand] px-6 py-3 text-sm font-semibold"
        >
          Done
        </button>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-3 border-b border-[--color-border]">
        <h2 className="text-lg font-semibold text-[--color-text]">Chore Guide</h2>
        <button onClick={onClose} className="text-sm text-[--color-text-muted] hover:text-[--color-text]">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {loading && <p className="py-8 text-center text-sm text-[--color-text-muted]">Loading…</p>}
        {error   && <p className="py-8 text-center text-sm text-red-500">{error}</p>}
        {!loading && !error && TIER_ORDER.map(tier => {
          const tierRates = grouped[tier];
          if (!tierRates.length) return null;
          return (
            <div key={tier} className="mt-6">
              <h3 className="text-sm font-bold text-[--color-text-muted] uppercase tracking-wider mb-3">
                {TIER_HEADINGS[tier]}
              </h3>
              {tierRates.map(rate => (
                <div
                  key={rate.id}
                  className="flex items-center justify-between py-3 border-b border-[--color-border] last:border-0"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm font-medium text-[--color-text] truncate">{rate.canonical_name}</p>
                    {!rate.median_is_local && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        We're still learning what this is worth in {regionLabel} — you could be the first!
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold tabular-nums text-[--color-text]">
                      {formatAmount(rate.median_amount, symbol)}
                    </span>
                    <button
                      disabled={sending === rate.id || suggested === rate.id}
                      onClick={() => handleSuggest(rate)}
                      className="rounded-lg bg-[--brand-primary] text-[--color-text-on-brand] px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-opacity"
                    >
                      {sending === rate.id ? '…' : suggested === rate.id ? '✓' : 'Suggest'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
