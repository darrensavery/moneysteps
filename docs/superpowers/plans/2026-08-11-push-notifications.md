# Push Notifications + App Icon Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native push notifications (iOS + Android, via Capacitor) for parents and children, plus a home-screen app icon badge that mirrors the existing in-app "needs action" count.

**Architecture:** Worker sends pushes directly to FCM (Android, RS256-JWT → OAuth token → REST) and APNs (iOS, ES256-JWT → REST) — no third-party push vendor. Badge/pending state is computed live from existing tables (no notification-history table). Trigger sends are fire-and-forget (`ctx.waitUntil` + `Promise.allSettled`) inserted into existing chore/completion/goal route handlers, following the same non-critical try/catch pattern those files already use for gamification hooks.

**Tech Stack:** Cloudflare Workers + D1 + KV (existing `CACHE` binding, reused), `@capacitor/push-notifications`, `@capawesome/capacitor-badge`, `react-router-dom` (existing), vitest (existing).

Full design: `docs/superpowers/specs/2026-08-11-push-notifications-design.md`.

## Global Constraints

- **No third-party push vendor.** Talk to FCM and APNs directly; no OneSignal/Firebase Admin SDK.
- **Native app only for v1.** No web push for browser-installed PWA users.
- **No notification-history table.** Pending/badge state is always derived live from existing tables.
- **`token` is the D1 primary key** on `device_tokens` (not `user_id`) — a physical token belongs to one installation; re-registering under a different `user_id` reassigns it (shared-device correctness).
- **APNs environment (`sandbox`/`production`) is stored per-token**, driven by the build's provisioning profile, never inferred from `NODE_ENV`. TestFlight and App Store builds both register as `production`.
- **Push sends never block the triggering API response** — always `ctx.waitUntil(...)`, always wrapped so a failure can't throw into the caller.
- **Badge-setting on the client is always guarded** with `Badge.isSupported()` + try/catch (Android launcher fragmentation).
- **Deep-link navigation from a tapped push uses the SPA router (`useNavigate()`)**, never `window.location.href` — that stays reserved for the post-registration stack-reset case per CLAUDE.md's Navigation Rule.
- Child-facing copy follows the existing Seedling/Professional persona split and avoids the "grove" metaphor on-screen (per project convention already used in `child-nudges.ts`).
- Route/handler code follows this codebase's existing conventions exactly: raw `fetch`-handler routing in `worker/src/index.ts` (`path === '...' && method === '...'`, no framework), `env.DB.prepare(sql).bind(...).first/.all/.run()`, `withAuth(request, auth, env, handler)`, `json()`/`error()` from `worker/src/lib/response.js`, auth via `(request as AuthedRequest).auth` (`JwtPayload` from `worker/src/lib/jwt.js`).

---

## Task 1: `device_tokens` migration

**Files:**
- Create: `worker/migrations/0093_push_notifications.sql`
- Test: manual verification via `wrangler d1 execute` (D1 migrations aren't unit-tested in this codebase; verified by applying to `morechard-dev`)

**Interfaces:**
- Produces: `device_tokens` table — `token TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `platform TEXT CHECK (platform IN ('ios','android'))`, `environment TEXT CHECK (environment IN ('sandbox','production'))`, `created_at TEXT`, `updated_at TEXT`. Consumed by Tasks 2–7.

- [ ] **Step 1: Write the migration file**

```sql
-- worker/migrations/0093_push_notifications.sql
-- Device tokens for native push notifications (iOS APNs / Android FCM).
-- `token` is the primary key (not `user_id`) — a physical device token
-- belongs to exactly one app installation. Re-registering the same token
-- under a different user_id (shared family tablet, account switch)
-- reassigns it via upsert in the /api/push/register handler, rather than
-- creating a stale duplicate row.
-- See docs/superpowers/specs/2026-08-11-push-notifications-design.md
CREATE TABLE IF NOT EXISTS device_tokens (
  token       TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id),
  platform    TEXT    NOT NULL CHECK (platform IN ('ios', 'android')),
  environment TEXT    NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);
```

- [ ] **Step 2: Apply to `morechard-dev` and verify**

```bash
cd worker
npx wrangler d1 migrations apply morechard-dev --remote
npx wrangler d1 execute morechard-dev --remote --command="SELECT sql FROM sqlite_master WHERE name='device_tokens'"
```
Expected: the `CREATE TABLE` statement printed back, matching Step 1.

- [ ] **Step 3: Confirm foreign-key enforcement, or drop the constraint's reliance on it**

Run:
```bash
cd worker
npx wrangler d1 execute morechard-dev --remote --command="PRAGMA foreign_keys"
```
If this returns `0` (disabled), D1's `ON DELETE CASCADE` on `device_tokens.user_id` will silently not fire when a user row is deleted, leaving orphaned tokens. In that case, open `worker/src/routes/auth.ts` and find the family-deletion handler (`DELETE /auth/family`, per CLAUDE.md's Phase 6 entry on account deletion) and add an explicit `DELETE FROM device_tokens WHERE user_id = ?` for each anonymized user id in that same handler, right alongside its other per-user cleanup writes — do not rely on the DB-level cascade if the pragma is off. If the pragma returns `1`, no further action needed; note the result in the commit message.

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0093_push_notifications.sql
git commit -m "feat(push): add device_tokens migration"
```

---

## Task 2: Token storage helpers

**Files:**
- Create: `worker/src/lib/push/tokens.ts`
- Test: `worker/src/lib/push/tokens.test.ts`

**Interfaces:**
- Consumes: `Env.DB` (`D1Database`, from `worker/src/types.ts`)
- Produces (consumed by Tasks 3, 6):
  ```ts
  export interface DeviceToken { token: string; user_id: string; platform: 'ios' | 'android'; environment: 'sandbox' | 'production' }
  export async function upsertDeviceToken(db: D1Database, args: { token: string; user_id: string; platform: 'ios' | 'android'; environment: 'sandbox' | 'production' }): Promise<void>
  export async function deleteDeviceToken(db: D1Database, token: string): Promise<void>
  export async function getDeviceTokensForUser(db: D1Database, userId: string): Promise<DeviceToken[]>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/lib/push/tokens.test.ts
import { describe, it, expect, vi } from 'vitest';
import { upsertDeviceToken, deleteDeviceToken, getDeviceTokensForUser } from './tokens.js';

function makeDb() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const all = vi.fn().mockResolvedValue({ results: [{ token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' }] });
  const bind = vi.fn().mockReturnValue({ run, all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, prepare, bind, run, all };
}

describe('upsertDeviceToken', () => {
  it('runs an upsert keyed on token', async () => {
    const { db, prepare, bind, run } = makeDb();
    await upsertDeviceToken(db, { token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' });
    expect(prepare.mock.calls[0][0]).toMatch(/ON CONFLICT\(token\)/);
    expect(bind).toHaveBeenCalledWith('tok_1', 'user_1', 'ios', 'production');
    expect(run).toHaveBeenCalled();
  });
});

describe('deleteDeviceToken', () => {
  it('deletes by token', async () => {
    const { db, prepare, bind, run } = makeDb();
    await deleteDeviceToken(db, 'tok_1');
    expect(prepare.mock.calls[0][0]).toMatch(/DELETE FROM device_tokens WHERE token = \?/);
    expect(bind).toHaveBeenCalledWith('tok_1');
    expect(run).toHaveBeenCalled();
  });
});

describe('getDeviceTokensForUser', () => {
  it('returns rows for the user', async () => {
    const { db } = makeDb();
    const rows = await getDeviceTokensForUser(db, 'user_1');
    expect(rows).toEqual([{ token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/push/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/push/tokens.ts
export interface DeviceToken {
  token: string;
  user_id: string;
  platform: 'ios' | 'android';
  environment: 'sandbox' | 'production';
}

export async function upsertDeviceToken(
  db: D1Database,
  args: { token: string; user_id: string; platform: 'ios' | 'android'; environment: 'sandbox' | 'production' },
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO device_tokens (token, user_id, platform, environment, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        environment = excluded.environment,
        updated_at = unixepoch()
    `)
    .bind(args.token, args.user_id, args.platform, args.environment)
    .run();
}

export async function deleteDeviceToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
}

export async function getDeviceTokensForUser(db: D1Database, userId: string): Promise<DeviceToken[]> {
  const result = await db
    .prepare('SELECT token, user_id, platform, environment FROM device_tokens WHERE user_id = ?')
    .bind(userId)
    .all<DeviceToken>();
  return result.results ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/push/tokens.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/push/tokens.ts worker/src/lib/push/tokens.test.ts
git commit -m "feat(push): add device token storage helpers"
```

---

## Task 3: `/api/push/register` and `/api/push/unregister` routes

**Files:**
- Create: `worker/src/routes/push.ts`
- Modify: `worker/src/index.ts` (add import + two route lines)
- Test: `worker/src/routes/push.test.ts`

**Interfaces:**
- Consumes: `upsertDeviceToken`, `deleteDeviceToken` from Task 2 (`./lib/push/tokens.js`); `json`/`error` from `./lib/response.js`; `AuthedRequest`/`JwtPayload` pattern from `./lib/jwt.js`
- Produces (consumed by Task 12, client registration):
  ```ts
  export async function handleRegisterDeviceToken(request: Request, env: Env): Promise<Response>
  export async function handleUnregisterDeviceToken(request: Request, env: Env): Promise<Response>
  ```
  `POST /api/push/register` body: `{ token: string; platform: 'ios' | 'android'; environment: 'sandbox' | 'production' }` → `200 { ok: true }`
  `POST /api/push/unregister` body: `{ token: string }` → `200 { ok: true }`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/routes/push.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleRegisterDeviceToken, handleUnregisterDeviceToken } from './push.js';

function makeEnv() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { env: { DB: { prepare } } as any, prepare, bind, run };
}

function authedRequest(body: unknown) {
  const req = new Request('https://x/api/push/register', { method: 'POST', body: JSON.stringify(body) });
  (req as any).auth = { sub: 'user_1', family_id: 'fam_1', role: 'parent' };
  return req;
}

describe('handleRegisterDeviceToken', () => {
  it('rejects a missing token', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ platform: 'ios', environment: 'production' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid platform', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ token: 'tok', platform: 'windows', environment: 'production' }), env);
    expect(res.status).toBe(400);
  });

  it('upserts a valid token', async () => {
    const { env, prepare } = makeEnv();
    const res = await handleRegisterDeviceToken(authedRequest({ token: 'tok_1', platform: 'ios', environment: 'production' }), env);
    expect(res.status).toBe(200);
    expect(prepare.mock.calls[0][0]).toMatch(/ON CONFLICT\(token\)/);
  });
});

describe('handleUnregisterDeviceToken', () => {
  it('deletes the token', async () => {
    const { env, prepare } = makeEnv();
    const req = authedRequest({ token: 'tok_1' });
    const res = await handleUnregisterDeviceToken(req, env);
    expect(res.status).toBe(200);
    expect(prepare.mock.calls[0][0]).toMatch(/DELETE FROM device_tokens/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/routes/push.test.ts`
Expected: FAIL — `Cannot find module './push.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/routes/push.ts
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';
import { json, error } from '../lib/response.js';
import { upsertDeviceToken, deleteDeviceToken } from '../lib/push/tokens.js';

type AuthedRequest = Request & { auth: JwtPayload };

interface RegisterBody {
  token: string;
  platform: string;
  environment: string;
}

export async function handleRegisterDeviceToken(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const body = await request.json<Partial<RegisterBody>>().catch(() => null);

  if (!body?.token) return error('token required', 400);
  if (body.platform !== 'ios' && body.platform !== 'android') return error("platform must be 'ios' or 'android'", 400);
  if (body.environment !== 'sandbox' && body.environment !== 'production') return error("environment must be 'sandbox' or 'production'", 400);

  await upsertDeviceToken(env.DB, {
    token: body.token,
    user_id: auth.sub,
    platform: body.platform,
    environment: body.environment,
  });

  return json({ ok: true });
}

export async function handleUnregisterDeviceToken(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ token?: string }>().catch(() => null);
  if (!body?.token) return error('token required', 400);

  await deleteDeviceToken(env.DB, body.token);
  return json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/routes/push.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the routes into `worker/src/index.ts`**

Add the import near the other route imports (next to the `child-nudges.js` import, `worker/src/index.ts:202`):
```ts
import { handleRegisterDeviceToken, handleUnregisterDeviceToken } from './routes/push.js';
```
Add the routes in the "any authenticated role" section, next to the child-nudges routes (`worker/src/index.ts:800-802`):
```ts
if (path === '/api/push/register'   && method === 'POST') return withAuth(request, auth, env, handleRegisterDeviceToken);
if (path === '/api/push/unregister' && method === 'POST') return withAuth(request, auth, env, handleUnregisterDeviceToken);
```

- [ ] **Step 6: Run the full worker test suite to check for regressions**

Run: `cd worker && npx vitest run`
Expected: all tests PASS, including the new `push.test.ts`

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/push.ts worker/src/routes/push.test.ts worker/src/index.ts
git commit -m "feat(push): add device token register/unregister endpoints"
```

---

## Task 4: FCM sender (RS256 JWT → OAuth → REST send)

**Files:**
- Create: `worker/src/lib/push/fcm.ts`
- Modify: `worker/src/types.ts` (add `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` secrets)
- Test: `worker/src/lib/push/fcm.test.ts`

**Interfaces:**
- Consumes: `Env.CACHE` (existing `KVNamespace` binding), `Env.FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` (new secrets)
- Produces (consumed by Task 6):
  ```ts
  export interface FcmSendResult { ok: boolean; shouldPruneToken: boolean }
  export async function sendFcmPush(
    env: Env,
    token: string,
    payload: { title: string; body: string; route: string; pendingCount: number },
  ): Promise<FcmSendResult>
  ```

- [ ] **Step 1: Add the new secrets to `Env` in `worker/src/types.ts`**

Add after the existing `SENTRY_WEBHOOK_SECRET` field (`worker/src/types.ts:46`):
```ts
  // ── Push notifications (Section 1, docs/superpowers/specs/2026-08-11-push-notifications-design.md) ──
  FCM_PROJECT_ID: string;
  FCM_CLIENT_EMAIL: string;
  FCM_PRIVATE_KEY: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_PRIVATE_KEY: string;
  APNS_BUNDLE_ID: string;
```

- [ ] **Step 2: Write the failing tests**

```ts
// worker/src/lib/push/fcm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendFcmPush } from './fcm.js';

function makeEnv(overrides: Partial<{ kvGet: unknown; fetchImpl: typeof fetch }> = {}) {
  const kvStore = new Map<string, string>();
  if (overrides.kvGet !== undefined) kvStore.set('fcm_oauth_token', overrides.kvGet as string);
  return {
    FCM_PROJECT_ID: 'proj-1',
    FCM_CLIENT_EMAIL: 'svc@proj-1.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM,
    CACHE: {
      get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
    },
  } as any;
}

// Generated fresh at test runtime (RSA keypair via crypto.subtle, exported to
// PKCS8 PEM) rather than checked in as a literal string — this file must never
// contain a literal "-----BEGIN PRIVATE KEY-----" block for secret scanners
// (gitleaks et al.) to flag. See worker/src/lib/push/fcm.test.ts for the
// generation helper this plan expects the implementer to write.
let TEST_PRIVATE_KEY_PEM = '';

describe('sendFcmPush', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reuses a cached OAuth token instead of re-exchanging it', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await sendFcmPush(env, 'device-token', { title: 't', body: 'b', route: '/x', pendingCount: 1 });

    // Only one fetch call — the send — not a second one to oauth2.googleapis.com/token
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('fcm.googleapis.com');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer cached-token');
  });

  it('returns shouldPruneToken=true on UNREGISTERED', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), { status: 404 }),
    );

    const result = await sendFcmPush(env, 'device-token', { title: 't', body: 'b', route: '/x', pendingCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });

  it('sends the hybrid notification+data payload', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await sendFcmPush(env, 'device-token', { title: 'Chore approved!', body: '+£5.00 added', route: '/chores/123', pendingCount: 2 });

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.message.token).toBe('device-token');
    expect(body.message.notification).toEqual({ title: 'Chore approved!', body: '+£5.00 added' });
    expect(body.message.data).toEqual({ pendingCount: '2', route: '/chores/123' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/push/fcm.test.ts`
Expected: FAIL — `Cannot find module './fcm.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/push/fcm.ts
import type { Env } from '../../types.js';

const FCM_KV_KEY = 'fcm_oauth_token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface FcmSendResult {
  ok: boolean;
  shouldPruneToken: boolean;
}

interface CachedFcmToken {
  access_token: string;
  expires_at: number; // epoch ms
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function signFcmJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.FCM_CLIENT_EMAIL,
    scope: FCM_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FCM_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(signature)}`;
}

async function getFcmAccessToken(env: Env): Promise<string> {
  const cachedRaw = await env.CACHE.get(FCM_KV_KEY);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedFcmToken;
    if (cached.expires_at > Date.now() + 60_000) return cached.access_token;
  }

  const assertion = await signFcmJwt(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json<{ access_token: string; expires_in: number }>();

  const expires_at = Date.now() + data.expires_in * 1000;
  await env.CACHE.put(FCM_KV_KEY, JSON.stringify({ access_token: data.access_token, expires_at }), {
    expirationTtl: Math.max(60, data.expires_in - 60),
  });

  return data.access_token;
}

export async function sendFcmPush(
  env: Env,
  token: string,
  payload: { title: string; body: string; route: string; pendingCount: number },
): Promise<FcmSendResult> {
  const accessToken = await getFcmAccessToken(env);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { pendingCount: String(payload.pendingCount), route: payload.route },
      },
    }),
  });

  if (res.ok) return { ok: true, shouldPruneToken: false };

  const errBody = await res.json<{ error?: { status?: string } }>().catch(() => ({}));
  const shouldPrune = errBody.error?.status === 'UNREGISTERED' || errBody.error?.status === 'NOT_FOUND';
  return { ok: false, shouldPruneToken: shouldPrune };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/push/fcm.test.ts`
Expected: PASS (3 tests)

*(Note: the test file's `TEST_PRIVATE_KEY_PEM` placeholder must be replaced with an actual generated RSA test key before this task is considered done — generate one locally with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test_key.pem` and inline its PKCS8 contents; delete `test_key.pem` after copying it into the test file. This key is never used against real Google infrastructure, only against the `crypto.subtle.importKey` call in the test.)*

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/push/fcm.ts worker/src/lib/push/fcm.test.ts worker/src/types.ts
git commit -m "feat(push): add FCM sender with cached OAuth token exchange"
```

---

## Task 5: APNs sender (ES256 JWT → REST send)

**Files:**
- Create: `worker/src/lib/push/apns.ts`
- Test: `worker/src/lib/push/apns.test.ts`

**Interfaces:**
- Consumes: `Env.APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY`/`APNS_BUNDLE_ID` (from Task 4's `types.ts` edit)
- Produces (consumed by Task 6):
  ```ts
  export interface ApnsSendResult { ok: boolean; shouldPruneToken: boolean }
  export async function sendApnsPush(
    env: Env,
    token: string,
    environment: 'sandbox' | 'production',
    payload: { title: string; body: string; route: string; badgeCount: number },
  ): Promise<ApnsSendResult>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/lib/push/apns.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendApnsPush } from './apns.js';

// Generated fresh at test runtime (EC P-256 keypair via crypto.subtle,
// exported to PKCS8 PEM) rather than checked in as a literal string — this
// file must never contain a literal "-----BEGIN PRIVATE KEY-----" block for
// secret scanners (gitleaks et al.) to flag. See worker/src/lib/push/apns.test.ts
// for the generation helper this plan expects the implementer to write.
let TEST_APNS_KEY_PEM = '';

function makeEnv() {
  return {
    APNS_KEY_ID: 'KEYID123',
    APNS_TEAM_ID: 'TEAMID123',
    APNS_PRIVATE_KEY: TEST_APNS_KEY_PEM,
    APNS_BUNDLE_ID: 'com.morechard.app',
  } as any;
}

describe('sendApnsPush', () => {
  it('hits the sandbox host for environment=sandbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'sandbox', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.sandbox.push.apple.com');
  });

  it('hits the production host for environment=production', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.push.apple.com');
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('sandbox');
  });

  it('sets required APNs headers and badge payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 'Chore approved!', body: '+£5', route: '/chores/1', badgeCount: 3 });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['apns-topic']).toBe('com.morechard.app');
    expect(headers['apns-push-type']).toBe('alert');
    expect(headers['apns-priority']).toBe('10');
    expect(headers.Authorization).toMatch(/^bearer /);

    const body = JSON.parse(String(init?.body));
    expect(body.aps.badge).toBe(3);
    expect(body.aps.alert).toEqual({ title: 'Chore approved!', body: '+£5' });
    expect(body.route).toBe('/chores/1');
  });

  it('returns shouldPruneToken=true on 410', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/push/apns.test.ts`
Expected: FAIL — `Cannot find module './apns.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/push/apns.ts
import type { Env } from '../../types.js';

export interface ApnsSendResult {
  ok: boolean;
  shouldPruneToken: boolean;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/** ES256-signs a fresh APNs auth token. Computed on every call — sub-1ms
 * local CPU cost via crypto.subtle, cheaper than the KV round-trip that
 * caching it would require (unlike FCM, there's no network exchange to save). */
async function signApnsJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: env.APNS_KEY_ID };
  const claims = { iss: env.APNS_TEAM_ID, iat: now };

  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.APNS_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(signature)}`;
}

export async function sendApnsPush(
  env: Env,
  token: string,
  environment: 'sandbox' | 'production',
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<ApnsSendResult> {
  const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const jwt = await signApnsJwt(env);

  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, badge: payload.badgeCount, sound: 'default' },
      route: payload.route,
    }),
  });

  if (res.ok) return { ok: true, shouldPruneToken: false };
  return { ok: false, shouldPruneToken: res.status === 410 || res.status === 400 };
}
```

*(Note: same as Task 4 — replace `TEST_APNS_KEY_PEM` with a real generated EC test key: `openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt -out test_key.pem`.)*

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/push/apns.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/push/apns.ts worker/src/lib/push/apns.test.ts
git commit -m "feat(push): add APNs sender with per-request ES256 JWT signing"
```

---

## Task 6: Send orchestrator (fan-out + pruning)

**Files:**
- Create: `worker/src/lib/push/send.ts`
- Test: `worker/src/lib/push/send.test.ts`

**Interfaces:**
- Consumes: `getDeviceTokensForUser`, `deleteDeviceToken` (Task 2); `sendFcmPush` (Task 4); `sendApnsPush` (Task 5)
- Produces (consumed by Tasks 8–10):
  ```ts
  export async function sendPushNotification(
    env: Env,
    userId: string,
    payload: { title: string; body: string; route: string; badgeCount: number },
  ): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/lib/push/send.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendPushNotification } from './send.js';
import * as tokens from './tokens.js';
import * as fcm from './fcm.js';
import * as apns from './apns.js';

describe('sendPushNotification', () => {
  it('fans out to all of a user\'s devices concurrently', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'ios-tok', user_id: 'u1', platform: 'ios', environment: 'production' },
      { token: 'android-tok', user_id: 'u1', platform: 'android', environment: 'production' },
    ]);
    const fcmSpy = vi.spyOn(fcm, 'sendFcmPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const apnsSpy = vi.spyOn(apns, 'sendApnsPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const deleteSpy = vi.spyOn(tokens, 'deleteDeviceToken').mockResolvedValue(undefined);

    await sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(fcmSpy).toHaveBeenCalledWith(expect.anything(), 'android-tok', expect.objectContaining({ title: 't' }));
    expect(apnsSpy).toHaveBeenCalledWith(expect.anything(), 'ios-tok', 'production', expect.objectContaining({ title: 't' }));
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('prunes a token flagged shouldPruneToken, and does not let one failure block the other device', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'dead-ios', user_id: 'u1', platform: 'ios', environment: 'production' },
      { token: 'live-android', user_id: 'u1', platform: 'android', environment: 'production' },
    ]);
    vi.spyOn(apns, 'sendApnsPush').mockResolvedValue({ ok: false, shouldPruneToken: true });
    vi.spyOn(fcm, 'sendFcmPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const deleteSpy = vi.spyOn(tokens, 'deleteDeviceToken').mockResolvedValue(undefined);

    await sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(deleteSpy).toHaveBeenCalledWith(expect.anything(), 'dead-ios');
    expect(deleteSpy).not.toHaveBeenCalledWith(expect.anything(), 'live-android');
  });

  it('never throws, even if a send rejects outright', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'ios-tok', user_id: 'u1', platform: 'ios', environment: 'production' },
    ]);
    vi.spyOn(apns, 'sendApnsPush').mockRejectedValue(new Error('network error'));

    await expect(
      sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/push/send.test.ts`
Expected: FAIL — `Cannot find module './send.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/push/send.ts
import type { Env } from '../../types.js';
import { getDeviceTokensForUser, deleteDeviceToken, type DeviceToken } from './tokens.js';
import { sendFcmPush } from './fcm.js';
import { sendApnsPush } from './apns.js';

async function sendToDevice(
  env: Env,
  device: DeviceToken,
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<void> {
  const result =
    device.platform === 'android'
      ? await sendFcmPush(env, device.token, { ...payload, pendingCount: payload.badgeCount })
      : await sendApnsPush(env, device.token, device.environment, payload);

  if (result.shouldPruneToken) {
    await deleteDeviceToken(env.DB, device.token);
  }
}

/** Fire-and-forget push send to every device a user is registered on.
 * Never throws — callers wrap this in ctx.waitUntil() and it must not be
 * able to surface a rejection back into the triggering API response. */
export async function sendPushNotification(
  env: Env,
  userId: string,
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<void> {
  try {
    const devices = await getDeviceTokensForUser(env.DB, userId);
    await Promise.allSettled(devices.map(device => sendToDevice(env, device, payload)));
  } catch (err) {
    console.error('[push] sendPushNotification failed:', err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/push/send.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/push/send.ts worker/src/lib/push/send.test.ts
git commit -m "feat(push): add multi-device send orchestrator with token pruning"
```

---

## Task 7: Child pending-count helper

**Files:**
- Create: `worker/src/lib/push/pendingCount.ts`
- Test: `worker/src/lib/push/pendingCount.test.ts`

**Interfaces:**
- Consumes: `Env.DB`
- Produces (consumed by Tasks 8–10):
  ```ts
  export async function getParentPendingCount(db: D1Database, familyId: string): Promise<number>
  export async function getChildPendingCount(db: D1Database, familyId: string, childId: string): Promise<number>
  ```

`getParentPendingCount` mirrors the existing logic in `handleCompletionCount` (`worker/src/routes/completions.ts:98-113`) plus pending gift/pool contributions, so the push badge always matches what the in-app Activity tab already shows. `getChildPendingCount` is new: count of chores currently assigned to the child with no open completion row (i.e. "not started yet") plus completions in `rejected`/`needs_revision` status (i.e. "needs the child's attention"), per the locked v1 scope ("new chore assigned + reward ready").

- [ ] **Step 1: Write the failing tests**

```ts
// worker/src/lib/push/pendingCount.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getParentPendingCount, getChildPendingCount } from './pendingCount.js';

function makeDb(counts: Record<string, number>) {
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: vi.fn().mockReturnValue({
      first: vi.fn().mockImplementation(async () => {
        if (/completions/.test(sql) && /awaiting_review/.test(sql)) return { count: counts.awaitingReview ?? 0 };
        if (/give_requests|pool/.test(sql)) return { count: counts.giveRequests ?? 0 };
        if (/chores/.test(sql) && /LEFT JOIN/.test(sql)) return { count: counts.newChores ?? 0 };
        if (/completions/.test(sql) && /rejected|needs_revision/.test(sql)) return { count: counts.needsRedo ?? 0 };
        return { count: 0 };
      }),
    }),
  }));
  return { DB: { prepare } } as any;
}

describe('getParentPendingCount', () => {
  it('sums awaiting-review completions and pending gifts', async () => {
    const db = makeDb({ awaitingReview: 3, giveRequests: 2 });
    const count = await getParentPendingCount(db.DB, 'fam_1');
    expect(count).toBe(5);
  });
});

describe('getChildPendingCount', () => {
  it('sums new chores and chores needing redo', async () => {
    const db = makeDb({ newChores: 2, needsRedo: 1 });
    const count = await getChildPendingCount(db.DB, 'fam_1', 'child_1');
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/push/pendingCount.test.ts`
Expected: FAIL — `Cannot find module './pendingCount.js'`

- [ ] **Step 3: Write the implementation**

```ts
// worker/src/lib/push/pendingCount.ts

export async function getParentPendingCount(db: D1Database, familyId: string): Promise<number> {
  const awaitingReview = await db
    .prepare(`SELECT COUNT(*) AS count FROM completions WHERE family_id = ? AND status = 'awaiting_review'`)
    .bind(familyId)
    .first<{ count: number }>();

  const giveRequests = await db
    .prepare(`SELECT COUNT(*) AS count FROM give_requests WHERE family_id = ? AND status = 'pending'`)
    .bind(familyId)
    .first<{ count: number }>();

  return (awaitingReview?.count ?? 0) + (giveRequests?.count ?? 0);
}

export async function getChildPendingCount(db: D1Database, familyId: string, childId: string): Promise<number> {
  const newChores = await db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM chores c
      LEFT JOIN completions comp ON comp.chore_id = c.id AND comp.child_id = c.assigned_to
        AND comp.status IN ('awaiting_review', 'completed')
      WHERE c.family_id = ? AND c.assigned_to = ? AND c.archived = 0 AND comp.id IS NULL
    `)
    .bind(familyId, childId)
    .first<{ count: number }>();

  const needsRedo = await db
    .prepare(`SELECT COUNT(*) AS count FROM completions WHERE family_id = ? AND child_id = ? AND status IN ('rejected', 'needs_revision')`)
    .bind(familyId, childId)
    .first<{ count: number }>();

  return (newChores?.count ?? 0) + (needsRedo?.count ?? 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/push/pendingCount.test.ts`
Expected: PASS (2 tests)

*(Note: verify the exact `chores`/`completions` column names and the `give_requests` table name against the live schema before merging — this task's implementer should run `npx wrangler d1 execute morechard-dev --remote --command=".schema chores"` etc. and adjust column names if they differ from what's assumed here; the design/query shape stays the same either way.)*

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/push/pendingCount.ts worker/src/lib/push/pendingCount.test.ts
git commit -m "feat(push): add parent and child pending-count helpers for badge counts"
```

---

## Task 8: Wire notifications into chore submit/create/redo

**Files:**
- Modify: `worker/src/routes/chores.ts` (`handleChoreCreate`, and the manual-review branch of `handleChoreSubmit`)
- Modify: `worker/src/routes/completions.ts` (`handleCompletionReject`)
- Modify: `worker/src/index.ts` (pass `ctx` through to route handlers that now need `ctx.waitUntil`, if not already threaded — see Step 1)
- Test: extend existing `worker/src/routes/chores.test.ts` / `completions.test.ts` if present, else create `worker/src/routes/chores.push.test.ts`

**Interfaces:**
- Consumes: `sendPushNotification` (Task 6), `getChildPendingCount` (Task 7)

- [ ] **Step 1: Confirm whether `route()`/handlers already receive `ExecutionContext`**

Read `worker/src/index.ts` around the `fetch(request, env)` signature (`worker/src/index.ts:258`) and the `route()` function signature. If `ctx: ExecutionContext` is not currently threaded from `fetch` into `route()` and onward into individual handlers, add it as a parameter alongside `env` everywhere `withAuth` is called, mirroring the existing `(request, env)` threading exactly (do not change any other calling convention). This is a mechanical plumbing change — every `withAuth(request, auth, env, handler)` call becomes `withAuth(request, auth, env, ctx, handler)`, and `withAuth`'s handler type gains a `ctx: ExecutionContext` parameter. Run `cd worker && npx vitest run` after this step alone to confirm no existing test broke from the signature change (tests that construct fake requests without a ctx will need a fake `{ waitUntil: () => {} }` passed — grep `worker/src/routes/*.test.ts` for `handleGoalContribute(` / similar direct handler calls and add the fake ctx arg at each call site).

- [ ] **Step 2: Add the "new chore assigned" push to `handleChoreCreate`**

In `worker/src/routes/chores.ts`, after the final `SELECT`/`json(chore, 201)` return in `handleChoreCreate` (after line 122 per the surveyed version), insert, following the same non-critical fire-and-forget style already used for gamification hooks elsewhere in this codebase:
```ts
  ctx.waitUntil(
    getChildPendingCount(env.DB, family_id, assigned_to).then(pendingCount =>
      sendPushNotification(env, assigned_to, {
        title: 'New chore',
        body: title.trim(),
        route: `/chores/${id}`,
        badgeCount: pendingCount,
      }),
    ),
  );

  return json(chore, 201);
```
Add the import at the top of the file: `import { sendPushNotification } from '../lib/push/send.js';` and `import { getChildPendingCount, getParentPendingCount } from '../lib/push/pendingCount.js';`. Update the function signature to accept `ctx: ExecutionContext` per Step 1's plumbing.

- [ ] **Step 3: Add the "chore submitted, ready to approve" push to `handleChoreSubmit`**

In the manual-review branch of `handleChoreSubmit` (the branch that sets `status = 'awaiting_review'`, further down in the same file past the auto-approve block surveyed earlier), after that DB write commits, first resolve the submitting child's display name (this handler runs as the child, so `auth.sub` is the child's own id — fetch the name rather than assuming a variable already holds it):
```ts
  const childRow = await env.DB
    .prepare('SELECT display_name FROM users WHERE id = ?')
    .bind(auth.sub)
    .first<{ display_name: string }>();
  const childName = childRow?.display_name ?? 'Your child';

  ctx.waitUntil((async () => {
    const parents = await env.DB
      .prepare(`SELECT id FROM users WHERE family_id = ? AND role = 'parent'`)
      .bind(chore.family_id)
      .all<{ id: string }>();
    const pendingCount = await getParentPendingCount(env.DB, chore.family_id);
    await Promise.allSettled(
      (parents.results ?? []).map(p =>
        sendPushNotification(env, p.id, {
          title: 'Ready to approve',
          body: `${childName} finished ${chore.title}`,
          route: `/chores/approvals/${completionId}`,
          badgeCount: pendingCount,
        }),
      ),
    );
  })());
```
(Confirm the exact column name — this codebase's Phase 6 roadmap entry confirms `display_name` is the real column used for the child's nickname, per CLAUDE.md's COPPA/GDPR-K note that only `display_name` exists, no `first_name`/`real_name` — so this matches the established schema, but verify against the live `users` table before shipping.)

- [ ] **Step 4: Add the "needs redo" push to `handleCompletionReject`**

In `worker/src/routes/completions.ts`, right after the existing `generateChildNudge(...).catch(() => {})` line in `handleCompletionReject` (surveyed at line ~478), insert:
```ts
  ctx.waitUntil(
    getChildPendingCount(env.DB, comp.family_id, comp.child_id).then(pendingCount =>
      sendPushNotification(env, comp.child_id, {
        title: 'Needs a re-do',
        body: parent_notes ? `Tap to see the note: "${parent_notes}"` : 'Tap to check what to fix',
        route: `/chores/${completionId}`,
        badgeCount: pendingCount,
      }),
    ),
  );
```
Add the same two imports as Step 2 to `completions.ts`, and update `handleCompletionReject`'s signature to accept `ctx: ExecutionContext`.

- [ ] **Step 5: Write/extend tests asserting the push call happens with the right arguments**

For each of the three handlers touched, add a test (in the file's existing test suite, or a new adjacent `.push.test.ts`) that mocks `sendPushNotification` and asserts it was invoked with the expected `userId`/`route`, without asserting on exact copy strings (copy is expected to be tuned later). Example for `handleChoreCreate`:
```ts
import { describe, it, expect, vi } from 'vitest';
import * as pushSend from '../lib/push/send.js';
import { handleChoreCreate } from './chores.js';
// ... construct a fake env/ctx per the existing test patterns in chores.test.ts ...

it('notifies the assigned child on chore creation', async () => {
  const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
  const fakeCtx = { waitUntil: (p: Promise<unknown>) => p } as ExecutionContext;
  // ...call handleChoreCreate(request, env, fakeCtx) with a valid body...
  expect(sendSpy).toHaveBeenCalledWith(expect.anything(), 'assigned-child-id', expect.objectContaining({ route: expect.stringMatching(/^\/chores\// ) }));
});
```

- [ ] **Step 6: Run the full worker test suite**

Run: `cd worker && npx vitest run`
Expected: all PASS, no regressions from the `ctx` plumbing change

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/chores.ts worker/src/routes/completions.ts worker/src/index.ts worker/src/routes/*.test.ts
git commit -m "feat(push): notify child on new chore assignment and redo request"
```

---

## Task 9: Wire notification into chore approval

**Files:**
- Modify: `worker/src/routes/completions.ts` (`handleCompletionApprove`)
- Test: extend `completions.test.ts` (or the `.push.test.ts` file from Task 8)

**Interfaces:**
- Consumes: `sendPushNotification` (Task 6), `getChildPendingCount` (Task 7)

- [ ] **Step 1: Add the "chore approved & paid" push**

In `handleCompletionApprove` (`worker/src/routes/completions.ts`, surveyed sequence: role check → claim → `writeLedgerEntry` → status log insert at line ~242 → gamification hook block), insert right after the status-log insert commits, before or alongside the existing gamification hook block, following its same try/catch-wrapped, non-critical style:
```ts
  ctx.waitUntil(
    getChildPendingCount(env.DB, comp.family_id, comp.child_id).then(pendingCount =>
      sendPushNotification(env, comp.child_id, {
        title: `${chore.title} approved!`,
        body: `+${formatCurrency(rewardAmount, chore.currency)} added`,
        route: `/chores/${completionId}`,
        badgeCount: pendingCount,
      }),
    ),
  );
```
(Use whatever currency-formatting helper this file already imports for building notification copy elsewhere — check the top of `completions.ts` for an existing `formatCurrency`/`formatAmount` import before introducing a new one; if none exists, format inline as `£${(rewardAmount / 100).toFixed(2)}` matching the pence-based amounts used throughout the ledger, per developer-bible currency conventions.)

- [ ] **Step 2: Add a test**

```ts
it('notifies the child their chore was approved and paid', async () => {
  const sendSpy = vi.spyOn(pushSend, 'sendPushNotification').mockResolvedValue(undefined);
  const fakeCtx = { waitUntil: (p: Promise<unknown>) => p } as ExecutionContext;
  // ...call handleCompletionApprove(request, env, fakeCtx, completionId) on a valid awaiting_review completion...
  expect(sendSpy).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ route: expect.stringMatching(/^\/chores\// ) }));
});
```

- [ ] **Step 3: Run tests**

Run: `cd worker && npx vitest run src/routes/completions.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/completions.ts worker/src/routes/completions.test.ts
git commit -m "feat(push): notify child when their chore is approved and paid"
```

---

## Task 10: Wire notifications into goal funding and gift/give-request received

**Files:**
- Modify: `worker/src/routes/goals.ts` (`handleGoalContribute`)
- Modify: whichever route handles gift/pool contributions being sent to a parent for review (locate via `Grep` for `give_requests` insert, likely in `worker/src/routes/jars.ts` or a dedicated gifts route — confirm exact file before editing)
- Test: extend `goals.test.ts` and the gifts route's test file

**Interfaces:**
- Consumes: `sendPushNotification` (Task 6), `getParentPendingCount`/`getChildPendingCount` (Task 7)

- [ ] **Step 1: Add the "goal boosted" push to `handleGoalContribute`**

In `worker/src/routes/goals.ts`, right after the jar-allocation `try/catch` block completes (surveyed at line ~352, before the final `SELECT`/`json(updated)` return), insert:
```ts
  ctx.waitUntil(
    getChildPendingCount(env.DB, goal.family_id, goal.child_id).then(pendingCount =>
      sendPushNotification(env, goal.child_id, {
        title: `${updated.title} got a boost!`,
        body: `Now ${Math.round((updated.current_saved_pence / updated.target_pence) * 100)}% there`,
        route: `/goals/${id}`,
        badgeCount: pendingCount,
      }),
    ),
  );
```
Add imports and `ctx` parameter as in prior tasks. Note `updated` must be fetched before this block (it already is, one line below in the current code — move the `SELECT` up above this insertion point rather than duplicating the query).

- [ ] **Step 2: Locate and instrument the gift/give-request creation handler**

Run `Grep` for `INSERT INTO give_requests` across `worker/src/routes/` to find the exact handler (this file wasn't captured in the initial survey — confirm before editing). Once found, insert a push to all parents in the family after the insert commits, mirroring Task 8 Step 3's "notify all parents" pattern:
```ts
  ctx.waitUntil((async () => {
    const parents = await env.DB
      .prepare(`SELECT id FROM users WHERE family_id = ? AND role = 'parent'`)
      .bind(familyId)
      .all<{ id: string }>();
    const pendingCount = await getParentPendingCount(env.DB, familyId);
    await Promise.allSettled(
      (parents.results ?? []).map(p =>
        sendPushNotification(env, p.id, {
          title: 'Contribution received',
          body: `${coParentName} sent ${formattedAmount} for ${childName}`,
          route: `/activity/${transactionId}`,
          badgeCount: pendingCount,
        }),
      ),
    );
  })());
```

- [ ] **Step 3: Write tests for both**

Same pattern as Tasks 8–9: spy on `sendPushNotification`, assert it's called with the right `userId`/`route` after a successful contribution/gift creation.

- [ ] **Step 4: Run the full worker test suite**

Run: `cd worker && npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/goals.ts worker/src/routes/<gifts-route>.ts worker/src/routes/*.test.ts
git commit -m "feat(push): notify child on goal boost and parent on gift received"
```

---

## Task 11: Co-parent "already approved" race guard

**Files:**
- Modify: whichever screen renders `/chores/approvals/:completion_id` (locate via `Grep` for `approvals` in `app/src/App.tsx`'s route table and the component it renders — likely `PendingTab.tsx` or a dedicated approval detail view; confirm before editing)
- Test: add/extend that component's existing test file if one exists, else a new `*.test.tsx` following this codebase's existing component test conventions (check `app/src/components/dashboard/__tests__/` for the pattern, e.g. `LabSection.test.tsx`)

**Interfaces:**
- Consumes: existing `getCompletions`/completion-detail fetch from `app/src/lib/api.ts`

- [ ] **Step 1: Confirm the exact target component**

Run `Grep` for `approvals/` in `app/src/App.tsx` and trace the route to its rendered component. This wasn't resolved in the initial survey (`PendingTab.tsx`/`ParentDashboard.tsx` were named as likely candidates but not confirmed) — read that component fully before proceeding.

- [ ] **Step 2: Add the resolved-state guard**

When the component fetches the completion by id on mount, check `status !== 'awaiting_review'`. If already resolved (`'completed'` or `'rejected'`), render a small info banner instead of the approve/reject action buttons:
```tsx
{completion.status !== 'awaiting_review' && (
  <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
    {completion.status === 'completed'
      ? `Already approved by ${completion.resolved_by_name ?? 'the other parent'}`
      : `Already reviewed by ${completion.resolved_by_name ?? 'the other parent'}`}
  </div>
)}
```
(Confirm whether the completion API response already includes a resolved-by display name — `resolved_by` in the schema surveyed in Task 9's context is a user id, not a name; if the API doesn't join it, add that join to the relevant `GET` handler, following the same `JOIN users` pattern likely already used elsewhere for displaying child names on completions.)

- [ ] **Step 3: Write a test**

```tsx
it('shows an already-approved banner instead of action buttons when the completion is resolved', () => {
  // render with a completion fixture where status: 'completed', resolved_by_name: 'Dad'
  // assert the approve/reject buttons are absent and "Already approved by Dad" is shown
});
```

- [ ] **Step 4: Run the app test suite**

Run: `cd app && npm test -- <target-test-file>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/<target-file>.tsx app/src/<target-test-file>.test.tsx
git commit -m "fix(push): show already-resolved state instead of erroring on co-parent race"
```

---

## Task 12: Install client push packages + native project config

**Files:**
- Modify: root `package.json` (add `@capacitor/push-notifications`, `@capawesome/capacitor-badge`)
- Modify: `capacitor.config.json` (no plugin config block needed for these two — both work with defaults; confirmed by checking their docs against the existing `StatusBar` block pattern already in the file)
- No test — this is dependency installation + manual native-portal setup (Apple Developer, Firebase Console), which can't be unit tested

- [ ] **Step 1: Install the packages**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npm install @capacitor/push-notifications @capawesome/capacitor-badge
```

- [ ] **Step 2: Sync native projects**

```bash
npx cap sync
```
Expected: `android/` and `ios/` projects pick up the new plugins (confirm via `npx cap sync` output listing both plugins under "Found X Capacitor plugins for android/ios").

- [ ] **Step 3: Document the manual native-portal setup as a checklist (not automatable)**

Add a section to `CLAUDE.md`'s "Outstanding" area (following the existing "Outstanding — Android App Links on-device verification" pattern) listing:
1. Apple Developer: enable Push Notifications capability for the app id, generate an APNs `.p8` auth key, note its Key ID and Team ID
2. Firebase Console: create/reuse a project, add the Android app (`com.morechard.app`), download `google-services.json` into `android/app/`
3. Set Worker secrets: `npx wrangler secret put FCM_PROJECT_ID` (and `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`) for both dev and `--env production`
4. In Xcode: enable the Push Notifications capability under Signing & Capabilities

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json CLAUDE.md
git commit -m "feat(push): install push-notifications and badge Capacitor plugins"
```

---

## Task 13: Client push library (`app/src/lib/push.ts`)

**Files:**
- Create: `app/src/lib/push.ts`
- Test: `app/src/lib/push.test.ts`

**Interfaces:**
- Consumes: `Capacitor` (`@capacitor/core`), `PushNotifications` (`@capacitor/push-notifications`), `Badge` (`@capawesome/capacitor-badge`), `authHeaders`/`apiUrl` (existing pattern from `app/src/lib/api.ts`, per Task 12's survey of `ParentDashboard.tsx` imports)
- Produces (consumed by Task 14 and Task 15):
  ```ts
  export async function requestPushPermission(): Promise<boolean>
  export async function registerDeviceToken(token: string, platform: 'ios' | 'android'): Promise<void>
  export async function safeSetBadge(count: number): Promise<void>
  export function hasPromptedForPushPermission(): boolean
  export function markPromptedForPushPermission(): void
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/lib/push.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capawesome/capacitor-badge', () => ({
  Badge: { isSupported: vi.fn(), set: vi.fn() },
}));

import { Badge } from '@capawesome/capacitor-badge';
import { safeSetBadge, hasPromptedForPushPermission, markPromptedForPushPermission } from './push.js';

describe('safeSetBadge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets the badge when supported', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: true });
    await safeSetBadge(3);
    expect(Badge.set).toHaveBeenCalledWith({ count: 3 });
  });

  it('skips setting when unsupported', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: false });
    await safeSetBadge(3);
    expect(Badge.set).not.toHaveBeenCalled();
  });

  it('swallows a thrown error from the badge plugin', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: true });
    (Badge.set as any).mockRejectedValue(new Error('launcher rejected badge API'));
    await expect(safeSetBadge(3)).resolves.toBeUndefined();
  });
});

describe('push permission prompt tracking', () => {
  beforeEach(() => { localStorage.clear(); });

  it('is false until marked', () => {
    expect(hasPromptedForPushPermission()).toBe(false);
    markPromptedForPushPermission();
    expect(hasPromptedForPushPermission()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/lib/push.test.ts`
Expected: FAIL — `Cannot find module './push.js'`

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/push.ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { apiUrl, authHeaders } from './api.js';

const PROMPT_FLAG_KEY = 'mc_push_permission_prompted';

export function hasPromptedForPushPermission(): boolean {
  return localStorage.getItem(PROMPT_FLAG_KEY) === '1';
}

export function markPromptedForPushPermission(): void {
  localStorage.setItem(PROMPT_FLAG_KEY, '1');
}

export async function safeSetBadge(count: number): Promise<void> {
  try {
    const { isSupported } = await Badge.isSupported();
    if (isSupported) await Badge.set({ count });
  } catch (err) {
    console.warn('[push] badge not supported on this device:', err);
  }
}

export async function registerDeviceToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  const environment = import.meta.env.PROD ? 'production' : 'sandbox';
  await fetch(apiUrl('/api/push/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ token, platform, environment }),
  });
}

export async function requestPushPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const permStatus = await PushNotifications.checkPermissions();
  let granted = permStatus.receive === 'granted';

  if (!granted && permStatus.receive !== 'denied') {
    const requested = await PushNotifications.requestPermissions();
    granted = requested.receive === 'granted';
  }

  markPromptedForPushPermission();
  if (!granted) return false;

  await PushNotifications.register();
  return true;
}
```

*(Note: `import.meta.env.PROD` for the `environment` field is a reasonable default for the web build config, but per the locked design this must actually reflect the native build's provisioning profile, not a JS env var — Task 12's manual checklist should be extended to confirm how the Capacitor build pipeline distinguishes a TestFlight/App Store archive from a local debug install, and this line revisited to read that signal instead if `import.meta.env.PROD` doesn't track it correctly for Capacitor-wrapped builds. Flag this explicitly during Task 13's code review rather than assuming it's correct.)*

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/lib/push.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/push.ts app/src/lib/push.test.ts
git commit -m "feat(push): add client push permission, registration, and badge helpers"
```

---

## Task 14: `PushNotificationListener` component

**Files:**
- Create: `app/src/components/PushNotificationListener.tsx`
- Modify: `app/src/App.tsx` (mount alongside `AppUrlListener`)
- Test: `app/src/components/PushNotificationListener.test.tsx`

**Interfaces:**
- Consumes: `registerDeviceToken`, `safeSetBadge` (Task 13); `PushNotifications` (`@capacitor/push-notifications`); `useNavigate` (`react-router-dom`)

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/components/PushNotificationListener.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
const addListenerMock = vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: addListenerMock,
    getDeliveredNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
  },
}));
vi.mock('../lib/push.js', () => ({
  registerDeviceToken: vi.fn().mockResolvedValue(undefined),
  safeSetBadge: vi.fn().mockResolvedValue(undefined),
}));

import { PushNotificationListener } from './PushNotificationListener.js';

describe('PushNotificationListener', () => {
  beforeEach(() => { addListenerMock.mockClear(); });

  it('registers all four expected native listeners on mount', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    const registeredEvents = addListenerMock.mock.calls.map(call => call[0]);
    expect(registeredEvents).toEqual(
      expect.arrayContaining(['registration', 'pushNotificationReceived', 'pushNotificationActionPerformed']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/PushNotificationListener.test.tsx`
Expected: FAIL — `Cannot find module './PushNotificationListener.js'`

- [ ] **Step 3: Write the implementation**

```tsx
// app/src/components/PushNotificationListener.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { registerDeviceToken, safeSetBadge } from '../lib/push.js';

function platformOf(): 'ios' | 'android' {
  return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
}

export function PushNotificationListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handles: Array<{ remove: () => Promise<void> }> = [];

    PushNotifications.addListener('registration', (token: Token) => {
      registerDeviceToken(token.value, platformOf()).catch(() => {});
    }).then(h => handles.push(h));

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      // Foreground: suppress the native banner (already the default for a
      // received-while-open event on both platforms), just refresh the badge.
      const pendingCount = Number(notification.data?.pendingCount ?? 0);
      if (!Number.isNaN(pendingCount)) safeSetBadge(pendingCount).catch(() => {});
    }).then(h => handles.push(h));

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const route = action.notification.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) navigate(route);
    }).then(h => handles.push(h));

    // Cold-start capture: if the app was launched by tapping a push (not
    // just backgrounded), the tap event can fire before this listener
    // attached. Check for a delivered/launch notification explicitly.
    PushNotifications.getDeliveredNotifications().then(({ notifications }) => {
      const launchRoute = notifications[0]?.data?.route;
      if (typeof launchRoute === 'string' && launchRoute.startsWith('/')) navigate(launchRoute);
    }).catch(() => {});

    return () => { handles.forEach(h => h.remove().catch(() => {})); };
  }, [navigate]);

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/PushNotificationListener.test.tsx`
Expected: PASS

- [ ] **Step 5: Mount the component in `App.tsx`**

In `app/src/App.tsx`, add the import next to `AppUrlListener`'s and mount it alongside the other always-on listener components inside `<BrowserRouter>` (per the surveyed pattern at `App.tsx:242-245`):
```tsx
import { PushNotificationListener } from './components/PushNotificationListener.js';
...
<BrowserRouter>
  <AppUrlListener />
  <PushNotificationListener />
  <AndroidBackController />
  <AppAutoLock />
```

- [ ] **Step 6: Run the app test suite**

Run: `cd app && npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add app/src/components/PushNotificationListener.tsx app/src/components/PushNotificationListener.test.tsx app/src/App.tsx
git commit -m "feat(push): add native push listener component with cold-start deep-link capture"
```

---

## Task 15: Contextual permission prompts + badge self-heal on resume

**Files:**
- Modify: `app/src/components/dashboard/JobsTab.tsx` (parent: prompt after first successful chore creation)
- Modify: `app/src/screens/ChildDashboard.tsx` (child: prompt on first dashboard load with ≥1 assigned chore)
- Test: extend each screen's existing test file if present, else skip automated coverage for the prompt-timing logic itself (it's a thin conditional around an already-tested `requestPushPermission()`) but add one test per screen asserting the prompt is NOT re-shown once `markPromptedForPushPermission()` has fired

**Interfaces:**
- Consumes: `requestPushPermission`, `hasPromptedForPushPermission`, `markPromptedForPushPermission`, `safeSetBadge` (Task 13)

- [ ] **Step 1: Add the parent contextual prompt to `JobsTab.tsx`**

Modify the `onCreated` callback passed to the first `<CreateChoreSheet>` (surveyed at `app/src/components/dashboard/JobsTab.tsx:409`):
```tsx
onCreated={() => {
  setShowSheet(false)
  load()
  if (!hasPromptedForPushPermission()) requestPushPermission().catch(() => {})
}}
```
Add the import: `import { requestPushPermission, hasPromptedForPushPermission } from '../../lib/push.js'`.

- [ ] **Step 2: Add the child contextual prompt to `ChildDashboard.tsx`**

Locate the effect/point where the child's assigned-chore list is first loaded in `app/src/screens/ChildDashboard.tsx` (read the file to find the existing data-load `useEffect`). Add:
```tsx
useEffect(() => {
  if (chores.length > 0 && !hasPromptedForPushPermission()) {
    requestPushPermission().catch(() => {})
  }
}, [chores.length])
```
Placed after the effect that populates `chores` state, using whatever that state variable is actually named in the file (confirm exact name before writing — do not assume `chores` without checking).

- [ ] **Step 3: Add badge self-heal on app resume**

In the same top-level listener component from Task 14 (`PushNotificationListener.tsx`), add an `App.addListener('resume', ...)` (or `App.addListener('appStateChange', ...)`, whichever this codebase's existing `AndroidBackController.tsx`/`useAndroidBack.ts` already use for foreground detection — check those files for the established pattern before choosing) that re-fetches the current pending count from the API and calls `safeSetBadge`:
```tsx
import { App as CapacitorApp } from '@capacitor/app';
...
// inside the same useEffect as the push listeners, after registering them:
CapacitorApp.addListener('resume', () => {
  fetchCurrentPendingCount().then(safeSetBadge).catch(() => {});
}).then(h => handles.push(h));
```
where `fetchCurrentPendingCount` is a small new export in `app/src/lib/push.ts` that calls whatever existing endpoint returns the current user's pending count — for a parent this is `GET /api/completions/count` (surveyed, Task 7 reference); for a child, add the equivalent using the same shape as `getChildPendingCount`'s server-side logic, exposed via a new lightweight endpoint or reused from an existing one if the child dashboard already fetches an equivalent count (check `ChildDashboard.tsx`'s existing data fetches before adding a new endpoint — reuse first, add third only if nothing already returns this number).

- [ ] **Step 4: Write the "don't re-prompt" tests**

```tsx
// in JobsTab.test.tsx (or equivalent)
it('does not request push permission again once already prompted', () => {
  localStorage.setItem('mc_push_permission_prompted', '1');
  // render, trigger onCreated, assert requestPushPermission was not called
});
```

- [ ] **Step 5: Run the full app test suite**

Run: `cd app && npx vitest run`
Expected: all PASS

- [ ] **Step 6: Manual verification note**

Add this task's real end-to-end behavior to the manual checklist already captured in the design doc's Section 5 (`docs/superpowers/specs/2026-08-11-push-notifications-design.md`) — this cannot be verified in the current sandboxed build environment, only on real hardware per that section.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/dashboard/JobsTab.tsx app/src/screens/ChildDashboard.tsx app/src/lib/push.ts app/src/components/PushNotificationListener.tsx app/src/components/dashboard/JobsTab.test.tsx
git commit -m "feat(push): add contextual permission prompts and resume-time badge self-heal"
```

---

## Post-implementation checklist (not a task — tracked for the real-device follow-up pass per the design doc)

- [ ] Manual device verification checklist (design doc Section 5, items 1–5) run on real iOS + Android hardware
- [ ] App Store Connect Privacy Nutrition Label updated (push token = Identifier, App Functionality)
- [ ] `PrivacyInfo.xcprivacy` manifest entry added if targeting iOS 17+
- [ ] Roadmap (`CLAUDE.md` Phase 8) updated to mark push notifications shipped, with the same "code-reviewed + unit-tested, real-device pass outstanding" caveat already used for WebAuthn/JWT-cookie/high-contrast entries
