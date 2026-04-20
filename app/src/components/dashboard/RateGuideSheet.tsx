// app/src/components/dashboard/RateGuideSheet.tsx
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMarketRates, fuzzyMatch } from '../../hooks/useMarketRates';
import { useLocale, currencySymbol } from '../../lib/locale';
import type { AppLocale } from '../../lib/locale';
import type { MarketRate } from '../../lib/api';

const CATEGORIES = [
  'All', 'Outdoor Work', 'Cleaning', 'Kitchen', 'Laundry', 'Tidying',
  'Garden', 'Pets', 'Errands', 'Learning & Skills', 'Good Habits',
];

/** Map AppLocale to its currency code. */
function localeToCurrency(locale: AppLocale): string {
  if (locale === 'pl')    return 'PLN';
  if (locale === 'en-US') return 'USD';
  return 'GBP';
}

function formatAmount(amount: number | null, symbol: string): string {
  if (amount == null) return '—';
  return `${symbol}${(amount / 100).toFixed(2)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RateGuideSheet({ open, onClose }: Props) {
  const { rates, loading, error } = useMarketRates();
  const { locale } = useLocale();
  const symbol = currencySymbol(localeToCurrency(locale));

  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('All');

  const filtered: MarketRate[] = useMemo(() => {
    return rates.filter(r => {
      const matchesCategory = category === 'All' || r.category === category;
      const matchesSearch   = fuzzyMatch(r, search);
      return matchesCategory && matchesSearch;
    });
  }, [rates, search, category]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-3 border-b border-[--color-border]">
        <h2 className="text-lg font-semibold text-[--color-text]">Rate Guide</h2>
        <button
          onClick={onClose}
          className="text-sm text-[--color-text-muted] hover:text-[--color-text]"
        >
          Close
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <input
          type="search"
          placeholder="Search chores…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--brand-primary]"
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-none">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat
                ? 'bg-[--brand-primary] text-[--color-text-on-brand]'
                : 'bg-[--color-surface] text-[--color-text-muted] border border-[--color-border]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {loading && (
          <p className="py-8 text-center text-sm text-[--color-text-muted]">Loading…</p>
        )}
        {error && (
          <p className="py-8 text-center text-sm text-red-500">{error}</p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-[--color-text-muted]">No results</p>
        )}
        {!loading && !error && filtered.map(rate => (
          <div
            key={rate.id}
            className="flex items-center justify-between py-3 border-b border-[--color-border] last:border-0"
          >
            <div>
              <p className="text-sm font-medium text-[--color-text]">{rate.canonical_name}</p>
              <p className="text-xs text-[--color-text-muted]">{rate.category}</p>
            </div>
            <div className="flex items-center gap-2">
              {!rate.median_is_local && (
                <span
                  title="Pioneer rate — based on global average"
                  className="text-xs rounded-full bg-amber-100 text-amber-700 px-2 py-0.5"
                >
                  Pioneer
                </span>
              )}
              <span className="text-sm font-semibold tabular-nums text-[--color-text]">
                {formatAmount(rate.median_amount, symbol)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
