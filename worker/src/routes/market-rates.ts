// worker/src/routes/market-rates.ts
/**
 * Market Rates routes
 *
 * GET  /api/market-rates           — list all canonical chores with locale-aware medians
 * POST /api/market-rates/suggest   — child suggests a chore to parent (writes to suggestions table)
 * GET  /api/market-rates/cron      — internal CRON health check (no user auth)
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';
import { nanoid } from '../lib/nanoid.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ── Value tier thresholds (GBP pence equivalent) ────────────────────────────
const TIER_SEEDS_MAX    = 149;  // £0 – £1.49
const TIER_SAPLINGS_MAX = 399;  // £1.50 – £3.99
                                 // £4.00+ = oaks

// ── Proxy multipliers for Pioneer Phase ─────────────────────────────────────
const PLN_MULTIPLIER = 5;
const USD_MULTIPLIER = 1.27;

type ValueTier = 'seeds' | 'saplings' | 'oaks' | 'discoverable';

interface TierInfo {
  value_tier: ValueTier;
  value_tier_label: string;
}

function computeTier(amount: number): TierInfo {
  if (amount <= TIER_SEEDS_MAX)    return { value_tier: 'seeds',    value_tier_label: 'Small Seeds' };
  if (amount <= TIER_SAPLINGS_MAX) return { value_tier: 'saplings', value_tier_label: 'Growing Saplings' };
  return                                  { value_tier: 'oaks',     value_tier_label: 'Great Oaks' };
}

interface MarketRateRow {
  id: string;
  canonical_name: string;
  category: string;
  synonyms: string;          // JSON string
  uk_median_pence: number | null;
  us_median_cents: number | null;
  pl_median_grosz: number | null;
  data_source: string;
  sample_count: number;
  is_orchard_8: number;
  sort_order: number;
}

export async function handleMarketRateList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Determine locale: query param overrides, else default
  const localeParam = url.searchParams.get('locale') ?? 'en-GB';

  const rows = await env.DB
    .prepare('SELECT * FROM market_rates ORDER BY sort_order ASC')
    .all<MarketRateRow>();

  const rates = (rows.results ?? []).map(row => {
    let medianAmount: number | null = null;
    let medianIsLocal = false;

    if (localeParam === 'pl') {
      if (row.pl_median_grosz != null) {
        medianAmount  = row.pl_median_grosz;
        medianIsLocal = true;
      } else if (row.uk_median_pence != null) {
        medianAmount  = Math.round(row.uk_median_pence * PLN_MULTIPLIER);
        medianIsLocal = false;
      }
    } else if (localeParam === 'en-US') {
      if (row.us_median_cents != null) {
        medianAmount  = row.us_median_cents;
        medianIsLocal = true;
      } else if (row.uk_median_pence != null) {
        medianAmount  = Math.round(row.uk_median_pence * USD_MULTIPLIER);
        medianIsLocal = false;
      }
    } else {
      // en-GB (default)
      if (row.uk_median_pence != null) {
        medianAmount  = row.uk_median_pence;
        medianIsLocal = true;
      }
    }

    let tierInfo: TierInfo;
    if (medianAmount == null) {
      tierInfo = { value_tier: 'discoverable', value_tier_label: 'Discoverable' };
    } else {
      // Tier is always computed against GBP-equivalent pence for consistency
      const penceEquivalent = localeParam === 'pl'
        ? Math.round(medianAmount / PLN_MULTIPLIER)
        : localeParam === 'en-US'
          ? Math.round(medianAmount / USD_MULTIPLIER)
          : medianAmount;
      tierInfo = computeTier(penceEquivalent);
    }

    let synonyms: string[] = [];
    try { synonyms = JSON.parse(row.synonyms); } catch { /* malformed JSON */ }

    return {
      id:                row.id,
      canonical_name:    row.canonical_name,
      category:          row.category,
      synonyms,
      median_amount:     medianAmount,
      median_is_local:   medianIsLocal,
      value_tier:        tierInfo.value_tier,
      value_tier_label:  tierInfo.value_tier_label,
      is_orchard_8:      row.is_orchard_8 === 1,
      sort_order:        row.sort_order,
      data_source:       row.data_source,
      sample_count:      row.sample_count,
    };
  });

  return json({ tile_source: 'hardcoded_defaults', rates });
}

export async function handleMarketRateSuggest(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can suggest chores', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON');

  const { canonical_name, median_amount, currency, context } = body;

  if (!canonical_name || typeof canonical_name !== 'string')
    return error('canonical_name required');
  if (!Number.isInteger(median_amount) || (median_amount as number) <= 0)
    return error('median_amount must be a positive integer');
  if (!currency || !['GBP', 'PLN', 'USD'].includes(currency as string))
    return error('currency must be GBP, PLN, or USD');

  const id  = nanoid();
  const now = Math.floor(Date.now() / 1000);

  // Store context (module slug) in the existing `reason` column.
  // Format: "module:01-effort-vs-reward" or null for direct browse.
  const reason = context && typeof context === 'string' ? context : null;

  await env.DB.prepare(`
    INSERT INTO suggestions
      (id, family_id, child_id, title, proposed_amount, reason, submitted_at)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    id,
    auth.family_id,
    auth.sub,
    (canonical_name as string).trim(),
    median_amount as number,
    reason,
    now,
  ).run();

  return json({ status: 'sent' }, 201);
}

export async function handleMarketRateCron(_request: Request, env: Env): Promise<Response> {
  const result = await env.DB
    .prepare('SELECT COUNT(*) as total FROM market_rates')
    .first<{ total: number }>();

  const rowCount = result?.total ?? 0;
  console.log(`[market-rate-cron] row_count=${rowCount}`);

  return json({ status: 'ok', row_count: rowCount, message: 'aggregation not yet implemented' });
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; }
  catch { return null; }
}
