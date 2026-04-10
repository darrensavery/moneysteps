# Security Suite — Design Spec

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Settings › Security & Access — PIN Management, Active Sessions, Gatekeeper challenge

---

## Overview

Replace the two `onComingSoon` stubs in `SecuritySettings.tsx` with two fully functional sub-screens, and wire a `useGatekeeper` hook so that sensitive parent actions (chore approvals, ledger mutations) challenge the parent for their PIN or biometrics before proceeding.

---

## Database Migration — 0021

File: `worker/migrations/0021_security_suite.sql`

```sql
-- Parent 4-digit PIN (separate from child pin_hash, which is set by the parent)
ALTER TABLE users ADD COLUMN parent_pin_hash    TEXT;

-- Lockout tracking (server-side so switching browsers cannot bypass it)
ALTER TABLE users ADD COLUMN pin_attempt_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until   INTEGER;          -- unixepoch, NULL = not locked

-- Device UA string for Active Sessions display
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
```

**Backfill:** none needed. All new columns are nullable or default-zero.

**`pin_hash` vs `parent_pin_hash`:** The existing `pin_hash` column on `users` is for child PINs set by the parent. `parent_pin_hash` is the parent's own 4-digit access PIN. Both use PBKDF2 (same `hashPassword` helper already in the worker).

---

## Backend Routes

All routes live in `worker/src/routes/auth.ts` and are registered in `worker/src/index.ts`.

---

### `POST /auth/pin/set`

- **Auth:** any authenticated parent
- **Body:** `{ password: string, new_pin: string }` — `password` is the parent's email/password credential (re-auth before setting PIN)
- **Validation:**
  - `new_pin` must be exactly 4 digits (`/^\d{4}$/`)
  - Verify `password` against `users.password_hash` before writing
- **Write:** `UPDATE users SET parent_pin_hash = ?, pin_attempt_count = 0, pin_locked_until = NULL WHERE id = ?`
- **Response:** `{ ok: true }`

**Note:** If the parent has no `password_hash` (magic-link-only account), return `400: "Set a password first to enable PIN."` — edge case to handle in Phase 8 when we add magic-link-only flows to the settings surface.

---

### `POST /auth/verify-pin`

- **Auth:** any authenticated parent
- **Body:** `{ pin: string }`
- **Lockout check:** if `pin_locked_until > unixepoch()` → `429: "Too many attempts. Try again in X seconds."`
- **Verify:** compare `pin` against `users.parent_pin_hash` using `verifyPassword`
  - **Wrong:** increment `pin_attempt_count`; if count ≥ 3, set `pin_locked_until = unixepoch() + 30`, reset count to 0; return `401: "Incorrect PIN"`
  - **Correct:** reset `pin_attempt_count = 0`, `pin_locked_until = NULL`; return `{ ok: true }`
- **Response:** `{ ok: true }` on success

---

### `POST /auth/pin/reset-with-password`

- **Auth:** any authenticated parent
- **Body:** `{ password: string, new_pin: string }`
- **Purpose:** "Forgot PIN" escape hatch — re-authenticates with email/password, then sets a new PIN
- **Logic:** identical to `/auth/pin/set` — same handler, same validation. This is a dedicated route name so the frontend can show distinct copy ("Forgot PIN? Reset with password") without conflating it with the initial-set flow.
- **Response:** `{ ok: true }`

---

### `GET /auth/sessions`

- **Auth:** any authenticated parent
- **Query:**
  ```sql
  SELECT jti, issued_at, user_agent
  FROM sessions
  WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()
  ORDER BY issued_at DESC
  ```
- **Response:** `{ sessions: Array<{ jti, issued_at, user_agent }> }`
- The current device is identified client-side by matching `jti` from the decoded JWT in localStorage.

---

### `DELETE /auth/sessions/:jti`

- **Auth:** any authenticated parent
- **Guard:** the target session's `user_id` must equal the caller's `user_id` (prevent cross-user revocation)
- **Write:** `UPDATE sessions SET revoked_at = unixepoch() WHERE jti = ? AND user_id = ?`
- **Response:** `{ ok: true }`

---

### `DELETE /auth/sessions?others=true`

- **Auth:** any authenticated parent
- **Write:** `UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND jti != ? AND revoked_at IS NULL`
  - The current `jti` (from the caller's JWT) is excluded.
- **Response:** `{ ok: true, revoked: number }`

---

### Login route update

`handleLogin` (and any other route that issues a JWT and writes a `sessions` row) must write `user_agent` from `request.headers.get('User-Agent') ?? ''` at insert time.

---

## Frontend

### New API client functions — `app/src/lib/api.ts`

```ts
export async function setParentPin(password: string, newPin: string): Promise<{ ok: boolean }>
export async function verifyPin(pin: string): Promise<{ ok: boolean }>
export async function resetPinWithPassword(password: string, newPin: string): Promise<{ ok: boolean }>
export async function getSessions(): Promise<{ sessions: SessionRow[] }>
export async function revokeSession(jti: string): Promise<{ ok: boolean }>
export async function revokeOtherSessions(): Promise<{ ok: boolean; revoked: number }>

export interface SessionRow {
  jti: string
  issued_at: number
  user_agent: string | null
}
```

---

### `useGatekeeper` hook — `app/src/hooks/useGatekeeper.ts`

Central hook that all sensitive actions call. Manages the challenge modal internally.

**State:**
- `challenged: boolean` — controls modal visibility
- `pendingAction: (() => void) | null` — stored callback to invoke after verification
- Grace window: `sessionStorage` key `mc_gk_verified_at` (Unix ms timestamp)

**Grace window:** 5 minutes. Verified-at is stored in `sessionStorage` (cleared on tab close, not `localStorage` which persists across restarts).

**API:**
```ts
function useGatekeeper(): {
  challenge: (onSuccess: () => void) => void
  GatekeeperModal: React.FC  // renders inline; returns null when not challenged
}
```

**Challenge flow:**
1. Read `mc_gk_verified_at`. If within 5 minutes → call `onSuccess()` immediately, no modal.
2. Otherwise: try `challengeBiometrics()` if `hasBiometricCredential()`.
   - Success → write `mc_gk_verified_at`, call `onSuccess()`.
   - Denied/unavailable → show PIN overlay.
3. PIN overlay: parent types 4 digits → call `verifyPin()`.
   - 200 → write `mc_gk_verified_at`, dismiss modal, call `onSuccess()`.
   - 401 → show error in overlay ("Incorrect PIN"), increment local visual attempt counter.
   - 429 → show lockout timer ("Try again in Xs").

**GatekeeperModal renders:**
- 4 dot indicators (filled/empty)
- Custom digit pad (same style as `LockScreen`)
- Error message slot
- "Forgot PIN?" link → navigates to PIN Management (resets flow, does not pass-through)

---

### New component files

| File | Purpose |
|------|---------|
| `app/src/components/settings/sections/PinManagementSettings.tsx` | PIN set / change / forgot flow |
| `app/src/components/settings/sections/ActiveSessionsSettings.tsx` | Session list + revoke |
| `app/src/hooks/useGatekeeper.ts` | Challenge hook + modal |

`SecuritySettings.tsx` becomes a router: receives sub-screen state and renders the correct component.

---

### `PinManagementSettings.tsx`

**States:**

| State | Shown when |
|-------|-----------|
| `verify-current` | `parent_pin_hash` is set — user must enter current PIN first |
| `set-new` | Current verified (or no PIN set) — enter new PIN then confirm |
| `forgot` | User taps "Forgot PIN?" — enters email password instead |

**Verify-current step:**
- 4-dot pad + digit keyboard
- "Forgot PIN? Reset with password." link below pad → switches to `forgot` state
- Wrong PIN: shake animation, "Incorrect PIN" below dots
- After 3 wrong: "Too many attempts. Try again in 30s." — input disabled, countdown shown
- Correct: transition to `set-new`

**Set-new step:**
- "New PIN" 4-dot row, then "Confirm PIN" 4-dot row
- Confirm must match — if not: "PINs don't match", both fields clear
- On success: call `setParentPin(password='', newPin)` ... wait — the PIN-set route requires a password. For the **change** flow (user already verified current PIN via `/auth/verify-pin`), we need an alternative: the server-side guard can be the current PIN check instead of password.

**Revised `/auth/pin/set` body:** `{ current_pin?: string, password?: string, new_pin: string }` — at least one of `current_pin` or `password` must be provided and verified.

**Forgot step:**
- Single password field (type=password)
- "Reset PIN" button → calls `resetPinWithPassword(password, newPin)` (new PIN collected in same step or next step)
- Two-phase: enter password → verify → then collect new PIN in `set-new` state

**Success toast:** "PIN updated" → navigate back to Security & Access.

**Biometric nudge:** if `isBiometricsAvailable()` and no biometric credential registered, show after PIN save: "Enable Face ID for faster access?" with "Enable" / "Skip" buttons. "Enable" calls `registerBiometrics()`.

---

### `ActiveSessionsSettings.tsx`

**Data shape displayed per session:**

| Field | Source | Display |
|-------|--------|---------|
| Device label | UA parse from `user_agent` | `"Chrome on Mac"`, `"Safari on iPhone"`, `"Unknown Device"` if empty/unrecognised |
| Age | `issued_at` → `Intl.RelativeTimeFormat` | `"just now"`, `"2 days ago"` |
| Current badge | `jti` matches decoded JWT `jti` | `[current]` pill, teal colour |

**UA parsing** — simple inline function, no library:
- Contains `"iPhone"` or `"iPad"` → `"Safari on iPhone"` / `"Safari on iPad"`
- Contains `"Android"` → `"Chrome on Android"` (or `"Firefox on Android"`)
- Contains `"Macintosh"` → `"Chrome on Mac"` / `"Safari on Mac"`
- Contains `"Windows"` → `"Chrome on Windows"` etc.
- Anything else or empty string → `"Unknown Device"`

**Actions:**
- Individual `[revoke]` button → calls `revokeSession(jti)`, removes row from local list optimistically
- "Revoke all other devices" red button at bottom → calls `revokeOtherSessions()`, clears all non-current rows

**Empty state:** "No other devices logged in." — "Revoke all" button hidden.

**Error state:** if `getSessions()` fails, show "Could not load sessions. Try again." with retry button.

---

### `SecuritySettings.tsx` (updated)

Becomes a thin router. Adds `view` state: `'menu' | 'pin' | 'sessions'`. Passes `onNavigate` to sub-screens. No props change to the parent tab — `SecuritySettings` remains self-contained.

---

## Safety Gates Summary

| Gate | Where | Behaviour |
|------|-------|-----------|
| Grace window | `useGatekeeper` | 5-min `sessionStorage` window before re-challenge |
| Lockout | `POST /auth/verify-pin` | 3 wrong → 30s lockout (server-side) |
| Cross-user revocation guard | `DELETE /auth/sessions/:jti` | `user_id` must match caller |
| Current-PIN or password required | `POST /auth/pin/set` | At least one high-authority credential checked |
| "Forgot PIN" escape | `PinManagementSettings` | Uses email/password re-auth, not PIN bypass |
| "Unknown Device" fallback | `ActiveSessionsSettings` | Empty/unrecognised UA → honest label |

---

## Out of Scope

- Biometric registration from within Settings (biometrics are enrolled during the onboarding Stage 3 flow; the PIN Management screen only nudges re-enrollment post-PIN-save)
- Push notifications to remaining devices when another session is revoked — Phase 8
- Magic-link-only parent accounts (no `password_hash`) — deferred; route returns a clear 400
- Rate-limiting on `POST /auth/pin/set` beyond the lockout already on `verify-pin`
