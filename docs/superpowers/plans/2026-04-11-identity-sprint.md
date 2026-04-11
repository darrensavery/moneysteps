# Identity Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth login + Short-Lived Token handoff so users who clear their cache can log back in without losing their account.

**Architecture:** Three new backend routes (`GET /auth/google`, `GET /auth/google/callback`, `POST /auth/slt/exchange`) live in `worker/src/routes/auth.ts`. The OAuth callback performs email-based merge, mints a 60-second SLT, and redirects the browser to `/auth/callback?slt=<token>`. The frontend `AuthCallbackScreen` immediately scrubs the SLT from the URL, POSTs it to exchange for a real JWT, writes `DeviceIdentity` + token to localStorage, then navigates to `/parent` via `window.location.replace`.

**Tech Stack:** Cloudflare Workers + D1 (SQL), Google OAuth 2.0 PKCE-less auth code flow (server-side), `crypto.subtle` for JWK verification, `nanoid` for token generation, React 18 + TypeScript + Tailwind CSS, `react-router-dom` v6.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `worker/migrations/0022_google_oauth.sql` | Add google columns + slt_tokens + slt_attempts tables |
| Modify | `worker/src/types.ts` | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` to `Env` |
| Modify | `worker/src/routes/auth.ts` | Add `handleGoogleAuth`, `handleGoogleCallback`, `handleSltExchange` |
| Modify | `worker/src/index.ts` | Import and register 3 new public routes; add cron cleanup |
| Modify | `app/src/lib/api.ts` | Add `exchangeSlt()` function + `SltExchangeResult` interface |
| Modify | `app/src/lib/deviceIdentity.ts` | Add `google_picture?: string` to `DeviceIdentity` |
| Create | `app/src/screens/LoginScreen.tsx` | Google button + magic-link fallback + error banners |
| Create | `app/src/screens/AuthCallbackScreen.tsx` | SLT consume + bridge UI + `window.location.replace('/parent')` |
| Modify | `app/src/screens/LandingGate.tsx` | Add "Already have an account? Sign In" tertiary link |
| Modify | `app/src/App.tsx` | Register `/auth/login` and `/auth/callback` routes |
| Modify | `app/src/components/dashboard/ParentDashboard.tsx` | Render Google avatar when `identity.google_picture` is set |

---

## Task 1: D1 Migration 0022

**Files:**
- Create: `worker/migrations/0022_google_oauth.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0022_google_oauth.sql
-- Google identity columns on users
ALTER TABLE users ADD COLUMN google_sub     TEXT UNIQUE;
ALTER TABLE users ADD COLUMN google_picture TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- Short-lived handoff tokens (60-second single-use bridge tokens)
CREATE TABLE IF NOT EXISTS slt_tokens (
  token      TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

-- IP-based abuse tracking for SLT exchange endpoint
CREATE TABLE IF NOT EXISTS slt_attempts (
  ip            TEXT    PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);
```

- [ ] **Step 2: Apply migration to local D1**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
npx wrangler d1 execute morechard-db --local --file=worker/migrations/0022_google_oauth.sql
```

Expected: `Executed 5 commands.` (3 ALTERs + 2 CREATEs)

- [ ] **Step 3: Apply migration to remote D1**

```bash
npx wrangler d1 execute morechard-db --remote --file=worker/migrations/0022_google_oauth.sql
```

Expected: same output, no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0022_google_oauth.sql
git commit -m "feat(db): migration 0022 — google_sub, slt_tokens, slt_attempts"
```

---

## Task 2: Extend Env Type

**Files:**
- Modify: `worker/src/types.ts`

- [ ] **Step 1: Add Google secrets to Env interface**

In `worker/src/types.ts`, after the `FIREBASE_PROJECT_ID` line, add:

```ts
  GOOGLE_CLIENT_ID:     string;
  GOOGLE_CLIENT_SECRET: string;
```

So the interface becomes:
```ts
export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  APP_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FIREBASE_PROJECT_ID: string;
  GOOGLE_CLIENT_ID:     string;
  GOOGLE_CLIENT_SECRET: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/types.ts
git commit -m "feat(worker): add GOOGLE_CLIENT_ID/SECRET to Env type"
```

---

## Task 3: Backend — Google OAuth Handlers

**Files:**
- Modify: `worker/src/routes/auth.ts` (append three new exported functions at the end, before the private helpers)

The three handlers go at the bottom of the exports section, before `issueParentJwt` and `parseBody`.

- [ ] **Step 1: Add the three Google/SLT handlers to auth.ts**

Append the following to `worker/src/routes/auth.ts`, immediately before the `issueParentJwt` function (around line 833):

```ts
// ----------------------------------------------------------------
// GET /auth/google
// Initiates Google OAuth 2.0 flow. Generates CSRF state cookie,
// builds the Google auth URL, and redirects the browser.
// ----------------------------------------------------------------
export async function handleGoogleAuth(_request: Request, env: Env): Promise<Response> {
  const state    = nanoid(16);
  const redirect = `${env.APP_URL.replace('app.', 'morechard-api.darren-savery.workers.dev').split('://')[0]}://morechard-api.darren-savery.workers.dev/auth/google/callback`;

  // Build redirect_uri from the worker's known URL (hard-coded for safety)
  const redirectUri = 'https://morechard-api.darren-savery.workers.dev/auth/google/callback';

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'offline',
    prompt:        'select_account',
  });

  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return new Response(null, {
    status: 302,
    headers: {
      'Location': googleUrl,
      'Set-Cookie': `mc_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`,
    },
  });
}

// ----------------------------------------------------------------
// GET /auth/google/callback
// Receives the OAuth code from Google. Verifies CSRF state,
// exchanges code for tokens, verifies ID token, merges user,
// issues SLT, and redirects to the frontend /auth/callback.
// ----------------------------------------------------------------
export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url          = new URL(request.url);
  const code         = url.searchParams.get('code');
  const stateParam   = url.searchParams.get('state');
  const appUrl       = 'https://app.morechard.com';
  const redirectUri  = 'https://morechard-api.darren-savery.workers.dev/auth/google/callback';

  // Clear state cookie helper
  const clearStateCookie = 'mc_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/';

  // ── Step 1: CSRF validation ──────────────────────────────────
  const cookieHeader = request.headers.get('Cookie') ?? '';
  const stateCookie  = cookieHeader.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('mc_oauth_state='))
    ?.split('=')[1];

  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=csrf`, 'Set-Cookie': clearStateCookie },
    });
  }

  // ── Step 2: Token exchange ────────────────────────────────────
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=google_exchange`, 'Set-Cookie': clearStateCookie },
    });
  }

  const tokenData = await tokenRes.json<{ id_token: string }>();
  const idToken   = tokenData.id_token;

  // ── Step 3: Verify ID token ───────────────────────────────────
  let googlePayload: { sub: string; email: string; email_verified: boolean; name: string; picture: string };
  try {
    googlePayload = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  } catch {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=google_exchange`, 'Set-Cookie': clearStateCookie },
    });
  }

  if (!googlePayload.email_verified) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}/auth/login?error=unverified`, 'Set-Cookie': clearStateCookie },
    });
  }

  const { sub, email, picture } = googlePayload;

  // ── Step 4: Merge / bridge logic ─────────────────────────────
  const normEmail = email.toLowerCase().trim();
  const user = await env.DB
    .prepare('SELECT id, family_id, display_name FROM users WHERE email = ? LIMIT 1')
    .bind(normEmail)
    .first<{ id: string; family_id: string; display_name: string }>();

  if (!user) {
    const hint = encodeURIComponent(normEmail);
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${appUrl}/auth/login?error=no_account&hint=${hint}`,
        'Set-Cookie': clearStateCookie,
      },
    });
  }

  // Merge Google identity into existing user record
  await env.DB
    .prepare('UPDATE users SET google_sub = ?, google_picture = ?, email_verified = 1 WHERE id = ?')
    .bind(sub, picture, user.id)
    .run();

  // ── Step 5: Issue SLT ─────────────────────────────────────────
  const slt       = nanoid(32);
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const ip        = clientIp(request);
  const ua        = request.headers.get('User-Agent') ?? '';

  await env.DB
    .prepare('INSERT INTO slt_tokens (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(slt, user.id, expiresAt, ip, ua)
    .run();

  // ── Step 6: Redirect to frontend ─────────────────────────────
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${appUrl}/auth/callback?slt=${slt}`,
      'Set-Cookie': clearStateCookie,
    },
  });
}

// ----------------------------------------------------------------
// POST /auth/slt/exchange
// Consumes a Short-Lived Token (SLT), returns a long-lived JWT.
// Body: { slt: string }
// ----------------------------------------------------------------
export async function handleSltExchange(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return error('Invalid JSON body');

  const { slt } = body;
  if (!slt || typeof slt !== 'string') return error('slt required');

  const ip = clientIp(request);

  // ── Step 1: IP abuse check ────────────────────────────────────
  const attempt = await env.DB
    .prepare('SELECT attempts, blocked_until FROM slt_attempts WHERE ip = ?')
    .bind(ip)
    .first<{ attempts: number; blocked_until: number | null }>();

  if (attempt?.blocked_until && attempt.blocked_until > Math.floor(Date.now() / 1000)) {
    return error('Too many attempts. Try again later.', 429);
  }

  // ── Step 2: SLT lookup ────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const tokenRow = await env.DB
    .prepare('SELECT user_id FROM slt_tokens WHERE token = ? AND expires_at > ?')
    .bind(slt, now)
    .first<{ user_id: string }>();

  if (!tokenRow) {
    // Increment abuse counter
    await env.DB
      .prepare(`
        INSERT INTO slt_attempts (ip, attempts, blocked_until)
        VALUES (?, 1, NULL)
        ON CONFLICT(ip) DO UPDATE SET
          attempts = attempts + 1,
          blocked_until = CASE WHEN attempts + 1 >= 5
                          THEN unixepoch() + 3600
                          ELSE blocked_until END
      `)
      .bind(ip)
      .run();
    return error('Invalid or expired token', 401);
  }

  // ── Step 3: Consume token ─────────────────────────────────────
  await env.DB
    .prepare('DELETE FROM slt_tokens WHERE token = ?')
    .bind(slt)
    .run();

  // ── Step 4: Load user ─────────────────────────────────────────
  const user = await env.DB
    .prepare(`
      SELECT u.id, u.display_name, u.email, u.google_picture,
             u.parent_pin_hash, u.password_hash,
             fr.family_id, fr.role,
             fr.granted_by
      FROM users u
      JOIN family_roles fr ON fr.user_id = u.id AND fr.role = 'parent'
      WHERE u.id = ?
      LIMIT 1
    `)
    .bind(tokenRow.user_id)
    .first<{
      id:               string;
      display_name:     string;
      email:            string;
      google_picture:   string | null;
      parent_pin_hash:  string | null;
      password_hash:    string | null;
      family_id:        string;
      role:             string;
      granted_by:       string | null;
    }>();

  if (!user) return error('User not found', 404);

  // ── Step 5: Issue JWT via existing helper ─────────────────────
  const jwtResponse = await issueParentJwt(user.id, user.family_id, request, env);
  const jwtData     = await jwtResponse.json<{ token: string }>();

  // ── Step 6: Reset abuse counter on success ───────────────────
  await env.DB
    .prepare('DELETE FROM slt_attempts WHERE ip = ?')
    .bind(ip)
    .run();

  // ── Step 7: Respond ───────────────────────────────────────────
  const parentingRole = user.granted_by ? 'CO_PARENT' : 'LEAD_PARENT';

  return json({
    token: jwtData.token,
    user: {
      id:             user.id,
      family_id:      user.family_id,
      display_name:   user.display_name,
      role:           'parent',
      parenting_role: parentingRole,
      has_pin:        user.parent_pin_hash !== null,
      has_password:   user.password_hash !== null,
      google_picture: user.google_picture ?? null,
    },
  });
}

// ----------------------------------------------------------------
// Private: Verify Google ID token using JWK
// ----------------------------------------------------------------
async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<{ sub: string; email: string; email_verified: boolean; name: string; picture: string }> {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Invalid token format');

  const header  = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

  // Validate standard claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now)                        throw new Error('Token expired');
  if (payload.aud !== expectedClientId)         throw new Error('Wrong audience');
  if (payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com')    throw new Error('Wrong issuer');

  // Fetch Google's public keys
  const certsRes = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const certs    = await certsRes.json<{ keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string; use: string }> }>();
  const jwk      = certs.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('JWK not found');

  // Import the public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify the signature
  const sigBytes     = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const dataBytes    = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid        = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sigBytes, dataBytes);
  if (!valid) throw new Error('Invalid signature');

  return payload as { sub: string; email: string; email_verified: boolean; name: string; picture: string };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: no errors. If `issueParentJwt` cannot be called without returning a Response and extracting the JWT, note that `issueParentJwt` already returns a `Response` with `{ token }` — we call `.json()` on it, which is correct.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/auth.ts
git commit -m "feat(auth): handleGoogleAuth, handleGoogleCallback, handleSltExchange"
```

---

## Task 4: Register Routes in index.ts + Cron Cleanup

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add imports at top of index.ts**

Find the existing import block for auth handlers (around line 91):
```ts
import {
  handleCreateFamily,
  handleRegister,
  ...
  handleRevokeOtherSessions,
} from './routes/auth.js';
```

Add `handleGoogleAuth, handleGoogleCallback, handleSltExchange,` to the import list:
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
  handleGoogleAuth,
  handleGoogleCallback,
  handleSltExchange,
} from './routes/auth.js';
```

- [ ] **Step 2: Register the 3 new public routes in the `route()` function**

In the `route()` function, after the existing public routes (around line 284, after `/auth/invite/redeem`), add:

```ts
  if (path === '/auth/google'          && method === 'GET')  return handleGoogleAuth(request, env);
  if (path === '/auth/google/callback' && method === 'GET')  return handleGoogleCallback(request, env);
  if (path === '/auth/slt/exchange'    && method === 'POST') return handleSltExchange(request, env);
```

- [ ] **Step 3: Add SLT cleanup to the scheduled cron**

In the `scheduled()` handler (around line 154), after the existing cleanup lines, add:

```ts
    // ── 3. Clean up expired SLT tokens and unblocked IP attempts ──
    await env.DB.prepare('DELETE FROM slt_tokens WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM slt_attempts WHERE blocked_until IS NOT NULL AND blocked_until < ?').bind(now).run();
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(router): register GET /auth/google, GET /auth/google/callback, POST /auth/slt/exchange"
```

---

## Task 5: Frontend API + DeviceIdentity

**Files:**
- Modify: `app/src/lib/api.ts`
- Modify: `app/src/lib/deviceIdentity.ts`

- [ ] **Step 1: Add `SltExchangeResult` interface and `exchangeSlt()` to api.ts**

Find the end of `app/src/lib/api.ts` and append:

```ts
// ── SLT Exchange ──────────────────────────────────────────────────

export interface SltExchangeResult {
  token: string
  user: {
    id:              string
    family_id:       string
    display_name:    string
    role:            'parent'
    parenting_role:  'LEAD_PARENT' | 'CO_PARENT'
    has_pin:         boolean
    has_password:    boolean
    google_picture:  string | null
  }
}

export async function exchangeSlt(slt: string): Promise<SltExchangeResult> {
  return request('/auth/slt/exchange', {
    method: 'POST',
    body: JSON.stringify({ slt }),
  })
}
```

- [ ] **Step 2: Add `google_picture` to DeviceIdentity interface**

In `app/src/lib/deviceIdentity.ts`, find the `DeviceIdentity` interface and add the new field after `auth_method`:

```ts
export interface DeviceIdentity {
  user_id:        string
  family_id:      string
  display_name:   string
  role:           DeviceRole
  parenting_role?: ParentingRole
  initials:       string
  registered_at:  string
  auth_method:    'biometrics' | 'pin' | 'none'
  pin?:           string
  /** Google profile picture URL; undefined for non-Google logins */
  google_picture?: string
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: no errors (new optional field is backwards-compatible).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/api.ts app/src/lib/deviceIdentity.ts
git commit -m "feat(frontend): exchangeSlt API + google_picture on DeviceIdentity"
```

---

## Task 6: LoginScreen

**Files:**
- Create: `app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Create LoginScreen.tsx**

```tsx
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { requestMagicLink } from '../lib/api'

export default function LoginScreen() {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()

  const errorCode = searchParams.get('error')   // 'no_account' | 'unverified' | 'csrf' | 'google_exchange' | null
  const hint      = searchParams.get('hint')     // encoded email, only when error=no_account

  const [email,      setEmail]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [magicSent,  setMagicSent]  = useState(false)
  const [magicError, setMagicError] = useState('')

  const workerUrl = import.meta.env.VITE_WORKER_URL as string

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    setSending(true)
    setMagicError('')
    try {
      await requestMagicLink(email.trim())
      setMagicSent(true)
    } catch (err) {
      setMagicError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[var(--color-bg)]">
      {/* Logo */}
      <div className="mb-8 text-center">
        <h1 className="text-[28px] font-extrabold text-[var(--color-text)] tracking-tight">
          🌳 Morechard
        </h1>
        <p className="text-[14px] text-[var(--color-text-muted)] mt-1">Welcome back</p>
      </div>

      {/* Error banners */}
      {errorCode === 'no_account' && (
        <div className="w-full max-w-sm mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-800">
          We couldn't find an account for <strong>{hint ? decodeURIComponent(hint) : 'this email'}</strong>.{' '}
          <button
            onClick={() => navigate('/register')}
            className="underline underline-offset-2 font-semibold cursor-pointer"
          >
            Create a new Orchard?
          </button>
        </div>
      )}
      {errorCode === 'unverified' && (
        <div className="w-full max-w-sm mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
          Google couldn't verify this email address. Try a different account.
        </div>
      )}
      {(errorCode === 'csrf' || errorCode === 'google_exchange') && (
        <div className="w-full max-w-sm mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
          Something went wrong. Please try again.
        </div>
      )}

      {/* Card */}
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] px-6 py-7 flex flex-col gap-5">

        {/* Google button — full-page navigation to worker (not React Router) */}
        <a
          href={`${workerUrl}/auth/google`}
          className="flex items-center justify-center gap-3 h-12 rounded-xl border border-[var(--color-border)] bg-white text-[15px] font-semibold text-[#3c4043] hover:bg-gray-50 active:scale-[0.98] transition-all cursor-pointer no-underline"
        >
          {/* Google "G" SVG */}
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 6.6 6.3 14.7z"/>
            <path fill="#FBBC05" d="M24 46c5.5 0 10.6-1.9 14.6-5l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.7-3.1-11.8-7.5l-7 5.4C9.7 43.4 16.3 46 24 46z"/>
            <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.5 5.3-6.8 6.7l6.7 5.5C39.7 37 44 31 44 24c0-1.3-.2-2.7-.5-4z"/>
          </svg>
          Continue with Google
        </a>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-border)]" />
          <span className="text-[12px] text-[var(--color-text-muted)]">or</span>
          <div className="flex-1 h-px bg-[var(--color-border)]" />
        </div>

        {/* Magic link */}
        {magicSent ? (
          <p className="text-center text-[14px] text-[var(--color-text-muted)]">
            Check your email — we've sent a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            {magicError && (
              <p className="text-[12px] text-red-500">{magicError}</p>
            )}
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="h-11 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
            >
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-[12px] text-[var(--color-text-muted)]">
          New here?{' '}
          <button
            onClick={() => navigate('/register')}
            className="text-[var(--brand-primary)] font-semibold underline underline-offset-2 cursor-pointer"
          >
            Create a Family Account
          </button>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check that `requestMagicLink` exists in api.ts**

```bash
grep -n "requestMagicLink" "e:/Web-Video Design/Claude/Apps/Pocket Money/app/src/lib/api.ts"
```

If it doesn't exist, add it to `api.ts`:
```ts
export async function requestMagicLink(email: string): Promise<void> {
  return request('/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/screens/LoginScreen.tsx app/src/lib/api.ts
git commit -m "feat(ui): LoginScreen — Google + magic-link login doorbell"
```

---

## Task 7: AuthCallbackScreen

**Files:**
- Create: `app/src/screens/AuthCallbackScreen.tsx`

- [ ] **Step 1: Create AuthCallbackScreen.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { exchangeSlt } from '../lib/api'
import { setToken } from '../lib/token'
import { setDeviceIdentity, toInitials } from '../lib/deviceIdentity'

type ScreenState = 'loading' | 'error'

export default function AuthCallbackScreen() {
  const [searchParams]    = useSearchParams()
  const navigate          = useNavigate()
  const [state, setState] = useState<ScreenState>('loading')

  // Determine locale early (before async work)
  const locale = localStorage.getItem('mc_locale')
    ?? (navigator.language.startsWith('pl') ? 'pl' : 'en')

  const bridgeText = locale === 'pl' ? 'Logowanie do Sadu…' : 'Consulting the Orchard Lead…'

  useEffect(() => {
    const slt = searchParams.get('slt')

    // Scrub SLT from URL immediately — before any async call
    window.history.replaceState({}, '', '/auth/callback')

    if (!slt) {
      setState('error')
      return
    }

    let cancelled = false

    exchangeSlt(slt)
      .then(result => {
        if (cancelled) return

        setToken(result.token)
        setDeviceIdentity({
          user_id:        result.user.id,
          family_id:      result.user.family_id,
          display_name:   result.user.display_name,
          role:           'parent',
          parenting_role: result.user.parenting_role,
          initials:       toInitials(result.user.display_name),
          registered_at:  new Date().toISOString(),
          auth_method:    'none',
          google_picture: result.user.google_picture ?? undefined,
        })

        // Full browser navigation — tears down React tree, forces RootGate
        // to re-read mc_device_identity from localStorage on remount.
        window.location.replace('/parent')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)] px-6">
        <p className="text-[16px] text-[var(--color-text-muted)] text-center">
          Sign-in failed. Please try again.
        </p>
        <button
          onClick={() => navigate('/auth/login')}
          className="h-11 px-6 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold cursor-pointer active:scale-[0.98] transition-all"
        >
          Try signing in again
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--color-bg)]">
      <h1 className="text-[24px] font-extrabold text-[var(--color-text)] tracking-tight">
        🌳 Morechard
      </h1>
      <Loader2 className="w-7 h-7 text-[var(--brand-primary)] animate-spin" />
      <p className="text-[14px] text-[var(--color-text-muted)]">{bridgeText}</p>
    </div>
  )
}
```

- [ ] **Step 2: Verify `setToken` import path**

```bash
grep -rn "export function setToken\|export.*setToken" "e:/Web-Video Design/Claude/Apps/Pocket Money/app/src/lib/"
```

If `setToken` lives in a different file (e.g. `lib/token.ts` or `lib/auth.ts`), adjust the import path accordingly. If it doesn't exist, check how the app stores `mc_token` — it may be `localStorage.setItem('mc_token', token)` directly. In that case replace `setToken(result.token)` with:
```ts
localStorage.setItem('mc_token', result.token)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/screens/AuthCallbackScreen.tsx
git commit -m "feat(ui): AuthCallbackScreen — SLT exchange + bridge UI"
```

---

## Task 8: Wire Routes + LandingGate + Google Avatar

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/screens/LandingGate.tsx`
- Modify: `app/src/components/dashboard/ParentDashboard.tsx`

- [ ] **Step 1: Register routes in App.tsx**

Read `app/src/App.tsx` to find where routes are declared. Add the two new public routes (no auth wrapper):

```tsx
import LoginScreen       from './screens/LoginScreen'
import AuthCallbackScreen from './screens/AuthCallbackScreen'

// Inside the <Routes> block:
<Route path="/auth/login"    element={<LoginScreen />} />
<Route path="/auth/callback" element={<AuthCallbackScreen />} />
```

Both routes must be outside any `RequireSession` or auth-guard wrapper.

- [ ] **Step 2: Add "Sign In" link to LandingGate.tsx**

Read `app/src/screens/LandingGate.tsx` to find the existing CTA buttons. Below the last button, add:

```tsx
<p className="text-center text-[13px] text-[var(--color-text-muted)]">
  Already have an account?{' '}
  <button
    onClick={() => navigate('/auth/login')}
    className="text-[var(--brand-primary)] font-semibold underline underline-offset-2 cursor-pointer"
  >
    Sign In
  </button>
</p>
```

Ensure `navigate` is imported from `react-router-dom` and called via `useNavigate()`.

- [ ] **Step 3: Add Google avatar to ParentDashboard.tsx**

Read `app/src/components/dashboard/ParentDashboard.tsx` to find where the avatar is rendered (look for `AvatarSVG` or `avatarId`). Replace the avatar render with:

```tsx
{identity?.google_picture ? (
  <img
    src={identity.google_picture}
    alt={identity.display_name}
    className="w-9 h-9 rounded-full object-cover border-2 border-[var(--brand-primary)]"
    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
  />
) : (
  <AvatarSVG id={avatarId} size={36} />
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.tsx app/src/screens/LandingGate.tsx app/src/components/dashboard/ParentDashboard.tsx
git commit -m "feat(ui): wire /auth/login + /auth/callback routes; LandingGate Sign In link; Google avatar"
```

---

## Task 9: Deploy + Set Worker Secrets

**Files:**
- No code changes — deployment + secret provisioning

- [ ] **Step 1: Set Google secrets via wrangler**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx wrangler secret put GOOGLE_CLIENT_ID
# Paste the Client ID from Google Cloud Console when prompted

npx wrangler secret put GOOGLE_CLIENT_SECRET
# Paste the Client Secret from Google Cloud Console when prompted
```

> **Google Cloud Console steps (one-time):**
> 1. Go to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
> 2. Application type: Web application
> 3. Authorized redirect URIs: `https://morechard-api.darren-savery.workers.dev/auth/google/callback`
> 4. Copy the Client ID and Client Secret

- [ ] **Step 2: Deploy worker**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/worker"
npx wrangler deploy
```

Expected: `Deployed morechard-api` with new routes listed.

- [ ] **Step 3: Deploy frontend**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git push origin main
```

GitHub Actions will auto-deploy to Cloudflare Pages.

- [ ] **Step 4: Smoke test**

1. Open `https://app.morechard.com/auth/login` — verify Google button + magic-link form appear
2. Click "Continue with Google" — verify redirect to `accounts.google.com`
3. Complete Google login — verify redirect to `https://app.morechard.com/auth/callback?slt=...`
4. Verify URL is scrubbed to `/auth/callback` within milliseconds
5. Verify redirect to `/parent` and correct avatar in header
6. Open `https://app.morechard.com` → LandingGate → verify "Already have an account? Sign In" link

---

## Spec Coverage Check

| Spec requirement | Task |
|-----------------|------|
| Migration: `google_sub`, `google_picture`, `email_verified` | Task 1 |
| Migration: `slt_tokens` table | Task 1 |
| Migration: `slt_attempts` table | Task 1 |
| Cron: delete expired SLT rows and unblocked attempts | Task 4 |
| `Env` extended with Google secrets | Task 2 |
| `GET /auth/google` — CSRF cookie + redirect | Task 3 |
| `GET /auth/google/callback` — code exchange, merge, SLT, redirect | Task 3 |
| `POST /auth/slt/exchange` — IP abuse, consume, JWT | Task 3 |
| `exchangeSlt()` API function + `SltExchangeResult` | Task 5 |
| `google_picture` on `DeviceIdentity` | Task 5 |
| `LoginScreen` — Google button + magic-link + error banners | Task 6 |
| `AuthCallbackScreen` — scrub URL, bridge UI, `window.location.replace` | Task 7 |
| LandingGate "Sign In" link | Task 8 |
| App.tsx route registration | Task 8 |
| ParentDashboard Google avatar with `onError` fallback | Task 8 |
| Worker secrets deployment | Task 9 |
