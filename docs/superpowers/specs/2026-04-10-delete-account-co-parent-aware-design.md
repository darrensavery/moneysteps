# Delete Account — Co-Parent Aware Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Settings › Account & Profile › Danger Zone

---

## Overview

Replace the `onComingSoon()` stub on the "Delete Account" row with two distinct, co-parent-aware flows:

- **Leave Family** — shown when `lead_count > 1`; removes the current user from the family, promotes a co-parent to lead if needed, preserves the ledger for the remaining parent.
- **Uproot (Delete Account)** — shown when `lead_count === 1`; soft-deletes the entire family, anonymises all PII, revokes all sessions.

---

## Database Migration — 0020

File: `worker/migrations/0020_parent_role_and_family_soft_delete.sql`

```sql
-- Add parent_role distinction to family_roles
ALTER TABLE family_roles ADD COLUMN parent_role TEXT
  CHECK (parent_role IN ('lead', 'co_parent'));

-- Backfill all existing parent rows as 'lead'
UPDATE family_roles SET parent_role = 'lead'
  WHERE role = 'parent' AND parent_role IS NULL;

-- Soft-delete support on families
ALTER TABLE families ADD COLUMN deleted_at INTEGER;
```

**Backfill rationale:** No co-parent invite redemption has ever written a `parent_role` value, so all current parent rows are safely leads.

**Write points going forward:**
- `handleCreateFamily` → `parent_role = 'lead'`
- `handleRedeemInvite` (co-parent path) → `parent_role = 'co_parent'`

---

## Backend Routes

All three routes live in `worker/src/routes/auth.ts` and are registered in `worker/src/index.ts`.

### `GET /auth/family/leads`

- **Auth:** any authenticated parent
- **Query:**
  ```sql
  SELECT COUNT(*) AS lead_count FROM family_roles
  WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead'
  ```
- **Response:** `{ lead_count: number }`
- **Purpose:** Frontend calls this on mount of `ProfileSettings` to gate the Danger Zone variant.

---

### `DELETE /auth/me/leave`

- **Auth:** any authenticated parent
- **Guards:**
  1. If caller is the only parent (lead or co-parent) and no other family member exists → reject `400`: `"Cannot leave an empty orchard. Use Delete Account instead."`
- **Sequence** (single D1 batch):
  1. Capture `display_name` before anonymisation (for the ledger note).
  2. **Succession Gate** — if caller is a `lead` and a `co_parent` exists: promote one co-parent to `lead` (`UPDATE family_roles SET parent_role = 'lead' WHERE user_id = <co_parent_id>`).
  3. Anonymise caller: `display_name = 'Former Co-Parent'`, `email = NULL`, `email_pending = NULL`, `password_hash = NULL`, `pin_hash = NULL`.
  4. Revoke all caller sessions: `UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ?`.
  5. Remove caller's `family_roles` row.
  6. Write `system_note` ledger entry: `"🌱 [captured name] has left the orchard."` (amount = 0, child_id = NULL, verification_status = 'verified_auto').
- **Response:** `{ ok: true, action: 'left' }`

---

### `DELETE /auth/family`

- **Auth:** lead only (`parent_role = 'lead'`)
- **Guards:**
  1. **Last Lead Guard:** count leads for family. If `> 1` → `403`: `"An orchard cannot be uprooted while another guardian is present."`
- **Sequence** (single D1 batch):
  1. Soft-delete family: `UPDATE families SET deleted_at = unixepoch() WHERE id = ?`.
  2. Anonymise **all** users in family: `display_name = 'Deleted User'`, `email = NULL`, `email_pending = NULL`, `password_hash = NULL`, `pin_hash = NULL`.
  3. Revoke all sessions for all family users.
  4. `DELETE FROM invite_codes WHERE family_id = ?`
  5. `DELETE FROM registration_progress WHERE family_id = ?`
  6. Ledger rows, chores, goals, and ledger-adjacent tables are left intact — anonymised but structurally sound for Phase 6 audit export.
- **Response:** `{ ok: true, action: 'uprooted' }`

---

## Middleware Update

`worker/src/lib/middleware.ts` — `requireAuth` family lookup gains:

```sql
AND families.deleted_at IS NULL
```

Any JWT referencing a soft-deleted family receives `403`: `"This family has been deleted."` — backstop regardless of session state.

---

## Frontend

### New API client functions — `app/src/lib/api.ts`

```ts
export async function getLeadCount(): Promise<{ lead_count: number }>
export async function leaveFamily(): Promise<{ ok: boolean; action: string }>
export async function deleteFamily(): Promise<{ ok: boolean; action: string }>
```

---

### `ParentSettingsTab.tsx`

- Add `leadCount` state (`number`, default `1`).
- Load via `getLeadCount()` inside the existing `load()` call (parallel with other fetches).
- Pass `leadCount` as a new prop to `ProfileSettings`.

---

### `ProfileSettings.tsx`

**Props change:** add `leadCount: number`.

**Danger Zone logic** (replaces the current `onComingSoon` stub):

| Condition | Label | Description | Modal |
|-----------|-------|-------------|-------|
| `leadCount > 1` | Leave Family | "You will lose access, but the family ledger will remain for the other parent." | Leave Modal |
| `leadCount === 1` | Delete Account | "Permanently uproot your orchard and delete your family account, including all data" | Uproot Modal |

The `isLead` gate is removed from the Danger Zone — co-parents must also be able to leave. Both paths remain inside the same red-bordered section card.

---

### Leave Modal

Shown when `leadCount > 1`.

**Copy:**
> "You will permanently lose access to this family. The ledger and all data will remain for the other parent."

If the caller **is a lead** (i.e. `isLead === true` and `leadCount > 1`), append:
> "A co-parent will be promoted to Lead to ensure the family can still be managed."

**Action:** Single red button — **"Leave Family"**. On confirm:
1. Call `leaveFamily()`
2. Wipe localStorage (full logout sequence — see below)
3. `window.location.replace('/')`

---

### Uproot Modal

Shown when `leadCount === 1`.

**Step 1 — Warning screen:**
> "This will permanently uproot your orchard. All family data, chores, and goals will be deleted. The ledger will be anonymised but structurally preserved."

**Step 2 — Type-to-confirm:**
> Input placeholder: `"Type UPROOT to confirm"`  
> Confirm button (`"Delete Everything"`) is disabled until input exactly equals `"UPROOT"`.

**On confirm:**
1. Call `deleteFamily()`
2. Wipe localStorage (full logout sequence)
3. `window.location.replace('/')`

---

### localStorage wipe (both paths)

```ts
clearDeviceIdentity()
sessionStorage.removeItem('mc_parent_tab')
localStorage.removeItem('mc_parent_avatar')
clearToken()  // removes mc_token, mc_family_id, mc_user_id, mc_role
```

---

## Safety Gates Summary

| Gate | Where | Behaviour |
|------|-------|-----------|
| Last Lead Guard | `DELETE /auth/family` | 403 if `lead_count > 1` |
| Empty Orchard Guard | `DELETE /auth/me/leave` | 400 if no other member exists |
| Succession Gate | `DELETE /auth/me/leave` | Promotes a co-parent to lead atomically if departing user is a lead |
| Soft-delete Middleware | `requireAuth` | 403 for any JWT on a deleted family |
| Type-to-confirm | Uproot Modal (frontend) | Button disabled until `"UPROOT"` typed exactly |

---

## Out of Scope

- "Remove Co-Parent" (initiated by a lead to remove another parent) — roadmap item, unlocked by this migration but not built here.
- Child profile deletion ("Uproot Profile") — separate roadmap item.
- Email notification to the remaining parent after a co-parent leaves — Phase 8 / notification system.
