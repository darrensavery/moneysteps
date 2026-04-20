// app/src/hooks/useMarketRates.ts
import { useState, useEffect } from 'react';
import { getMarketRates, MarketRate, MarketRatesResponse } from '../lib/api';
import { useLocale } from '../lib/locale';

const SESSION_KEY = 'mc_market_rates';

export function useMarketRates(): {
  rates: MarketRate[];
  tileSource: MarketRatesResponse['tile_source'];
  loading: boolean;
  error: string | null;
} {
  const { locale } = useLocale();
  const [rates, setRates]           = useState<MarketRate[]>([]);
  const [tileSource, setTileSource] = useState<MarketRatesResponse['tile_source']>('hardcoded_defaults');
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as MarketRatesResponse;
        setRates(parsed.rates);
        setTileSource(parsed.tile_source);
        setLoading(false);
        return;
      } catch { /* stale cache — refetch */ }
    }

    getMarketRates(locale)
      .then(data => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
        setRates(data.rates);
        setTileSource(data.tile_source);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load rate guide'))
      .finally(() => setLoading(false));
  }, [locale]);

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
