// worker/src/jobs/familyPurge.ts
//
// Two-stage data purge for deleted families.
//
// Stage 1 — T+30 days (runSoftDeletePurge)
//   For families soft-deleted more than 30 days ago, hard-delete all
//   operational data. The ledger and payment_audit_log are kept because they
//   are retained as pseudonymised records under Art. 6(1)(f) + Art. 17(3)(b)
//   (see docs/governance/lia/lia.md, LIA-3). The families row is reduced to a
//   tombstone (id + deleted_at only) so the 7-year gate can fire.
//
// Stage 2 — T+7 years (runLedgerPurge)
//   For families deleted more than 7 years ago, hard-delete the pseudonymised
//   ledger rows and their associated status log, the payment audit log, and
//   the tombstone itself. 7 years aligns with the UK Limitation Act 1980
//   civil-claims window (see LIA-3 outstanding action).
//
// Both stages are idempotent and safe to re-run.

import type { Env } from '../types.js';

const THIRTY_DAYS_S = 30 * 86_400;
const SEVEN_YEARS_S = 7 * 365 * 86_400; // 220,752,000 seconds (ignores leap years — acceptable)

export async function runSoftDeletePurge(env: Env, nowEpoch: number): Promise<void> {
  const cutoff30 = nowEpoch - THIRTY_DAYS_S;

  // Collect family IDs past the 30-day window that haven't been purged yet.
  // "Not yet purged" = families row still has non-null name (tombstoning sets name to NULL).
  const rows = await env.DB
    .prepare(
      `SELECT id FROM families
       WHERE deleted_at IS NOT NULL
         AND deleted_at < ?
         AND name IS NOT NULL`,
    )
    .bind(cutoff30)
    .all<{ id: string }>();

  if (!rows.results.length) return;

  for (const { id: familyId } of rows.results) {
    // Collect child user IDs for this family (needed for child-keyed tables).
    const childRows = await env.DB
      .prepare(`SELECT id FROM users WHERE family_id = ?`)
      .bind(familyId)
      .all<{ id: string }>();
    const childIds = childRows.results.map(r => r.id);

    const batch: D1PreparedStatement[] = [];

    // ── Mentor chat escalations ─────────────────────────────────────
    // mentor_chat_escalations has no family_id column of its own — it only
    // references mentor_chat_messages.id via message_id. This delete MUST be
    // queued before the mentor_chat_messages delete below (part of the
    // familyTables loop), otherwise the subquery finds nothing and orphan
    // escalation rows survive the purge.
    batch.push(
      env.DB
        .prepare(
          `DELETE FROM mentor_chat_escalations WHERE message_id IN (SELECT id FROM mentor_chat_messages WHERE family_id = ?)`,
        )
        .bind(familyId),
    );

    // ── Family-keyed tables ─────────────────────────────────────────
    const familyTables = [
      'chores',
      'goals',
      'completions',
      'bonus_payments',
      'insight_snapshots',
      'child_badges',
      'child_logins',
      'child_nudges',
      'child_streaks',
      'family_roles',
      'push_subscriptions',
      'parent_messages',
      'payouts',
      'jar_config',
      'jar_movements',
      'give_requests',
      'analytics_consents',
      'plans',
      'shared_expenses',
      'spending',
      'payday_log',
      'review_feedback',
      'review_prompt_state',
      'referral_clicks',
      'referral_conversions',
      'family_governance_log',
      'mentor_chat_messages',
    ];
    for (const table of familyTables) {
      batch.push(
        env.DB.prepare(`DELETE FROM ${table} WHERE family_id = ?`).bind(familyId),
      );
    }

    // ── Child-keyed tables ──────────────────────────────────────────
    // Only if there are child rows to avoid a no-op IN () which SQLite rejects.
    if (childIds.length > 0) {
      const placeholders = childIds.map(() => '?').join(',');
      const childKeyedTables = [
        'chat_history',
        'unlocked_modules',
        'lesson_completions',
        'module_act_progress',
        'chat_rate_limits',
        'user_settings',
        'account_locks',
        'sessions',
      ];
      for (const table of childKeyedTables) {
        batch.push(
          env.DB
            .prepare(`DELETE FROM ${table} WHERE child_id IN (${placeholders})`)
            .bind(...childIds),
        );
      }
      // sessions and auth tables key on user_id rather than child_id
      const userKeyedTables = [
        'sessions',
        'magic_link_tokens',
        'magic_link_attempts',
        'email_verify_tokens',
        'upgrade_interest',
        'slt_tokens',
        'slt_attempts',
      ];
      for (const table of userKeyedTables) {
        batch.push(
          env.DB
            .prepare(`DELETE FROM ${table} WHERE user_id IN (${placeholders})`)
            .bind(...childIds),
        );
      }
    }

    // ── Hard-delete users (PII already anonymised at T=0; now remove the rows) ─
    batch.push(
      env.DB.prepare(`DELETE FROM users WHERE family_id = ?`).bind(familyId),
    );

    // ── Ledger status log contains actor_id (user_id) and ip_address ───────────
    // Delete it; the ledger rows themselves are kept as pseudonymised data.
    batch.push(
      env.DB
        .prepare(`DELETE FROM ledger_status_log WHERE ledger_id IN (SELECT id FROM ledger WHERE family_id = ?)`)
        .bind(familyId),
    );

    // ── Tombstone the families row ──────────────────────────────────
    // Set all PII columns to NULL; preserve id and deleted_at for the 7-year gate.
    batch.push(
      env.DB
        .prepare(
          `UPDATE families SET
             name            = NULL,
             home_lat        = NULL,
             home_lng        = NULL,
             referral_code   = NULL,
             referred_by_code = NULL
           WHERE id = ?`,
        )
        .bind(familyId),
    );

    // D1 batch is capped at 100 statements; families with many children could
    // theoretically exceed this, but in practice child counts are ≤ 10.
    await env.DB.batch(batch);
  }
}

export async function runLedgerPurge(env: Env, nowEpoch: number): Promise<void> {
  const cutoff7y = nowEpoch - SEVEN_YEARS_S;

  // Tombstoned families (name IS NULL, deleted_at set) older than 7 years.
  const rows = await env.DB
    .prepare(
      `SELECT id FROM families
       WHERE deleted_at IS NOT NULL
         AND deleted_at < ?
         AND name IS NULL`,
    )
    .bind(cutoff7y)
    .all<{ id: string }>();

  if (!rows.results.length) return;

  for (const { id: familyId } of rows.results) {
    await env.DB.batch([
      // Ledger status log may still have rows if families deleted before this
      // purge job existed (pre-T+30 pass). Belt-and-braces deletion.
      env.DB
        .prepare(`DELETE FROM ledger_status_log WHERE ledger_id IN (SELECT id FROM ledger WHERE family_id = ?)`)
        .bind(familyId),
      // Pseudonymised ledger rows — hard-delete after 7 years.
      env.DB.prepare(`DELETE FROM ledger WHERE family_id = ?`).bind(familyId),
      // Ledger prune archive (historical redacted entries) keyed by family_id.
      env.DB.prepare(`DELETE FROM ledger_prune_archive WHERE family_id = ?`).bind(familyId),
      // Payment audit log — pseudonymous financial record; 7-year accounting window matches.
      env.DB.prepare(`DELETE FROM payment_audit_log WHERE family_id = ?`).bind(familyId),
      // Remove the tombstone itself.
      env.DB.prepare(`DELETE FROM families WHERE id = ?`).bind(familyId),
    ]);
  }
}
