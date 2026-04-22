---
title: Payment Bridge V1 — Design Spec
date: 2026-04-22
status: draft
phase: 7 (Monetization-adjacent) / 3 (Transaction Loop)
supersedes: n/a
depends_on: n/a
unlocks:
  - Spec B — Local-Only Bank Details Vault
  - Spec C — Gifting Link for Grandparents
---

# Payment Bridge V1

## Summary

Morechard's ledger today is **virtual**: when a parent approves a completion, the child's
in-app balance goes up and the hash-chained ledger records the credit. Whether actual
money has moved between the parent's bank and the child's is invisible to the app.

Payment Bridge V1 closes the gap between the virtual ledger and real-world payout
**without** taking on payment-processor fees, licences, or PII liability. It does this by:

1. **Hand-off, not processing.** The app opens the parent's existing banking app (deep
   link) or hands them the details to paste into it (Smart Copy). Morechard never touches
   money or card numbers.
2. **One new optional timestamp.** A nullable `paid_out_at` column on `completions`
   records that the parent said "yes, I sent it." This is purely a delivery-status flag;
   the ledger itself is untouched.
3. **Zero server-side storage of child bank details.** For V1, traditional-bank details
   (sort code / account number) live in the parent's browser `localStorage`. This is a
   **known temporary** that Spec B replaces with an encrypted on-device vault.

V1 scope covers UK (Monzo, Revolut, PayPal, traditional banks via Smart Copy) and US
(Venmo, Zelle via Smart Copy, PayPal). BLIK for Poland is deferred until the PL market
push (per the 5-year roadmap).

## Non-Goals

- **No payment processing.** We are not a PISP. No Stripe/Plaid/Yapily integration.
- **No partial payouts in V1.** `paid_out_at` is all-or-nothing per completion. If a
  parent pays £10 of a £15 unpaid total, they simply don't tap "Yes, sent" — the
  unpaid indicator remains until they settle the rest.
- **No debt/owing ledger.** Unpaid completions are surfaced as a single aggregate
  "Unpaid: £X.XX" indicator on the child card. There is no per-completion "owed" view
  in V1.
- **No encrypted vault.** Traditional-bank details use plain `localStorage` with a
  visible banner warning the parent. Spec B replaces this.
- **No grandparent / gifting flow.** That is Spec C.
- **No BLIK.** Deferred.
- **No bank-app launch for traditional UK/US banks.** Schemes like `barclays://` and
  `hsbcuk://` are undocumented and unreliable. We rely on Smart Copy + the parent
  switching apps manually.

## User Story

> **Priya approves Alex's £5 bin-out chore.** The app shows a success toast with a
> "Pay Now (£5.00)?" button. She taps it.
>
> The Payment Bridge bottom sheet opens. It shows a tile grid: Monzo, Revolut,
> PayPal, Venmo, "Bank Transfer." Priya has Alex's Monzo handle saved, so she taps
> Monzo. The app hands off to the Monzo app pre-filled with `monzo.me/alexj/5.00`.
> Monzo handles the actual transfer.
>
> Priya returns to Morechard. A confirmation sheet asks "Did the payment go
> through?" She taps **Yes, sent**. Haptic tick. The sheet closes. The child card's
> "Unpaid: £5.00" indicator vanishes.

Alternative path: Priya uses Barclays, which Morechard can't deep-link into. She taps
**Bank Transfer**. Three copy buttons appear — Sort Code, Account Number, Amount — plus
an auto-generated reference (`MC Alex 22APR`). Each copy gives a haptic tick. A banner
reads: "Open your banking app and paste these." She switches to Barclays manually,
completes the transfer, returns, taps **Yes, sent**.

Batch path: Priya clears four of Alex's pending approvals via **Approve All**. The
success toast says "4 approved · Pay Now (£18.50)?". Tapping opens the bridge with
all four IDs bundled — same UI as the single case, but **Yes, sent** stamps every one
of them. If Approve All also covered Alex's brother Ben, the toast offers two
actions: "Pay Alex (£18.50)" and "Pay Ben (£6.00)" — the bridge itself is always
scoped to one child and one currency.

The "Unpaid: £5.00" pill on a child card opens the bridge with every unpaid
completion for that child at once — same single-child batch flow.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PendingTab.tsx / ChildCard                                 │
│  ─────────────────────────                                  │
│  - After approve: toast with "Pay Now (£X)?" button         │
│  - Child card shows "Unpaid: £X" if unpaid total > 0        │
└──────────────────────┬──────────────────────────────────────┘
                       │ open bridge
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  PaymentBridgeSheet.tsx  (new)                              │
│  ────────────────────────                                   │
│  Props: { completionIds: string[], childId: string, currency: string }
// Bridge is always single-child, single-currency. A "batch" is just len > 1.     │
│                                                             │
│  ┌─── Tile Grid ────────────────────────────────────┐       │
│  │  Monzo  Revolut  PayPal  Venmo  Bank Transfer   │       │
│  └──────────────────────────────────────────────────┘       │
│                       │                                     │
│       ┌───────────────┴────────────┐                        │
│       ▼                            ▼                        │
│  DeepLinkHandler              SmartCopyPanel                │
│  (Monzo/Revolut/PayPal/       (Bank Transfer /              │
│   Venmo)                       Zelle)                       │
│       │                            │                        │
│       ▼                            ▼                        │
│  visibilitychange →           Copy buttons                  │
│  confirmation sheet           (+ "Open your bank")          │
│                                    │                        │
│                                    ▼                        │
│                               manual return →               │
│                               confirmation sheet            │
└──────────────────────┬──────────────────────────────────────┘
                       │ "Yes, sent"
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/completions/:id/mark-paid    (new)               │
│  POST /api/completions/mark-paid-batch  (new)               │
│  ──────────────────────────────────────                     │
│  Stamps paid_out_at on target rows. Auth: parent.           │
│  No ledger write. No hash-chain mutation.                   │
└─────────────────────────────────────────────────────────────┘
```

## Data Model Changes

### Migration `0037_payment_bridge.sql`

```sql
-- Payment Bridge V1: adds payout timestamp and public payment handles.

-- 1. Completion-level payout stamp.
ALTER TABLE completions ADD COLUMN paid_out_at INTEGER;
-- Unix epoch seconds. NULL = virtual credit only, not yet settled to real money.
-- Stamped by POST /api/completions/:id/mark-paid after parent confirms "Yes, sent"
-- in the Payment Bridge.

-- 2. Public payment handles on the user record.
-- Morechard uses a single `users` table for both parents and children; role is
-- resolved via `family_roles`. Child-specific fields like allowance_amount,
-- earnings_mode, teen_mode already live on `users`, so payment handles follow
-- that pattern. A parent row with these NULL is harmless.
ALTER TABLE users ADD COLUMN monzo_handle TEXT;
ALTER TABLE users ADD COLUMN revolut_handle TEXT;
ALTER TABLE users ADD COLUMN paypal_handle TEXT;
ALTER TABLE users ADD COLUMN venmo_handle TEXT;
-- Public-facing handles only (the part of monzo.me/<handle>/... or venmo.com/<handle>).
-- No leading '@', no URL. Server-side storage is acceptable because these are already
-- shareable public URLs by design. NOT suitable for sort codes / account numbers —
-- those go in localStorage until Spec B.
```

**Why not a new `payouts` table?** The batch use-case is satisfied by stamping each
completion row with the same `paid_out_at` timestamp. A separate `payouts` table
would aggregate rows but adds schema weight V1 doesn't need. If Spec C (gifting)
requires tracking who paid what, we'll revisit.

**Hash-chain note.** The immutable ledger chains SHA-256 over completion approvals
(amount + child + parent + prior hash). `paid_out_at` is metadata on the completion
row, **not a ledger entry**, and does not enter the hash input. Mutating it does not
break chain integrity. This distinction is deliberate: the ledger is the *what*
(earned, approved), the timestamp is the *when* (delivered to a real bank).

### Local storage (temporary)

```ts
// app/src/lib/localBankDetails.ts
type StoredBankDetails = {
  childId: string;
  sortCode?: string;       // UK, 6 digits, no hyphens
  accountNumber?: string;  // UK, 8 digits
  zelleHandle?: string;    // US, email or phone
  updatedAt: number;
};

// localStorage key: `morechard.bankdetails.v1.${familyId}`
// Shape: Record<childId, StoredBankDetails>
```

**Warning banner** shown whenever the parent taps into "Bank Transfer" with saved
details:

> These details are saved only on this device. If you switch phones, you'll need to
> re-enter them. We'll upgrade this to encrypted storage in a future update.

Spec B replaces this module with WebCrypto-backed IndexedDB storage. The module
contract (`getDetails(childId)`, `setDetails(childId, d)`, `clearDetails(childId)`)
stays the same so Spec B is a drop-in replacement — no call-site changes.

## API

### `POST /api/completions/:id/mark-paid`

- **Auth:** parent in the same family as the completion.
- **Body:** none.
- **Effect:** sets `paid_out_at = unixepoch()` on the completion. Idempotent — if already
  stamped, the endpoint returns **200** with the existing timestamp and does not
  overwrite it (first write wins, not last).
- **Guards:**
  - Completion must exist, be `status='approved'`, belong to caller's family.
- **Returns:** `{ completion_id, paid_out_at, was_already_paid: boolean }`.

### `POST /api/completions/mark-paid-batch`

- **Auth:** parent.
- **Body:** `{ family_id: string, completion_ids: string[] }`.
- **Effect:** stamps every listed completion in one D1 transaction. All-or-nothing:
  if any ID is invalid or not owned by the caller's family, the whole batch rejects
  with 400. Caller passes exactly the IDs they intend to pay — the server does not
  fan out "all unpaid" on its own. (The client computes the unpaid set.)
- **Returns:** `{ stamped: number, paid_out_at: number }`.

### `GET /api/completions/unpaid-summary?family_id=…`

- **Auth:** parent.
- **Returns:** per-child aggregate of unpaid approved completions:
  ```json
  {
    "children": [
      { "child_id": "c_abc", "unpaid_total": 500, "unpaid_count": 1, "currency": "GBP" },
      { "child_id": "c_def", "unpaid_total": 1850, "unpaid_count": 4, "currency": "GBP" }
    ]
  }
  ```
- **Drives:** the "Unpaid: £X.XX" indicator on each child card, and pre-populates the
  Batch Mode totals. Amounts in minor units, matching existing conventions.

## Frontend

### New files

```
app/src/components/payment/
  PaymentBridgeSheet.tsx        — bottom-sheet shell, routes to deep-link or smart-copy
  PaymentTileGrid.tsx           — 5-tile grid (Monzo, Revolut, PayPal, Venmo, Bank Transfer)
  DeepLinkHandler.tsx           — visibility-based success detection
  SmartCopyPanel.tsx            — bank-transfer / Zelle copy UI
  PaymentConfirmSheet.tsx       — "Did the payment go through?" Yes/No
  UnpaidIndicator.tsx           — small pill shown on child cards

app/src/lib/
  paymentBridge.ts              — URL generators, reference generator
  localBankDetails.ts           — localStorage wrapper (temp, Spec B replaces)
  haptics.ts                    — Haptics.impact → navigator.vibrate → visual fallback
  clipboard.ts                  — Capacitor Clipboard → navigator.clipboard fallback
```

### URL generators (`paymentBridge.ts`)

```ts
// All generators return null if required input is missing.
// Amounts are passed as major-unit strings (e.g., "5.00"), since that's what every
// deep-link spec expects. Convert from minor-unit integers at the call site.

export function monzoUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://monzo.me/${encodeURIComponent(handle)}/${amount}`;
}

export function revolutUrl(handle: string, amount: string): string | null {
  if (!handle) return null;
  return `https://revolut.me/${encodeURIComponent(handle)}/${amount}`;
}

export function paypalUrl(handle: string, amount: string, currency: 'GBP'|'USD'|'EUR'): string | null {
  if (!handle) return null;
  return `https://paypal.me/${encodeURIComponent(handle)}/${amount}${currency}`;
}

export function venmoUrl(handle: string, amount: string, note: string): string {
  // `note` is the reference string from buildReference() — appears in the
  // recipient's Venmo transaction history.
  const params = new URLSearchParams({
    txn: 'pay',
    recipients: handle,
    amount,
    note,
  });
  return `venmo://paycharge?${params.toString()}`;
}
```

Zelle has no deep-link — it falls through to Smart Copy (email/phone + amount + reference).

### Reference generator

```ts
// Format: "MC <FirstName> <DDMMM>" — max 18 chars, alphanumeric + spaces only.
export function buildReference(childFirstName: string, date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mmm = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase(); // "APR"
  const name = childFirstName.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  const ref = `MC ${name} ${dd}${mmm}`;
  return ref.slice(0, 18);
}
// Examples: "MC Alex 22APR" (13), "MC Maximilian 22APR" → "MC Maximilia 22APR" (18).
// Editable in the UI before sending.
```

### Deep-link success detection

The naive `setTimeout(() => showFallback(), 2000)` flashes the fallback even when the
link works. Correct approach:

```ts
// In DeepLinkHandler.tsx
async function openDeepLink(url: string) {
  let pageHidden = false;
  const onVisibility = () => { if (document.hidden) pageHidden = true; };
  document.addEventListener('visibilitychange', onVisibility);

  try {
    // Capacitor native: App.openUrl returns success/failure directly.
    if (Capacitor.isNativePlatform()) {
      const { completed } = await App.openUrl({ url });
      if (!completed) return 'fallback';
      return 'opened';
    }
    // PWA: no return value, rely on visibility side-effect.
    window.location.href = url;
  } finally {
    // Wait ~1.5s to see if the OS switched apps.
    await new Promise(r => setTimeout(r, 1500));
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return pageHidden ? 'opened' : 'fallback';
}
```

When `opened`: wait for the user to return (visibility → visible) and show the
confirmation sheet.

When `fallback`: surface the Smart Copy panel for that provider with an apologetic
banner ("Couldn't open <App>. Copy the details and switch apps manually.").

### Haptics utility

```ts
// app/src/lib/haptics.ts
export async function tick() {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    }
  } catch { /* fall through */ }

  if ('vibrate' in navigator) {
    navigator.vibrate(10);
    return;
  }
  // Visual-only fallback handled by the caller (checkmark animation).
}
```

### Clipboard utility

Same pattern: Capacitor `Clipboard.write({ string })` on native, `navigator.clipboard.writeText(s)`
on PWA. Returns a boolean so the UI can swap the icon to a checkmark and fire haptics.

### Approve-flow integration

`PendingTab.tsx` currently calls `approveCompletion(id)` or `approveAll(...)` and
reloads. Add a post-success toast:

```tsx
// Pseudocode — single approval
await approveCompletion(id);
showToast({
  variant: 'success',
  message: 'Approved ✓',
  action: {
    label: `Pay Now (${formatCurrency(amount, currency)})`,
    onClick: () => openBridge({ completionIds: [id], childId, currency }),
  },
});
```

**Approve-all:** the just-approved completions are grouped by `(childId, currency)`.
The toast shows one "Pay <Name>" action per group. Each action opens the bridge with
that group's IDs. No mixed-child or mixed-currency bridge.

### Unpaid indicator

Small pill on each child card:
```
[ £12.50 earned ]   [ Unpaid: £5.00 ]
```
Hidden if `unpaid_total === 0`. Tapping it opens the bridge in batch mode for that
child. Data source: `/api/completions/unpaid-summary` (polled on dashboard mount and
after any `mark-paid` call).

## Confirmation Loop

After the user returns from a deep-link or completes Smart Copy, the bridge shows:

```
┌──────────────────────────────┐
│   Did the payment go         │
│   through?                   │
│                              │
│   We can't check with your   │
│   bank — just tap Yes if     │
│   the transfer was sent.     │
│                              │
│   [ Yes, sent  ]             │
│   [ Not yet    ]             │
└──────────────────────────────┘
```

- **Yes, sent** → `POST mark-paid` (single) or `mark-paid-batch`, stamp `paid_out_at`,
  haptic tick, close sheet, refresh unpaid summary.
- **Not yet** → close sheet, leave `paid_out_at` NULL, child card still shows "Unpaid".

Honest copy is deliberate here — brand-book tone (no euphemisms, no pretending we
have bank integration).

## Platform Notes

**Android hardware Back button (Capacitor).** The Payment Bridge is a modal bottom
sheet and must intercept the Android Back button to close itself rather than exiting
the app. Implementation in `PaymentBridgeSheet.tsx`:

```ts
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  const sub = App.addListener('backButton', () => {
    if (confirmSheetOpen) {
      setConfirmSheetOpen(false);    // Back from confirm → back to tile grid
    } else {
      onClose();                      // Back from grid → close bridge
    }
  });
  return () => { sub.then(s => s.remove()); };
}, [confirmSheetOpen, onClose]);
```

Same pattern for any nested sheet (e.g., Smart Copy panel expanded from a tile).

**`navigator.vibrate` user-gesture requirement.** Android Chrome only allows vibration
inside a user-gesture callback. This is fine for Copy buttons (direct tap → tick), but
we must NOT trigger haptics in response to:
- async promise resolution without a fresh gesture (e.g., haptic on `mark-paid` 200 — too late)
- visibility-change return from bank app (no gesture context)

The haptic tick on the confirmation "Yes, sent" button fires from inside the click
handler before the API call, not from its `.then()`.

**Clipboard in non-HTTPS dev.** `navigator.clipboard.writeText` is gated behind secure
context. Local dev over `http://localhost` works (loopback is secure by spec); LAN IPs
(`http://192.168.x.x`) do not. The fallback textarea + manual copy path covers this,
but flag it in the dev README so nobody burns an hour debugging.

## Error Handling

| Scenario | Handling |
|---|---|
| Deep link fails (scheme unresolved) | Visibility-based detection → show Smart Copy panel with apology banner |
| `navigator.clipboard` throws (iOS Safari in non-HTTPS dev) | Fall back to manual select/copy textarea with a hint |
| `localBankDetails` missing for child | Smart Copy panel shows empty input fields → "Enter Alex's sort code" / "Save to this device" button |
| `mark-paid` returns `was_already_paid: true` | Treat as normal success, haptic tick, close. Log once for telemetry. |
| Network error on `mark-paid` | Toast: "Couldn't update — tap to retry." No background queue in V1 (YAGNI). The unpaid indicator stays visible, so the parent can re-tap the bridge and try again. |
| Batch mode (approve-all entry point) spans children with different currencies | Caller splits into one batch per currency and opens the bridge per-child. The UI never shows a mixed-currency batch. |

## Testing

### Unit tests (`*.test.ts` colocated with modules)
- `paymentBridge.test.ts` — URL generators with normal/empty/special-char handles; reference generator truncation and date formatting; Venmo URL encoding.
- `localBankDetails.test.ts` — get/set/clear round-trips; handles missing `localStorage` (private browsing).
- `haptics.test.ts` — mocked Capacitor + mocked `navigator.vibrate`, assert fall-through order.

### Component tests (Vitest + Testing Library)
- `PaymentBridgeSheet` — renders tile grid; tapping Monzo with empty handle shows inline "Add Alex's Monzo handle" CTA; tapping Bank Transfer with empty localStorage shows input form.
- `SmartCopyPanel` — each copy button writes correct value; fires haptic; shows checkmark for 1.2s.
- `PaymentConfirmSheet` — "Yes, sent" with one ID hits `mark-paid`; with multiple IDs hits `mark-paid-batch`.

### Integration tests (worker)
- `mark-paid` rejects cross-family completion IDs (403).
- `mark-paid` is idempotent (second call returns existing timestamp, no double-stamp).
- `mark-paid-batch` is atomic — one invalid ID rolls the whole transaction back.
- `unpaid-summary` excludes stamped completions, respects family scope.

### Manual QA (can't automate)
- Real Monzo deep-link on Android + iOS Capacitor build.
- Real Venmo deep-link on iOS.
- `localStorage` survives app-to-Safari-to-app switch on iOS.
- Haptic feel on Pixel 9 (primary dev device).

## Rollout

No feature flag. The Payment Bridge is additive: if a parent ignores the "Pay Now"
button and never opens the bridge, nothing changes from today's behavior. Unpaid
totals simply accumulate on the child card until the parent settles them — which
itself is useful information.

Migration `0037` is backward-compatible (additive columns, no data change).

## Open Questions

None blocking. A few to revisit in Spec B/C:

- Should `unpaid-summary` be pushed via a WebSocket / SSE rather than polled? Probably
  not — polling on dashboard mount is fine for V1.
- Should we track *which* provider the parent used (Monzo vs. bank transfer)? Useful
  telemetry but adds a column and a privacy question. Defer.
- Spec C (gifting) will want to know if a grandparent contributed to a goal — that's
  a separate concept from `paid_out_at`, probably its own `gift_contributions` table.
  Not in V1 scope.
