// worker/src/jobs/marketRateAggregation.ts
import { Env } from '../types.js';

/**
 * Weekly market rate aggregation job.
 * Currently a stub — verifies D1 read access and logs row count.
 * Full aggregation logic (AI canonical mapper) is deferred to a future phase.
 */
export async function runMarketRateAggregation(env: Env): Promise<void> {
  const result = await env.DB
    .prepare('SELECT COUNT(*) as total FROM market_rates')
    .first<{ total: number }>();

  console.log(`[market-rate-aggregation] market_rates row count: ${result?.total ?? 0}. Aggregation not yet implemented.`);
}
