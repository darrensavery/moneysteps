# Delete Account — Co-Parent Aware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `onComingSoon()` stub on "Delete Account" with two real, co-parent-aware flows: "Leave Family" (when other parents exist) and "Uproot / Delete Account" (when the current user is the sole lead).

**Architecture:** A D1 migration adds `parent_role` to `family_roles` (distinguishing `lead` from `co_parent`) and `deleted_at` to `families` for soft-delete. Three new worker routes handle lead-count query, leave, and family deletion. The frontend reads lead count on mount and renders the correct modal. Both paths wipe localStorage and redirect to `/`.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Worker (TypeScript), React + Tailwind (frontend PWA), Lucide icons.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `worker/migrations/0020_parent_role_and_family_soft_delete.sql` | Create | Adds `parent_role` column + backfill + `deleted_at` |
| `worker/src/routes/auth.ts` | Modify | Add `handleFamilyLeads`, `handleLeaveFamily`, `handleDeleteFamily` |
| `worker/src/routes/invite.ts` | Modify | Set `parent_role = 'co_parent'` on co-parent redeem |
| `worker/src/lib/middleware.ts` | Modify | Add `deleted_at IS NULL` guard to `requireAuth` |
| `worker/src/index.ts` | Modify | Register three new routes |
| `app/src/lib/api.ts` | Modify | Add `getLeadCount`, `leaveFamily`, `deleteFamily` |
| `app/src/components/dashboard/ParentSettingsTab.tsx` | Modify | Load `leadCount`, pass to `ProfileSettings` |
| `app/src/components/settings/sections/ProfileSettings.tsx` | Modify | Co-parent-aware Danger Zone + Leave/Uproot modals |

---

## Task 1: Database Migration

**Files:**
- Create: `worker/migrations/0020_parent_role_and_family_soft_delete.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 0020: Add parent_role to family_roles; add deleted_at to families.
--
-- parent_role values:
--   'lead'      — primary billing/deletion authority (founding parent or promoted co-parent)
--   'co_parent' — full audit/approval rights, cannot delete the family
--   NULL        — future: 'viewer' role (read-only, grandparents/social workers)
--
-- Backfill: all existing parent rows become 'lead' because no co-parent
-- invite redemption has ever written a parent_role value.

ALTER TABLE family_roles ADD COLUMN parent_role TEXT
  CHECK (parent_role IN ('lead', 'co_parent'));

UPDATE family_roles
  SET parent_role = 'lead'
  WHERE role = 'parent' AND parent_role IS NULL;

ALTER TABLE families ADD COLUMN deleted_at INTEGER;
```

- [ ] **Step 2: Apply migration to local D1**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npx wrangler d1 execute morechard-db --local --file=worker/migrations/0020_parent_role_and_family_soft_delete.sql
```

Expected output: `🌀 Executing on local database...` with no errors.

- [ ] **Step 3: Verify columns exist**

```bash
npx wrangler d1 execute morechard-db --local --command="PRAGMA table_info(family_roles); PRAGMA table_info(families);"
```

Expected: `family_roles` includes a `parent_role` column; `families` includes a `deleted_at` column.

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0020_parent_role_and_family_soft_delete.sql
git commit -m "feat(db): migration 0020 — add parent_role to family_roles, deleted_at to families"
```

---

## Task 2: Update `handleCreateFamily` to write `parent_role = 'lead'`

**Files:**
- Modify: `worker/src/routes/auth.ts` (around line 91)

- [ ] **Step 1: Update the INSERT in `handleCreateFamily`**

Find this line in `handleCreateFamily`:
```ts
env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role) VALUES (?,?,'parent')`)
  .bind(userId, familyId),
```

Replace with:
```ts
env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?,?,'parent','lead')`)
  .bind(userId, familyId),
```

- [ ] **Step 2: Also update `handleRegister` (around line 132)**

Find:
```ts
env.DB.prepare(`
  INSERT INTO family_roles (user_id, family_id, role) VALUES (?,?,'parent')
`).bind(userId, family_id),
```

Replace with:
```ts
env.DB.prepare(`
  INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?,?,'parent','lead')
`).bind(userId, family_id),
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): stamp parent_role='lead' on family creation and direct registration"
```

---

## Task 3: Update `handleRedeemInvite` to write `parent_role = 'co_parent'`

**Files:**
- Modify: `worker/src/routes/invite.ts` (around line 227)

- [ ] **Step 1: Find the co-parent family_roles insert**

Find this line in `handleRedeemInvite` (the co-parent branch, around line 227):
```ts
env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role) VALUES (?, ?, 'parent')`)
```

Replace with:
```ts
env.DB.prepare(`INSERT INTO family_roles (user_id, family_id, role, parent_role) VALUES (?, ?, 'parent', 'co_parent')`)
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/routes/invite.ts
git commit -m "feat(invite): stamp parent_role='co_parent' on co-parent invite redemption"
```

---

## Task 4: Add three new auth route handlers

**Files:**
- Modify: `worker/src/routes/auth.ts` (append to end of file, before the `parseBody` helper)

- [ ] **Step 1: Add `handleFamilyLeads`**

Append to `worker/src/routes/auth.ts`:

```ts
// ----------------------------------------------------------------
// GET /auth/family/leads
// Returns the count of lead parents in the calling user's family.
// Used by the frontend to decide between "Leave Family" and "Delete Account".
// Auth: any authenticated parent.
// ----------------------------------------------------------------
export async function handleFamilyLeads(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = request.auth;
  if (!auth) return error('Authorisation required', 401);

  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS lead_count FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead'`)
    .bind(auth.family_id)
    .first<{ lead_count: number }>();

  return json({ lead_count: row?.lead_count ?? 0 });
}
```

- [ ] **Step 2: Add `handleLeaveFamily`**

Append to `worker/src/routes/auth.ts`:

```ts
// ----------------------------------------------------------------
// DELETE /auth/me/leave
// Removes the calling parent from the family.
//
// Safety gates:
//   1. Empty Orchard Guard — rejects if no other parent exists.
//   2. Succession Gate — if caller is the last lead but co_parents exist,
//      promotes one co_parent to lead before departing.
//
// Sequence (D1 batch):
//   - Capture display_name for audit note.
//   - Optionally promote a co_parent to lead.
//   - Anonymise caller (name, email, password_hash, pin_hash, email_pending).
//   - Revoke all caller sessions.
//   - Remove caller's family_roles row.
//   - Write system_note ledger entry.
// ----------------------------------------------------------------
export async function handleLeaveFamily(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = request.auth;
  if (!auth) return error('Authorisation required', 401);

  const userId   = auth.sub;
  const familyId = auth.family_id;
  const ip       = clientIp(request);

  // Fetch caller's current parent_role and display_name
  const caller = await env.DB
    .prepare(`SELECT u.display_name, fr.parent_role FROM users u JOIN family_roles fr ON fr.user_id = u.id WHERE u.id = ? AND fr.family_id = ? AND fr.role = 'parent'`)
    .bind(userId, familyId)
    .first<{ display_name: string; parent_role: string | null }>();

  if (!caller) return error('Parent record not found', 404);

  // Count all other parents in the family (any parent_role)
  const others = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  // Empty Orchard Guard — must use Delete Account instead
  if ((others?.cnt ?? 0) === 0) {
    return error('Cannot leave an empty orchard. Use Delete Account instead.', 400);
  }

  // Succession Gate — if caller is a lead, check whether other leads exist
  const otherLeads = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead' AND user_id != ?`)
    .bind(familyId, userId)
    .first<{ cnt: number }>();

  // Find a co_parent to promote if no other lead exists
  let promotionStmt: D1PreparedStatement | null = null;
  if ((otherLeads?.cnt ?? 0) === 0) {
    const coParent = await env.DB
      .prepare(`SELECT user_id FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'co_parent' LIMIT 1`)
      .bind(familyId)
      .first<{ user_id: string }>();

    if (coParent) {
      promotionStmt = env.DB
        .prepare(`UPDATE family_roles SET parent_role = 'lead' WHERE user_id = ? AND family_id = ?`)
        .bind(coParent.user_id, familyId);
    }
  }

  // Ledger: compute hash chain
  const prevRow = await env.DB
    .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
    .bind(familyId)
    .first<{ id: number; record_hash: string }>();
  const maxRow = await env.DB
    .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger WHERE family_id = ?')
    .bind(familyId)
    .first<{ max_id: number }>();
  const previousHash = prevRow?.record_hash ?? GENESIS_HASH;
  const newId        = (maxRow?.max_id ?? 0) + 1;
  const recordHash   = await computeRecordHash(newId, familyId, null, 0, 'GBP', 'system_note', previousHash);

  const capturedName = caller.display_name;

  const batch: D1PreparedStatement[] = [
    // Anonymise caller
    env.DB.prepare(`UPDATE users SET display_name = 'Former Co-Parent', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE id = ?`)
      .bind(userId),
    // Revoke all sessions
    env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(userId),
    // Remove family_roles row
    env.DB.prepare(`DELETE FROM family_roles WHERE user_id = ? AND family_id = ?`)
      .bind(userId, familyId),
    // Audit note
    env.DB.prepare(`INSERT INTO ledger (id, family_id, child_id, entry_type, amount, currency, description, verification_status, previous_hash, record_hash, ip_address) VALUES (?,?,NULL,'system_note',0,'GBP',?,?  ,'verified_auto',?,?,?)`)
      .bind(newId, familyId, `🌱 ${capturedName} has left the orchard.`, previousHash, recordHash, ip),
  ];

  if (promotionStmt) batch.unshift(promotionStmt); // promote first, then remove

  await env.DB.batch(batch);

  return json({ ok: true, action: 'left' });
}
```

> **Note on `D1PreparedStatement` type:** Import it from the Cloudflare Workers types — it is available globally as `D1PreparedStatement` in the worker environment. No additional import needed if `@cloudflare/workers-types` is in scope.

- [ ] **Step 3: Add `handleDeleteFamily`**

Append to `worker/src/routes/auth.ts`:

```ts
// ----------------------------------------------------------------
// DELETE /auth/family
// Soft-deletes the entire family. Lead-only. Only callable when
// the caller is the last lead.
//
// Safety gates:
//   1. Lead-only — rejects if caller's parent_role != 'lead'.
//   2. Last Lead Guard — rejects if other leads exist in the family.
//
// Sequence (D1 batch):
//   - Soft-delete family record (deleted_at = now).
//   - Anonymise ALL family users (name, email, password_hash, pin_hash, email_pending).
//   - Revoke ALL sessions for all family users.
//   - Delete invite_codes and registration_progress for the family.
//   - Ledger, chores, goals, snapshots — left intact (anonymised, no PII).
// ----------------------------------------------------------------
export async function handleDeleteFamily(request: Request & { auth?: JwtPayload }, env: Env): Promise<Response> {
  const auth = request.auth;
  if (!auth) return error('Authorisation required', 401);

  const userId   = auth.sub;
  const familyId = auth.family_id;

  // Lead-only check
  const callerRole = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(userId, familyId)
    .first<{ parent_role: string | null }>();

  if (!callerRole || callerRole.parent_role !== 'lead') {
    return error('Only a Lead parent can delete the family.', 403);
  }

  // Last Lead Guard
  const leadCount = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM family_roles WHERE family_id = ? AND role = 'parent' AND parent_role = 'lead'`)
    .bind(familyId)
    .first<{ cnt: number }>();

  if ((leadCount?.cnt ?? 0) > 1) {
    return error('An orchard cannot be uprooted while another guardian is present.', 403);
  }

  await env.DB.batch([
    // Soft-delete the family
    env.DB.prepare(`UPDATE families SET deleted_at = unixepoch() WHERE id = ?`)
      .bind(familyId),
    // Anonymise all users in the family
    env.DB.prepare(`UPDATE users SET display_name = 'Deleted User', email = NULL, email_pending = NULL, password_hash = NULL, pin_hash = NULL WHERE family_id = ?`)
      .bind(familyId),
    // Revoke all sessions for all family users
    env.DB.prepare(`UPDATE sessions SET revoked_at = unixepoch() WHERE user_id IN (SELECT id FROM users WHERE family_id = ?) AND revoked_at IS NULL`)
      .bind(familyId),
    // Delete invite codes
    env.DB.prepare(`DELETE FROM invite_codes WHERE family_id = ?`)
      .bind(familyId),
    // Delete registration progress
    env.DB.prepare(`DELETE FROM registration_progress WHERE family_id = ?`)
      .bind(familyId),
  ]);

  return json({ ok: true, action: 'uprooted' });
}
```

- [ ] **Step 4: Add missing imports at top of auth.ts**

Verify that `computeRecordHash` and `GENESIS_HASH` are imported. They're already imported in the existing file header:
```ts
import { sha256, computeRecordHash, GENESIS_HASH } from '../lib/hash.js';
```
If not present, add this import. Also verify `JwtPayload` is imported from `'../lib/jwt.js'` — it already is.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): add handleFamilyLeads, handleLeaveFamily, handleDeleteFamily routes"
```

---

## Task 5: Update middleware — soft-delete guard

**Files:**
- Modify: `worker/src/lib/middleware.ts`

- [ ] **Step 1: Add `deleted_at IS NULL` check after session validation**

In `requireAuth`, after `if (session.revoked_at) return error(...)`, add:

```ts
  // Check the family has not been soft-deleted
  const family = await env.DB
    .prepare('SELECT deleted_at FROM families WHERE id = ?')
    .bind(payload.family_id)
    .first<{ deleted_at: number | null }>();

  if (!family || family.deleted_at !== null) {
    return error('This family has been deleted.', 403);
  }
```

The full updated `requireAuth` function should look like:

```ts
export async function requireAuth(request: Request, env: Env): Promise<JwtPayload | Response> {
  const token = extractToken(request);
  if (!token) return error('Authorisation required', 401);

  let payload: JwtPayload;
  try {
    payload = await verifyJwt(token, env.JWT_SECRET);
  } catch {
    return error('Invalid or expired token', 401);
  }

  // Check session has not been revoked
  const session = await env.DB
    .prepare('SELECT revoked_at FROM sessions WHERE jti = ?')
    .bind(payload.jti)
    .first<{ revoked_at: number | null }>();

  if (!session)           return error('Session not found', 401);
  if (session.revoked_at) return error('Session revoked — please log in again', 401);

  // Check the family has not been soft-deleted
  const family = await env.DB
    .prepare('SELECT deleted_at FROM families WHERE id = ?')
    .bind(payload.family_id)
    .first<{ deleted_at: number | null }>();

  if (!family || family.deleted_at !== null) {
    return error('This family has been deleted.', 403);
  }

  return payload;
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/lib/middleware.ts
git commit -m "feat(middleware): block requests to soft-deleted families"
```

---

## Task 6: Register new routes in `index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add imports**

Find the import block for auth handlers (around line 91–101):
```ts
import {
  handleCreateFamily,
  handleRegister,
  ...
  handleMePatch,
} from './routes/auth.js';
```

Add the three new handlers:
```ts
import {
  handleCreateFamily,
  handleRegister,
  handleLogin,
  handleMagicLinkRequest,
  handleMagicLinkVerify,
  handleChildLogin,
  handleSetChildPin,
  handleLogout,
  handleMe,
  handleMePatch,
  handleFamilyLeads,
  handleLeaveFamily,
  handleDeleteFamily,
} from './routes/auth.js';
```

- [ ] **Step 2: Register routes in the `route()` function**

The new routes must be placed **inside the authenticated zone but before the trial block** (to avoid blocking users who are trying to delete while on expired trial). Add after the `/auth/me PATCH` route (around line 288):

```ts
  // Co-parent-aware account deletion
  if (path === '/auth/family/leads' && method === 'GET')    return withAuth(request, auth, env, handleFamilyLeads);
  if (path === '/auth/me/leave'     && method === 'DELETE') return withAuth(request, auth, env, handleLeaveFamily);
  if (path === '/auth/family'       && method === 'DELETE') return withAuth(request, auth, env, handleDeleteFamily);
```

> **Important:** Place these three lines before the `checkTrialStatus` call to ensure users on an expired trial can still leave or delete.

- [ ] **Step 3: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(router): register GET /auth/family/leads, DELETE /auth/me/leave, DELETE /auth/family"
```

---

## Task 7: Deploy worker to verify backend compiles

- [ ] **Step 1: Build the worker**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npx wrangler deploy --dry-run
```

Expected: `Total Upload: ...kB` with no TypeScript compile errors.

- [ ] **Step 2: If errors, fix them before proceeding**

Common issues:
- `D1PreparedStatement` type not found — this is a global type from `@cloudflare/workers-types`. Ensure `tsconfig.json` includes `"types": ["@cloudflare/workers-types"]`.
- `computeRecordHash` signature mismatch — check `worker/src/lib/hash.ts` for the exact parameter order.

---

## Task 8: Add API client functions

**Files:**
- Modify: `app/src/lib/api.ts`

- [ ] **Step 1: Add three new functions after the existing `updateProfile` function**

```ts
// ----------------------------------------------------------------
// Co-parent-aware account deletion
// ----------------------------------------------------------------
export async function getLeadCount(): Promise<{ lead_count: number }> {
  return request('/auth/family/leads', { method: 'GET' });
}

export async function leaveFamily(): Promise<{ ok: boolean; action: string }> {
  return request('/auth/me/leave', { method: 'DELETE' });
}

export async function deleteFamily(): Promise<{ ok: boolean; action: string }> {
  return request('/auth/family', { method: 'DELETE' });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/api.ts
git commit -m "feat(api): add getLeadCount, leaveFamily, deleteFamily client functions"
```

---

## Task 9: Update `ParentSettingsTab` to load and pass `leadCount`

**Files:**
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx`

- [ ] **Step 1: Import new API functions**

Find the existing api imports (around line 72–79):
```ts
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
  getChildGrowth, updateChildGrowth,
  getMe, updateProfile,
  type MeResult,
} from '../../lib/api'
```

Add `getLeadCount`:
```ts
import {
  getChildren, addChild, generateInvite,
  getFamily, getSettings, updateSettings,
  getChildSettings, updateChildSettings,
  getChildGrowth, updateChildGrowth,
  getMe, updateProfile, getLeadCount,
  type MeResult,
} from '../../lib/api'
```

- [ ] **Step 2: Add `leadCount` state**

After the `profile` state declaration (around line 241):
```ts
const [profile, setProfile] = useState<MeResult | null>(null)
```

Add:
```ts
const [leadCount, setLeadCount] = useState<number>(1)
```

- [ ] **Step 3: Load `leadCount` inside `load()`**

Find the `Promise.all` inside `load()` (around line 263):
```ts
const [c, f, s, p] = await Promise.all([
  getChildren().then(r => r.children),
  getFamily(),
  getSettings(),
  getMe(),
])
```

Replace with:
```ts
const [c, f, s, p, leads] = await Promise.all([
  getChildren().then(r => r.children),
  getFamily(),
  getSettings(),
  getMe(),
  getLeadCount().then(r => r.lead_count).catch(() => 1),
])
```

Then after `setProfile(p)`, add:
```ts
setLeadCount(leads)
```

- [ ] **Step 4: Pass `leadCount` to `ProfileSettings`**

Find the `ProfileSettings` render (around line 346):
```ts
if (view.section === 'account') return <ProfileSettings profile={profile} settings={settings} identity={identity} family={family} isLead={isLead} onSaveName={handleSaveName} onSaveEmail={handleSaveEmail} onSetAvatar={handleSetAvatar} onBack={back} onComingSoon={comingSoon} toast={toast} />
```

Replace with:
```ts
if (view.section === 'account') return <ProfileSettings profile={profile} settings={settings} identity={identity} family={family} isLead={isLead} leadCount={leadCount} onSaveName={handleSaveName} onSaveEmail={handleSaveEmail} onSetAvatar={handleSetAvatar} onBack={back} onComingSoon={comingSoon} toast={toast} />
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dashboard/ParentSettingsTab.tsx
git commit -m "feat(settings): load leadCount and pass to ProfileSettings"
```

---

## Task 10: Update `ProfileSettings` — co-parent-aware Danger Zone

**Files:**
- Modify: `app/src/components/settings/sections/ProfileSettings.tsx`

- [ ] **Step 1: Update Props interface**

Find the Props interface (around line 19):
```ts
interface Props {
  profile:      MeResult | null
  settings:     { avatar_id: string; theme: string; locale: string } | null
  identity:     ReturnType<typeof getDeviceIdentity>
  family:       Record<string, unknown>
  isLead:       boolean
  onSaveName:   (newName: string) => Promise<void>
  onSaveEmail:  (newEmail: string) => Promise<void>
  onSetAvatar:  (id: string) => Promise<void>
  onBack:       () => void
  onComingSoon: () => void
  toast:        string | null
}
```

Replace with:
```ts
interface Props {
  profile:      MeResult | null
  settings:     { avatar_id: string; theme: string; locale: string } | null
  identity:     ReturnType<typeof getDeviceIdentity>
  family:       Record<string, unknown>
  isLead:       boolean
  leadCount:    number
  onSaveName:   (newName: string) => Promise<void>
  onSaveEmail:  (newEmail: string) => Promise<void>
  onSetAvatar:  (id: string) => Promise<void>
  onBack:       () => void
  onComingSoon: () => void
  toast:        string | null
}
```

- [ ] **Step 2: Add `leadCount` to destructuring**

Find the function signature (around line 35):
```ts
export function ProfileSettings({
  profile, settings, identity, family, isLead,
  onSaveName, onSaveEmail, onSetAvatar,
  onBack, onComingSoon, toast,
}: Props) {
```

Replace with:
```ts
export function ProfileSettings({
  profile, settings, identity, family, isLead, leadCount,
  onSaveName, onSaveEmail, onSetAvatar,
  onBack, onComingSoon, toast,
}: Props) {
```

- [ ] **Step 3: Add modal state variables**

After the existing email state variables (after `const [emailError, setEmailError] = useState...`), add:

```ts
  // Danger zone modal state
  const [showLeaveModal,  setShowLeaveModal]  = useState(false)
  const [showUprootModal, setShowUprootModal] = useState(false)
  const [uprootInput,     setUprootInput]     = useState('')
  const [dangerBusy,      setDangerBusy]      = useState(false)
  const [dangerError,     setDangerError]     = useState<string | null>(null)
```

- [ ] **Step 4: Add import for `leaveFamily` and `deleteFamily`**

At the top of the file, add to the existing imports from `../../../lib/api`:
```ts
import { leaveFamily, deleteFamily } from '../../../lib/api'
```

Also add `LogOut` to the lucide-react import:
```ts
import { User, Shield, AlertTriangle, X, LogOut } from 'lucide-react'
```

Also add the `clearToken` import:
```ts
import { clearToken } from '../../../lib/api'
import { clearDeviceIdentity } from '../../../lib/deviceIdentity'
```

- [ ] **Step 5: Add handler functions**

After `handleSetAvatar`, add:

```ts
  function wipeLsAndRedirect() {
    clearDeviceIdentity()
    sessionStorage.removeItem('mc_parent_tab')
    localStorage.removeItem('mc_parent_avatar')
    clearToken()
    window.location.replace('/')
  }

  async function handleLeave() {
    setDangerBusy(true)
    setDangerError(null)
    try {
      await leaveFamily()
      wipeLsAndRedirect()
    } catch (err: unknown) {
      setDangerError((err as Error).message)
      setDangerBusy(false)
    }
  }

  async function handleUproot() {
    if (uprootInput !== 'UPROOT') return
    setDangerBusy(true)
    setDangerError(null)
    try {
      await deleteFamily()
      wipeLsAndRedirect()
    } catch (err: unknown) {
      setDangerError((err as Error).message)
      setDangerBusy(false)
    }
  }
```

- [ ] **Step 6: Replace the Danger Zone JSX**

Find the existing Danger Zone block (around line 254):
```tsx
      {/* Delete — Lead only */}
      {isLead && (
        <div>
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
          <div className="rounded-xl border-2 border-red-500 overflow-hidden">
            <SettingsRow
              icon={<AlertTriangle size={15} />}
              label="Delete Account"
              description="Permanently uproot your orchard and delete your family account, including all data"
              onClick={onComingSoon}
              destructive
            />
          </div>
        </div>
      )}
```

Replace with:
```tsx
      {/* Danger Zone — visible to all parents */}
      <div>
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-2">Danger Zone</p>
        <div className="rounded-xl border-2 border-red-500 overflow-hidden">
          {leadCount > 1 ? (
            <SettingsRow
              icon={<LogOut size={15} />}
              label="Leave Family"
              description="You will lose access, but the family ledger will remain for the other parent."
              onClick={() => setShowLeaveModal(true)}
              destructive
            />
          ) : (
            <SettingsRow
              icon={<AlertTriangle size={15} />}
              label="Delete Account"
              description="Permanently uproot your orchard and delete your family account, including all data"
              onClick={() => setShowUprootModal(true)}
              destructive
            />
          )}
        </div>
      </div>

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-[var(--color-text)]">Leave Family?</p>
              <button onClick={() => { setShowLeaveModal(false); setDangerError(null) }} className="text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              You will permanently lose access to this family. The ledger and all data will remain for the other parent.
            </p>
            {isLead && (
              <p className="text-[12px] text-amber-600 font-semibold leading-relaxed">
                A co-parent will be promoted to Lead to ensure the family can still be managed.
              </p>
            )}
            {dangerError && <p className="text-[12px] text-red-500">{dangerError}</p>}
            <button
              onClick={handleLeave}
              disabled={dangerBusy}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-red-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {dangerBusy ? 'Leaving…' : 'Leave Family'}
            </button>
          </div>
        </div>
      )}

      {/* Uproot Modal */}
      {showUprootModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-8">
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-red-600">Delete Everything?</p>
              <button onClick={() => { setShowUprootModal(false); setUprootInput(''); setDangerError(null) }} className="text-[var(--color-text-muted)] cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              This will permanently uproot your orchard. All family data, chores, and goals will be deleted. The ledger will be anonymised but structurally preserved.
            </p>
            <input
              type="text"
              value={uprootInput}
              onChange={e => setUprootInput(e.target.value)}
              placeholder="Type UPROOT to confirm"
              className="w-full px-3 py-2 text-[14px] rounded-xl border border-red-300 bg-red-50 text-red-800 placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {dangerError && <p className="text-[12px] text-red-500">{dangerError}</p>}
            <button
              onClick={handleUproot}
              disabled={dangerBusy || uprootInput !== 'UPROOT'}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-red-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {dangerBusy ? 'Deleting…' : 'Delete Everything'}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/settings/sections/ProfileSettings.tsx
git commit -m "feat(ui): co-parent-aware Danger Zone with Leave and Uproot modals"
```

---

## Task 11: Apply migration to production D1

- [ ] **Step 1: Apply migration to remote D1**

```bash
npx wrangler d1 execute morechard-db --remote --file=worker/migrations/0020_parent_role_and_family_soft_delete.sql
```

Expected: `🌀 Executing on remote database...` with no errors.

- [ ] **Step 2: Verify backfill applied**

```bash
npx wrangler d1 execute morechard-db --remote --command="SELECT user_id, role, parent_role FROM family_roles WHERE role = 'parent' LIMIT 10;"
```

Expected: all rows show `parent_role = 'lead'`.

---

## Task 12: Deploy and smoke test

- [ ] **Step 1: Deploy worker**

```bash
npx wrangler deploy
```

- [ ] **Step 2: Run local dev server and verify UI**

```bash
npm run dev
```

Open the app → Settings → Account & Profile → scroll to Danger Zone.

**Solo Lead scenario** (`lead_count = 1`):
- Row label: "Delete Account"
- Clicking opens Uproot Modal
- "Delete Everything" button is disabled until `UPROOT` is typed exactly

**Co-parenting scenario** (`lead_count > 1`): (requires a second parent in the family via invite)
- Row label: "Leave Family"
- Clicking opens Leave Modal with the two-line warning
- If the current user is a Lead: amber text "A co-parent will be promoted to Lead..." is visible
- "Leave Family" button is red and active

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat: co-parent-aware Delete Account — Leave Family + Uproot flows"
git push
```

---

## Self-Review Against Spec

| Spec requirement | Task(s) |
|-----------------|---------|
| Migration 0020 — `parent_role` + backfill | Task 1 |
| Migration 0020 — `deleted_at` on families | Task 1 |
| `handleCreateFamily` writes `parent_role = 'lead'` | Task 2 |
| `handleRegister` writes `parent_role = 'lead'` | Task 2 |
| `handleRedeemInvite` writes `parent_role = 'co_parent'` | Task 3 |
| `GET /auth/family/leads` | Task 4, Task 6 |
| `DELETE /auth/me/leave` with Empty Orchard Guard | Task 4, Task 6 |
| `DELETE /auth/me/leave` Succession Gate (handles multiple leads) | Task 4 |
| `DELETE /auth/me/leave` anonymises caller incl. `pin_hash` | Task 4 |
| `DELETE /auth/me/leave` writes `system_note` ledger entry | Task 4 |
| `DELETE /auth/family` Lead-only + Last Lead Guard | Task 4, Task 6 |
| `DELETE /auth/family` soft-deletes family | Task 4 |
| `DELETE /auth/family` anonymises all users incl. `pin_hash` | Task 4 |
| `DELETE /auth/family` revokes all sessions | Task 4 |
| `DELETE /auth/family` cleans invite_codes + registration_progress | Task 4 |
| Middleware `deleted_at IS NULL` backstop | Task 5 |
| Routes bypass trial paywall | Task 6 (placed before `checkTrialStatus`) |
| `getLeadCount`, `leaveFamily`, `deleteFamily` API client | Task 8 |
| `ParentSettingsTab` loads + passes `leadCount` | Task 9 |
| `ProfileSettings` `leadCount` prop | Task 10 |
| Danger Zone: "Leave Family" label when `leadCount > 1` | Task 10 |
| Danger Zone: "Delete Account" label when `leadCount === 1` | Task 10 |
| `isLead` gate removed from Danger Zone (co-parents can also leave) | Task 10 |
| Leave Modal — succession transparency text for leads | Task 10 |
| Uproot Modal — type `UPROOT` to confirm | Task 10 |
| Full localStorage wipe on both paths | Task 10 |
| `window.location.replace('/')` on both paths | Task 10 |
| Production migration applied | Task 11 |
