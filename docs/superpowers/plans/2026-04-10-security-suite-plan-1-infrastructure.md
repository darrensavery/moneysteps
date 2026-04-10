# Security Suite — Plan 1: Infrastructure (Migration + Worker Routes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the D1 migration for new security columns, wire five new auth routes (PIN set, PIN verify, sessions list/revoke), and update `GET /auth/me` + `issueParentJwt` to carry the new fields.

**Architecture:** All changes are in `worker/`. The migration adds four columns (three on `users`, one on `sessions`). Five new route handlers are appended to `worker/src/routes/auth.ts` and registered in `worker/src/index.ts`. No new files are created — the worker stays in its existing structure.

**Tech Stack:** Cloudflare D1 (SQL), Cloudflare Workers (TypeScript), existing `hashPassword`/`verifyPassword` helpers from `worker/src/lib/crypto.ts`, existing `AuthedRequest` type and `requireAuth` middleware.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `worker/migrations/0021_security_suite.sql` | **Create** | Four new columns |
| `worker/src/routes/auth.ts` | **Modify** | `handleMe` gains `has_password`; `issueParentJwt` writes `user_agent`; five new handlers appended |
| `worker/src/index.ts` | **Modify** | Import + register five new routes |

---

## Task 1: Write the migration

**Files:**
- Create: `worker/migrations/0021_security_suite.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 0021: Security Suite
--
-- parent_pin_hash   — parent's own 4-digit PIN (separate from child pin_hash)
-- pin_attempt_count — tracks consecutive wrong PINs (server-side lockout)
-- pin_locked_until  — unixepoch timestamp; NULL = not locked
-- sessions.user_agent — stored at login time for the Active Sessions display

ALTER TABLE users ADD COLUMN parent_pin_hash   TEXT;
ALTER TABLE users ADD COLUMN pin_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until  INTEGER;

ALTER TABLE sessions ADD COLUMN user_agent TEXT;
```

Save to `worker/migrations/0021_security_suite.sql`.

- [ ] **Step 2: Apply migration to local D1**

```bash
npx wrangler d1 migrations apply morechard-db --local
```

Expected output: `✅  Applied migration 0021_security_suite.sql`

- [ ] **Step 3: Verify columns exist**

```bash
npx wrangler d1 execute morechard-db --local --command "PRAGMA table_info(users);" | grep -E "parent_pin|pin_attempt|pin_locked"
npx wrangler d1 execute morechard-db --local --command "PRAGMA table_info(sessions);" | grep user_agent
```

Expected: two lines for `users` (parent_pin_hash, pin_attempt_count, pin_locked_until) and one for `sessions` (user_agent).

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0021_security_suite.sql
git commit -m "feat(db): migration 0021 — parent_pin_hash, pin lockout columns, sessions.user_agent"
```

---

## Task 2: Update `issueParentJwt` to write `user_agent`

**Files:**
- Modify: `worker/src/routes/auth.ts` — `issueParentJwt` function (near bottom of file)

The current INSERT into `sessions` does not write `user_agent`. Every parent session created going forward needs it.

- [ ] **Step 1: Update `issueParentJwt`**

Find this block (around line 662):

```ts
await env.DB
  .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address)
            VALUES (?,?,?,'parent',?,?)`)
  .bind(jti, userId, familyId, now + PARENT_JWT_EXPIRY, ip)
  .run();
```

Replace with:

```ts
const ua = request.headers.get('User-Agent') ?? '';

await env.DB
  .prepare(`INSERT INTO sessions (jti, user_id, family_id, role, expires_at, ip_address, user_agent)
            VALUES (?,?,?,'parent',?,?,?)`)
  .bind(jti, userId, familyId, now + PARENT_JWT_EXPIRY, ip, ua)
  .run();
```

- [ ] **Step 2: Verify the worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): write user_agent to sessions on parent login"
```

---

## Task 3: Update `GET /auth/me` to include `has_password`

**Files:**
- Modify: `worker/src/routes/auth.ts` — `handleMe` function (around line 352)

The frontend needs to know whether a password exists before showing the PIN Management screen.

- [ ] **Step 1: Update `handleMe`**

Find `handleMe` which currently runs:

```ts
const user = await env.DB
  .prepare('SELECT id, display_name, email, locale, email_verified, email_pending FROM users WHERE id = ?')
  .bind(caller.sub)
  .first();

if (!user) return error('User not found', 404);
return json({ ...user, family_id: caller.family_id, role: caller.role });
```

Replace with:

```ts
const user = await env.DB
  .prepare('SELECT id, display_name, email, locale, email_verified, email_pending, password_hash, parent_pin_hash FROM users WHERE id = ?')
  .bind(caller.sub)
  .first<{
    id: string; display_name: string; email: string | null; locale: string;
    email_verified: number; email_pending: string | null;
    password_hash: string | null; parent_pin_hash: string | null;
  }>();

if (!user) return error('User not found', 404);

const { password_hash, parent_pin_hash, ...safeUser } = user;
return json({
  ...safeUser,
  family_id: caller.family_id,
  role: caller.role,
  has_password: password_hash !== null,
  has_pin: parent_pin_hash !== null,
});
```

This strips the raw hashes before sending and adds two boolean flags.

- [ ] **Step 2: Verify the worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): GET /auth/me returns has_password and has_pin flags"
```

---

## Task 4: Add `POST /auth/pin/set`

**Files:**
- Modify: `worker/src/routes/auth.ts` — append new handler before `issueParentJwt`

- [ ] **Step 1: Append the handler**

Add this function to `auth.ts`, just before the `// ---- Internal helpers ----` comment:

```ts
// ----------------------------------------------------------------
// POST /auth/pin/set
// Set or change the parent's 4-digit PIN.
// Always requires email password as the master key.
// Body: { password: string, new_pin: string }
// ----------------------------------------------------------------
export async function handlePinSet(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { password, new_pin } = body;
  if (!password || typeof password !== 'string') return error('password required');
  if (!new_pin  || typeof new_pin  !== 'string') return error('new_pin required');
  if (!/^\d{4}$/.test(new_pin as string)) return error('PIN must be exactly 4 digits');

  const user = await env.DB
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ password_hash: string | null }>();

  if (!user) return error('User not found', 404);
  if (!user.password_hash) return error('Set a password first to enable PIN.', 400);

  const valid = await verifyPassword(password as string, user.password_hash);
  if (!valid) return error('Incorrect password', 401);

  const pinHash = await hashPassword(new_pin as string);
  await env.DB
    .prepare('UPDATE users SET parent_pin_hash = ?, pin_attempt_count = 0, pin_locked_until = NULL WHERE id = ?')
    .bind(pinHash, caller.sub)
    .run();

  return json({ ok: true });
}
```

- [ ] **Step 2: Verify the worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): POST /auth/pin/set — master-key-gated parent PIN setup"
```

---

## Task 5: Add `POST /auth/verify-pin`

**Files:**
- Modify: `worker/src/routes/auth.ts` — append new handler

- [ ] **Step 1: Append the handler**

```ts
// ----------------------------------------------------------------
// POST /auth/verify-pin
// Verifies the parent's 4-digit PIN. Server-side lockout after 3 failures.
// Body: { pin: string }
// ----------------------------------------------------------------
export async function handleVerifyPin(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { pin } = body;
  if (!pin || typeof pin !== 'string') return error('pin required');

  const now = Math.floor(Date.now() / 1000);

  const user = await env.DB
    .prepare('SELECT parent_pin_hash, pin_attempt_count, pin_locked_until FROM users WHERE id = ?')
    .bind(caller.sub)
    .first<{ parent_pin_hash: string | null; pin_attempt_count: number; pin_locked_until: number | null }>();

  if (!user) return error('User not found', 404);
  if (!user.parent_pin_hash) return error('No PIN set', 400);

  // Lockout check
  if (user.pin_locked_until && user.pin_locked_until > now) {
    const seconds = user.pin_locked_until - now;
    return error(`Too many attempts. Try again in ${seconds} seconds.`, 429);
  }

  const valid = await verifyPassword(pin as string, user.parent_pin_hash);

  if (!valid) {
    const newCount = (user.pin_attempt_count ?? 0) + 1;
    if (newCount >= 3) {
      // Lock for 30 seconds, reset counter
      await env.DB
        .prepare('UPDATE users SET pin_attempt_count = 0, pin_locked_until = ? WHERE id = ?')
        .bind(now + 30, caller.sub)
        .run();
    } else {
      await env.DB
        .prepare('UPDATE users SET pin_attempt_count = ? WHERE id = ?')
        .bind(newCount, caller.sub)
        .run();
    }
    return error('Incorrect PIN', 401);
  }

  // Correct — reset counters
  await env.DB
    .prepare('UPDATE users SET pin_attempt_count = 0, pin_locked_until = NULL WHERE id = ?')
    .bind(caller.sub)
    .run();

  return json({ ok: true });
}
```

- [ ] **Step 2: Verify the worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): POST /auth/verify-pin — 3-attempt lockout with 30s cooldown"
```

---

## Task 6: Add `GET /auth/sessions`, `DELETE /auth/sessions/:jti`, `DELETE /auth/sessions`

**Files:**
- Modify: `worker/src/routes/auth.ts` — append three handlers

- [ ] **Step 1: Append the three handlers**

```ts
// ----------------------------------------------------------------
// GET /auth/sessions
// Returns all active (non-revoked, non-expired) sessions for the caller.
// ----------------------------------------------------------------
export async function handleGetSessions(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const now = Math.floor(Date.now() / 1000);

  const { results } = await env.DB
    .prepare(`
      SELECT jti, issued_at, user_agent
      FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY issued_at DESC
    `)
    .bind(caller.sub, now)
    .all<{ jti: string; issued_at: number; user_agent: string | null }>();

  return json({ sessions: results });
}

// ----------------------------------------------------------------
// DELETE /auth/sessions/:jti
// Revoke a single session. Caller must own the session.
// ----------------------------------------------------------------
export async function handleRevokeSession(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const url = new URL(request.url);
  const jti = url.pathname.split('/').at(-1);
  if (!jti) return error('jti required', 400);

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE jti = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now, jti, caller.sub)
    .run();

  if (result.meta.changes === 0) return error('Session not found', 404);
  return json({ ok: true });
}

// ----------------------------------------------------------------
// DELETE /auth/sessions?others=true
// Revoke all sessions for this user except the current one.
// ----------------------------------------------------------------
export async function handleRevokeOtherSessions(request: Request, env: Env): Promise<Response> {
  const caller = (request as AuthedRequest).auth;
  if (!caller) return error('Unauthorised', 401);
  if (caller.role !== 'parent') return error('Parents only', 403);

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND jti != ? AND revoked_at IS NULL')
    .bind(now, caller.sub, caller.jti)
    .run();

  return json({ ok: true, revoked: result.meta.changes });
}
```

- [ ] **Step 2: Verify the worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): GET /auth/sessions, DELETE /auth/sessions/:jti, DELETE /auth/sessions?others"
```

---

## Task 7: Register all new routes in `index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Update the import from `routes/auth.js`**

Find the existing import block:

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

Replace with:

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
  handlePinSet,
  handleVerifyPin,
  handleGetSessions,
  handleRevokeSession,
  handleRevokeOtherSessions,
} from './routes/auth.js';
```

- [ ] **Step 2: Register the routes in the `route()` function**

Find the block of auth routes in the `route()` function inside `index.ts` (search for `handleLogout` to locate the right area). After the existing auth route registrations, add:

```ts
// ── Security / PIN ────────────────────────────────────────────────
if (method === 'POST' && path === '/auth/pin/set') {
  await requireAuth(request, env);
  return handlePinSet(request, env);
}
// Same handler — distinct route name lets the frontend show different copy
if (method === 'POST' && path === '/auth/pin/reset-with-password') {
  await requireAuth(request, env);
  return handlePinSet(request, env);
}
if (method === 'POST' && path === '/auth/verify-pin') {
  await requireAuth(request, env);
  return handleVerifyPin(request, env);
}

// ── Sessions ──────────────────────────────────────────────────────
if (method === 'GET' && path === '/auth/sessions') {
  await requireAuth(request, env);
  return handleGetSessions(request, env);
}
if (method === 'DELETE' && path.startsWith('/auth/sessions/')) {
  await requireAuth(request, env);
  return handleRevokeSession(request, env);
}
if (method === 'DELETE' && path === '/auth/sessions' && url.searchParams.get('others') === 'true') {
  await requireAuth(request, env);
  return handleRevokeOtherSessions(request, env);
}
```

**Important:** Place these blocks **before** the `return error('Not found', 404)` fallthrough at the bottom of the routing function.

- [ ] **Step 3: Verify the full worker builds**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke-test locally**

```bash
npx wrangler dev
```

In another terminal:

```bash
# Get a parent token first (substitute real values from your local DB)
TOKEN=$(curl -s -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"yourpassword"}' | jq -r '.token')

# Check has_password and has_pin appear in /auth/me
curl -s http://localhost:8787/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '{has_password, has_pin}'
# Expected: { "has_password": true, "has_pin": false }

# Set a PIN
curl -s -X POST http://localhost:8787/auth/pin/set \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"yourpassword","new_pin":"1234"}' | jq
# Expected: { "ok": true }

# Verify PIN
curl -s -X POST http://localhost:8787/auth/verify-pin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}' | jq
# Expected: { "ok": true }

# Wrong PIN 3 times → expect 429 on the 3rd attempt
for i in 1 2 3; do
  curl -s -X POST http://localhost:8787/auth/verify-pin \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"pin":"0000"}' | jq .
done
# Expected: first two return 401, third returns 429 with seconds remaining

# List sessions
curl -s http://localhost:8787/auth/sessions \
  -H "Authorization: Bearer $TOKEN" | jq
# Expected: array with at least one session (your current login)
```

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(router): register PIN and session management routes"
```

---

## Task 8: Apply migration to production D1

> Do this only when ready to deploy. Do not apply to production during development.

- [ ] **Step 1: Apply to remote D1**

```bash
npx wrangler d1 migrations apply morechard-db --remote
```

Expected: `✅  Applied migration 0021_security_suite.sql`

- [ ] **Step 2: Deploy the worker**

```bash
npx wrangler deploy
```

- [ ] **Step 3: Smoke-test production**

Repeat the curl smoke-test from Task 7 Step 4 against your production URL (replace `http://localhost:8787` with `https://api.morechard.com` or equivalent).

- [ ] **Step 4: Commit (deploy tag)**

```bash
git tag security-suite-infra-deployed
git push origin security-suite-infra-deployed
```

---

## Self-Review Checklist

- [x] Migration adds all four columns from spec: `parent_pin_hash`, `pin_attempt_count`, `pin_locked_until`, `sessions.user_agent`
- [x] `issueParentJwt` writes `user_agent` on every parent login
- [x] `GET /auth/me` returns `has_password` and `has_pin` without leaking raw hashes
- [x] `POST /auth/pin/set` always requires `password` (master key, no shortcut)
- [x] `POST /auth/verify-pin` implements 3-attempt / 30s lockout server-side
- [x] `GET /auth/sessions` filters `revoked_at IS NULL AND expires_at > now`
- [x] `DELETE /auth/sessions/:jti` guards `user_id` match (cross-user revocation blocked)
- [x] `DELETE /auth/sessions?others=true` excludes current `jti`
- [x] All routes require `requireAuth` + parent role check
- [x] `POST /auth/pin/reset-with-password` is the same logic as `POST /auth/pin/set` — the spec says "same handler, same validation" so `handlePinSet` serves both. The router can register `/auth/pin/reset-with-password` pointing to the same handler if distinct frontend copy is needed. **Add this registration in Task 7.**
