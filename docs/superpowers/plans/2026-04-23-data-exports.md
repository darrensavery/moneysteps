# Data & Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the Data & Exports screen end-to-end — ungating Family Summary, adding the Shield SKU, enforcing server-side tier checks, extracting export state into a hook, and implementing Data Pruning with PII-safe archiving.

**Architecture:** All export logic lives in `worker/src/routes/export.ts`; the new `handleExportPrune` function is added there. The frontend hook `useExportManager` owns download state and replaces inline state in `DataSettings.tsx`. Two D1 migrations add the `has_shield` column and the prune archive table while replacing the immutable ledger trigger with a targeted one that still protects hash-chain columns.

**Tech Stack:** React (hooks, no new libraries), Cloudflare Workers (D1, Web Crypto), TypeScript, existing `authHeaders`/`apiUrl` helpers, existing `SectionCard`/`SettingsRow` UI primitives.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `app/src/hooks/useExportManager.ts` | Download state machine + prune call |
| **Modify** | `app/src/components/settings/sections/DataSettings.tsx` | Use hook, new props, copy, pruning confirm UI |
| **Modify** | `app/src/components/dashboard/ParentSettingsTab.tsx` | Pass `hasShield`, wire `onNavigateToPlan` |
| **Modify** | `app/src/lib/api.ts` | Add `has_shield`, remove `has_legal_bundle` on `TrialStatus` |
| **Modify** | `worker/src/types.ts` | Add `SHIELD` to `PaymentType`, `has_shield` to interfaces |
| **Modify** | `worker/src/routes/stripe.ts` | Add `SHIELD` product + webhook handler branch |
| **Modify** | `worker/src/routes/export.ts` | Tier gate enforcement + `handleExportPrune` |
| **Modify** | `worker/src/lib/trial.ts` | Read `has_shield` from DB, return in `TrialStatus` |
| **Modify** | `worker/src/index.ts` | Register `POST /api/export/prune` route |
| **Create** | `worker/migrations/0038_shield_sku.sql` | `ALTER TABLE families ADD COLUMN has_shield` |
| **Create** | `worker/migrations/0039_prune_archive.sql` | Prune archive table + `pruned_at` on ledger + trigger replacement |

---

## Task 1: D1 Migration — Shield SKU column

**Files:**
- Create: `worker/migrations/0038_shield_sku.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 0038: Shield SKU
-- Adds has_shield flag to families for the one-off £149.99 Shield plan.
-- Default 0 (false) — existing rows are unaffected.
ALTER TABLE families ADD COLUMN has_shield INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply migration locally**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npx wrangler d1 execute morechard-db --local --file=worker/migrations/0038_shield_sku.sql
```

Expected: `✅ Applied migration 0038_shield_sku.sql`

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0038_shield_sku.sql
git commit -m "feat(db): add has_shield column to families"
```

---

## Task 2: D1 Migration — Prune archive table + ledger trigger replacement

**Files:**
- Create: `worker/migrations/0039_prune_archive.sql`

The `ledger` table has a `BEFORE UPDATE` trigger from migration 0001 that aborts **all** updates. This migration drops it and replaces it with a targeted trigger that only protects the five hash-chain columns (`record_hash`, `previous_hash`, `amount`, `currency`, `entry_type`). The prune UPDATE writes to `description`, `ip_address`, `receipt_id`, and `pruned_at` — none of which are in the protected set.

- [ ] **Step 1: Create migration file**

```sql
-- Migration 0039: Ledger prune archive + targeted immutability trigger
--
-- 1. Stores record_hash + previous_hash before PII scrub (hash-chain integrity).
-- 2. Adds pruned_at column so the UI can detect archived rows.
-- 3. Replaces the blanket BEFORE UPDATE trigger with one that only protects
--    hash-chain columns, allowing the prune UPDATE to zero PII columns.

CREATE TABLE IF NOT EXISTS ledger_prune_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id     INTEGER NOT NULL,
  record_hash   TEXT    NOT NULL,
  previous_hash TEXT    NOT NULL,
  archived_at   INTEGER NOT NULL
);

ALTER TABLE ledger ADD COLUMN pruned_at INTEGER;

-- Drop the blanket immutability trigger from 0001_initial_schema.sql
DROP TRIGGER IF EXISTS ledger_no_update;

-- Replace with a targeted trigger that only guards hash-chain integrity columns.
-- Updates to description, ip_address, receipt_id, pruned_at are permitted.
CREATE TRIGGER IF NOT EXISTS ledger_no_update_chain
  BEFORE UPDATE OF record_hash, previous_hash, amount, currency, entry_type ON ledger
BEGIN
  SELECT RAISE(ABORT, 'Ledger hash-chain columns are immutable.');
END;
```

- [ ] **Step 2: Apply migration locally**

```bash
npx wrangler d1 execute morechard-db --local --file=worker/migrations/0039_prune_archive.sql
```

Expected: `✅ Applied migration 0039_prune_archive.sql`

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0039_prune_archive.sql
git commit -m "feat(db): prune archive table + targeted ledger immutability trigger"
```

---

## Task 3: Worker types — Shield SKU + has_shield

**Files:**
- Modify: `worker/src/types.ts`

- [ ] **Step 1: Update `PaymentType`, `TrialStatus`, and `FamilyLicenseRow`**

Find and replace these three declarations:

```ts
// BEFORE
export type PaymentType = 'LIFETIME' | 'AI_ANNUAL';
```
```ts
// AFTER
export type PaymentType = 'LIFETIME' | 'AI_ANNUAL' | 'SHIELD';
```

```ts
// BEFORE — in TrialStatus interface
  has_legal_bundle: boolean;       // Legal Integrity Bundle add-on (Phase 7)
```
```ts
// AFTER — in TrialStatus interface
  has_shield: boolean;             // Shield plan add-on (£149.99 one-off)
```

```ts
// BEFORE — in FamilyLicenseRow interface
  ai_subscription_expiry: string | null;
}
```
```ts
// AFTER — in FamilyLicenseRow interface
  ai_subscription_expiry: string | null;
  has_shield: number;              // 0 or 1
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: No errors. If errors appear related to `has_legal_bundle` references elsewhere, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add worker/src/types.ts
git commit -m "feat(types): add SHIELD PaymentType and has_shield to TrialStatus"
```

---

## Task 4: `trial.ts` — read and return `has_shield`

**Files:**
- Modify: `worker/src/lib/trial.ts`

- [ ] **Step 1: Update `getFamilyRow` query to include `has_shield`**

```ts
// BEFORE
async function getFamilyRow(env: Env, family_id: string): Promise<FamilyLicenseRow | null> {
  return env.DB
    .prepare(`
      SELECT id, trial_start_date, is_activated, has_lifetime_license, ai_subscription_expiry
      FROM families WHERE id = ?
    `)
    .bind(family_id)
    .first<FamilyLicenseRow>();
}
```

```ts
// AFTER
async function getFamilyRow(env: Env, family_id: string): Promise<FamilyLicenseRow | null> {
  return env.DB
    .prepare(`
      SELECT id, trial_start_date, is_activated, has_lifetime_license,
             ai_subscription_expiry, has_shield
      FROM families WHERE id = ?
    `)
    .bind(family_id)
    .first<FamilyLicenseRow>();
}
```

- [ ] **Step 2: Update default return in `getTrialStatus` (the null-row path)**

```ts
// BEFORE
  if (!row) {
    return {
      is_activated: false,
      days_remaining: null,
      is_expired: false,
      has_lifetime_license: false,
      ai_subscription_active: false,
      has_legal_bundle: false,
    };
  }
```

```ts
// AFTER
  if (!row) {
    return {
      is_activated: false,
      days_remaining: null,
      is_expired: false,
      has_lifetime_license: false,
      ai_subscription_active: false,
      has_shield: false,
    };
  }
```

- [ ] **Step 3: Update the main return in `getTrialStatus`**

```ts
// BEFORE
  return {
    is_activated: activated,
    days_remaining,
    is_expired: expired,
    has_lifetime_license: lifetimeLicense,
    ai_subscription_active: aiActive,
    has_legal_bundle: false,   // Phase 7: wire to DB column when Legal Bundle SKU lands
  };
```

```ts
// AFTER
  return {
    is_activated: activated,
    days_remaining,
    is_expired: expired,
    has_lifetime_license: lifetimeLicense,
    ai_subscription_active: aiActive,
    has_shield: Boolean(row.has_shield),
  };
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/trial.ts
git commit -m "feat(trial): wire has_shield from D1 into TrialStatus response"
```

---

## Task 5: `stripe.ts` — Shield product + webhook handler

**Files:**
- Modify: `worker/src/routes/stripe.ts`

- [ ] **Step 1: Add SHIELD to the PRODUCTS catalogue**

```ts
// BEFORE
const PRODUCTS: Record<PaymentType, { amount: number; currency: string; label: string }> = {
  LIFETIME:  { amount: 3499, currency: 'gbp', label: 'Morechard Lifetime Tracker' },
  AI_ANNUAL: { amount: 1999, currency: 'gbp', label: 'Morechard AI Coach — Annual' },
};
```

```ts
// AFTER
const PRODUCTS: Record<PaymentType, { amount: number; currency: string; label: string }> = {
  LIFETIME:  { amount: 3499,  currency: 'gbp', label: 'Morechard Lifetime Tracker' },
  AI_ANNUAL: { amount: 1999,  currency: 'gbp', label: 'Morechard AI Coach — Annual' },
  SHIELD:    { amount: 14999, currency: 'gbp', label: 'Morechard Shield' },
};
```

- [ ] **Step 2: Update checkout validation to accept SHIELD**

```ts
// BEFORE
  if (payment_type !== 'LIFETIME' && payment_type !== 'AI_ANNUAL') {
    return error('payment_type must be LIFETIME or AI_ANNUAL', 400);
  }
```

```ts
// AFTER
  if (payment_type !== 'LIFETIME' && payment_type !== 'AI_ANNUAL' && payment_type !== 'SHIELD') {
    return error('payment_type must be LIFETIME, AI_ANNUAL, or SHIELD', 400);
  }
```

- [ ] **Step 3: Add SHIELD branch in the webhook fulfillment handler**

Find the section in `handleStripeWebhook` that processes `LIFETIME` and `AI_ANNUAL` (look for `UPDATE families SET has_lifetime_license`). Add the SHIELD branch immediately after the AI_ANNUAL branch:

```ts
  // Existing AI_ANNUAL block ends here — add SHIELD below it:
  if (payment_type === 'SHIELD') {
    await env.DB
      .prepare('UPDATE families SET has_shield = 1 WHERE id = ?')
      .bind(family_id)
      .run();
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/stripe.ts
git commit -m "feat(stripe): add SHIELD SKU at £149.99 with permanent has_shield flag"
```

---

## Task 6: `export.ts` — server-side tier gates + `handleExportPrune`

**Files:**
- Modify: `worker/src/routes/export.ts`

### Part A — Tier gate enforcement in `handleExportPdf`

- [ ] **Step 1: Add tier gates after the family row fetch**

In `handleExportPdf`, find the line `if (!family) return error('Family not found', 404);` and add the gates immediately after it:

```ts
  if (!family) return error('Family not found', 404);

  // Server-side tier enforcement — prevents crafted requests bypassing frontend gates
  if (tier === 'behavioral') {
    const row = await env.DB
      .prepare('SELECT ai_subscription_expiry FROM families WHERE id = ?')
      .bind(family_id)
      .first<{ ai_subscription_expiry: string | null }>();
    const active = row?.ai_subscription_expiry
      && new Date(row.ai_subscription_expiry).getTime() > Date.now();
    if (!active) return error('AI Mentor subscription required', 403);
  }

  if (tier === 'forensic') {
    const row = await env.DB
      .prepare('SELECT has_shield FROM families WHERE id = ?')
      .bind(family_id)
      .first<{ has_shield: number }>();
    if (!row?.has_shield) return error('Shield plan required', 403);
  }
```

### Part B — `handleExportPrune` function

- [ ] **Step 2: Add `handleExportPrune` at the bottom of `export.ts`, before the helpers section**

```ts
// ----------------------------------------------------------------
// POST /api/export/prune
// Lead-parent only. Identifies ledger rows older than 2 years,
// archives their hashes, then zeroes PII columns (description,
// ip_address, receipt_id). Also nulls proof_exif and system_verify
// on linked completions. Hash-chain columns are untouched.
// ----------------------------------------------------------------
export async function handleExportPrune(
  request: Request,
  env: Env,
  auth: { sub: string; family_id: string; role: string },
): Promise<Response> {
  const family_id = auth.family_id;

  // Lead-only gate
  const caller = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(auth.sub, family_id)
    .first<{ parent_role: string }>();
  if (!caller || caller.parent_role !== 'lead') {
    return error('Only the lead parent can prune data', 403);
  }

  const cutoff = Math.floor(Date.now() / 1000) - 2 * 365 * 86400;

  const { results: candidates } = await env.DB
    .prepare(`
      SELECT id, record_hash, previous_hash
      FROM ledger
      WHERE family_id = ? AND created_at < ? AND pruned_at IS NULL
    `)
    .bind(family_id, cutoff)
    .all<{ id: number; record_hash: string; previous_hash: string }>();

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ pruned: 0, archived: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let archived = 0;

  for (const row of candidates) {
    // Step 1 — archive hash proof
    await env.DB
      .prepare(`INSERT INTO ledger_prune_archive (ledger_id, record_hash, previous_hash, archived_at) VALUES (?, ?, ?, unixepoch())`)
      .bind(row.id, row.record_hash, row.previous_hash)
      .run();

    // Step 2 — zero PII on ledger row (hash-chain columns untouched)
    await env.DB
      .prepare(`UPDATE ledger SET description = '[archived]', ip_address = NULL, receipt_id = NULL, pruned_at = unixepoch() WHERE id = ? AND family_id = ?`)
      .bind(row.id, family_id)
      .run();

    // Step 3 — zero PII on linked completions (EXIF + system verify contain GPS/IP)
    await env.DB
      .prepare(`
        UPDATE completions
        SET proof_exif = NULL, system_verify = NULL
        WHERE chore_id IN (
          SELECT chore_id FROM ledger WHERE id = ? AND family_id = ? AND chore_id IS NOT NULL
        )
      `)
      .bind(row.id, family_id)
      .run();

    archived++;
  }

  return new Response(JSON.stringify({ pruned: candidates.length, archived }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/export.ts
git commit -m "feat(export): server-side tier gates + handleExportPrune with PII archiving"
```

---

## Task 7: `index.ts` — register prune route

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add import for `handleExportPrune`**

```ts
// BEFORE
import { handleExportJson, handleExportPdf } from './routes/export.js';
```

```ts
// AFTER
import { handleExportJson, handleExportPdf, handleExportPrune } from './routes/export.js';
```

- [ ] **Step 2: Register the route after the existing export routes**

Find the block ending at line ~574:
```ts
  if (path === '/api/export/pdf' && method === 'GET') {
    const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
    if (famCheck) return famCheck;
    return handleExportPdf(request, env);
  }
```

Add immediately after it:
```ts
  if (path === '/api/export/prune' && method === 'POST') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    return handleExportPrune(request, env, auth);
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): register POST /api/export/prune route"
```

---

## Task 8: `api.ts` — update `TrialStatus` interface

**Files:**
- Modify: `app/src/lib/api.ts`

- [ ] **Step 1: Replace `has_legal_bundle` with `has_shield`**

```ts
// BEFORE
export interface TrialStatus {
  is_activated:         boolean
  days_remaining:       number | null
  is_expired:           boolean
  has_lifetime_license: boolean
  ai_subscription_active: boolean
  has_legal_bundle:     boolean   // Legal Integrity Bundle add-on (Phase 7)
}
```

```ts
// AFTER
export interface TrialStatus {
  is_activated:         boolean
  days_remaining:       number | null
  is_expired:           boolean
  has_lifetime_license: boolean
  ai_subscription_active: boolean
  has_shield:           boolean   // Shield plan add-on (£149.99 one-off)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: Errors pointing to `has_legal_bundle` usages in `DataSettings.tsx` and `ParentSettingsTab.tsx` — these will be fixed in Tasks 9 and 10. Note them and proceed.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/api.ts
git commit -m "feat(api): rename has_legal_bundle -> has_shield in TrialStatus"
```

---

## Task 9: `useExportManager` hook

**Files:**
- Create: `app/src/hooks/useExportManager.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useState, useCallback } from 'react'
import { getFamilyId, getToken, apiUrl, authHeaders } from '../lib/api'

export type ExportKey = 'json-basic' | 'pdf-basic' | 'pdf-behavioral' | 'pdf-forensic' | 'prune'
export type ExportState = 'idle' | 'generating' | 'success' | 'error'

interface UseExportManager {
  stateOf:       (key: ExportKey) => ExportState
  errorOf:       (key: ExportKey) => string | null
  triggerExport: (format: 'pdf' | 'json', tier: 'basic' | 'behavioral' | 'forensic', lang: string) => Promise<void>
  triggerPrune:  () => Promise<{ pruned: number }>
}

export function useExportManager(): UseExportManager {
  const [states, setStates] = useState<Map<ExportKey, ExportState>>(new Map())
  const [errors, setErrors] = useState<Map<ExportKey, string | null>>(new Map())

  function setKeyState(key: ExportKey, state: ExportState) {
    setStates(prev => new Map(prev).set(key, state))
  }
  function setKeyError(key: ExportKey, msg: string | null) {
    setErrors(prev => new Map(prev).set(key, msg))
  }

  const stateOf  = useCallback((key: ExportKey): ExportState  => states.get(key) ?? 'idle',  [states])
  const errorOf  = useCallback((key: ExportKey): string | null => errors.get(key) ?? null, [errors])

  const triggerExport = useCallback(async (
    format: 'pdf' | 'json',
    tier: 'basic' | 'behavioral' | 'forensic',
    lang: string,
  ): Promise<void> => {
    const family_id = getFamilyId()
    const token     = getToken()
    if (!family_id || !token) return

    const key: ExportKey = `${format}-${tier}` as ExportKey
    setKeyState(key, 'generating')
    setKeyError(key, null)

    try {
      const params = new URLSearchParams({ family_id, lang, tier })
      const res = await fetch(apiUrl(`/api/export/${format}?${params}`), {
        headers: authHeaders(),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `morechard-${tier}-report-${Date.now()}.${format === 'json' ? 'json' : 'html'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setKeyState(key, 'success')
      setTimeout(() => setKeyState(key, 'idle'), 3000)
    } catch (err) {
      setKeyState(key, 'error')
      setKeyError(key, err instanceof Error ? err.message : 'Export failed')
    }
  }, [])

  const triggerPrune = useCallback(async (): Promise<{ pruned: number }> => {
    setKeyState('prune', 'generating')
    setKeyError('prune', null)

    try {
      const res = await fetch(apiUrl('/api/export/prune'), {
        method:  'POST',
        headers: authHeaders('application/json'),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Prune failed (${res.status})`)
      }

      const data = await res.json() as { pruned: number; archived: number }
      setKeyState('prune', 'success')
      setTimeout(() => setKeyState('prune', 'idle'), 3000)
      return { pruned: data.pruned }
    } catch (err) {
      setKeyState('prune', 'error')
      setKeyError('prune', err instanceof Error ? err.message : 'Prune failed')
      throw err
    }
  }, [])

  return { stateOf, errorOf, triggerExport, triggerPrune }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: No errors from the new hook file itself (other files may still have errors — that's fine at this step).

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useExportManager.ts
git commit -m "feat(hooks): useExportManager — download state machine + prune trigger"
```

---

## Task 10: `DataSettings.tsx` — use hook, new props, copy, prune confirm

**Files:**
- Modify: `app/src/components/settings/sections/DataSettings.tsx`

This is a full replacement of the file. The diff is significant but mechanical — all logic moves to the hook.

- [ ] **Step 1: Replace the file content**

```tsx
/**
 * DataSettings — Data & Exports section.
 *
 * Three PDF tiers:
 *   basic      — available to all authenticated users (GDPR portability baseline)
 *   behavioral — requires active AI Mentor subscription (£19.99/yr)
 *   forensic   — requires Shield plan (£149.99 one-off)
 *
 * JSON export is always available (GDPR Article 20 portability).
 * Data Pruning is lead-parent only and requires double-confirm.
 */

import { useState } from 'react'
import { Database, FileText, Shield, AlertTriangle, Download } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { useExportManager } from '../../../hooks/useExportManager'

interface Props {
  isLead:              boolean
  hasAiMentor:         boolean
  hasShield:           boolean
  lang:                string
  toast:               string | null
  onBack:              () => void
  onNavigateToPlan:    (sku: 'AI_ANNUAL' | 'SHIELD') => void
}

export function DataSettings({
  isLead, hasAiMentor, hasShield,
  lang, toast, onBack, onNavigateToPlan,
}: Props) {
  const { stateOf, errorOf, triggerExport, triggerPrune } = useExportManager()
  const [pruneStep, setPruneStep] = useState<'idle' | 'confirm' | 'pruning'>('idle')
  const [pruneToast, setPruneToast] = useState<string | null>(null)

  const busy = (key: Parameters<typeof stateOf>[0]) => stateOf(key) === 'generating'

  const exportError =
    errorOf('json-basic') ??
    errorOf('pdf-basic') ??
    errorOf('pdf-behavioral') ??
    errorOf('pdf-forensic') ??
    null

  async function handlePruneConfirm() {
    setPruneStep('pruning')
    try {
      const { pruned } = await triggerPrune()
      setPruneToast(`Archived ${pruned} record${pruned !== 1 ? 's' : ''}`)
      setTimeout(() => setPruneToast(null), 4000)
    } catch {
      // error already stored in hook — show it via errorOf
      setPruneToast(errorOf('prune') ?? 'Prune failed')
      setTimeout(() => setPruneToast(null), 4000)
    } finally {
      setPruneStep('idle')
    }
  }

  return (
    <div className="space-y-4">
      {(toast || exportError || pruneToast) && (
        <Toast message={pruneToast ?? exportError ?? toast ?? ''} />
      )}

      <SectionHeader title="Data & Exports" onBack={onBack} />

      {/* JSON — always available */}
      <SectionCard>
        <SettingsRow
          icon={<Database size={15} />}
          label="Download Raw Data (JSON)"
          description="Full transaction history — GDPR Article 20 data portability"
          onClick={() => triggerExport('json', 'basic', lang)}
          rightSlot={busy('json-basic') ? <Spinner /> : <Download size={14} className="text-gray-400" />}
        />
      </SectionCard>

      {/* PDF Reports */}
      <SectionCard>
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            PDF Reports
          </p>
        </div>

        {/* Family Summary — no plan gate, session only */}
        <SettingsRow
          icon={<FileText size={15} />}
          label={busy('pdf-basic') ? 'Generating Report…' : 'Family Summary Report'}
          description="Earnings, task history and status log"
          onClick={() => triggerExport('pdf', 'basic', lang)}
          rightSlot={busy('pdf-basic') ? <Spinner /> : <Download size={14} className="text-gray-400" />}
        />

        {/* Growth & Learning — requires AI Mentor */}
        <SettingsRow
          icon={<FileText size={15} className="text-purple-500" />}
          label={busy('pdf-behavioral') ? 'Generating Report…' : 'Growth & Learning Report'}
          description="Learning Lab modules and Behavioural Pulse"
          onClick={hasAiMentor
            ? () => triggerExport('pdf', 'behavioral', lang)
            : () => onNavigateToPlan('AI_ANNUAL')}
          rightSlot={busy('pdf-behavioral')
            ? <Spinner />
            : hasAiMentor
              ? <Download size={14} className="text-gray-400" />
              : <LockedBadge label="Add AI Mentor" />}
        />

        {/* Forensic Report — requires Shield */}
        <SettingsRow
          icon={<Shield size={15} className="text-orange-600" />}
          label={busy('pdf-forensic') ? 'Generating Report…' : 'Forensic Report'}
          description="Tamper-evident record with secure digital signatures and device verification"
          onClick={hasShield
            ? () => triggerExport('pdf', 'forensic', lang)
            : () => onNavigateToPlan('SHIELD')}
          rightSlot={busy('pdf-forensic')
            ? <Spinner />
            : hasShield
              ? <Download size={14} className="text-gray-400" />
              : <LockedBadge label="Add Shield" />}
        />
      </SectionCard>

      {/* Data Pruning — lead only */}
      {isLead && (
        <SectionCard>
          {pruneStep === 'idle' && (
            <SettingsRow
              icon={<AlertTriangle size={15} />}
              label="Data Pruning"
              description="Archive records older than 2 years (hash chain preserved)"
              onClick={() => setPruneStep('confirm')}
              destructive
            />
          )}

          {(pruneStep === 'confirm' || pruneStep === 'pruning') && (
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-[var(--color-text)] leading-snug">
                  This will remove personal details from records older than 2 years.
                  The secure verification trail is preserved. This cannot be undone.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pruneStep === 'pruning'}
                  onClick={handlePruneConfirm}
                  className="flex-1 h-9 rounded-xl bg-red-500 text-white text-[12px] font-semibold disabled:opacity-50 cursor-pointer hover:bg-red-600 active:scale-95 transition-all"
                >
                  {pruneStep === 'pruning' ? 'Archiving…' : 'Yes, archive old records'}
                </button>
                <button
                  type="button"
                  disabled={pruneStep === 'pruning'}
                  onClick={() => setPruneStep('idle')}
                  className="flex-1 h-9 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] text-[12px] font-semibold disabled:opacity-50 cursor-pointer hover:bg-[var(--color-surface-alt)] active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-[var(--brand-primary)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function LockedBadge({ label }: { label: string }) {
  return (
    <span className="text-[9px] font-semibold text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: Errors only from `ParentSettingsTab.tsx` (still passing old props). Fix in Task 11.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/settings/sections/DataSettings.tsx
git commit -m "feat(ui): DataSettings — hook, ungated Family Summary, copy, prune confirm"
```

---

## Task 11: `ParentSettingsTab.tsx` — pass new props

**Files:**
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx`

- [ ] **Step 1: Update the `DataSettings` JSX call (line ~327)**

```tsx
// BEFORE
if (view.section === 'data') return <ProfileSection><DataSettings isLead={isLead} hasLifetimeLicense={Boolean(trial?.has_lifetime_license)} hasAiMentor={Boolean(trial?.ai_subscription_active)} hasLegalBundle={Boolean(trial?.has_legal_bundle)} lang={isPolish(locale) ? 'pl' : 'en'} toast={toast} onBack={back} onComingSoon={comingSoon} /></ProfileSection>
```

```tsx
// AFTER
if (view.section === 'data') return <ProfileSection><DataSettings isLead={isLead} hasAiMentor={Boolean(trial?.ai_subscription_active)} hasShield={Boolean(trial?.has_shield)} lang={isPolish(locale) ? 'pl' : 'en'} toast={toast} onBack={back} onNavigateToPlan={(sku) => { setView({ type: 'section', section: 'billing' }); }} /></ProfileSection>
```

Note: `onNavigateToPlan` opens the billing section. `BillingSettings` always renders at its top-level menu (it manages its own sub-view state internally), so the user lands on the billing menu and can tap "Plan Management" directly. A future iteration can deep-link to the plan sub-view.

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/dashboard/ParentSettingsTab.tsx
git commit -m "feat(settings): wire hasShield and onNavigateToPlan into DataSettings"
```

---

## Task 12: HistoryTab — archived completion display

**Files:**
- Modify: `app/src/components/dashboard/HistoryTab.tsx`

This task adds the graceful "Details archived" state for completions whose `proof_exif` was zeroed by the prune. First, check what the file currently renders for completion evidence.

- [ ] **Step 1: Locate the completion evidence render block in HistoryTab.tsx**

```bash
grep -n "proof_exif\|system_verify\|device_model\|haversine\|evidence\|photo\|photo_url" "e:/Web-Video Design/Claude/Apps/Pocket Money/app/src/components/dashboard/HistoryTab.tsx"
```

If there are no matches, the tab does not yet render proof/evidence blocks and this task is a no-op — skip to commit with a note. If matches exist, continue with Step 2.

- [ ] **Step 2: Add the archived guard wherever `proof_exif` or `system_verify` is rendered**

Wrap the evidence block with:
```tsx
{ledgerRow.pruned_at != null && completion.proof_exif == null ? (
  <p className="text-[11px] text-[var(--color-text-muted)] italic px-3 py-2">
    Details archived (2+ years old)
  </p>
) : (
  /* existing evidence block here */
)}
```

The condition `pruned_at != null` distinguishes "pruned" from "never had evidence" — a row that was never linked to a completion has `proof_exif = null` and `pruned_at = null`, so the archived label will not appear for it.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/dashboard/HistoryTab.tsx
git commit -m "feat(ui): show 'Details archived' for pruned completions in HistoryTab"
```

---

## Task 13: Deploy migrations to production D1

- [ ] **Step 1: Apply migrations to remote D1**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npx wrangler d1 execute morechard-db --remote --file=worker/migrations/0038_shield_sku.sql
npx wrangler d1 execute morechard-db --remote --file=worker/migrations/0039_prune_archive.sql
```

Expected output for each:
```
✅ Applied migration
```

If either fails with "duplicate column", the migration was already applied — safe to continue.

- [ ] **Step 2: Deploy worker**

```bash
npx wrangler deploy
```

Expected: `✅ Deployed to ... workers.dev`

- [ ] **Step 3: Smoke test the export endpoints**

Open the app, go to Settings → Data & Exports:
- JSON download fires immediately (no gate) — file downloads.
- Family Summary PDF fires immediately — HTML file downloads with basic tier badge.
- Growth & Learning row shows "Add AI Mentor" badge if not subscribed, navigates to Billing on tap.
- Forensic row shows "Add Shield" badge if not subscribed, navigates to Billing on tap.
- Data Pruning row is visible to lead parent only. Clicking shows the inline confirm block. Clicking Cancel returns to idle. With no records older than 2 years, "Yes, archive old records" returns `{ pruned: 0, archived: 0 }` and shows "Archived 0 records" toast.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(data-exports): complete Data & Exports screen — Shield SKU, prune, tier gates"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `useExportManager` hook → Task 9
  - Family Summary gate removed (frontend) → Task 10; server no-gate → Task 6 Part A
  - Shield SKU → Tasks 1, 3, 4, 5
  - `has_legal_bundle` → `has_shield` rename → Tasks 3, 4, 5, 8, 10, 11
  - Upgrade navigation → Task 10 (`onNavigateToPlan`), Task 11 (wiring)
  - Copy fixes (label/description) → Task 10
  - Server-side tier enforcement → Task 6 Part A
  - `POST /api/export/prune` → Tasks 6 Part B, 7
  - Migrations → Tasks 1, 2
  - Double-confirm UI → Task 10
  - Archived display → Task 12
  - Immutable trigger replacement → Task 2

- [x] **Placeholder scan:** No TBDs, TODOs, or "similar to" references. All code blocks are complete.

- [x] **Type consistency:**
  - `ExportKey` defined in Task 9, used in Task 10 (import from hook).
  - `has_shield: boolean` defined in Task 3 (`types.ts`) and Task 8 (`api.ts`), consumed in Task 4, 5, 10, 11.
  - `PaymentType` extended in Task 3, used in Task 5.
  - `handleExportPrune` signature uses `{ sub, family_id, role }` — matches `JwtPayload` shape used throughout `index.ts` (Tasks 6 and 7 are consistent).
  - `triggerExport` in Task 9 takes `lang` param; calls in Task 10 pass `lang` from props — consistent.
  - `LockedBadge` in Task 10 has required `label: string` prop — no optional ambiguity.
