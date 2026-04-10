# Identity & Audit System — Design Spec
**Date:** 2026-04-10  
**Scope:** Account & Profile → Display Name + Email editing with cross-device persistence and immutable audit trail  
**Status:** Approved

---

## Goals

1. Display Name and Email editable inline in Account & Profile settings
2. Changes persist to Worker DB (D1) for cross-device sync
3. Every identity change writes a zero-amount `system_note` to the hash-chained ledger
4. Email address never written to the ledger — only the fact of a change
5. Unverified email state surfaced clearly in the UI
6. No-op saves blocked at the UI level (disabled Save when value unchanged)

---

## Section 1 — Database: Migration `0019`

### 1a. Extend `entry_type` CHECK on `ledger`

D1 does not support `ALTER TABLE … CHECK`. The migration recreates the constraint by:
1. Renaming `ledger` to `ledger_old`
2. Creating a new `ledger` table with the updated CHECK:
   ```sql
   CHECK (entry_type IN ('credit', 'reversal', 'payment', 'system_note'))
   ```
3. Copying all rows from `ledger_old`
4. Recreating all triggers (immutability trigger from `0004`, disputed trigger from `0005`)
5. Dropping `ledger_old`

`system_note` rows have `amount = 0`, `child_id = NULL`, `chore_id = NULL`. The hash-chain computation is unchanged — `computeRecordHash(id, family_id, child_id, amount, currency, entry_type, previousHash)` — `child_id` passes as `NULL`.

### 1b. Add `email_pending` to `users`

```sql
ALTER TABLE users ADD COLUMN email_pending TEXT;
```

`email_verified` already exists. `email_pending` holds the unconfirmed new address while the current `email` remains active. On a successful email update: `email = email_pending`, `email_pending = NULL`, `email_verified = 0`.

For now (no verification email flow), the update goes directly to `email` with `email_verified = 0`.

---

## Section 2 — Worker: `PATCH /auth/me`

**File:** `worker/src/routes/auth.ts`  
**Registration:** `index.ts` alongside existing `GET /auth/me`

```
PATCH /auth/me
Authorization: Bearer <parent JWT>
Body: { display_name?: string, email?: string }
```

### Display Name flow

1. Validate: trim whitespace, 2–40 chars, non-empty
2. `UPDATE users SET display_name = ? WHERE id = ?`
3. Write `system_note` ledger entry:
   - `amount = 0`
   - `child_id = NULL`
   - `chore_id = NULL`
   - `entry_type = 'system_note'`
   - `description = '🌱 [Name] updated their family name'` (uses the NEW name)
   - `verification_status = 'verified_auto'`
   - `currency` = family's `default_currency` (fetched from `families` table)
   - `authorised_by = caller.sub`
   - Hash-chain computed via existing `computeRecordHash` helper
4. Return `{ id, display_name, email, email_verified, email_pending, family_id, role }`

### Email flow

1. Validate: basic RFC format check, not blank
2. Check uniqueness: reject if another `email_verified = 1` account holds this address
3. `UPDATE users SET email = ?, email_verified = 0 WHERE id = ?`
4. Write `system_note` ledger entry:
   - Same structure as above
   - `description = '🌱 Contact email was updated'` (no address in description)
5. Return updated profile

### Error responses

| Condition | Status | Message |
|-----------|--------|---------|
| Name too short/long | 400 | `'Display name must be 2–40 characters'` |
| Email malformed | 400 | `'Please enter a valid email address'` |
| Email already in use | 409 | `'That email address is already registered'` |
| No fields provided | 400 | `'Nothing to update'` |

### `GET /auth/me` extension

Include `email_pending` in the response so the frontend can render the Unverified badge.

---

## Section 3 — Frontend: Inline Edit Forms

**File:** `app/src/components/dashboard/ParentSettingsTab.tsx`

### New API function in `api.ts`

```ts
export interface UserProfile {
  id: string
  display_name: string
  email: string | null
  email_verified: number
  email_pending: string | null
  family_id: string
  role: string
}

export async function updateProfile(
  body: { display_name?: string; email?: string }
): Promise<UserProfile> {
  return request('/auth/me', { method: 'PATCH', body: JSON.stringify(body) })
}
```

### Display Name row

- Row description shows current `identity.display_name`
- Clicking opens an inline expand (same pattern as avatar picker — no navigation)
- Text input pre-filled with current name
- **Save button disabled** when `input.trim() === currentName` OR `input.trim().length < 2`
- On save:
  1. Call `updateProfile({ display_name })`
  2. Update localStorage identity via `setDeviceIdentity({ ...identity, display_name })`
  3. Update local `family` state so the avatar card reflects the new name immediately
  4. Collapse the form
  5. `showToast('🌿 Name updated')`
- Error displayed inline beneath input (not as toast)

### Email row

- Row description shows current email or `'No email set'`
- If `email_pending` is set OR `email_verified === 0`: amber `⚠ Unverified` badge shown on the row; edit is still allowed
- Inline expand pattern — same as name
- On save:
  1. Call `updateProfile({ email })`
  2. Collapse form
  3. `showToast('📬 Email updated')`
  4. Row badge updates to `⚠ Unverified` immediately
- **Save button disabled** when `input.trim() === currentEmail`
- Error displayed inline

### State additions to `ParentSettingsTab`

```ts
// Display name edit
const [editingName,   setEditingName]   = useState(false)
const [nameInput,     setNameInput]     = useState('')
const [nameSaving,    setNameSaving]    = useState(false)
const [nameError,     setNameError]     = useState<string | null>(null)

// Email edit
const [editingEmail,  setEditingEmail]  = useState(false)
const [emailInput,    setEmailInput]    = useState('')
const [emailSaving,   setEmailSaving]   = useState(false)
const [emailError,    setEmailError]    = useState<string | null>(null)

// Profile (from GET /auth/me, loaded alongside family/settings)
const [profile, setProfile] = useState<UserProfile | null>(null)
```

`profile` is loaded in the existing `load()` callback alongside `getFamily()` and `getSettings()`. Add `getMe()` (new API fn wrapping `GET /auth/me`) to the `Promise.all`.

---

## Section 4 — Cosmetic Fixes

### "In Goals" contrast

Find the purple/violet colour applied to the "In Goals" metric in `ChildDashboard.tsx` (both `OrchardView` and `ProfessionalView`) and replace with:
- Dark mode: `text-cyan-400`
- Light mode: `text-cyan-700`

Use Tailwind's `dark:` prefix or a CSS variable approach matching the existing pattern in the file.

### Component renames (export names only — filenames unchanged)

| File | Old export | New export |
|------|-----------|------------|
| `JobsTab.tsx` | `JobsTab` | `ChoresTab` |
| `HistoryTab.tsx` | `HistoryTab` | `ActivityTab` |

Update imports in `ParentDashboard.tsx`. Tab labels (`'Chores'`, `'Activity'`) already correct — no label changes needed.

---

## Out of Scope

- Email verification flow (magic-link to new address) — deferred
- Removing `email_pending` after manual re-verification — deferred
- Displaying `system_note` entries in the Activity tab UI — deferred (they exist in D1 for audit; no UI rendering needed now)

---

## Files Touched

| File | Change |
|------|--------|
| `worker/migrations/0019_system_note_entry_type.sql` | New migration |
| `worker/src/routes/auth.ts` | Add `handleMePatch` |
| `worker/src/index.ts` | Register `PATCH /auth/me` |
| `app/src/lib/api.ts` | Add `updateProfile()`, extend `getMe()` return type |
| `app/src/components/dashboard/ParentSettingsTab.tsx` | Inline edit forms for name + email |
| `app/src/screens/ChildDashboard.tsx` | Fix "In Goals" colour |
| `app/src/components/dashboard/JobsTab.tsx` | Rename export |
| `app/src/components/dashboard/HistoryTab.tsx` | Rename export |
| `app/src/screens/ParentDashboard.tsx` | Update imports |
