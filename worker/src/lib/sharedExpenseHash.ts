/**
 * Chain-of-Trust hashing for shared expenses.
 *
 * Each row's record_hash = SHA-256 of:
 *   id || family_id || logged_by || total_amount || currency || split_bp || previous_hash
 *
 * The genesis row uses previous_hash = GENESIS_HASH.
 */

import { sha256, GENESIS_HASH } from './hash';

export { GENESIS_HASH };

/**
 * Computes the record_hash for a committed shared_expense row.
 * Input mirrors the ledger pattern: fields joined with '|'.
 * Only call this at commit time — pending rows carry 'PENDING' as record_hash.
 */
export async function computeSharedExpenseHash(
  id: number,
  familyId: string,
  loggedBy: string,
  totalAmount: number,
  currency: string,
  splitBp: number,
  previousHash: string,
): Promise<string> {
  // description and category are intentionally excluded — only financial terms and chain linkage are hashed.
  const payload = [id, familyId, loggedBy, totalAmount, currency, splitBp, previousHash].join('|');
  return sha256(payload);
}

/**
 * Fetches the record_hash of the most recently committed shared_expense row
 * for a given family, to use as previous_hash for the next committed row.
 * Returns GENESIS_HASH if no committed row exists yet.
 */
export async function getLastCommittedHash(db: D1Database, familyId: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT record_hash FROM shared_expenses
       WHERE family_id = ?
         AND verification_status IN ('committed_auto', 'committed_manual', 'reversed')
         AND record_hash != 'PENDING'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(familyId)
    .first<{ record_hash: string }>();
  return row?.record_hash ?? GENESIS_HASH;
}
