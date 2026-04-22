# Payment Bridge V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-fee Payment Bridge that hands off the parent's approved reward to their existing banking app via deep link (Monzo, Revolut, PayPal, Venmo) or Smart Copy (bank transfer, Zelle), and tracks delivery with a `paid_out_at` timestamp without touching the immutable ledger.

**Architecture:** One new D1 migration adds `paid_out_at` to `completions` and four public payment-handle columns to `children`. Three new worker routes (`mark-paid`, `mark-paid-batch`, `unpaid-summary`) manage the timestamp with parent-only auth and family-scope checks. Six new React components compose the bridge UI as a Radix-Dialog bottom sheet with a 5-tile provider grid; four new lib modules handle URL generation, Capacitor-aware clipboard/haptics, and temporary localStorage for UK bank details (to be replaced in Spec B). Approve-flow integration adds post-success toasts with "Pay Now" actions.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 + `@radix-ui/react-dialog`; Cloudflare Worker + D1 (SQLite); Capacitor 8 (`@capacitor/app`, `@capacitor/haptics`, `@capacitor/clipboard` — to be added); Vitest (to be added for pure utilities).

**Spec:** [docs/superpowers/specs/2026-04-22-payment-bridge-v1-design.md](../specs/2026-04-22-payment-bridge-v1-design.md)

---

## File Map

### Worker (new)
- `worker/migrations/0037_payment_bridge.sql` — schema changes
- `worker/src/routes/payments.ts` — `mark-paid`, `mark-paid-batch`, `unpaid-summary` handlers

### Worker (modified)
- `worker/src/index.ts:62-65` — import new handlers
- `worker/src/index.ts:486` — register new routes

### App — libraries (new)
- `app/src/lib/paymentBridge.ts` — URL generators, reference builder
- `app/src/lib/localBankDetails.ts` — temporary localStorage wrapper
- `app/src/lib/haptics.ts` — Capacitor → Vibration API → visual fallback
- `app/src/lib/clipboard.ts` — Capacitor → navigator.clipboard → textarea fallback

### App — libraries (modified)
- `app/src/lib/api.ts` — add `markPaid`, `markPaidBatch`, `getUnpaidSummary`, extend `Completion` and `ChildRecord` types

### App — components (new, all under `app/src/components/payment/`)
- `PaymentBridgeSheet.tsx` — Radix-Dialog bottom sheet shell, tile grid, Back-button handling
- `PaymentTileGrid.tsx` — 5 tiles (Monzo, Revolut, PayPal, Venmo, Bank Transfer)
- `DeepLinkHandler.tsx` — visibility-based success detection, Capacitor branch
- `SmartCopyPanel.tsx` — copy buttons for bank transfer + Zelle
- `PaymentConfirmSheet.tsx` — "Did the payment go through?" Yes/No
- `UnpaidIndicator.tsx` — pill on child card

### App — components (modified)
- `app/src/components/dashboard/PendingTab.tsx` — post-approve toast with "Pay Now" action, approve-all grouping by child

### Tests (new)
- `app/src/lib/paymentBridge.test.ts`
- `app/src/lib/localBankDetails.test.ts`
- `app/src/lib/haptics.test.ts`
- `app/vitest.config.ts`
- `app/src/test-setup.ts`

---

## Task 0: Install Capacitor plugins & Vitest

**Files:**
- Modify: `package.json` (root)
- Modify: `app/package.json`

- [ ] **Step 1: Install Capacitor plugins at the root**

Run from the project root:

```bash
npm install @capacitor/app@^8 @capacitor/haptics@^8 @capacitor/clipboard@^8
```

Expected: three packages added to root `dependencies`. No build errors.

- [ ] **Step 2: Install Vitest + Testing Library in the app package**

Run from the project root:

```bash
cd app && npm install -D vitest@^3 @vitest/ui@^3 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25
```

Expected: five devDependencies added to `app/package.json`.

- [ ] **Step 3: Create Vitest config**

Create `app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create test setup**

Create `app/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Add test script**

Edit `app/package.json` `scripts`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build && cp ../dist/index.html ../dist/404.html",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: Sanity-check Vitest**

Create `app/src/sanity.test.ts`:

```ts
import { expect, test } from 'vitest';
test('vitest is alive', () => { expect(1 + 1).toBe(2); });
```

Run from repo root:

```bash
cd app && npm test
```

Expected: `1 test passed`. Delete `app/src/sanity.test.ts` after.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/package.json app/vitest.config.ts app/src/test-setup.ts
git commit -m "chore: add Capacitor App/Haptics/Clipboard plugins and Vitest

Adds plumbing for Payment Bridge V1. No feature code yet."
```

---

## Task 1: D1 migration — payment bridge schema

**Files:**
- Create: `worker/migrations/0037_payment_bridge.sql`

- [ ] **Step 1: Write the migration**

Create `worker/migrations/0037_payment_bridge.sql`:

```sql
-- 0037_payment_bridge.sql
-- Payment Bridge V1: virtual-ledger → real-world payout hand-off.
-- paid_out_at is a delivery-status flag, NOT a ledger entry. It is NOT
-- included in the SHA-256 hash chain. Mutating it does not break ledger
-- integrity.

ALTER TABLE completions ADD COLUMN paid_out_at INTEGER;
-- Unix epoch seconds. NULL = virtual credit only, not yet settled to real
-- money. Stamped by POST /api/completions/:id/mark-paid after the parent
-- confirms "Yes, sent" in the Payment Bridge.

-- Public payment handles on the user record. Morechard uses a single
-- `users` table for both parents and children; role is resolved via
-- `family_roles`. Child-specific fields (allowance_amount, earnings_mode,
-- teen_mode) already live on `users`, so payment handles follow that
-- pattern. Parent rows leaving these NULL is harmless.
-- These are the shareable parts of URLs like monzo.me/<handle>/<amount>
-- or venmo.com/<handle>, so server-side storage is acceptable (already
-- public by design). NOT suitable for sort codes / account numbers —
-- those live in localStorage until Spec B ships the encrypted vault.
ALTER TABLE users ADD COLUMN monzo_handle TEXT;
ALTER TABLE users ADD COLUMN revolut_handle TEXT;
ALTER TABLE users ADD COLUMN paypal_handle TEXT;
ALTER TABLE users ADD COLUMN venmo_handle TEXT;
```

- [ ] **Step 2: Apply locally**

Run from the project root:

```bash
cd worker && npx wrangler d1 migrations apply morechard --local
```

Expected: `Migrations applied. 0037_payment_bridge.sql`.

- [ ] **Step 3: Verify columns exist**

```bash
cd worker && npx wrangler d1 execute morechard --local --command "PRAGMA table_info(completions);"
```

Expected: output contains a row where name is `paid_out_at` and type is `INTEGER`.

```bash
cd worker && npx wrangler d1 execute morechard --local --command "PRAGMA table_info(users);"
```

Expected: output contains rows `monzo_handle`, `revolut_handle`, `paypal_handle`, `venmo_handle`, all TEXT.

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0037_payment_bridge.sql
git commit -m "feat(db): 0037 payment bridge schema

Adds paid_out_at to completions and four public payment handles to the
users table (which holds both parents and children). paid_out_at is
metadata, not a ledger entry — the hash chain is unaffected."
```

---

## Task 2: URL generators & reference builder (TDD)

**Files:**
- Create: `app/src/lib/paymentBridge.ts`
- Create: `app/src/lib/paymentBridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/paymentBridge.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  monzoUrl, revolutUrl, paypalUrl, venmoUrl, buildReference,
} from './paymentBridge';

describe('monzoUrl', () => {
  test('builds well-formed URL', () => {
    expect(monzoUrl('alexj', '5.00')).toBe('https://monzo.me/alexj/5.00');
  });
  test('returns null when handle missing', () => {
    expect(monzoUrl('', '5.00')).toBeNull();
  });
  test('encodes handles with special chars', () => {
    expect(monzoUrl('alex j', '5.00')).toBe('https://monzo.me/alex%20j/5.00');
  });
});

describe('revolutUrl', () => {
  test('builds well-formed URL', () => {
    expect(revolutUrl('alexj', '5.00')).toBe('https://revolut.me/alexj/5.00');
  });
  test('returns null when handle missing', () => {
    expect(revolutUrl('', '5.00')).toBeNull();
  });
});

describe('paypalUrl', () => {
  test('appends currency code', () => {
    expect(paypalUrl('alexj', '5.00', 'GBP')).toBe('https://paypal.me/alexj/5.00GBP');
  });
  test('supports USD', () => {
    expect(paypalUrl('alexj', '5.00', 'USD')).toBe('https://paypal.me/alexj/5.00USD');
  });
  test('returns null when handle missing', () => {
    expect(paypalUrl('', '5.00', 'GBP')).toBeNull();
  });
});

describe('venmoUrl', () => {
  test('builds deep-link with txn, recipients, amount, note', () => {
    const url = venmoUrl('alexj', '5.00', 'MC Alex 22APR');
    expect(url).toMatch(/^venmo:\/\/paycharge\?/);
    expect(url).toContain('txn=pay');
    expect(url).toContain('recipients=alexj');
    expect(url).toContain('amount=5.00');
    expect(url).toContain('note=MC+Alex+22APR');
  });
});

describe('buildReference', () => {
  test('formats "MC <Name> <DDMMM>"', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    expect(buildReference('Alex', d)).toBe('MC Alex 22APR');
  });
  test('truncates long names to fit 18-char cap', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    const ref = buildReference('Maximilianus', d);
    expect(ref.length).toBeLessThanOrEqual(18);
    expect(ref).toMatch(/^MC Maximilia.*22APR$/);
  });
  test('strips non-alphanumeric chars from name', () => {
    const d = new Date('2026-04-22T12:00:00Z');
    expect(buildReference("O'Brien", d)).toBe('MC OBrien 22APR');
  });
  test('pads single-digit days', () => {
    const d = new Date('2026-04-05T12:00:00Z');
    expect(buildReference('Alex', d)).toBe('MC Alex 05APR');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run from project root:

```bash
cd app && npm test -- paymentBridge
```

Expected: all tests fail with `Failed to resolve import "./paymentBridge"`.

- [ ] **Step 3: Implement**

Create `app/src/lib/paymentBridge.ts`:

```ts
// Payment Bridge V1 — URL generators and reference builder.
// All generators return null if required input is missing, so callers
// can show an inline "Add <provider> handle" CTA instead of a broken URL.

export function monzoUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://monzo.me/${encodeURIComponent(handle)}/${amount}`;
}

export function revolutUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://revolut.me/${encodeURIComponent(handle)}/${amount}`;
}

export type PayPalCurrency = 'GBP' | 'USD' | 'EUR';

export function paypalUrl(
  handle: string,
  amount: string,
  currency: PayPalCurrency,
): string | null {
  if (!handle) return null;
  return `https://paypal.me/${encodeURIComponent(handle)}/${amount}${currency}`;
}

export function venmoUrl(handle: string, amount: string, note: string): string {
  const params = new URLSearchParams({
    txn: 'pay',
    recipients: handle,
    amount,
    note,
  });
  return `venmo://paycharge?${params.toString()}`;
}

// "MC <FirstName> <DDMMM>" — max 18 chars, alphanumeric + spaces only.
// UK Faster Payments references allow 18 chars; some banks strip specials.
export function buildReference(
  childFirstName: string,
  date: Date = new Date(),
): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mmm = months[date.getUTCMonth()];
  const cleanName = childFirstName.replace(/[^A-Za-z0-9]/g, '');
  const fixedSuffix = ` ${dd}${mmm}`;   // e.g. " 22APR" — 6 chars
  const prefix = 'MC ';                 // 3 chars
  const nameBudget = 18 - prefix.length - fixedSuffix.length; // 9
  return `${prefix}${cleanName.slice(0, nameBudget)}${fixedSuffix}`;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run from project root:

```bash
cd app && npm test -- paymentBridge
```

Expected: all tests pass (13 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/paymentBridge.ts app/src/lib/paymentBridge.test.ts
git commit -m "feat(app): URL generators and reference builder for Payment Bridge"
```

---

## Task 3: Local bank details wrapper (TDD)

**Files:**
- Create: `app/src/lib/localBankDetails.ts`
- Create: `app/src/lib/localBankDetails.test.ts`

Spec note: this module is a **known temporary**. Spec B replaces it with an encrypted IndexedDB-backed vault, keeping the same contract (`getDetails`, `setDetails`, `clearDetails`).

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/localBankDetails.test.ts`:

```ts
import { describe, expect, test, beforeEach } from 'vitest';
import {
  getDetails, setDetails, clearDetails, type StoredBankDetails,
} from './localBankDetails';

beforeEach(() => { localStorage.clear(); });

describe('localBankDetails', () => {
  test('setDetails then getDetails round-trips', () => {
    const d: StoredBankDetails = {
      childId: 'c_abc',
      sortCode: '201575',
      accountNumber: '12345678',
      updatedAt: 0, // overwritten by setDetails
    };
    setDetails('fam_1', 'c_abc', d);
    const got = getDetails('fam_1', 'c_abc');
    expect(got?.sortCode).toBe('201575');
    expect(got?.accountNumber).toBe('12345678');
    expect(got?.updatedAt).toBeGreaterThan(0);
  });

  test('getDetails returns null for unknown child', () => {
    expect(getDetails('fam_1', 'c_missing')).toBeNull();
  });

  test('setDetails on one child does not affect another', () => {
    setDetails('fam_1', 'c_abc', { childId: 'c_abc', sortCode: '111111', updatedAt: 0 });
    setDetails('fam_1', 'c_def', { childId: 'c_def', sortCode: '222222', updatedAt: 0 });
    expect(getDetails('fam_1', 'c_abc')?.sortCode).toBe('111111');
    expect(getDetails('fam_1', 'c_def')?.sortCode).toBe('222222');
  });

  test('clearDetails removes only the target child', () => {
    setDetails('fam_1', 'c_abc', { childId: 'c_abc', sortCode: '111111', updatedAt: 0 });
    setDetails('fam_1', 'c_def', { childId: 'c_def', sortCode: '222222', updatedAt: 0 });
    clearDetails('fam_1', 'c_abc');
    expect(getDetails('fam_1', 'c_abc')).toBeNull();
    expect(getDetails('fam_1', 'c_def')?.sortCode).toBe('222222');
  });

  test('stores Zelle handle (US)', () => {
    setDetails('fam_1', 'c_abc', {
      childId: 'c_abc',
      zelleHandle: 'alex@example.com',
      updatedAt: 0,
    });
    expect(getDetails('fam_1', 'c_abc')?.zelleHandle).toBe('alex@example.com');
  });

  test('survives corrupt JSON gracefully', () => {
    localStorage.setItem('morechard.bankdetails.v1.fam_1', 'not-json');
    expect(getDetails('fam_1', 'c_abc')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run from project root:

```bash
cd app && npm test -- localBankDetails
```

Expected: import-resolution failure.

- [ ] **Step 3: Implement**

Create `app/src/lib/localBankDetails.ts`:

```ts
// Temporary per-device storage of child bank details.
// KNOWN TEMPORARY: Spec B replaces this with an encrypted IndexedDB vault.
// Contract (getDetails / setDetails / clearDetails) is preserved so Spec B
// is a drop-in swap — no call-site changes.

export type StoredBankDetails = {
  childId: string;
  sortCode?: string;       // UK, 6 digits, no hyphens
  accountNumber?: string;  // UK, 8 digits
  zelleHandle?: string;    // US, email or phone
  updatedAt: number;       // Unix ms
};

type Store = Record<string, StoredBankDetails>; // keyed by childId

function storageKey(familyId: string): string {
  return `morechard.bankdetails.v1.${familyId}`;
}

function readStore(familyId: string): Store {
  try {
    const raw = localStorage.getItem(storageKey(familyId));
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

function writeStore(familyId: string, store: Store): void {
  localStorage.setItem(storageKey(familyId), JSON.stringify(store));
}

export function getDetails(
  familyId: string,
  childId: string,
): StoredBankDetails | null {
  const store = readStore(familyId);
  return store[childId] ?? null;
}

export function setDetails(
  familyId: string,
  childId: string,
  details: StoredBankDetails,
): void {
  const store = readStore(familyId);
  store[childId] = { ...details, childId, updatedAt: Date.now() };
  writeStore(familyId, store);
}

export function clearDetails(familyId: string, childId: string): void {
  const store = readStore(familyId);
  delete store[childId];
  writeStore(familyId, store);
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run from project root:

```bash
cd app && npm test -- localBankDetails
```

Expected: all tests pass (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/localBankDetails.ts app/src/lib/localBankDetails.test.ts
git commit -m "feat(app): temporary per-device bank-details wrapper

Plain localStorage. Spec B replaces this with an encrypted IndexedDB
vault using the same function signatures."
```

---

## Task 4: Haptics + Clipboard utilities (TDD for haptics, smoke test for clipboard)

**Files:**
- Create: `app/src/lib/haptics.ts`
- Create: `app/src/lib/haptics.test.ts`
- Create: `app/src/lib/clipboard.ts`

- [ ] **Step 1: Write failing haptics tests**

Create `app/src/lib/haptics.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

// Hoisted mocks for Capacitor — vi.mock is hoisted above imports
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT' },
}));

import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';
import { tick } from './haptics';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('haptics.tick', () => {
  test('uses Capacitor Haptics on native', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await tick();
    expect(Haptics.impact).toHaveBeenCalledOnce();
  });

  test('falls back to navigator.vibrate on web when available', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const vibrate = vi.fn();
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: vibrate, configurable: true,
    });
    await tick();
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(Haptics.impact).not.toHaveBeenCalled();
  });

  test('does not throw when nothing is available', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: undefined, configurable: true,
    });
    await expect(tick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run from project root:

```bash
cd app && npm test -- haptics
```

Expected: import-resolution failure on `./haptics`.

- [ ] **Step 3: Implement haptics.ts**

Create `app/src/lib/haptics.ts`:

```ts
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Fire a short haptic tick. Best-effort, no-throw.
// Order: Capacitor native → navigator.vibrate → silent (visual-only fallback
// is the caller's responsibility — e.g., the checkmark animation).
// Android Chrome requires a user gesture; call this from the click handler,
// not from an async .then() after a network round-trip.
export async function tick(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    }
  } catch {
    // fall through
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(10); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run from project root:

```bash
cd app && npm test -- haptics
```

Expected: 3 tests pass.

- [ ] **Step 5: Implement clipboard.ts (no test — simple delegation)**

Create `app/src/lib/clipboard.ts`:

```ts
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

// Copy text to the system clipboard.
// Capacitor native → navigator.clipboard → textarea execCommand fallback.
// Returns true on success so the caller can swap the icon to a checkmark.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Clipboard.write({ string: text });
      return true;
    }
  } catch {
    // fall through to web
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  // Last-ditch fallback for non-HTTPS LAN dev.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/haptics.ts app/src/lib/haptics.test.ts app/src/lib/clipboard.ts
git commit -m "feat(app): Capacitor-aware haptics and clipboard utilities

Haptics: native Haptics.impact → navigator.vibrate → silent.
Clipboard: native Clipboard.write → navigator.clipboard → execCommand."
```

---

## Task 5: Worker — `payments.ts` routes

**Files:**
- Create: `worker/src/routes/payments.ts`

- [ ] **Step 1: Implement handlers**

Create `worker/src/routes/payments.ts`:

```ts
/**
 * Payments routes — Payment Bridge V1.
 *
 * POST /api/completions/:id/mark-paid       Stamp paid_out_at on one completion
 * POST /api/completions/mark-paid-batch     Atomically stamp N completions
 * GET  /api/completions/unpaid-summary      Per-child unpaid totals
 *
 * These routes manage *delivery status* only. They do NOT write to the
 * ledger and do NOT mutate any field that feeds the SHA-256 hash chain.
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// ----------------------------------------------------------------
// POST /api/completions/:id/mark-paid
// ----------------------------------------------------------------
export async function handleMarkPaid(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can mark a payment', 403);

  const row = await env.DB
    .prepare('SELECT id, family_id, status, paid_out_at FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ id: string; family_id: string; status: string; paid_out_at: number | null }>();

  if (!row) return error('Completion not found', 404);
  if (row.family_id !== auth.family_id) return error('Forbidden', 403);
  if (row.status !== 'completed')
    return error(`Cannot mark paid — completion is '${row.status}'`, 409);

  // Idempotent: first write wins.
  if (row.paid_out_at != null) {
    return json({
      completion_id: row.id,
      paid_out_at: row.paid_out_at,
      was_already_paid: true,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('UPDATE completions SET paid_out_at = ? WHERE id = ?')
    .bind(now, completionId)
    .run();

  return json({
    completion_id: completionId,
    paid_out_at: now,
    was_already_paid: false,
  });
}

// ----------------------------------------------------------------
// POST /api/completions/mark-paid-batch
// Body: { family_id: string, completion_ids: string[] }
// Atomic: all valid (same family, status='completed', unstamped) or none.
// ----------------------------------------------------------------
export async function handleMarkPaidBatch(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can mark a payment', 403);

  let body: { family_id?: string; completion_ids?: string[] };
  try { body = await request.json(); } catch { return error('Invalid JSON body'); }

  const familyId = body.family_id;
  const ids = body.completion_ids;
  if (!familyId) return error('family_id required');
  if (familyId !== auth.family_id) return error('Forbidden', 403);
  if (!Array.isArray(ids) || ids.length === 0) return error('completion_ids required');
  if (ids.length > 100) return error('Max 100 completions per batch');

  // Validate every row in one query.
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB
    .prepare(
      `SELECT id, family_id, status, paid_out_at FROM completions WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{ id: string; family_id: string; status: string; paid_out_at: number | null }>();

  const foundIds = new Set(rows.results.map((r) => r.id));
  for (const id of ids) {
    if (!foundIds.has(id)) return error(`Completion ${id} not found`, 404);
  }
  for (const r of rows.results) {
    if (r.family_id !== familyId) return error('Forbidden', 403);
    if (r.status !== 'completed')
      return error(`Completion ${r.id} is '${r.status}', cannot mark paid`, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const toStamp = rows.results.filter((r) => r.paid_out_at == null).map((r) => r.id);

  if (toStamp.length > 0) {
    const stmts = toStamp.map((id) =>
      env.DB
        .prepare('UPDATE completions SET paid_out_at = ? WHERE id = ?')
        .bind(now, id),
    );
    await env.DB.batch(stmts);
  }

  return json({ stamped: toStamp.length, paid_out_at: now });
}

// ----------------------------------------------------------------
// GET /api/completions/unpaid-summary?family_id=
// Per-child aggregate of completed-but-unpaid completions.
// ----------------------------------------------------------------
export async function handleUnpaidSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can view unpaid summary', 403);

  const url = new URL(request.url);
  const familyId = url.searchParams.get('family_id');
  if (!familyId) return error('family_id required');
  if (familyId !== auth.family_id) return error('Forbidden', 403);

  const rows = await env.DB
    .prepare(
      `SELECT comp.child_id,
              SUM(ch.reward_amount) AS unpaid_total,
              COUNT(*)              AS unpaid_count,
              ch.currency
         FROM completions comp
         JOIN chores ch ON ch.id = comp.chore_id
        WHERE comp.family_id = ?
          AND comp.status = 'completed'
          AND comp.paid_out_at IS NULL
        GROUP BY comp.child_id, ch.currency`,
    )
    .bind(familyId)
    .all<{ child_id: string; unpaid_total: number; unpaid_count: number; currency: string }>();

  return json({ children: rows.results });
}
```

- [ ] **Step 2: Register routes in `index.ts`**

Edit `worker/src/index.ts`. Find the imports block around line 62-65 and add the new handlers:

```ts
import {
  handleCompletionList, handleCompletionCount, handleCompletionHistory,
  handleCompletionApprove, handleCompletionRevise,
  handleCompletionRate, handleApproveAll,
} from './routes/completions.js';
import {
  handleMarkPaid, handleMarkPaidBatch, handleUnpaidSummary,
} from './routes/payments.js';
```

Find the completions routing block (around line 482-486) and add the new routes **before** the `compApproveMatch` line, so the static path `mark-paid-batch` and `unpaid-summary` are matched before the `:id/approve` regex:

```ts
  if (path === '/api/completions/mark-paid-batch'  && method === 'POST') return withAuth(request, auth, env, handleMarkPaidBatch);
  if (path === '/api/completions/unpaid-summary'   && method === 'GET')  return withAuth(request, auth, env, handleUnpaidSummary);
  const compMarkPaidMatch = path.match(/^\/api\/completions\/([^/]+)\/mark-paid$/);
  if (compMarkPaidMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleMarkPaid(req, e, compMarkPaidMatch[1]));

  const compApproveMatch = path.match(/^\/api\/completions\/([^/]+)\/approve$/);
  if (compApproveMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleCompletionApprove(req, e, compApproveMatch[1]));
  // ... existing lines unchanged
```

- [ ] **Step 3: Start the worker locally**

Run from project root in one terminal:

```bash
cd worker && npm run dev
```

Expected: `Listening at http://localhost:8787`. Keep it running.

- [ ] **Step 4: Seed a completed-but-unpaid row**

In a second terminal from project root, create a test completion row that's already in `status='completed'` but with `paid_out_at IS NULL`:

```bash
cd worker && npx wrangler d1 execute morechard --local --command "
  SELECT id, child_id, status, paid_out_at FROM completions WHERE status = 'completed' LIMIT 3;
"
```

Expected: at least one row. Note one ID — call it `<CID>` below.

If no completed rows exist, approve one via the app UI first, then repeat the query.

- [ ] **Step 5: Integration test — `unpaid-summary`**

Substitute a real JWT from the app (read it from devtools → Application → Cookies, cookie name `auth_token`, copy the value).

```bash
curl -s 'http://localhost:8787/api/completions/unpaid-summary?family_id=<YOUR_FAMILY_ID>' \
  -H 'Cookie: auth_token=<JWT>' | jq .
```

Expected:
```json
{ "children": [ { "child_id": "...", "unpaid_total": 500, "unpaid_count": 1, "currency": "GBP" } ] }
```

- [ ] **Step 6: Integration test — `mark-paid` (happy path)**

```bash
curl -s -X POST "http://localhost:8787/api/completions/<CID>/mark-paid" \
  -H 'Cookie: auth_token=<JWT>' | jq .
```

Expected:
```json
{ "completion_id": "<CID>", "paid_out_at": 1745..., "was_already_paid": false }
```

- [ ] **Step 7: Integration test — `mark-paid` (idempotent)**

Re-run the same command:

```bash
curl -s -X POST "http://localhost:8787/api/completions/<CID>/mark-paid" \
  -H 'Cookie: auth_token=<JWT>' | jq .
```

Expected: same `paid_out_at` timestamp, `"was_already_paid": true`.

- [ ] **Step 8: Integration test — `mark-paid-batch` atomic rejection**

Send one valid ID and one bogus ID. The batch should reject and neither should be stamped.

```bash
curl -s -X POST http://localhost:8787/api/completions/mark-paid-batch \
  -H 'Cookie: auth_token=<JWT>' \
  -H 'Content-Type: application/json' \
  -d '{"family_id":"<YOUR_FAMILY_ID>","completion_ids":["bogus_id","<CID2>"]}' | jq .
```

Expected: `{"error": "Completion bogus_id not found"}`, HTTP 404. Verify `<CID2>` is still `paid_out_at = NULL`:

```bash
cd worker && npx wrangler d1 execute morechard --local --command "
  SELECT id, paid_out_at FROM completions WHERE id = '<CID2>';
"
```

Expected: `paid_out_at | NULL`.

- [ ] **Step 9: Verify `unpaid-summary` excludes stamped rows**

Re-run Step 5. Expected: the child whose completion you stamped now has a smaller `unpaid_count` (or no row if that was their only unpaid).

- [ ] **Step 10: Commit**

```bash
git add worker/src/routes/payments.ts worker/src/index.ts
git commit -m "feat(worker): payment bridge routes

mark-paid (idempotent), mark-paid-batch (atomic), unpaid-summary.
Parent-only, family-scoped. No ledger writes — paid_out_at is
delivery metadata, not a chain-affecting field."
```

---

## Task 6: API client functions

**Files:**
- Modify: `app/src/lib/api.ts`

- [ ] **Step 1: Find the `Completion` and `ChildRecord` types**

Run from project root:

```bash
grep -n "interface Completion\|interface ChildRecord\|export type Completion\|export type ChildRecord" "app/src/lib/api.ts"
```

Note the line numbers.

- [ ] **Step 2: Extend `Completion`**

In `app/src/lib/api.ts`, find the `Completion` interface and add at the end of its field list:

```ts
  paid_out_at: number | null;
```

- [ ] **Step 3: Extend `ChildRecord`**

Find the `ChildRecord` interface and add:

```ts
  monzo_handle: string | null;
  revolut_handle: string | null;
  paypal_handle: string | null;
  venmo_handle: string | null;
```

- [ ] **Step 4: Add API functions**

Append to `app/src/lib/api.ts` (below `approveAll`):

```ts
// ── Payment Bridge ─────────────────────────────────────────────────

export type MarkPaidResult = {
  completion_id: string;
  paid_out_at: number;
  was_already_paid: boolean;
};

export async function markPaid(completionId: string): Promise<MarkPaidResult> {
  return request(`/api/completions/${completionId}/mark-paid`, { method: 'POST' });
}

export async function markPaidBatch(
  familyId: string,
  completionIds: string[],
): Promise<{ stamped: number; paid_out_at: number }> {
  return request('/api/completions/mark-paid-batch', {
    method: 'POST',
    body: JSON.stringify({ family_id: familyId, completion_ids: completionIds }),
  });
}

export type UnpaidSummaryRow = {
  child_id: string;
  unpaid_total: number;
  unpaid_count: number;
  currency: string;
};

export async function getUnpaidSummary(
  familyId: string,
): Promise<{ children: UnpaidSummaryRow[] }> {
  return request(`/api/completions/unpaid-summary?family_id=${encodeURIComponent(familyId)}`);
}
```

- [ ] **Step 5: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors. If errors appear about missing fields on `Completion` in other files, fix them by making the new field optional with `?` or default to `null` where constructed — do NOT cast to `any`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/api.ts
git commit -m "feat(app): markPaid / markPaidBatch / getUnpaidSummary API client"
```

---

## Task 7: `DeepLinkHandler` component

**Files:**
- Create: `app/src/components/payment/DeepLinkHandler.tsx`

- [ ] **Step 1: Create the directory**

Run from project root:

```bash
mkdir -p app/src/components/payment
```

- [ ] **Step 2: Implement**

Create `app/src/components/payment/DeepLinkHandler.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

type Status = 'pending' | 'opened' | 'fallback';

type Props = {
  url: string;
  onOpened: () => void;    // fired when we're confident the deep link resolved
  onFallback: () => void;  // fired when it didn't (show Smart Copy with apology)
};

// Best-effort detection of whether a custom-scheme or https deep link
// actually opened an external app.
// - Capacitor native: App.openUrl returns { completed: boolean }, use it directly.
// - PWA: rely on visibilitychange. If the page hides within ~1.5s, the OS
//   switched apps → success. If it never hides, the scheme didn't resolve.
export function DeepLinkHandler({ url, onOpened, onFallback }: Props) {
  const [status, setStatus] = useState<Status>('pending');
  const firedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pageHidden = false;

    function onVisibility() {
      if (document.hidden) pageHidden = true;
    }
    document.addEventListener('visibilitychange', onVisibility);

    (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          // Capacitor App plugin's openUrl can be used to launch external URIs.
          // Returns { completed: true } when the URI was handed off successfully.
          const res = await App.openUrl({ url });
          if (cancelled) return;
          if (res.completed) { fire('opened'); } else { fire('fallback'); }
        } catch {
          if (!cancelled) fire('fallback');
        }
        return;
      }

      // Web/PWA path.
      window.location.href = url;

      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;
      fire(pageHidden ? 'opened' : 'fallback');
    })();

    function fire(s: Status) {
      if (firedRef.current) return;
      firedRef.current = true;
      setStatus(s);
      if (s === 'opened') onOpened();
      else onFallback();
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, onOpened, onFallback]);

  // Invisible — parent component owns the UI.
  return null;
}
```

- [ ] **Step 3: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/payment/DeepLinkHandler.tsx
git commit -m "feat(app): DeepLinkHandler with visibility-based success detection

Native: App.openUrl returns completed flag.
PWA: 1.5s visibilitychange sentinel — if the page never hides, the
scheme didn't resolve and we fall back to Smart Copy."
```

---

## Task 8: `SmartCopyPanel` component

**Files:**
- Create: `app/src/components/payment/SmartCopyPanel.tsx`

- [ ] **Step 1: Implement**

Create `app/src/components/payment/SmartCopyPanel.tsx`:

```tsx
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { tick } from '../../lib/haptics';
import { cn } from '../../lib/utils';

type Row = { label: string; value: string };

type Props = {
  rows: Row[];
  warningBanner?: string; // e.g., "Details stored on this device only"
  apologyBanner?: string; // e.g., "Couldn't open Monzo — copy instead"
};

export function SmartCopyPanel({ rows, warningBanner, apologyBanner }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      {apologyBanner && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-900">
          {apologyBanner}
        </div>
      )}
      {warningBanner && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-[12px] text-neutral-600">
          {warningBanner}
        </div>
      )}
      {rows.map((r) => (
        <CopyRow key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

function CopyRow({ label, value }: Row) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    // Fire haptic synchronously inside the click handler — required for
    // Android Chrome's user-gesture vibration rule.
    void tick();
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
        copied
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-white border-neutral-200 active:bg-neutral-50',
      )}
    >
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
        <div className="text-[15px] font-semibold font-mono truncate">{value}</div>
      </div>
      <div className={cn('shrink-0 ml-3', copied ? 'text-emerald-600' : 'text-neutral-400')}>
        {copied ? <Check size={20} /> : <Copy size={18} />}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/payment/SmartCopyPanel.tsx
git commit -m "feat(app): SmartCopyPanel with copy-with-haptic rows"
```

---

## Task 9: `PaymentConfirmSheet` component

**Files:**
- Create: `app/src/components/payment/PaymentConfirmSheet.tsx`

- [ ] **Step 1: Implement**

Create `app/src/components/payment/PaymentConfirmSheet.tsx`:

```tsx
import { useState } from 'react';
import { tick } from '../../lib/haptics';
import { markPaid, markPaidBatch, formatCurrency } from '../../lib/api';

type Props = {
  familyId: string;
  completionIds: string[];
  totalMinorUnits: number;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
};

export function PaymentConfirmSheet({
  familyId, completionIds, totalMinorUnits, currency, onDone, onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleYes() {
    // Fire haptic synchronously — before any await — so the gesture
    // context is still valid on Android Chrome.
    void tick();
    setBusy(true);
    setErr(null);
    try {
      if (completionIds.length === 1) {
        await markPaid(completionIds[0]);
      } else {
        await markPaidBatch(familyId, completionIds);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="text-center pt-2">
        <div className="text-[20px] font-bold">Did the payment go through?</div>
        <div className="mt-1 text-[13px] text-neutral-500">
          We can&apos;t check with your bank — just tap Yes if the transfer was sent.
        </div>
        <div className="mt-3 text-[17px] font-semibold">
          {formatCurrency(totalMinorUnits, currency)}
          {completionIds.length > 1 && (
            <span className="ml-2 text-[13px] font-normal text-neutral-500">
              ({completionIds.length} rewards)
            </span>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[13px] text-rose-900">
          Couldn&apos;t update — {err}. Tap retry.
        </div>
      )}

      <button
        type="button"
        onClick={handleYes}
        disabled={busy}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Saving…' : err ? 'Retry' : 'Yes, sent ✓'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full rounded-2xl bg-neutral-100 py-3.5 font-semibold text-neutral-700"
      >
        Not yet
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/payment/PaymentConfirmSheet.tsx
git commit -m "feat(app): PaymentConfirmSheet — Yes/Not yet stamping"
```

---

## Task 10: `PaymentTileGrid` component

**Files:**
- Create: `app/src/components/payment/PaymentTileGrid.tsx`

- [ ] **Step 1: Implement**

Create `app/src/components/payment/PaymentTileGrid.tsx`:

```tsx
import { Landmark } from 'lucide-react';

export type Provider = 'monzo' | 'revolut' | 'paypal' | 'venmo' | 'bank';

type Props = {
  onSelect: (p: Provider) => void;
  availability: Record<Provider, boolean>; // false → tile shows "Add handle" hint
};

const TILES: { id: Provider; label: string; emoji: string }[] = [
  { id: 'monzo',   label: 'Monzo',         emoji: '🟡' },
  { id: 'revolut', label: 'Revolut',       emoji: '⚫' },
  { id: 'paypal',  label: 'PayPal',        emoji: '🔵' },
  { id: 'venmo',   label: 'Venmo',         emoji: '💙' },
  { id: 'bank',    label: 'Bank Transfer', emoji: '🏦' },
];

export function PaymentTileGrid({ onSelect, availability }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3 px-4 pt-2 pb-4">
      {TILES.map((t) => {
        const ok = availability[t.id];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white py-4 active:bg-neutral-50"
          >
            {t.id === 'bank' ? (
              <Landmark size={24} />
            ) : (
              <span className="text-[22px]" aria-hidden>{t.emoji}</span>
            )}
            <span className="text-[13px] font-semibold">{t.label}</span>
            {!ok && t.id !== 'bank' && (
              <span className="text-[10px] text-neutral-400">No handle</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/payment/PaymentTileGrid.tsx
git commit -m "feat(app): PaymentTileGrid — 5-tile provider chooser"
```

---

## Task 11: `PaymentBridgeSheet` shell — deep-link flows

**Files:**
- Create: `app/src/components/payment/PaymentBridgeSheet.tsx`

- [ ] **Step 1: Implement (deep-link path only; bank transfer is next task)**

Create `app/src/components/payment/PaymentBridgeSheet.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  monzoUrl, revolutUrl, paypalUrl, venmoUrl, buildReference,
  type PayPalCurrency,
} from '../../lib/paymentBridge';
import { formatCurrency } from '../../lib/api';
import type { ChildRecord } from '../../lib/api';
import { PaymentTileGrid, type Provider } from './PaymentTileGrid';
import { DeepLinkHandler } from './DeepLinkHandler';
import { SmartCopyPanel } from './SmartCopyPanel';
import { PaymentConfirmSheet } from './PaymentConfirmSheet';

type Props = {
  open: boolean;
  onClose: () => void;
  familyId: string;
  child: ChildRecord;
  completionIds: string[];
  totalMinorUnits: number;
  currency: string;
  onPaid: () => void; // refresh unpaid summary after successful stamp
};

type View =
  | { kind: 'grid' }
  | { kind: 'deep-link-pending'; provider: Provider; url: string }
  | { kind: 'deep-link-fallback'; provider: Provider; rows: Row[] }
  | { kind: 'bank-copy'; rows: Row[] }
  | { kind: 'zelle-copy'; rows: Row[] }
  | { kind: 'confirm' };

type Row = { label: string; value: string };

export function PaymentBridgeSheet(props: Props) {
  const {
    open, onClose, familyId, child,
    completionIds, totalMinorUnits, currency, onPaid,
  } = props;

  const [view, setView] = useState<View>({ kind: 'grid' });
  const amountMajor = (totalMinorUnits / 100).toFixed(2);
  const reference = buildReference(child.display_name);

  // Android hardware Back button — close nested view first, then the sheet.
  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    App.addListener('backButton', () => {
      if (view.kind === 'grid') onClose();
      else setView({ kind: 'grid' });
    }).then((handle) => { remove = () => handle.remove(); });
    return () => { remove?.(); };
  }, [open, view.kind, onClose]);

  // Reset to grid each time the sheet opens.
  useEffect(() => {
    if (open) setView({ kind: 'grid' });
  }, [open]);

  const availability = {
    monzo:   !!child.monzo_handle,
    revolut: !!child.revolut_handle,
    paypal:  !!child.paypal_handle,
    venmo:   !!child.venmo_handle,
    bank:    true,
  };

  function handleTileSelect(p: Provider) {
    if (p === 'bank') {
      // Handled in Task 12.
      setView({ kind: 'bank-copy', rows: [] });
      return;
    }
    if (p === 'monzo' && child.monzo_handle) {
      const url = monzoUrl(child.monzo_handle, amountMajor);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'revolut' && child.revolut_handle) {
      const url = revolutUrl(child.revolut_handle, amountMajor);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'paypal' && child.paypal_handle) {
      const url = paypalUrl(child.paypal_handle, amountMajor, currency as PayPalCurrency);
      if (url) return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    if (p === 'venmo' && child.venmo_handle) {
      const url = venmoUrl(child.venmo_handle, amountMajor, reference);
      return setView({ kind: 'deep-link-pending', provider: p, url });
    }
    // No handle → stay on grid; user taps another tile or closes.
  }

  function handleDeepLinkOpened() {
    setView({ kind: 'confirm' });
  }

  function handleDeepLinkFallback(provider: Provider) {
    const rows: Row[] = [
      { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
      { label: 'Recipient', value: child.display_name },
      { label: 'Reference', value: reference },
    ];
    setView({ kind: 'deep-link-fallback', provider, rows });
  }

  function handlePaymentDone() {
    onPaid();
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 bottom-0 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl bg-white pb-safe"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Payment Bridge</Dialog.Title>
          <div className="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-neutral-300" />

          <div className="px-4 pt-1 pb-2">
            <div className="text-[13px] text-neutral-500">Pay {child.display_name}</div>
            <div className="text-[22px] font-bold">
              {formatCurrency(totalMinorUnits, currency)}
              {completionIds.length > 1 && (
                <span className="ml-2 text-[13px] font-normal text-neutral-500">
                  ({completionIds.length} rewards)
                </span>
              )}
            </div>
          </div>

          {view.kind === 'grid' && (
            <PaymentTileGrid onSelect={handleTileSelect} availability={availability} />
          )}

          {view.kind === 'deep-link-pending' && (
            <>
              <div className="px-4 py-6 text-center text-[14px] text-neutral-500">
                Opening your {view.provider} app…
              </div>
              <DeepLinkHandler
                url={view.url}
                onOpened={handleDeepLinkOpened}
                onFallback={() => handleDeepLinkFallback(view.provider)}
              />
            </>
          )}

          {view.kind === 'deep-link-fallback' && (
            <SmartCopyPanel
              rows={view.rows}
              apologyBanner={`Couldn't open ${view.provider}. Copy the details below and switch apps manually.`}
            />
          )}

          {view.kind === 'confirm' && (
            <PaymentConfirmSheet
              familyId={familyId}
              completionIds={completionIds}
              totalMinorUnits={totalMinorUnits}
              currency={currency}
              onDone={handlePaymentDone}
              onCancel={() => setView({ kind: 'grid' })}
            />
          )}

          {/* bank-copy and zelle-copy rendered in Task 12 */}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors. If `formatCurrency` isn't exported at that path, adjust the import to match the actual export.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/payment/PaymentBridgeSheet.tsx
git commit -m "feat(app): PaymentBridgeSheet — deep-link flows

Tile grid, DeepLinkHandler, fallback Smart Copy, confirm. Bank and
Zelle paths wired in the next task. Android Back button closes nested
views first, then the sheet."
```

---

## Task 12: Bank Transfer + Zelle Smart Copy paths

**Files:**
- Modify: `app/src/components/payment/PaymentBridgeSheet.tsx`

- [ ] **Step 1: Add bank-transfer view state**

In `PaymentBridgeSheet.tsx`, add above the `handleTileSelect` function a helper that builds the rows when a `StoredBankDetails` exists:

```tsx
import { getDetails } from '../../lib/localBankDetails';
import { useMemo } from 'react';
```

- [ ] **Step 2: Replace the bank-copy placeholder in `handleTileSelect`**

Replace:

```tsx
    if (p === 'bank') {
      setView({ kind: 'bank-copy', rows: [] });
      return;
    }
```

with:

```tsx
    if (p === 'bank') {
      const saved = getDetails(familyId, child.id);
      // UK has sort code + account number; US uses Zelle (email/phone).
      if (saved?.zelleHandle && !saved?.sortCode) {
        setView({
          kind: 'zelle-copy',
          rows: [
            { label: 'Zelle (email/phone)', value: saved.zelleHandle },
            { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
            { label: 'Reference', value: reference },
          ],
        });
        return;
      }
      if (saved?.sortCode && saved?.accountNumber) {
        setView({
          kind: 'bank-copy',
          rows: [
            { label: 'Sort Code', value: saved.sortCode },
            { label: 'Account Number', value: saved.accountNumber },
            { label: 'Amount', value: formatCurrency(totalMinorUnits, currency) },
            { label: 'Reference', value: reference },
          ],
        });
        return;
      }
      // No saved details — prompt the parent inline. V1 minimal form:
      // eslint-disable-next-line no-alert
      alert(`No bank details saved for ${child.display_name}. Add them in the child's profile first.`);
      return;
    }
```

- [ ] **Step 3: Render the bank-copy and zelle-copy views**

In the JSX, after the `deep-link-fallback` block, add:

```tsx
          {view.kind === 'bank-copy' && (
            <>
              <SmartCopyPanel
                rows={view.rows}
                warningBanner="Saved on this device only. We'll upgrade this to encrypted storage soon."
              />
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'confirm' })}
                  className="w-full rounded-2xl bg-neutral-900 py-3 font-semibold text-white"
                >
                  I&apos;ve sent it — next
                </button>
              </div>
            </>
          )}

          {view.kind === 'zelle-copy' && (
            <>
              <SmartCopyPanel
                rows={view.rows}
                warningBanner="Open your banking app and find Zelle to complete the transfer."
              />
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'confirm' })}
                  className="w-full rounded-2xl bg-neutral-900 py-3 font-semibold text-white"
                >
                  I&apos;ve sent it — next
                </button>
              </div>
            </>
          )}
```

- [ ] **Step 4: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors. The unused-`useMemo` import can be removed if ESLint complains.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/payment/PaymentBridgeSheet.tsx
git commit -m "feat(app): bank-transfer and Zelle Smart Copy views in bridge"
```

---

## Task 13: `UnpaidIndicator` + wire into child card

**Files:**
- Create: `app/src/components/payment/UnpaidIndicator.tsx`
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx` or wherever child cards render (see Step 1)

- [ ] **Step 1: Locate the child card**

Run from project root:

```bash
grep -rn "child.display_name\|ChildRecord" "app/src/components/dashboard/" | grep -v ".test." | head -20
```

Find the component that renders a child's headline balance. It is most likely inside `EarnTab.tsx`, `JobsTab.tsx`, or a shared child-card. Note the file path — call it `<CARD_FILE>`.

- [ ] **Step 2: Implement the indicator**

Create `app/src/components/payment/UnpaidIndicator.tsx`:

```tsx
import { formatCurrency } from '../../lib/api';

type Props = {
  unpaidMinorUnits: number;
  currency: string;
  onClick?: () => void;
};

export function UnpaidIndicator({ unpaidMinorUnits, currency, onClick }: Props) {
  if (unpaidMinorUnits <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-[12px] font-semibold text-amber-900"
    >
      Unpaid: {formatCurrency(unpaidMinorUnits, currency)}
    </button>
  );
}
```

- [ ] **Step 3: Wire into `<CARD_FILE>`**

In the file you identified in Step 1, locate the parent dashboard parent-tab that already fetches the child list (likely `ParentDashboard.tsx` or a tab component). Add state + fetch:

```tsx
import { useEffect, useState } from 'react';
import { getUnpaidSummary, type UnpaidSummaryRow } from '../../lib/api';
import { UnpaidIndicator } from '../payment/UnpaidIndicator';
import { PaymentBridgeSheet } from '../payment/PaymentBridgeSheet';

// Inside the component that owns the child list:
const [unpaid, setUnpaid] = useState<UnpaidSummaryRow[]>([]);
const [bridgeCtx, setBridgeCtx] = useState<null | {
  child: ChildRecord; completionIds: string[]; total: number; currency: string;
}>(null);

async function refreshUnpaid() {
  try { setUnpaid((await getUnpaidSummary(familyId)).children); }
  catch { /* non-fatal */ }
}

useEffect(() => { refreshUnpaid(); }, [familyId]);
```

In the child-card render, inject the indicator beside the headline balance. If the indicator is tapped, you need the actual completion IDs to stamp — fetch them on tap:

```tsx
import { getCompletions } from '../../lib/api';

async function openBridgeForChild(child: ChildRecord, row: UnpaidSummaryRow) {
  const r = await getCompletions({
    family_id: familyId, child_id: child.id, status: 'completed',
  });
  const unpaidIds = r.completions
    .filter((c) => c.paid_out_at == null)
    .map((c) => c.id);
  if (unpaidIds.length === 0) { refreshUnpaid(); return; }
  setBridgeCtx({
    child,
    completionIds: unpaidIds,
    total: row.unpaid_total,
    currency: row.currency,
  });
}
```

Then in JSX:

```tsx
{(() => {
  const row = unpaid.find((u) => u.child_id === child.id);
  if (!row) return null;
  return (
    <UnpaidIndicator
      unpaidMinorUnits={row.unpaid_total}
      currency={row.currency}
      onClick={() => openBridgeForChild(child, row)}
    />
  );
})()}

{bridgeCtx && (
  <PaymentBridgeSheet
    open={true}
    onClose={() => setBridgeCtx(null)}
    familyId={familyId}
    child={bridgeCtx.child}
    completionIds={bridgeCtx.completionIds}
    totalMinorUnits={bridgeCtx.total}
    currency={bridgeCtx.currency}
    onPaid={refreshUnpaid}
  />
)}
```

- [ ] **Step 4: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual verification**

1. Start the app: `cd worker && npm run dev` (in one terminal), `cd app && npm run dev` (in another).
2. Log in as a parent; approve a chore so there's a completed/unpaid completion.
3. Expected: amber "Unpaid: £X.XX" pill appears next to the child's name/balance.
4. Tap the pill → Payment Bridge opens with 5 tiles.
5. Tap Bank Transfer → (if no details saved) alert fires. Add details via the browser console:
   ```js
   // temporary — replace with proper form in a later iteration
   const fam = '<YOUR_FAMILY_ID>';
   const cid = '<YOUR_CHILD_ID>';
   const store = JSON.parse(localStorage.getItem(`morechard.bankdetails.v1.${fam}`) || '{}');
   store[cid] = { childId: cid, sortCode: '201575', accountNumber: '12345678', updatedAt: Date.now() };
   localStorage.setItem(`morechard.bankdetails.v1.${fam}`, JSON.stringify(store));
   ```
6. Tap Bank Transfer again → Smart Copy rows render with Sort Code, Account Number, Amount, Reference.
7. Tap each copy button → haptic (on a device with vibration) + checkmark animation.
8. Tap "I've sent it — next" → confirmation sheet.
9. Tap "Yes, sent" → sheet closes, amber pill disappears.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/payment/UnpaidIndicator.tsx <CARD_FILE>
git commit -m "feat(app): wire UnpaidIndicator and PaymentBridgeSheet into parent dashboard

Tapping the Unpaid pill fetches the child's unpaid completion IDs and
opens the bridge in batch mode. onPaid refreshes the summary."
```

---

## Task 14: Approve-flow integration — post-approve "Pay Now" toast

**Files:**
- Modify: `app/src/components/dashboard/PendingTab.tsx`

- [ ] **Step 1: Import what we need**

At the top of `PendingTab.tsx`, alongside existing imports, add:

```tsx
import { PaymentBridgeSheet } from '../payment/PaymentBridgeSheet';
import { useToast, Toast } from '../settings/shared';
```

- [ ] **Step 2: Add state for toast + bridge**

Inside the `PendingTab` component body, just below the existing `useState` block, add:

```tsx
const { toast, showToast } = useToast();
const [bridgeCtx, setBridgeCtx] = useState<null | {
  completionIds: string[];
  total: number;
  currency: string;
}>(null);
const [pendingToastAction, setPendingToastAction] = useState<null | {
  label: string;
  onClick: () => void;
}>(null);
```

- [ ] **Step 3: Modify `handleApprove` to offer "Pay Now"**

Replace the existing `handleApprove` with:

```tsx
async function handleApprove(id: string) {
  setBusy(id);
  try {
    await approveCompletion(id);
    // Find the completion we just approved so we know the amount/currency.
    const approved = completions.find((c) => c.id === id);
    await load();
    if (approved) {
      setPendingToastAction({
        label: `Pay Now (${formatCurrency(approved.reward_amount, approved.currency)})`,
        onClick: () => setBridgeCtx({
          completionIds: [approved.id],
          total: approved.reward_amount,
          currency: approved.currency,
        }),
      });
      showToast(`Approved ✓`);
    }
  } finally {
    setBusy(null);
  }
}
```

- [ ] **Step 4: Modify `handleConfirmApproveAll` to offer batch Pay Now**

Replace the existing `handleConfirmApproveAll` with:

```tsx
async function handleConfirmApproveAll() {
  setShowApproveAllModal(false);
  setApproveAllBusy(true);
  // Snapshot the to-be-approved set BEFORE the call, because `completions`
  // is refilled by load() after.
  const snapshot = completions.map((c) => ({
    id: c.id, amount: c.reward_amount, currency: c.currency,
  }));
  try {
    await approveAll(familyId, child.id);
    await load();

    // PendingTab is scoped to one child already (see the `child` prop),
    // so we only need to split by currency.
    const byCurrency = new Map<string, { ids: string[]; total: number }>();
    for (const r of snapshot) {
      const bucket = byCurrency.get(r.currency) ?? { ids: [], total: 0 };
      bucket.ids.push(r.id);
      bucket.total += r.amount;
      byCurrency.set(r.currency, bucket);
    }

    if (byCurrency.size === 1) {
      const [[currency, bucket]] = [...byCurrency.entries()];
      setPendingToastAction({
        label: `Pay Now (${formatCurrency(bucket.total, currency)})`,
        onClick: () => setBridgeCtx({
          completionIds: bucket.ids,
          total: bucket.total,
          currency,
        }),
      });
    }
    // If multi-currency, skip the auto-offer — parent can use the Unpaid pill.

    showToast(`${snapshot.length} approved ✓`);
  } finally {
    setApproveAllBusy(false);
  }
}
```

- [ ] **Step 5: Render toast, action button, and bridge**

At the bottom of the `return` JSX, just before the closing tag, add:

```tsx
{toast && <Toast message={toast} />}

{toast && pendingToastAction && (
  <button
    type="button"
    onClick={() => {
      pendingToastAction.onClick();
      setPendingToastAction(null);
    }}
    className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-600 text-white text-[13px] font-semibold shadow-lg"
  >
    {pendingToastAction.label}
  </button>
)}

{bridgeCtx && (
  <PaymentBridgeSheet
    open={true}
    onClose={() => setBridgeCtx(null)}
    familyId={familyId}
    child={child}
    completionIds={bridgeCtx.completionIds}
    totalMinorUnits={bridgeCtx.total}
    currency={bridgeCtx.currency}
    onPaid={() => { /* parent dashboard refetches unpaid-summary on its own */ }}
  />
)}
```

- [ ] **Step 6: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 7: Manual verification**

1. Start worker + app (see Task 13 Step 5).
2. As a child, submit a chore.
3. As a parent, open PendingTab and approve it.
4. Expected: "Approved ✓" toast appears; green "Pay Now (£X.XX)" button appears above it.
5. Tap "Pay Now" → Payment Bridge opens for that completion.
6. Close the bridge without confirming → toast and button fade after 3s.
7. Submit 3 chores, approve-all → "3 approved ✓" toast + batched Pay Now button with summed total.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/dashboard/PendingTab.tsx
git commit -m "feat(app): post-approve 'Pay Now' toast wires PendingTab into Payment Bridge

Single approval offers single-ID bridge. Approve-all offers the sum
for the current child (PendingTab is already child-scoped). Multi-
currency approve-all defers to the Unpaid pill."
```

---

## Task 15: Child profile — payment handle settings

**Files:**
- Modify: the child-edit UI (identify via Step 1)

- [ ] **Step 1: Locate the child-edit form**

Run from project root:

```bash
grep -rn "display_name.*PATCH\|/api/child/" "app/src/components/" | head -15
```

Identify the form component that edits a child's display name or profile — call it `<CHILD_FORM>`. (If no form exists yet, this task adds one; see Step 3 for the minimum.)

- [ ] **Step 2: Add a PATCH endpoint on the worker for handles**

*If* a generic child PATCH endpoint already accepts arbitrary fields, skip to Step 3. Otherwise, add to `worker/src/routes/payments.ts`:

```ts
// ----------------------------------------------------------------
// PATCH /api/child/:id/payment-handles
// Body: { monzo_handle?, revolut_handle?, paypal_handle?, venmo_handle? }
// Pass null to clear a handle. Parent-only.
// ----------------------------------------------------------------
export async function handleSetPaymentHandles(
  request: Request,
  env: Env,
  childId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Only parents can edit handles', 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error('Invalid JSON body'); }

  // Morechard uses `users` + `family_roles` — verify the target is a child
  // in the caller's family in one query (pattern from chores.ts:61-65).
  const child = await env.DB
    .prepare(`SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
              WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'child'`)
    .bind(childId, auth.family_id)
    .first<{ id: string }>();
  if (!child) return error('Child not found in this family', 404);

  const allowed = ['monzo_handle', 'revolut_handle', 'paypal_handle', 'venmo_handle'];
  const updates: { col: string; val: string | null }[] = [];
  for (const col of allowed) {
    if (col in body) {
      const v = body[col];
      if (v !== null && typeof v !== 'string') return error(`${col} must be string or null`);
      // Strip leading '@' and whitespace — handles are the bare username.
      const clean = v === null ? null : String(v).trim().replace(/^@/, '');
      updates.push({ col, val: clean });
    }
  }
  if (updates.length === 0) return error('No fields to update');

  const set = updates.map((u) => `${u.col} = ?`).join(', ');
  const vals = updates.map((u) => u.val);
  await env.DB
    .prepare(`UPDATE users SET ${set} WHERE id = ?`)
    .bind(...vals, childId)
    .run();

  return json({ child_id: childId, updated: updates.map((u) => u.col) });
}
```

Register in `worker/src/index.ts`:

```ts
// In imports from './routes/payments.js':
handleSetPaymentHandles,

// In routing section, near other child routes:
const childHandlesMatch = path.match(/^\/api\/child\/([^/]+)\/payment-handles$/);
if (childHandlesMatch && method === 'PATCH') return withAuth(request, auth, env, (req, e) => handleSetPaymentHandles(req, e, childHandlesMatch[1]));
```

- [ ] **Step 3: Add API client fn**

In `app/src/lib/api.ts`:

```ts
export async function setPaymentHandles(
  childId: string,
  handles: Partial<{
    monzo_handle: string | null;
    revolut_handle: string | null;
    paypal_handle: string | null;
    venmo_handle: string | null;
  }>,
): Promise<{ child_id: string; updated: string[] }> {
  return request(`/api/child/${childId}/payment-handles`, {
    method: 'PATCH',
    body: JSON.stringify(handles),
  });
}
```

- [ ] **Step 4: Add handle inputs to `<CHILD_FORM>`**

In the child-edit form component, add four input rows. Minimal version:

```tsx
<section className="mt-6">
  <div className="text-[14px] font-semibold mb-2">Payment handles</div>
  <div className="text-[12px] text-neutral-500 mb-3">
    The child&apos;s Monzo.me, Revolut.me, PayPal.me, or Venmo username —
    no @ sign. Used to deep-link into your banking apps when you pay rewards.
  </div>
  {(['monzo', 'revolut', 'paypal', 'venmo'] as const).map((p) => (
    <label key={p} className="flex items-center gap-3 py-2 border-b last:border-0">
      <span className="w-20 text-[13px] capitalize">{p}</span>
      <input
        type="text"
        defaultValue={child[`${p}_handle`] ?? ''}
        onBlur={async (e) => {
          const val = e.target.value.trim() || null;
          await setPaymentHandles(child.id, { [`${p}_handle`]: val });
        }}
        placeholder={p === 'paypal' ? 'alexj' : `alex${p === 'venmo' ? 'j' : ''}`}
        className="flex-1 rounded-lg border px-2 py-1 text-[14px]"
      />
    </label>
  ))}
</section>
```

- [ ] **Step 5: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manual verification**

1. Open child-edit screen as a parent.
2. Enter a Monzo handle, blur the input.
3. Verify in DB:
   ```bash
   cd worker && npx wrangler d1 execute morechard --local --command "
     SELECT id, monzo_handle FROM users WHERE id = '<CID>';"
   ```
   Expected: handle matches what you typed.
4. Approve a chore → open bridge → Monzo tile now shows no "No handle" hint; tapping it attempts the deep link.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/api.ts worker/src/routes/payments.ts worker/src/index.ts <CHILD_FORM>
git commit -m "feat(app): child-profile payment-handle editor + PATCH endpoint

Four inputs (Monzo/Revolut/PayPal/Venmo), @-stripping on save, parent-
only, family-scoped."
```

---

## Task 16: Bank-details form on child profile (stop using console to seed)

**Files:**
- Modify: `<CHILD_FORM>` (from Task 15)

- [ ] **Step 1: Add a Bank Transfer section beneath the payment handles section**

```tsx
import { getDetails, setDetails, clearDetails } from '../../lib/localBankDetails';

// Inside the child-edit component:
const [sortCode, setSortCode] = useState(
  () => getDetails(familyId, child.id)?.sortCode ?? '',
);
const [acctNum, setAcctNum] = useState(
  () => getDetails(familyId, child.id)?.accountNumber ?? '',
);
const [zelle, setZelle] = useState(
  () => getDetails(familyId, child.id)?.zelleHandle ?? '',
);

function saveBankDetails() {
  if (!sortCode && !acctNum && !zelle) {
    clearDetails(familyId, child.id);
    return;
  }
  setDetails(familyId, child.id, {
    childId: child.id,
    sortCode: sortCode || undefined,
    accountNumber: acctNum || undefined,
    zelleHandle: zelle || undefined,
    updatedAt: 0,
  });
}
```

In JSX:

```tsx
<section className="mt-6">
  <div className="text-[14px] font-semibold mb-1">Bank transfer details</div>
  <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-[11px] text-neutral-600 mb-3">
    Stored on this device only — never sent to our servers. If you switch
    phones, you&apos;ll re-enter them. We&apos;ll upgrade this to encrypted
    storage in a future release.
  </div>
  <label className="flex items-center gap-3 py-2 border-b">
    <span className="w-32 text-[13px]">Sort code</span>
    <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
      value={sortCode} onChange={(e) => setSortCode(e.target.value.replace(/\D/g, ''))}
      onBlur={saveBankDetails}
      placeholder="201575"
      className="flex-1 rounded-lg border px-2 py-1 font-mono text-[14px]" />
  </label>
  <label className="flex items-center gap-3 py-2 border-b">
    <span className="w-32 text-[13px]">Account number</span>
    <input inputMode="numeric" pattern="[0-9]{8}" maxLength={8}
      value={acctNum} onChange={(e) => setAcctNum(e.target.value.replace(/\D/g, ''))}
      onBlur={saveBankDetails}
      placeholder="12345678"
      className="flex-1 rounded-lg border px-2 py-1 font-mono text-[14px]" />
  </label>
  <label className="flex items-center gap-3 py-2">
    <span className="w-32 text-[13px]">Zelle (US)</span>
    <input type="text"
      value={zelle} onChange={(e) => setZelle(e.target.value)}
      onBlur={saveBankDetails}
      placeholder="alex@example.com"
      className="flex-1 rounded-lg border px-2 py-1 text-[14px]" />
  </label>
</section>
```

- [ ] **Step 2: Replace the `alert(…)` in `PaymentBridgeSheet` with a real empty-state**

In `PaymentBridgeSheet.tsx`, add a new view kind:

```tsx
type View =
  | { kind: 'grid' }
  | { kind: 'bank-empty' }
  | /* existing kinds */;
```

Replace the `alert(…)` line:

```tsx
alert(`No bank details saved for ${child.display_name}. Add them in the child's profile first.`);
```

with:

```tsx
setView({ kind: 'bank-empty' });
return;
```

And render it in JSX:

```tsx
{view.kind === 'bank-empty' && (
  <div className="px-4 py-8 text-center">
    <div className="text-[14px] font-semibold">No bank details saved</div>
    <div className="mt-1 text-[13px] text-neutral-500">
      Add {child.display_name}&apos;s sort code and account number in their
      profile first.
    </div>
    <button
      type="button"
      onClick={() => setView({ kind: 'grid' })}
      className="mt-4 rounded-2xl bg-neutral-100 px-4 py-2 text-[13px] font-semibold"
    >
      Back
    </button>
  </div>
)}
```

- [ ] **Step 3: Type-check**

Run from project root:

```bash
cd app && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual verification**

1. Open child profile → Bank Transfer details section.
2. Enter sort code `201575`, account number `12345678`. Blur.
3. Open devtools → Application → Local Storage → key `morechard.bankdetails.v1.<FAMILY_ID>`. Verify the JSON contains those values.
4. Clear all three fields, blur → the localStorage key should have no entry for this child.
5. Open bridge → Bank Transfer tile shows empty-state screen when no details saved; shows Smart Copy rows when details exist.

- [ ] **Step 5: Commit**

```bash
git add <CHILD_FORM> app/src/components/payment/PaymentBridgeSheet.tsx
git commit -m "feat(app): bank-details form on child profile + empty state in bridge

Removes the temporary alert and replaces the console-seeding workflow
with a proper inline form. Details remain in localStorage until Spec B."
```

---

## Task 17: End-to-end manual QA

**Files:** none

- [ ] **Step 1: Fresh-install sanity pass**

1. Stop worker and app.
2. Clear local D1: `cd worker && npx wrangler d1 execute morechard --local --command "DELETE FROM ledger; DELETE FROM completions; DELETE FROM chores;"` (do NOT delete users/families — too much setup).
3. Clear browser localStorage for localhost.
4. Start worker + app: `npm run dev` from project root.
5. Add a chore as a parent, submit as a child, approve as a parent.
6. Walk the entire Payment Bridge flow: Monzo (add handle first), Revolut, PayPal, Venmo, Bank Transfer.
7. For each path, verify: tile grid → deep-link-pending OR smart-copy → confirm → `paid_out_at` stamped in D1.

- [ ] **Step 2: Android hardware Back button check (Capacitor)**

1. Run a Capacitor build: `cd app && npm run build && cd .. && npx cap sync android && npx cap run android`.
2. Open the bridge.
3. From grid view, press hardware Back → sheet closes, app stays open (NOT exits).
4. From Smart Copy view, press hardware Back → returns to tile grid, not closes the sheet.
5. From confirm view, press hardware Back → returns to tile grid.

- [ ] **Step 3: Haptics check on Pixel 9**

1. On the device, tap a Smart Copy row → feel a single short vibration.
2. Tap "Yes, sent" → feel a vibration.
3. On desktop Chrome, same taps → no vibration, checkmark animation only.

- [ ] **Step 4: Idempotency check**

1. In devtools network panel, watch `mark-paid` requests.
2. Approve, open bridge, confirm "Yes, sent" twice in quick succession.
3. Expected: second request (if any) returns `was_already_paid: true`, no double-stamp — verify `paid_out_at` is the *first* timestamp (not overwritten):
   ```bash
   cd worker && npx wrangler d1 execute morechard --local --command "
     SELECT id, paid_out_at FROM completions ORDER BY paid_out_at DESC LIMIT 5;"
   ```

- [ ] **Step 5: Hash chain integrity**

Verify the ledger hash chain is unaffected by payment stamping:

```bash
cd worker && npx wrangler d1 execute morechard --local --command "
  SELECT id, previous_hash, record_hash FROM ledger ORDER BY id DESC LIMIT 3;"
```

Expected: each row's `previous_hash` matches the prior row's `record_hash`. No entries were added by the payment bridge.

- [ ] **Step 6: Commit final clean-up (if any)**

If any polish fixes were needed during QA, commit them. Otherwise skip:

```bash
git commit --allow-empty -m "docs: Payment Bridge V1 manual QA passed"
```

---

## Task 18: Roadmap tick + PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the live roadmap**

In `CLAUDE.md`, under Phase 7, add under "Integrate Stripe with PPP" a new `[x]` line:

```md
- [x] Payment Bridge V1 — deep-link (Monzo/Revolut/PayPal/Venmo) + Smart Copy (UK bank transfer, Zelle). `paid_out_at` delivery flag, not a ledger write. BLIK deferred to PL market push. Bank-details localStorage is temporary — Spec B replaces with encrypted vault.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(roadmap): tick Payment Bridge V1 under Phase 7"
```

- [ ] **Step 3: Push and open a PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: Payment Bridge V1" --body "$(cat <<'EOF'
## Summary
- Zero-fee hand-off from virtual ledger to real-world payout via deep links (Monzo, Revolut, PayPal, Venmo) and Smart Copy (UK bank transfer, Zelle)
- Adds `paid_out_at` timestamp on completions and four public payment handles on `users` (migration `0037`)
- Three new worker routes (`mark-paid`, `mark-paid-batch`, `unpaid-summary`) — parent-only, family-scoped, idempotent
- Android Back button closes nested views before closing the sheet; `visibilitychange`-based deep-link success detection; Capacitor haptics fallback chain
- Bank details stored in `localStorage` only — known temporary, replaced by Spec B's encrypted vault

## Test plan
- [ ] Unit tests pass: `cd app && npm test`
- [ ] Manual QA: full flow for each provider (Task 17 checklist)
- [ ] Android Back button behaves per Task 17 Step 2
- [ ] Hash chain verified unchanged (Task 17 Step 5)
- [ ] Idempotent `mark-paid` returns `was_already_paid: true` on re-stamp

Spec: docs/superpowers/specs/2026-04-22-payment-bridge-v1-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Report it to the user.
