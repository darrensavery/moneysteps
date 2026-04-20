// app/src/hooks/useMarketRates.ts
import { useState, useEffect } from 'react';
import { getMarketRates } from '../lib/api';
import type { MarketRate, MarketRatesResponse } from '../lib/api';

// Map family currency to the locale the API expects, so amounts always
// match the currency the family actually uses — regardless of UI language.
function currencyToLocale(currency: string): string {
  if (currency === 'PLN') return 'pl';
  if (currency === 'USD') return 'en-US';
  return 'en-GB'; // GBP and anything else
}

export function useMarketRates(currency = 'GBP'): {
  rates: MarketRate[];
  tileSource: MarketRatesResponse['tile_source'];
  loading: boolean;
  error: string | null;
} {
  const locale = currencyToLocale(currency);
  // Include currency in the cache key so GBP and PLN families don't share a cache.
  const sessionKey = `mc_market_rates_${currency}`;

  const [rates, setRates]           = useState<MarketRate[]>([]);
  const [tileSource, setTileSource] = useState<MarketRatesResponse['tile_source']>('hardcoded_defaults');
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem(sessionKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as MarketRatesResponse;
        // Only use cache if it actually has data — an empty array means a prior
        // failed fetch (e.g. before migrations ran) was cached; skip and refetch.
        if (parsed.rates && parsed.rates.length > 0) {
          setRates(parsed.rates);
          setTileSource(parsed.tile_source);
          setLoading(false);
          return;
        }
      } catch { /* stale cache — refetch */ }
    }

    getMarketRates(locale)
      .then(data => {
        sessionStorage.setItem(sessionKey, JSON.stringify(data));
        setRates(data.rates);
        setTileSource(data.tile_source);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load rate guide'))
      .finally(() => setLoading(false));
  }, [locale, sessionKey]);

  return { rates, tileSource, loading, error: err };
}

/** Returns true if the typed query matches a canonical chore name or any of its synonyms. */
export function fuzzyMatch(rate: MarketRate, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    rate.canonical_name.toLowerCase().includes(q) ||
    rate.synonyms.some(s => s.toLowerCase().includes(q))
  );
}
