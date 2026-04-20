// app/src/components/dashboard/RateGuideSheet.tsx
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMarketRates, fuzzyMatch } from '../../hooks/useMarketRates';
import { currencySymbol } from '../../lib/locale';
import type { MarketRate } from '../../lib/api';

const CATEGORIES: { label: string; icon: string }[] = [
  { label: 'All',               icon: '✦'  },
  { label: 'Outdoor Work',      icon: '🌿' },
  { label: 'Cleaning',          icon: '🧹' },
  { label: 'Kitchen',           icon: '🍽' },
  { label: 'Laundry',           icon: '👕' },
  { label: 'Tidying',           icon: '📦' },
  { label: 'Garden',            icon: '🌱' },
  { label: 'Pets',              icon: '🐾' },
  { label: 'Errands',           icon: '🛒' },
  { label: 'Learning & Skills', icon: '📚' },
  { label: 'Good Habits',       icon: '⭐' },
];

function formatAmount(amount: number | null, symbol: string): string {
  if (amount == null) return '—';
  return `${symbol}${(amount / 100).toFixed(2)}`;
}

// ── Source badge icons ────────────────────────────────────────────────────────

function CommunityIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IndustryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0">
      <line x1="3" y1="22" x2="21" y2="22"/>
      <rect x="2" y="9" width="4" height="13"/>
      <rect x="10" y="9" width="4" height="13"/>
      <rect x="18" y="9" width="4" height="13"/>
      <path d="M2 9l10-7 10 7"/>
    </svg>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  currency?: string;
  onUse?: (title: string, amount: number) => void;
}

export function RateGuideSheet({ open, onClose, currency = 'GBP', onUse }: Props) {
  const { rates, loading, error } = useMarketRates(currency);
  const symbol = currencySymbol(currency);

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

  const noResults = !loading && !error && filtered.length === 0 && search.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50">
      <div className="relative bg-[var(--color-bg)] rounded-t-3xl shadow-2xl w-full max-w-[560px] flex flex-col max-h-[92svh]">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-0 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* ── Sticky top section: header + search + pills ───────────── */}
        <div className="shrink-0 px-5 pt-3 pb-0 border-b border-[var(--color-border)]">

          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[17px] font-extrabold text-[var(--color-text)] tracking-tight">Rate Guide</h2>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">What other families pay</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none cursor-pointer"
              aria-label="Close"
            >×</button>
          </div>

          {/* Search */}
          <div className="mb-3">
            <input
              type="search"
              placeholder="Search chores…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-white dark:bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition shadow-sm"
            />
          </div>

          {/* Category pills */}
          <div
            className="flex gap-2 pb-3 overflow-x-auto"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            {CATEGORIES.map(cat => (
              <button
                key={cat.label}
                onClick={() => setCategory(cat.label)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                  category === cat.label
                    ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                    : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_85%,var(--color-text)_15%)] hover:text-[var(--color-text)]'
                }`}
              >
                <span className="text-[11px] leading-none">{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 pb-3 text-[10px] text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1">
              <span className="text-[var(--brand-primary)]"><CommunityIcon /></span>
              Morechard families
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]"><IndustryIcon /></span>
              Industry average
            </span>
          </div>
        </div>

        {/* ── Scrollable list ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="py-10 text-center text-[14px] text-[var(--color-text-muted)]">Loading…</p>
          )}
          {error && (
            <p className="py-10 text-center text-[13px] text-red-500">{error}</p>
          )}

          {/* No results state */}
          {noResults && (
            <div className="py-12 flex flex-col items-center gap-3 px-6 text-center">
              <p className="text-[14px] text-[var(--color-text-muted)]">No rates found for "{search}"</p>
              <button
                onClick={() => {
                  // Clear search and close so parent can open CreateChoreSheet with the typed title
                  if (onUse) onUse(search, 0);
                  else onClose();
                }}
                className="px-4 py-2 rounded-xl border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition cursor-pointer"
              >
                Add "{search}" as custom chore
              </button>
            </div>
          )}

          {/* Rate rows */}
          {!loading && !error && filtered.length > 0 && (
            <div className="px-5 pb-8">
              {filtered.map(rate => {
                const isCommunity = rate.median_is_local && rate.sample_count >= 5;
                return (
                  <div
                    key={rate.id}
                    className="flex items-center gap-3 py-3.5 border-b border-[var(--color-border)] last:border-0"
                  >
                    {/* Chore name + category */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-[var(--color-text)] leading-snug">{rate.canonical_name}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{rate.category}</p>
                    </div>

                    {/* Price + source icon + Use button */}
                    <div className="shrink-0 flex items-center gap-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          title={isCommunity ? `Based on ${rate.sample_count} Morechard families` : 'Based on industry/national averages'}
                          className={isCommunity ? 'text-[var(--brand-primary)]' : 'text-[var(--color-text-muted)]'}
                        >
                          {isCommunity ? <CommunityIcon /> : <IndustryIcon />}
                        </span>
                        <span className="text-[16px] font-extrabold tabular-nums text-[var(--color-text)]">
                          {formatAmount(rate.median_amount, symbol)}
                        </span>
                      </div>

                      {onUse && rate.median_amount != null && (
                        <button
                          onClick={() => onUse(rate.canonical_name, rate.median_amount!)}
                          className="h-7 px-2.5 rounded-lg bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold hover:bg-[color-mix(in_srgb,var(--brand-primary)_18%,transparent)] transition cursor-pointer"
                        >
                          Use
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
