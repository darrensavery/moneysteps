# DSAR Self-Service Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, unauthenticated DSAR (access + erasure) request portal that reuses Morechard's existing anonymization/purge logic, with email verification, an atomic anti-race claim, and a 30-day-deferred bulk purge for single-child erasures.

**Architecture:** New `dsar_requests` D1 table + two public routes (`worker/src/routes/dsar.ts`) drive a request → email-verify → execute flow. Erasure logic is extracted from the existing authenticated `handleDeleteFamily` into shared functions in `worker/src/lib/dsarExecution.ts`, reused by both the authenticated route and the new DSAR flow. Access requests reuse the existing `handleExportJson` and add a new R2 bucket for short-lived signed download links.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), R2, Resend (email), vitest.

## Global Constraints

- Never target `--local` D1 or run destructive commands against the `morechard` (production) database. All commands in this plan target `morechard-dev --remote` unless explicitly marked production.
- No manual approval step anywhere in the erasure path — per product decision, verified requests execute automatically.
- Ledger rows (`ledger`, `ledger_status_log`) are never mutated or deleted by any DSAR erasure path — this is safety-critical (hash-chain integrity) and every task touching erasure must preserve it.
- R2 presigned/signed URLs for data exports must use a 1-hour expiry, enforced natively by R2 (`createSignedUrl({ expiresIn: 3600 })`), not cron cleanup.
- Migration files are numbered sequentially; the next free number is `0088`.
- Test runner is vitest (`npm test` from `worker/`); existing tests use a hand-rolled `D1Database` mock matched by SQL substring (see `worker/src/routes/auth.test.ts`), not Miniflare.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/migrations/0088_dsar_requests.sql` | New `dsar_requests` table + `users.purge_pending_at` column |
| `worker/src/lib/dsarExecution.ts` | Shared erasure logic: sole-parent, lead-with-coparent, non-lead-coparent, child-scope; child-name resolution |
| `worker/src/lib/dsarExecution.test.ts` | Unit tests for the above, including a ledger-untouched proof |
| `worker/src/lib/dsarEmail.ts` | Resend email senders for verification, clarification, and access-link delivery |
| `worker/src/routes/dsar.ts` | `POST /api/dsar/request`, `GET /api/dsar/verify` |
| `worker/src/routes/dsar.test.ts` | Route tests: matching/anti-enumeration, atomic claim/race, needs_clarification, access flow |
| `worker/src/routes/auth.ts` | Modified: `handleDeleteFamily` refactored to call shared functions, gains the lead-with-coparent path instead of blocking |
| `worker/src/routes/auth.test.ts` | New tests for the refactored `handleDeleteFamily` |
| `worker/src/jobs/familyPurge.ts` | New `runChildDsarPurge` export |
| `worker/src/jobs/familyPurge.test.ts` | New test file for `runChildDsarPurge` |
| `worker/src/index.ts` | Modified: register the two new routes, import + call `runChildDsarPurge` in `scheduled()` |
| `worker/src/types.ts` | Modified: add `DSAR_EXPORTS: R2Bucket` to `Env` |
| `worker/wrangler.toml` | Modified: add `DSAR_EXPORTS` R2 binding (dev + `env.production`) |
| `marketing/src/dsar.html` | New public request form page |
| `marketing/src/privacy-policy.html` | Modified: Section 7 links to the new form |

---

### Task 1: Migration, R2 bucket, Env type

**Files:**
- Create: `worker/migrations/0088_dsar_requests.sql`
- Modify: `worker/src/types.ts`
- Modify: `worker/wrangler.toml`

**Interfaces:**
- Produces: table `dsar_requests(id, request_type, scope, target_family_id, target_child_name_raw, requester_email, matched_user_id, token_hash, status, created_at, verified_at, executed_at)`; column `users.purge_pending_at INTEGER`; `Env.DSAR_EXPORTS: R2Bucket`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0088: DSAR self-service portal
--
-- Adds the dsar_requests table backing the public (unauthenticated) DSAR
-- portal, and a purge_pending_at tombstone marker on users for single-child
-- erasure requests (mirrors families.deleted_at's role for whole-family
-- erasure — set immediately at verification, swept by the T+30 cron in
-- worker/src/jobs/familyPurge.ts::runChildDsarPurge).
--
-- See docs/superpowers/specs/2026-07-17-dsar-portal-design.md

CREATE TABLE dsar_requests (
  id                     TEXT PRIMARY KEY,
  request_type           TEXT NOT NULL CHECK (request_type IN ('access', 'erasure')),
  scope                  TEXT NOT NULL CHECK (scope IN ('family', 'child')),
  target_family_id       TEXT NOT NULL REFERENCES families(id),
  target_child_name_raw  TEXT,
  requester_email        TEXT NOT NULL,
  matched_user_id        TEXT NOT NULL REFERENCES users(id),
  token_hash             TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'pending_verification'
                            CHECK (status IN ('pending_verification', 'processing', 'completed', 'expired', 'needs_clarification')),
  created_at             INTEGER NOT NULL,
  verified_at            INTEGER,
  executed_at            INTEGER
);

CREATE INDEX idx_dsar_requests_token ON dsar_requests(token_hash);

ALTER TABLE users ADD COLUMN purge_pending_at INTEGER;
```

- [ ] **Step 2: Apply to morechard-dev**

Run:
```bash
cd worker
npx wrangler d1 migrations apply morechard-dev --remote
```
Expected: output lists `0088_dsar_requests.sql` as applied, no errors.

- [ ] **Step 3: Create the R2 bucket (dev)**

Run:
```bash
cd worker
npx wrangler r2 bucket create morechard-dsar-exports-dev
```
Expected: `Created bucket 'morechard-dsar-exports-dev'`.

- [ ] **Step 4: Add the wrangler.toml binding (dev block)**

In `worker/wrangler.toml`, after the existing dev `[[r2_buckets]]` block for `RECEIPTS` (around line 42):

```toml
[[r2_buckets]]
binding = "RECEIPTS"
bucket_name = "morechard-receipts"

[[r2_buckets]]
binding = "DSAR_EXPORTS"
bucket_name = "morechard-dsar-exports-dev"
```

- [ ] **Step 5: Add the wrangler.toml binding (production block)**

Create the production bucket first:
```bash
cd worker
npx wrangler r2 bucket create morechard-dsar-exports
```

Then, after the existing `[[env.production.r2_buckets]]` block for `RECEIPTS` (around line 147):

```toml
[[env.production.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "morechard-receipts"

[[env.production.r2_buckets]]
binding = "DSAR_EXPORTS"
bucket_name = "morechard-dsar-exports"
```

- [ ] **Step 6: Add the binding to the `Env` type**

In `worker/src/types.ts`, after line 5 (`RECEIPTS: R2Bucket;`):

```ts
  RECEIPTS: R2Bucket;
  DSAR_EXPORTS: R2Bucket;
```

- [ ] **Step 7: Commit**

```bash
cd worker
git add migrations/0088_dsar_requests.sql wrangler.toml src/types.ts
git commit -m "feat: add dsar_requests table, purge_pending_at column, DSAR_EXPORTS R2 bucket"
```

---

### Task 2: Shared erasure execution logic

**Files:**
- Create: `worker/src/lib/dsarExecution.ts`
- Test: `worker/src/lib/dsarExecution.test.ts`

**Interfaces:**
- Consumes: `Env` from `../types.js`.
- Produces:
  - `resolveChildByName(env: Env, familyId: string, rawName: string): Promise<{ matched: 'none' | 'ambiguous' | 'one'; childId?: string }>`
  - `executeFamilyErasureSoleParent(env: Env, familyId: string): Promise<void>`
  - `executeFamilyErasureLeadWithCoparent(env: Env, familyId: string, departingLeadUserId: string): Promise<{ promotedUserId: string } | { error: string }>`
  - `executeFamilyErasureNonLeadCoparent(env: Env, familyId: string, userId: string): Promise<void>`
  - `executeChildErasure(env: Env, childUserId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/lib/dsarExecution.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  resolveChildByName,
  executeFamilyErasureSoleParent,
  executeFamilyErasureLeadWithCoparent,
  executeChildErasure,
} from './dsarExecution.js';
import type { Env } from '../types.js';

function makeMockDb(opts: {
  firstBySubstring?: Array<{ match: string; value: unknown }>;
  allBySubstring?: Array<{ match: string; value: unknown[] }>;
} = {}) {
  const batchCalls: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>() {
              const hit = (opts.firstBySubstring ?? []).find(f => sql.includes(f.match));
              return (hit?.value ?? null) as T;
            },
            async all<T>() {
              const hit = (opts.allBySubstring ?? []).find(f => sql.includes(f.match));
              return { results: (hit?.value ?? []) as T[] };
            },
            async run() { return { success: true, meta: {} }; },
          };
        },
      };
    },
    async batch(statements: Array<{ sql?: string }>) {
      // Record the SQL text of each statement in call order for ordering assertions.
      for (const s of statements as unknown as { toString(): string }[]) {
        batchCalls.push(String(s));
      }
      return statements.map(() => ({ success: true, meta: {} }));
    },
    __batchCalls: batchCalls,
  };
  return db as unknown as D1Database & { __batchCalls: string[] };
}

describe('resolveChildByName', () => {
  it('returns "one" when exactly one child matches case-insensitively', async () => {
    const db = makeMockDb({ allBySubstring: [{ match: 'family_roles', value: [{ id: 'child-1' }] }] });
    const env = { DB: db } as unknown as Env;
    const result = await resolveChildByName(env, 'fam-1', '  Ben  ');
    expect(result).toEqual({ matched: 'one', childId: 'child-1' });
  });

  it('returns "none" when no child matches', async () => {
    const db = makeMockDb({ allBySubstring: [{ match: 'family_roles', value: [] }] });
    const env = { DB: db } as unknown as Env;
    const result = await resolveChildByName(env, 'fam-1', 'Nobody');
    expect(result).toEqual({ matched: 'none' });
  });

  it('returns "ambiguous" when more than one child matches', async () => {
    const db = makeMockDb({ allBySubstring: [{ match: 'family_roles', value: [{ id: 'c1' }, { id: 'c2' }] }] });
    const env = { DB: db } as unknown as Env;
    const result = await resolveChildByName(env, 'fam-1', 'Ben');
    expect(result).toEqual({ matched: 'ambiguous' });
  });
});

describe('executeFamilyErasureSoleParent', () => {
  it('batches family soft-delete + PII null + session revoke + invite/registration cleanup', async () => {
    const db = makeMockDb();
    const env = { DB: db } as unknown as Env;
    await executeFamilyErasureSoleParent(env, 'fam-1');
    expect(db.__batchCalls.length).toBe(5);
    expect(db.__batchCalls.some(s => s.includes('UPDATE families SET deleted_at'))).toBe(true);
    expect(db.__batchCalls.some(s => s.includes("display_name = 'Deleted User'"))).toBe(true);
  });
});

describe('executeFamilyErasureLeadWithCoparent', () => {
  it('promotes the co-parent to lead before anonymising the departing lead', async () => {
    const db = makeMockDb({
      firstBySubstring: [{ match: "parent_role = 'co_parent'", value: { user_id: 'coparent-1' } }],
    });
    const env = { DB: db } as unknown as Env;
    const result = await executeFamilyErasureLeadWithCoparent(env, 'fam-1', 'lead-1');
    expect(result).toEqual({ promotedUserId: 'coparent-1' });
    const promoteIdx = db.__batchCalls.findIndex(s => s.includes("parent_role = 'lead'") && s.includes('family_roles'));
    const nullIdx = db.__batchCalls.findIndex(s => s.includes("display_name = 'Deleted User'"));
    expect(promoteIdx).toBeGreaterThanOrEqual(0);
    expect(nullIdx).toBeGreaterThan(promoteIdx);
  });

  it('returns an error when no co-parent can be found', async () => {
    const db = makeMockDb({ firstBySubstring: [{ match: "parent_role = 'co_parent'", value: null }] });
    const env = { DB: db } as unknown as Env;
    const result = await executeFamilyErasureLeadWithCoparent(env, 'fam-1', 'lead-1');
    expect(result).toEqual({ error: 'No co-parent found to promote' });
  });
});

describe('executeChildErasure', () => {
  it('only touches the users row — never the ledger', async () => {
    const db = makeMockDb();
    const env = { DB: db } as unknown as Env;
    await executeChildErasure(env, 'child-1');
    expect(db.__batchCalls.length).toBe(1);
    expect(db.__batchCalls[0]).toContain("display_name = 'Deleted Child'");
    expect(db.__batchCalls[0]).toContain('purge_pending_at');
    expect(db.__batchCalls.some(s => s.toLowerCase().includes('ledger'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/dsarExecution.test.ts`
Expected: FAIL — `Cannot find module './dsarExecution.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/dsarExecution.ts
//
// Shared erasure logic used by both the authenticated Uproot flow
// (worker/src/routes/auth.ts::handleDeleteFamily) and the public DSAR
// portal (worker/src/routes/dsar.ts). Extracted so the two entry points
// can never drift.
//
// Ledger rows (`ledger`, `ledger_status_log`) are NEVER touched here — the
// hash chain is preserved by anonymising the referenced `users` row only;
// `ledger.child_id` keeps pointing at the same immutable id forever.
//
// See docs/superpowers/specs/2026-07-17-dsar-portal-design.md

import type { Env } from '../types.js';

export interface ChildMatchResult {
  matched: 'none' | 'ambiguous' | 'one';
  childId?: string;
}

/** Resolves a free-text child display name to exactly one child, scoped to a family. */
export async function resolveChildByName(
  env: Env,
  familyId: string,
  rawName: string,
): Promise<ChildMatchResult> {
  const trimmed = rawName.trim().toLowerCase();
  const rows = await env.DB
    .prepare(
      `SELECT u.id FROM users u
       JOIN family_roles fr ON fr.user_id = u.id AND fr.family_id = u.family_id
       WHERE u.family_id = ? AND fr.role = 'child' AND LOWER(TRIM(u.display_name)) = ?`,
    )
    .bind(familyId, trimmed)
    .all<{ id: string }>();

  if (rows.results.length === 0) return { matched: 'none' };
  if (rows.results.length > 1) return { matched: 'ambiguous' };
  return { matched: 'one', childId: rows.results[0].id };
}

/** Whole-family erasure where the requester is the sole parent (no co-parent exists). */
export async function executeFamilyErasureSoleParent(env: Env, familyId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE families SET deleted_at = unixepoch() WHERE id = ?`).bind(familyId),
    env.DB.prepare(
      `UPDATE users SET display_name = 'Deleted User', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE family_id = ?`,
    ).bind(familyId),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = unixepoch() WHERE user_id IN (SELECT id FROM users WHERE family_id = ?) AND revoked_at IS NULL`,
    ).bind(familyId),
    env.DB.prepare(`DELETE FROM invite_codes WHERE family_id = ?`).bind(familyId),
    env.DB.prepare(`DELETE FROM registration_progress WHERE family_id = ?`).bind(familyId),
  ]);
}

/**
 * Whole-family erasure where the requester is the LEAD and a co-parent remains.
 * Promotes the co-parent to lead BEFORE anonymising the departing lead's row,
 * in the same D1 batch — so there is never a window where the row being
 * anonymised still holds the lead flag (which would orphan the family or
 * lose track of who to promote). Family, ledger, and children are otherwise
 * untouched.
 */
export async function executeFamilyErasureLeadWithCoparent(
  env: Env,
  familyId: string,
  departingLeadUserId: string,
): Promise<{ promotedUserId: string } | { error: string }> {
  const coparent = await env.DB
    .prepare(
      `SELECT user_id FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'co_parent' AND user_id != ? LIMIT 1`,
    )
    .bind(familyId, departingLeadUserId)
    .first<{ user_id: string }>();

  if (!coparent) return { error: 'No co-parent found to promote' };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE family_roles SET parent_role = 'lead' WHERE family_id = ? AND user_id = ? AND role = 'parent'`,
    ).bind(familyId, coparent.user_id),
    env.DB.prepare(
      `UPDATE family_roles SET parent_role = NULL WHERE family_id = ? AND user_id = ? AND role = 'parent'`,
    ).bind(familyId, departingLeadUserId),
    env.DB.prepare(
      `UPDATE users SET display_name = 'Deleted User', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE id = ?`,
    ).bind(departingLeadUserId),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(departingLeadUserId),
  ]);

  return { promotedUserId: coparent.user_id };
}

/** Non-lead co-parent leaving via a DSAR request. Mirrors handleLeaveFamily's anonymisation. */
export async function executeFamilyErasureNonLeadCoparent(
  env: Env,
  familyId: string,
  userId: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET display_name = 'Deleted User', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE id = ?`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(userId),
    env.DB.prepare(`DELETE FROM family_roles WHERE user_id = ? AND family_id = ?`).bind(userId, familyId),
  ]);
}

/**
 * Single-child erasure. Writes only the identity-state (users row) synchronously
 * — bulk child-keyed tables (chat_history, progress, etc.) are swept later by
 * runChildDsarPurge (worker/src/jobs/familyPurge.ts) at T+30 days, to stay
 * within D1 transaction/statement limits. Ledger rows are NEVER touched.
 */
export async function executeChildErasure(env: Env, childUserId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET display_name = 'Deleted Child', purge_pending_at = unixepoch() WHERE id = ?`,
    ).bind(childUserId),
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/dsarExecution.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the ledger-untouched proof test**

Append to `worker/src/lib/dsarExecution.test.ts`:

```ts
import { verifyChain } from './hash.js';

describe('ledger integrity across erasure paths', () => {
  it('a chain that verifies before erasure still verifies after (no ledger writes occur)', async () => {
    const entries = [
      { id: 1, family_id: 'fam-1', child_id: 'child-1', amount: 500, currency: 'GBP', entry_type: 'chore_reward', previous_hash: '0'.repeat(64), record_hash: '' },
    ];
    // Compute a real hash for row 1 so the chain is valid before we assert nothing changes it.
    const { computeRecordHash } = await import('./hash.js');
    entries[0].record_hash = await computeRecordHash(1, 'fam-1', 'child-1', 500, 'GBP', 'chore_reward', '0'.repeat(64));

    const before = await verifyChain(entries);
    expect(before.valid).toBe(true);

    // Run a child erasure against a mock DB that would throw if any statement
    // touched a table with "ledger" in its name.
    const db = {
      prepare(sql: string) {
        if (sql.toLowerCase().includes('ledger')) throw new Error('erasure must never touch the ledger');
        return { bind: () => ({ run: async () => ({ success: true, meta: {} }) }) };
      },
      async batch(statements: unknown[]) { return statements.map(() => ({ success: true, meta: {} })); },
    } as unknown as D1Database;
    await executeChildErasure({ DB: db } as unknown as Env, 'child-1');

    // Chain is untouched — same entries still verify.
    const after = await verifyChain(entries);
    expect(after.valid).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/dsarExecution.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
cd worker
git add src/lib/dsarExecution.ts src/lib/dsarExecution.test.ts
git commit -m "feat: extract shared DSAR erasure execution logic"
```

---

### Task 3: Refactor `handleDeleteFamily` to use shared logic + support lead-with-coparent

**Files:**
- Modify: `worker/src/routes/auth.ts:1116-1170`
- Test: `worker/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `executeFamilyErasureSoleParent`, `executeFamilyErasureLeadWithCoparent` from `../lib/dsarExecution.js`.

- [ ] **Step 1: Write the failing test**

Append to `worker/src/routes/auth.test.ts` (create the file with the imports below if it doesn't already have them):

```ts
import { describe, it, expect } from 'vitest';
import { handleDeleteFamily } from './auth.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

function makeMockDb(opts: {
  callerRole: { parent_role: string | null } | null;
  otherParentsCount: number;
  coparentUserId?: string;
}) {
  const batchCalls: string[] = [];
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('SELECT parent_role FROM family_roles')) return opts.callerRole as T;
              if (sql.includes('COUNT(*) AS cnt')) return { cnt: opts.otherParentsCount } as T;
              if (sql.includes("parent_role = 'co_parent'")) return (opts.coparentUserId ? { user_id: opts.coparentUserId } : null) as T;
              return null as T;
            },
          };
        },
      };
    },
    async batch(statements: Array<{ toString(): string }>) {
      for (const s of statements) batchCalls.push(String(s));
      return statements.map(() => ({ success: true, meta: {} }));
    },
    __batchCalls: batchCalls,
  } as unknown as D1Database & { __batchCalls: string[] };
}

function makeRequest(auth: JwtPayload): Request & { auth: JwtPayload } {
  const req = new Request('https://internal/auth/family', { method: 'DELETE' }) as Request & { auth: JwtPayload };
  req.auth = auth;
  return req;
}

describe('handleDeleteFamily', () => {
  it('rejects non-lead callers', async () => {
    const db = makeMockDb({ callerRole: { parent_role: 'co_parent' }, otherParentsCount: 1 });
    const env = { DB: db } as unknown as Env;
    const res = await handleDeleteFamily(makeRequest({ sub: 'u1', family_id: 'f1' } as JwtPayload), env);
    expect(res.status).toBe(403);
  });

  it('sole parent: soft-deletes the whole family', async () => {
    const db = makeMockDb({ callerRole: { parent_role: 'lead' }, otherParentsCount: 0 });
    const env = { DB: db } as unknown as Env;
    const res = await handleDeleteFamily(makeRequest({ sub: 'u1', family_id: 'f1' } as JwtPayload), env);
    expect(res.status).toBe(200);
    expect(db.__batchCalls.some(s => s.includes('UPDATE families SET deleted_at'))).toBe(true);
  });

  it('lead with a co-parent remaining: promotes co-parent, does not block', async () => {
    const db = makeMockDb({ callerRole: { parent_role: 'lead' }, otherParentsCount: 1, coparentUserId: 'coparent-1' });
    const env = { DB: db } as unknown as Env;
    const res = await handleDeleteFamily(makeRequest({ sub: 'lead-1', family_id: 'f1' } as JwtPayload), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string; promoted_user_id?: string };
    expect(body.action).toBe('lead_transferred');
    expect(body.promoted_user_id).toBe('coparent-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/routes/auth.test.ts -t handleDeleteFamily`
Expected: FAIL on the third test — current code returns 403 ("All co-parents must leave...") instead of promoting.

- [ ] **Step 3: Refactor `handleDeleteFamily`**

Replace `worker/src/routes/auth.ts:1116-1170` (the existing `handleDeleteFamily` function) with:

```ts
// ----------------------------------------------------------------
// DELETE /auth/family
// Soft-deletes the family (sole-parent case) or, if a co-parent remains,
// promotes them to lead and anonymises only the departing lead's row.
// Lead-only. Shares execution logic with the public DSAR portal
// (worker/src/lib/dsarExecution.ts) so behavior never drifts between the
// authenticated and unauthenticated entry points.
// ----------------------------------------------------------------
export async function handleDeleteFamily(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = (request as Request & { auth?: JwtPayload }).auth;
  if (!auth) return error('Authorisation required', 401);

  const userId   = auth.sub;
  const familyId = auth.family_id;

  const callerRole = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(userId, familyId)
    .first<{ parent_role: string | null }>();

  if (!callerRole || callerRole.parent_role !== 'lead') {
    return error('Only a Lead parent can delete the family.', 403);
  }

  const otherParents = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  if ((otherParents?.cnt ?? 0) === 0) {
    await executeFamilyErasureSoleParent(env, familyId);
    return json({ ok: true, action: 'uprooted' });
  }

  const result = await executeFamilyErasureLeadWithCoparent(env, familyId, userId);
  if ('error' in result) return error(result.error, 409);
  return json({ ok: true, action: 'lead_transferred', promoted_user_id: result.promotedUserId });
}
```

- [ ] **Step 4: Add the import**

Near the top of `worker/src/routes/auth.ts`, alongside other local imports:

```ts
import { executeFamilyErasureSoleParent, executeFamilyErasureLeadWithCoparent } from '../lib/dsarExecution.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/routes/auth.test.ts -t handleDeleteFamily`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd worker
git add src/routes/auth.ts src/routes/auth.test.ts
git commit -m "fix: handleDeleteFamily promotes remaining co-parent instead of blocking deletion"
```

---

### Task 4: DSAR email senders

**Files:**
- Create: `worker/src/lib/dsarEmail.ts`

**Interfaces:**
- Consumes: `Env.RESEND_API_KEY`.
- Produces: `sendDsarVerificationEmail(to, link, requestType, env)`, `sendDsarClarificationEmail(to, env)`, `sendDsarAccessLinkEmail(to, downloadUrl, env)` — all `Promise<void>`, throw on non-2xx Resend response.

- [ ] **Step 1: Write the implementation**

No separate unit test — this module is exercised via the Task 6 route tests (which mock `fetch`), consistent with how `auth.ts`'s `sendMagicLinkEmail` is untested in isolation today.

```ts
// worker/src/lib/dsarEmail.ts
//
// Resend-backed email senders for the DSAR portal. Mirrors the inline
// pattern used by sendMagicLinkEmail in worker/src/routes/auth.ts.

import type { Env } from '../types.js';

async function sendEmail(to: string, subject: string, html: string, env: Env): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: 'Morechard <noreply@mail.morechard.com>', to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

export async function sendDsarVerificationEmail(
  to: string,
  link: string,
  requestType: 'access' | 'erasure',
  env: Env,
): Promise<void> {
  const action = requestType === 'erasure' ? 'delete your data' : 'export your data';
  await sendEmail(
    to,
    'Confirm your Morechard data request',
    `<p>Click the link below to confirm your request to ${action}. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can safely ignore this email — no action will be taken.</p>`,
    env,
  );
}

export async function sendDsarClarificationEmail(to: string, env: Env): Promise<void> {
  await sendEmail(
    to,
    'We need more detail on your Morechard data request',
    `<p>We couldn't match the child's name you provided to exactly one child on the account. Please submit a new request using the child's exact in-app display name, or contact <a href="mailto:support@morechard.com">support@morechard.com</a> for help.</p>`,
    env,
  );
}

export async function sendDsarAccessLinkEmail(to: string, downloadUrl: string, env: Env): Promise<void> {
  await sendEmail(
    to,
    'Your Morechard data export is ready',
    `<p>Your data export is ready to download.</p><p><a href="${downloadUrl}">${downloadUrl}</a></p><p>This link expires in 1 hour for your security. If it expires before you use it, submit a new request.</p>`,
    env,
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd worker
git add src/lib/dsarEmail.ts
git commit -m "feat: add DSAR email senders"
```

---

### Task 5: `POST /api/dsar/request`

**Files:**
- Create: `worker/src/routes/dsar.ts`
- Test: `worker/src/routes/dsar.test.ts`

**Interfaces:**
- Consumes: `sendDsarVerificationEmail` from `../lib/dsarEmail.js`; `sha256` from `../lib/hash.js`; `nanoid` from `../lib/nanoid.js`; `json`, `error`, `parseBody` from `../lib/response.js`.
- Produces: `handleDsarRequest(request: Request, env: Env): Promise<Response>`, exported constant `DSAR_TOKEN_EXPIRY_S = 3600`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/routes/dsar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDsarRequest } from './dsar.js';
import type { Env } from '../types.js';

function makeMockDb(matchedParent: { user_id: string; family_id: string } | null) {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM users u JOIN family_roles')) return matchedParent as T;
              return null as T;
            },
            async run() {
              if (sql.startsWith('INSERT INTO dsar_requests')) inserted.push({ args });
              return { success: true, meta: {} };
            },
          };
        },
      };
    },
    __inserted: inserted,
  } as unknown as D1Database & { __inserted: unknown[] };
}

describe('handleDsarRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  it('returns the generic response and creates no row for an unmatched email', async () => {
    const db = makeMockDb(null);
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', request_type: 'erasure', scope: 'family' }),
    });
    const res = await handleDsarRequest(req, env);
    expect(res.status).toBe(200);
    expect(db.__inserted.length).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates a row and sends a verification email for a matched parent email', async () => {
    const db = makeMockDb({ user_id: 'parent-1', family_id: 'fam-1' });
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'parent@example.com', request_type: 'erasure', scope: 'family' }),
    });
    const res = await handleDsarRequest(req, env);
    expect(res.status).toBe(200);
    expect(db.__inserted.length).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a child-scope request with no child_name', async () => {
    const db = makeMockDb({ user_id: 'parent-1', family_id: 'fam-1' });
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'parent@example.com', request_type: 'erasure', scope: 'child' }),
    });
    const res = await handleDsarRequest(req, env);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/routes/dsar.test.ts`
Expected: FAIL — `Cannot find module './dsar.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/routes/dsar.ts
//
// Public (unauthenticated) DSAR portal routes.
// See docs/superpowers/specs/2026-07-17-dsar-portal-design.md

import type { Env } from '../types.js';
import { json, error, parseBody } from '../lib/response.js';
import { sha256 } from '../lib/hash.js';
import { nanoid } from '../lib/nanoid.js';
import {
  sendDsarVerificationEmail,
  sendDsarClarificationEmail,
  sendDsarAccessLinkEmail,
} from '../lib/dsarEmail.js';
import {
  resolveChildByName,
  executeFamilyErasureSoleParent,
  executeFamilyErasureLeadWithCoparent,
  executeFamilyErasureNonLeadCoparent,
  executeChildErasure,
} from '../lib/dsarExecution.js';
import { handleExportJson } from './export.js';

export const DSAR_TOKEN_EXPIRY_S = 60 * 60; // 1 hour

const GENERIC_RESPONSE = {
  ok: true,
  message: 'If that email is on an account, you will receive a verification link shortly.',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function handleDsarRequest(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid request body', 400);

  const email = String(body.email ?? '').trim().toLowerCase();
  const requestType = body.request_type;
  const scope = body.scope;
  const childName = typeof body.child_name === 'string' ? body.child_name.trim() : undefined;

  if (!isValidEmail(email)) return error('A valid email address is required', 400);
  if (requestType !== 'access' && requestType !== 'erasure') {
    return error('request_type must be "access" or "erasure"', 400);
  }
  if (scope !== 'family' && scope !== 'child') return error('scope must be "family" or "child"', 400);
  if (scope === 'child' && !childName) return error('child_name is required when scope is "child"', 400);

  const parent = await env.DB
    .prepare(
      `SELECT u.id AS user_id, u.family_id FROM users u
       JOIN family_roles fr ON fr.user_id = u.id AND fr.family_id = u.family_id
       WHERE u.email = ? AND fr.role = 'parent'`,
    )
    .bind(email)
    .first<{ user_id: string; family_id: string }>();

  if (!parent) return json(GENERIC_RESPONSE);

  const rawToken = nanoid(32);
  const tokenHash = await sha256(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid(21);

  await env.DB
    .prepare(
      `INSERT INTO dsar_requests
         (id, request_type, scope, target_family_id, target_child_name_raw, requester_email, matched_user_id, token_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?)`,
    )
    .bind(id, requestType, scope, parent.family_id, scope === 'child' ? childName : null, email, parent.user_id, tokenHash, now)
    .run();

  const link = `${env.APP_URL}/api/dsar/verify?token=${rawToken}`;
  await sendDsarVerificationEmail(email, link, requestType, env);

  return json(GENERIC_RESPONSE);
}

interface DsarRequestRow {
  id: string;
  request_type: 'access' | 'erasure';
  scope: 'family' | 'child';
  target_family_id: string;
  target_child_name_raw: string | null;
  requester_email: string;
  matched_user_id: string;
}

function htmlResult(message: string, success: boolean): Response {
  return new Response(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
      <h2>${success ? 'Request received' : 'Unable to process request'}</h2>
      <p>${message}</p>
    </body></html>`,
    { status: success ? 200 : 400, headers: { 'Content-Type': 'text/html' } },
  );
}

export async function handleDsarVerify(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return htmlResult('Missing verification token.', false);

  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);

  // Atomic claim — first statement, before any other work. Prevents a
  // double-click or email-prefetch from running execution twice: only the
  // instance that flips 0 pending_verification rows to processing loses.
  const claim = await env.DB
    .prepare(
      `UPDATE dsar_requests SET status = 'processing', verified_at = ?
       WHERE token_hash = ? AND status = 'pending_verification' AND created_at > ?`,
    )
    .bind(now, tokenHash, now - DSAR_TOKEN_EXPIRY_S)
    .run();

  if (!claim.meta.changes) {
    return htmlResult('This link has already been used or has expired. Please submit a new request.', false);
  }

  const dsarRequest = await env.DB
    .prepare(`SELECT id, request_type, scope, target_family_id, target_child_name_raw, requester_email, matched_user_id FROM dsar_requests WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<DsarRequestRow>();

  if (!dsarRequest) return htmlResult('Request not found.', false);

  try {
    if (dsarRequest.request_type === 'erasure') {
      await executeErasure(env, dsarRequest);
    } else {
      await executeAccess(env, dsarRequest);
    }
  } catch (err) {
    console.error('[dsar] execution failed', err);
    return htmlResult('Something went wrong processing your request. Please contact support@morechard.com.', false);
  }

  return htmlResult('Your request has been processed. Check your email for confirmation.', true);
}

async function executeErasure(env: Env, req: DsarRequestRow): Promise<void> {
  if (req.scope === 'family') {
    const roleRow = await env.DB
      .prepare(`SELECT parent_role FROM family_roles WHERE family_id = ? AND user_id = ? AND role = 'parent'`)
      .bind(req.target_family_id, req.matched_user_id)
      .first<{ parent_role: string | null }>();

    const otherParents = await env.DB
      .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND user_id != ?`)
      .bind(req.target_family_id, req.matched_user_id)
      .first<{ cnt: number }>();

    if ((otherParents?.cnt ?? 0) === 0) {
      await executeFamilyErasureSoleParent(env, req.target_family_id);
    } else if (roleRow?.parent_role === 'lead') {
      await executeFamilyErasureLeadWithCoparent(env, req.target_family_id, req.matched_user_id);
    } else {
      await executeFamilyErasureNonLeadCoparent(env, req.target_family_id, req.matched_user_id);
    }
  } else {
    const match = await resolveChildByName(env, req.target_family_id, req.target_child_name_raw ?? '');
    if (match.matched !== 'one') {
      await env.DB.prepare(`UPDATE dsar_requests SET status = 'needs_clarification' WHERE id = ?`).bind(req.id).run();
      await sendDsarClarificationEmail(req.requester_email, env);
      return;
    }
    await executeChildErasure(env, match.childId as string);
  }

  await env.DB
    .prepare(`UPDATE dsar_requests SET status = 'completed', executed_at = unixepoch() WHERE id = ?`)
    .bind(req.id)
    .run();
}

async function executeAccess(env: Env, req: DsarRequestRow): Promise<void> {
  const exportResponse = await handleExportJson(
    new Request(`https://internal/api/export/json?family_id=${req.target_family_id}`),
    env,
  );
  const payload = await exportResponse.text();
  const key = `dsar-exports/${req.id}.json`;
  await env.DSAR_EXPORTS.put(key, payload, { httpMetadata: { contentType: 'application/json' } });

  // createSignedUrl is a Cloudflare R2 runtime method not yet fully typed in
  // workers-types — same pattern as worker/src/routes/sharedExpenseReceipt.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url: string = await (env.DSAR_EXPORTS as unknown as any).createSignedUrl(key, { expiresIn: 3600 });

  await sendDsarAccessLinkEmail(req.requester_email, url, env);

  await env.DB
    .prepare(`UPDATE dsar_requests SET status = 'completed', executed_at = unixepoch() WHERE id = ?`)
    .bind(req.id)
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/routes/dsar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd worker
git add src/routes/dsar.ts src/routes/dsar.test.ts
git commit -m "feat: add POST /api/dsar/request"
```

---

### Task 6: `GET /api/dsar/verify` — race condition, needs_clarification, access flow tests

**Files:**
- Modify: `worker/src/routes/dsar.test.ts` (adds tests for `handleDsarVerify`, already implemented in Task 5)

**Interfaces:**
- Consumes: `handleDsarVerify` (already implemented in Task 5's `dsar.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/routes/dsar.test.ts`:

```ts
import { handleDsarVerify } from './dsar.js';
import { sha256 } from '../lib/hash.js';

function makeVerifyMockDb(opts: {
  claimChanges: number;
  requestRow: Record<string, unknown> | null;
  otherParentsCount?: number;
  parentRole?: string | null;
  childMatches?: Array<{ id: string }>;
}) {
  const updates: string[] = [];
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async run() {
              if (sql.startsWith("UPDATE dsar_requests SET status = 'processing'")) {
                return { success: true, meta: { changes: opts.claimChanges } };
              }
              updates.push(sql);
              return { success: true, meta: { changes: 1 } };
            },
            async first<T>() {
              if (sql.includes('SELECT id, request_type, scope')) return opts.requestRow as T;
              if (sql.includes('COUNT(*) AS cnt')) return { cnt: opts.otherParentsCount ?? 0 } as T;
              if (sql.includes('SELECT parent_role FROM family_roles')) return { parent_role: opts.parentRole ?? 'lead' } as T;
              return null as T;
            },
            async all<T>() {
              return { results: (opts.childMatches ?? []) as T[] };
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) { return statements.map(() => ({ success: true, meta: {} })); },
    __updates: updates,
  } as unknown as D1Database & { __updates: string[] };
}

describe('handleDsarVerify', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  it('returns a no-op response when the claim affects 0 rows (already used / expired / race loser)', async () => {
    const db = makeVerifyMockDb({ claimChanges: 0, requestRow: null });
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/verify?token=abc');
    const res = await handleDsarVerify(req, env);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('already been used or has expired');
  });

  it('erasure, family scope, sole parent: completes', async () => {
    const db = makeVerifyMockDb({
      claimChanges: 1,
      requestRow: { id: 'req-1', request_type: 'erasure', scope: 'family', target_family_id: 'fam-1', matched_user_id: 'parent-1', target_child_name_raw: null, requester_email: 'p@x.com' },
      otherParentsCount: 0,
    });
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/verify?token=abc');
    const res = await handleDsarVerify(req, env);
    expect(res.status).toBe(200);
    expect(db.__updates.some(s => s.includes("status = 'completed'"))).toBe(true);
  });

  it('erasure, child scope, ambiguous name match: sets needs_clarification, does not erase', async () => {
    const db = makeVerifyMockDb({
      claimChanges: 1,
      requestRow: { id: 'req-2', request_type: 'erasure', scope: 'child', target_family_id: 'fam-1', matched_user_id: 'parent-1', target_child_name_raw: 'Ben', requester_email: 'p@x.com' },
      childMatches: [{ id: 'c1' }, { id: 'c2' }],
    });
    const env = { DB: db, RESEND_API_KEY: 'k', APP_URL: 'https://app.morechard.com' } as unknown as Env;
    const req = new Request('https://internal/api/dsar/verify?token=abc');
    const res = await handleDsarVerify(req, env);
    expect(res.status).toBe(200);
    expect(db.__updates.some(s => s.includes("status = 'needs_clarification'"))).toBe(true);
    expect(db.__updates.some(s => s.includes("status = 'completed'"))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // clarification email only
  });

  it('access request: generates export, stores in R2, emails a signed URL', async () => {
    const db = makeVerifyMockDb({
      claimChanges: 1,
      requestRow: { id: 'req-3', request_type: 'access', scope: 'family', target_family_id: 'fam-1', matched_user_id: 'parent-1', target_child_name_raw: null, requester_email: 'p@x.com' },
    });
    const put = vi.fn(async () => undefined);
    const createSignedUrl = vi.fn(async () => 'https://r2.example.com/signed');
    const env = {
      DB: db,
      RESEND_API_KEY: 'k',
      APP_URL: 'https://app.morechard.com',
      DSAR_EXPORTS: { put, createSignedUrl } as unknown as R2Bucket,
    } as unknown as Env;
    const req = new Request('https://internal/api/dsar/verify?token=abc');
    const res = await handleDsarVerify(req, env);
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('dsar-exports/req-3.json', { expiresIn: 3600 });
    expect(fetch).toHaveBeenCalledTimes(1); // access-link email
  });
});
```

Note: this test file calls `handleExportJson` indirectly via `handleDsarVerify`'s access branch — since `export.ts` isn't mocked here, add a minimal stub at the top of the access-request test file scope is unnecessary because `handleExportJson` only touches `env.DB`, which the shared mock already answers with `null`/empty results for any unmatched query, producing a valid (if sparse) JSON body. This is acceptable for this route-level test; Task 5/6 tests assert on `handleDsarVerify`'s own behavior (claim, dispatch, R2 calls), not on `export.ts`'s payload contents, which already has its own coverage.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/routes/dsar.test.ts`
Expected: the 4 new tests FAIL or reveal mismatches against the Task 5 implementation (e.g. `sha256` import unused warning, or a mismatch in mocked `first()` routing) — inspect failures and adjust the mock `first()`/`all()` substring routing in this test file only (not `dsar.ts`) until they accurately reflect the implementation's query shapes.

- [ ] **Step 3: Fix any mismatches and re-run**

Run: `cd worker && npx vitest run src/routes/dsar.test.ts`
Expected: PASS (7 tests total across both `handleDsarRequest` and `handleDsarVerify`).

- [ ] **Step 4: Commit**

```bash
cd worker
git add src/routes/dsar.test.ts
git commit -m "test: cover DSAR verify race condition, needs_clarification, and access flow"
```

---

### Task 7: Wire routes into the Worker

**Files:**
- Modify: `worker/src/index.ts:556-568` (route table)

**Interfaces:**
- Consumes: `handleDsarRequest`, `handleDsarVerify` from `./routes/dsar.js`.

- [ ] **Step 1: Add the import**

In `worker/src/index.ts`, near the other route imports (e.g. after the `market-rates.js` import block around line 186):

```ts
import { handleDsarRequest, handleDsarVerify } from './routes/dsar.js';
```

- [ ] **Step 2: Register the routes**

In the `route()` function's public section, after line 568 (`handleWebauthnLoginVerify`):

```ts
  if (path === '/auth/webauthn/login/verify' && method === 'POST') return handleWebauthnLoginVerify(request, env);

  // DSAR portal — public, no auth. Identity is verified via the emailed
  // token, not a session. See docs/superpowers/specs/2026-07-17-dsar-portal-design.md
  if (path === '/api/dsar/request' && method === 'POST') return handleDsarRequest(request, env);
  if (path === '/api/dsar/verify'  && method === 'GET')  return handleDsarVerify(request, env);
```

- [ ] **Step 3: Type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd worker
git add src/index.ts
git commit -m "feat: register DSAR portal routes"
```

---

### Task 8: Deferred child-scope purge cron

**Files:**
- Modify: `worker/src/jobs/familyPurge.ts`
- Test: Create `worker/src/jobs/familyPurge.test.ts`
- Modify: `worker/src/index.ts` (scheduled handler)

**Interfaces:**
- Produces: `runChildDsarPurge(env: Env, nowEpoch: number): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/jobs/familyPurge.test.ts
import { describe, it, expect } from 'vitest';
import { runChildDsarPurge } from './familyPurge.js';
import type { Env } from '../types.js';

function makeMockDb(pendingChildren: Array<{ id: string }>) {
  const batchCalls: string[] = [];
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async all<T>() {
              if (sql.includes('purge_pending_at')) return { results: pendingChildren as T[] };
              return { results: [] as T[] };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ toString(): string }>) {
      for (const s of statements) batchCalls.push(String(s));
      return statements.map(() => ({ success: true, meta: {} }));
    },
    __batchCalls: batchCalls,
  } as unknown as D1Database & { __batchCalls: string[] };
}

describe('runChildDsarPurge', () => {
  it('does nothing when no children are past the 30-day window', async () => {
    const db = makeMockDb([]);
    const env = { DB: db } as unknown as Env;
    await runChildDsarPurge(env, 1_800_000_000);
    expect((db as unknown as { __batchCalls: string[] }).__batchCalls.length).toBe(0);
  });

  it('hard-deletes bulk child-keyed tables and the users row, never the ledger', async () => {
    const db = makeMockDb([{ id: 'child-1' }]);
    const env = { DB: db } as unknown as Env;
    await runChildDsarPurge(env, 1_800_000_000);
    const calls = (db as unknown as { __batchCalls: string[] }).__batchCalls;
    expect(calls.some(s => s.includes('chat_history'))).toBe(true);
    expect(calls.some(s => s.includes('DELETE FROM users WHERE id'))).toBe(true);
    expect(calls.some(s => s.toLowerCase().includes('ledger'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/jobs/familyPurge.test.ts`
Expected: FAIL — `runChildDsarPurge` is not exported.

- [ ] **Step 3: Add `runChildDsarPurge` to `familyPurge.ts`**

Append to `worker/src/jobs/familyPurge.ts` (after the existing `runLedgerPurge` function):

```ts
/**
 * Stage 1b — T+30 days, single-child DSAR erasures.
 *
 * A child-scope DSAR request anonymises the child's users row immediately
 * (worker/src/lib/dsarExecution.ts::executeChildErasure) and sets
 * purge_pending_at. This sweep hard-deletes the bulk child-keyed tables and
 * the users row itself 30 days later — mirroring the family-scope pattern
 * in runSoftDeletePurge, but scoped to one child instead of a whole family.
 * Ledger rows are NEVER touched: `ledger.child_id` keeps pointing at the
 * same (now-deleted) id, exactly as it already does for family-scope purges.
 */
export async function runChildDsarPurge(env: Env, nowEpoch: number): Promise<void> {
  const cutoff30 = nowEpoch - THIRTY_DAYS_S;

  const rows = await env.DB
    .prepare(`SELECT id FROM users WHERE purge_pending_at IS NOT NULL AND purge_pending_at < ?`)
    .bind(cutoff30)
    .all<{ id: string }>();

  if (!rows.results.length) return;

  for (const { id: childId } of rows.results) {
    const childKeyedTables = [
      'chat_history',
      'unlocked_modules',
      'lesson_completions',
      'module_act_progress',
      'chat_rate_limits',
      'user_settings',
      'account_locks',
      'child_badges',
      'child_streaks',
      'child_nudges',
    ];
    const batch: D1PreparedStatement[] = childKeyedTables.map(table =>
      env.DB.prepare(`DELETE FROM ${table} WHERE child_id = ?`).bind(childId),
    );
    batch.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(childId));
    batch.push(env.DB.prepare(`DELETE FROM family_roles WHERE user_id = ?`).bind(childId));
    batch.push(env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(childId));

    await env.DB.batch(batch);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/jobs/familyPurge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the cron handler**

In `worker/src/index.ts`, update the import at line 189:

```ts
import { runSoftDeletePurge, runLedgerPurge, runChildDsarPurge } from './jobs/familyPurge.js';
```

And after line 372 (`await runLedgerPurge(env, now);`):

```ts
        await runSoftDeletePurge(env, now);
        await runLedgerPurge(env, now);

        // ── 10b. Single-child DSAR erasures — deferred bulk purge ────────
        // Companion to Stage 1 above: hard-deletes bulk child-keyed data for
        // children anonymised via a child-scope DSAR request 30+ days ago.
        await runChildDsarPurge(env, now);
```

- [ ] **Step 6: Type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd worker
git add src/jobs/familyPurge.ts src/jobs/familyPurge.test.ts src/index.ts
git commit -m "feat: sweep single-child DSAR erasures in the daily purge cron"
```

---

### Task 9: Public request form + privacy policy link

**Files:**
- Create: `marketing/src/dsar.html`
- Modify: `marketing/src/privacy-policy.html:150`

**Interfaces:**
- Consumes: `POST https://morechard-api.darren-savery.workers.dev/api/dsar/request` (Task 5/7).

- [ ] **Step 1: Create the form page**

```html
<!--
  TITLE: Request Your Data – Morechard
  DESCRIPTION: Request a copy of your Morechard data or ask us to delete it.
  CANONICAL: https://morechard.com/dsar
  PAGE_CSS: page.css
-->

<!-- BODY_START -->
<main class="prose-page container">
  <h1>Request Your Data</h1>
  <p class="prose-meta">Export a copy of your family's data, or ask us to delete it.</p>

  <div class="prose-tldr">
    <ul>
      <li>Enter the email address on your Morechard parent account — we'll send a confirmation link to verify it's really you.</li>
      <li>You can request your whole family's data, or just one child's.</li>
      <li>Erasure requests are processed automatically once you confirm — there's no waiting on us.</li>
      <li>Read more about how erasure works with our tamper-evident ledger in our <a href="/privacy-policy#cookies">Privacy Policy</a>, Section 8.</li>
    </ul>
  </div>

  <form id="dsar-form" style="max-width:480px;">
    <label for="dsar-email">Email address on your Morechard account</label><br>
    <input type="email" id="dsar-email" name="email" required style="width:100%;padding:10px;margin:8px 0 16px;">

    <fieldset style="margin-bottom:16px;">
      <legend>What would you like to do?</legend>
      <label><input type="radio" name="request_type" value="access" checked> Get a copy of my data</label><br>
      <label><input type="radio" name="request_type" value="erasure"> Delete my data</label>
    </fieldset>

    <fieldset style="margin-bottom:16px;">
      <legend>Scope</legend>
      <label><input type="radio" name="scope" value="family" checked> My whole family</label><br>
      <label><input type="radio" name="scope" value="child"> Just one child</label>
    </fieldset>

    <div id="dsar-child-name-wrap" style="display:none;margin-bottom:16px;">
      <label for="dsar-child-name">Child's exact in-app display name</label><br>
      <input type="text" id="dsar-child-name" name="child_name" style="width:100%;padding:10px;margin:8px 0;">
    </div>

    <button type="submit" id="dsar-submit">Submit request</button>
    <p id="dsar-error" style="color:#c0392b;display:none;"></p>
  </form>

  <div id="dsar-success" style="display:none;">
    <h2>Check your email</h2>
    <p>If that email is on an account, you'll receive a verification link shortly. Click it to confirm your request — nothing happens until you do.</p>
  </div>
</main>
<!-- BODY_END -->

<!-- SCRIPTS_START -->
<script>
(function() {
  const form       = document.getElementById('dsar-form');
  const errorEl    = document.getElementById('dsar-error');
  const successEl  = document.getElementById('dsar-success');
  const submitBtn  = document.getElementById('dsar-submit');
  const scopeRadios = form.querySelectorAll('input[name="scope"]');
  const childWrap  = document.getElementById('dsar-child-name-wrap');
  const childInput = document.getElementById('dsar-child-name');

  scopeRadios.forEach(r => r.addEventListener('change', () => {
    const isChild = form.querySelector('input[name="scope"]:checked').value === 'child';
    childWrap.style.display = isChild ? 'block' : 'none';
    childInput.required = isChild;
  }));

  function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
  function clearError() { errorEl.style.display = 'none'; }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const email = document.getElementById('dsar-email').value.trim();
    const requestType = form.querySelector('input[name="request_type"]:checked').value;
    const scope = form.querySelector('input[name="scope"]:checked').value;
    const childName = childInput.value.trim();

    submitBtn.disabled = true;
    try {
      const res = await fetch('https://morechard-api.darren-savery.workers.dev/api/dsar/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          request_type: requestType,
          scope,
          child_name: scope === 'child' ? childName : undefined,
        }),
      });
      if (res.ok) {
        form.style.display = 'none';
        successEl.style.display = 'block';
      } else {
        const data = await res.json().catch(() => ({}));
        showError(data.error || 'Something went wrong — please try again.');
        submitBtn.disabled = false;
      }
    } catch {
      showError('Something went wrong — please check your connection and try again.');
      submitBtn.disabled = false;
    }
  });
})();
</script>
<!-- SCRIPTS_END -->
```

- [ ] **Step 2: Link from the privacy policy**

In `marketing/src/privacy-policy.html`, replace line 150:

```html
  <p>To exercise any right, email <a href="mailto:support@morechard.com">support@morechard.com</a>. We will respond within one calendar month.</p>
```

with:

```html
  <p>To exercise any right, use our <a href="/dsar">self-service data request form</a> to export or delete your data — erasure requests are processed automatically once you confirm by email. For any other request, email <a href="mailto:support@morechard.com">support@morechard.com</a>. We will respond within one calendar month.</p>
```

- [ ] **Step 3: Verify the marketing site builds**

Run:
```bash
cd marketing
npm run build
```
Expected: build succeeds, `dist/dsar.html` and `dist/privacy-policy.html` are produced with the new content.

- [ ] **Step 4: Commit**

```bash
git add marketing/src/dsar.html marketing/src/privacy-policy.html
git commit -m "feat: add public DSAR request form, link from privacy policy"
```

---

### Task 10: Manual end-to-end verification (morechard-dev only)

**Files:** none — this is a verification pass, not a code change.

- [ ] **Step 1: Run the full worker test suite**

Run: `cd worker && npm test`
Expected: all tests pass, including every test added in Tasks 2, 3, 5, 6, 8.

- [ ] **Step 2: Deploy a preview version**

Run:
```bash
cd worker
npm run deploy:preview
```
Expected: a preview URL is printed; note it for the manual walkthrough below (or use the local `wrangler dev --remote` worker if preview isn't reachable).

- [ ] **Step 3: Seed a test parent + child in morechard-dev**

Confirm a known test family exists (e.g. via `npm run seed:m13` from repo root, or query for an existing dev family):
```bash
cd worker
npx wrangler d1 execute morechard-dev --remote --command="SELECT u.email, u.family_id FROM users u JOIN family_roles fr ON fr.user_id = u.id WHERE fr.role='parent' AND u.email IS NOT NULL LIMIT 1;"
```
Expected: at least one row with a real email you can receive mail at (use your own test inbox on the dev family if none exists).

- [ ] **Step 4: Submit an access request**

`POST` to the preview worker's `/api/dsar/request` with `{ "email": "<test-parent-email>", "request_type": "access", "scope": "family" }`. Confirm:
- Response is the generic 200 message.
- An email arrives with a confirm link.
- Clicking the link returns the "request received" HTML page.
- `npx wrangler r2 object get morechard-dsar-exports-dev dsar-exports/<request-id>.json --remote` (from the dev bucket) returns the export payload.
- A second follow-up email with a signed download URL arrives; opening it in a browser downloads the JSON.

- [ ] **Step 5: Submit an erasure request (child scope) against a disposable test child**

Create a throwaway child on the test family first (via the app UI in dev), then submit `{ "email": "<test-parent-email>", "request_type": "erasure", "scope": "child", "child_name": "<exact child display name>" }`. Confirm:
- Confirmation email arrives, clicking it succeeds.
- `npx wrangler d1 execute morechard-dev --remote --command="SELECT display_name, purge_pending_at FROM users WHERE id='<child-id>';"` shows `display_name = 'Deleted Child'` and a non-null `purge_pending_at`.
- The child's row in `ledger` (if any) is unchanged — spot check with `SELECT * FROM ledger WHERE child_id='<child-id>' LIMIT 1;` before and after, confirm identical `record_hash`.

- [ ] **Step 6: Confirm the double-click race guard**

Click the same confirmation link twice in a row (or curl it twice). Confirm the second response is the "already been used or has expired" page and no second execution occurs (check `dsar_requests.executed_at` doesn't change between the two attempts).

- [ ] **Step 7: Record results and promote**

If all checks pass, promote the preview version:
```bash
cd worker
npm run deploy:promote
```
This shifts live traffic to the version containing the DSAR portal.
