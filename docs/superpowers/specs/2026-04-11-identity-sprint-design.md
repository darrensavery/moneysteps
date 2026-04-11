# Identity Sprint — Design Spec

**Date:** 2026-04-11  
**Status:** Approved  
**Scope:** Google OAuth, returning-user bridge, `/auth/login` screen, SLT handoff, avatar display

---

## Overview

When a parent clears their browser cache (or reinstalls the PWA), `mc_device_identity` and `mc_token` are wiped from localStorage. Currently there is no recovery path — the user is forced through the full registration flow, which creates a duplicate family or an onboarding loop.

This sprint adds:

1. **Google OAuth** as the primary "high-integrity" sign-in method
2. **Returning-user bridge** — email match in `users` table auto-merges the Google identity with the existing account, issues a JWT, and drops the user straight into `/parent`
3. **`/auth/login` screen** — the "doorbell" for returning users, with Google button + magic-link fallback
4. **Short-Lived Token (SLT) handoff** — secure bridge between the server-side OAuth callback and localStorage

Polish honorifics (D) are deferred.

---

## Database Migration — 0022

File: `worker/migrations/0022_google_oauth.sql`

```sql
-- Google identity columns on users
ALTER TABLE users ADD COLUMN google_sub     TEXT UNIQUE;   -- Google's stable subject ID
ALTER TABLE users ADD COLUMN google_picture TEXT;          -- Profile picture URL
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;  -- 1 = verified

-- Short-lived handoff tokens (60-second single-use bridge tokens)
CREATE TABLE IF NOT EXISTS slt_tokens (
  token      TEXT    PRIMARY KEY,       -- nanoid(32)
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,          -- unixepoch() + 60
  ip_address TEXT,                      -- requester IP (audit log)
  user_agent TEXT                       -- requester UA (audit log)
  -- NOTE: rows are DELETED immediately on successful exchange
  -- Cron cleans up expired-but-never-exchanged rows
);

-- IP-based abuse tracking for SLT exchange endpoint
CREATE TABLE IF NOT EXISTS slt_attempts (
  ip           TEXT    PRIMARY KEY,
  attempts     INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER          -- unixepoch(); NULL = not blocked
);
```

**Backfill:** None needed. All new columns are nullable or default-zero.

**Cron addition:** The existing Saturday 8am cron adds:
```sql
DELETE FROM slt_tokens WHERE expires_at < unixepoch();
DELETE FROM slt_attempts WHERE blocked_until < unixepoch();
```

---

## Worker Secrets

Two secrets must be set via `wrangler secret put` before deployment:

```
GOOGLE_CLIENT_ID      — from Google Cloud Console OAuth 2.0 client
GOOGLE_CLIENT_SECRET  — from Google Cloud Console OAuth 2.0 client
```

The `Env` type in `worker/src/index.ts` must be extended:
```ts
GOOGLE_CLIENT_ID:     string
GOOGLE_CLIENT_SECRET: string
```

Authorized redirect URI to register in Google Cloud Console:
```
https://morechard-api.darren-savery.workers.dev/auth/google/callback
```

---

## Backend Routes

All handlers live in `worker/src/routes/auth.ts`. All three new routes are registered in `worker/src/index.ts` without auth middleware (they are pre-auth entry points).

---

### `GET /auth/google`

**Purpose:** Initiate the OAuth flow.

1. Generate `state = nanoid(16)`
2. Set cookie: `mc_oauth_state=<state>; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`
3. Build Google auth URL:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=<GOOGLE_CLIENT_ID>
     &redirect_uri=https://morechard-api.darren-savery.workers.dev/auth/google/callback
     &response_type=code
     &scope=openid email profile
     &state=<state>
     &access_type=offline
     &prompt=select_account
   ```
4. Return `302` redirect to that URL.

---

### `GET /auth/google/callback`

**Purpose:** Receive Google's authorisation code, verify identity, merge/create user, issue SLT, redirect to app.

**Step 1 — CSRF validation**
- Read `state` from query params and `mc_oauth_state` cookie
- If mismatch or either is missing → `302` to `/auth/login?error=csrf`
- Clear `mc_oauth_state` cookie (set `Max-Age=0`)

**Step 2 — Token exchange**
POST to `https://oauth2.googleapis.com/token`:
```json
{
  "code": "<query.code>",
  "client_id": "<GOOGLE_CLIENT_ID>",
  "client_secret": "<GOOGLE_CLIENT_SECRET>",
  "redirect_uri": "https://morechard-api.darren-savery.workers.dev/auth/google/callback",
  "grant_type": "authorization_code"
}
```
On failure → `302` to `/auth/login?error=google_exchange`

**Step 3 — ID token verification**
- Fetch Google's JWK set from `https://www.googleapis.com/oauth2/v3/certs`
- Verify the `id_token` signature using `crypto.subtle.verify` with the matching JWK
- Decode payload: `{ sub, email, email_verified, name, picture }`
- If `email_verified` is false → `302` to `/auth/login?error=unverified`

**Step 4 — Merge / bridge logic**
```
SELECT * FROM users WHERE email = <google_email> LIMIT 1

  FOUND:
    UPDATE users
    SET google_sub = <sub>,
        google_picture = <picture>,
        email_verified = 1
    WHERE id = <user.id>
    → use existing user_id, family_id, display_name

  NOT FOUND:
    → 302 to /auth/login?error=no_account&hint=<encoded_email>
    (The /auth/login screen shows: "We couldn't find an account for
     this email. Create a new Orchard?")
    (Full Google-first registration deferred to a future sprint)
```

**Step 5 — Issue SLT**
```sql
INSERT INTO slt_tokens (token, user_id, expires_at, ip_address, user_agent)
VALUES (nanoid(32), <user_id>, unixepoch() + 60, <ip>, <ua>)
```

**Step 6 — Redirect to app**
```
302 → https://app.morechard.com/auth/callback?slt=<token>
```

---

### `POST /auth/slt/exchange`

**Purpose:** Consume SLT, return long-lived JWT.

**Body:** `{ slt: string }`

**Step 1 — IP abuse check**
```sql
SELECT * FROM slt_attempts WHERE ip = <requester_ip>
```
- If `blocked_until > unixepoch()` → `429 { error: "Too many attempts. Try again later." }`

**Step 2 — SLT lookup**
```sql
SELECT * FROM slt_tokens WHERE token = ? AND expires_at > unixepoch()
```
- Not found or expired:
  ```sql
  INSERT INTO slt_attempts (ip, attempts, blocked_until)
  VALUES (<ip>, 1, NULL)
  ON CONFLICT(ip) DO UPDATE SET
    attempts = attempts + 1,
    blocked_until = CASE WHEN attempts + 1 >= 5
                    THEN unixepoch() + 3600
                    ELSE blocked_until END
  ```
  → `401 { error: "Invalid or expired token" }`

**Step 3 — Consume token**
```sql
DELETE FROM slt_tokens WHERE token = ?
```

**Step 4 — Load user**
```sql
SELECT u.id, u.display_name, u.email, u.google_picture,
       u.parent_pin_hash, u.password_hash,
       fr.family_id, fr.role
FROM users u
JOIN family_roles fr ON fr.user_id = u.id AND fr.role = 'parent'
WHERE u.id = <user_id>
LIMIT 1
```

**Step 5 — Issue JWT**
Use existing `issueParentJwt(user, env, request)` helper — writes to `sessions` table with `user_agent` from the exchange request.

**Step 6 — Reset abuse counter on success**
```sql
DELETE FROM slt_attempts WHERE ip = <requester_ip>
```

**Step 7 — Response**
```json
{
  "token": "<jwt>",
  "user": {
    "id": "...",
    "family_id": "...",
    "display_name": "...",
    "role": "parent",
    "parenting_role": "LEAD_PARENT",
    "has_pin": false,
    "has_password": false,
    "google_picture": "https://lh3.googleusercontent.com/..."
  }
}
```

`has_pin` = `parent_pin_hash IS NOT NULL`  
`has_password` = `password_hash IS NOT NULL`  
`parenting_role` = derived from `family_roles` — `'LEAD_PARENT'` if `granted_by IS NULL`, else `'CO_PARENT'`

---

## Frontend

### New files

| File | Purpose |
|------|---------|
| `app/src/screens/LoginScreen.tsx` | Returning-user doorbell |
| `app/src/screens/AuthCallbackScreen.tsx` | SLT consume + clear |

### Modified files

| File | Change |
|------|--------|
| `app/src/App.tsx` | Register `/auth/login` and `/auth/callback` routes |
| `app/src/screens/LandingGate.tsx` | Add "Already have an account? Sign In" link |
| `app/src/lib/api.ts` | Add `exchangeSlt(slt)` function |
| `app/src/lib/deviceIdentity.ts` | Add `google_picture?: string` to `DeviceIdentity` |
| `app/src/components/dashboard/ParentDashboard.tsx` | Render Google avatar when present |

---

### New API function — `app/src/lib/api.ts`

```ts
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

---

### `DeviceIdentity` update — `app/src/lib/deviceIdentity.ts`

Add one optional field:

```ts
export interface DeviceIdentity {
  // ... existing fields ...
  google_picture?: string   // Google profile picture URL; undefined for non-Google logins
}
```

---

### `LoginScreen.tsx`

**Route:** `/auth/login`  
**Access:** Always public (no auth guard)

**States:**
- Default: Google button + magic-link section
- `?error=no_account&hint=<email>`: banner "We couldn't find an account for `<email>`. Create a new Orchard?" with link to `/register`
- `?error=unverified`: banner "Google couldn't verify this email address. Try a different account."
- `?error=csrf` / `?error=google_exchange`: banner "Something went wrong. Please try again."

**Layout:**
- Logo header (same as `LandingGate`)
- Primary CTA: "Continue with Google" — `<a href={import.meta.env.VITE_WORKER_URL + '/auth/google'}>` (plain anchor, not React Router — must trigger a full-page navigation to the worker; `VITE_WORKER_URL` already used in `api.ts`)
- Divider: "or"
- Email field + "Send sign-in link" button (calls existing `POST /auth/magic-link`)
- Footer link: "New here? Create a Family Account" → `/register`

**Locale:** Copy is English only for this sprint. Polish honorifics deferred.

---

### `AuthCallbackScreen.tsx`

**Route:** `/auth/callback`  
**Access:** Always public

**On mount (strict sequence):**
1. Read `slt` from `useSearchParams()`
2. **Immediately** call `window.history.replaceState({}, '', '/auth/callback')` — scrubs SLT from URL and browser history
3. If no `slt` param → show error state
4. Determine locale:
   ```ts
   const locale = localStorage.getItem('mc_locale')
     ?? (navigator.language.startsWith('pl') ? 'pl' : 'en')
   ```
5. Show themed bridge UI (see below)
6. Call `exchangeSlt(slt)`
7. **On success:**
   - `setToken(result.token)`
   - `setDeviceIdentity({ user_id: result.user.id, family_id: result.user.family_id, display_name: result.user.display_name, role: 'parent', parenting_role: result.user.parenting_role, initials: toInitials(result.user.display_name), registered_at: new Date().toISOString(), auth_method: 'none', google_picture: result.user.google_picture ?? undefined })`
   - `window.location.replace('/parent')` — full browser navigation, not React Router. Tears down the entire React tree so `RootGate` reads `mc_device_identity` fresh from localStorage on remount. Prevents any onboarding state from persisting in memory.
8. **On failure:** Show error state with "Try signing in again" button → `/auth/login`

**Bridge UI:**
- Background: `var(--color-bg)` — matches app theme, no white flash
- Centred content: Morechard logo + fade-in text
  - `en`: "Consulting the Orchard Lead…"
  - `pl`: "Logowanie do Sadu…"
- Subtle spinner (Lucide `Loader2` with `animate-spin`)
- No visible URL or token in the DOM

---

### `LandingGate.tsx` update

Below the existing two CTA buttons, add a tertiary text link:

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

---

### `App.tsx` route additions

```tsx
<Route path="/auth/login"    element={<LoginScreen />} />
<Route path="/auth/callback" element={<AuthCallbackScreen />} />
```

Both are public (no `RequireSession` wrapper).

---

### Google avatar in `ParentDashboard`

The header's avatar display already reads from `settings.avatar_id` (the orchard avatar picker). When `identity.google_picture` is set, it takes precedence:

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

The `onError` handler falls back silently to the initials avatar if Google's CDN is unreachable.

---

## Security Summary

| Gate | Where | Behaviour |
|------|-------|-----------|
| CSRF state validation | `GET /auth/google/callback` | `state` query param must match `mc_oauth_state` cookie |
| `email_verified` guard | `GET /auth/google/callback` | Rejects Google accounts with unverified email |
| SLT expiry | `POST /auth/slt/exchange` | Token valid for 60 seconds only |
| SLT single-use | `POST /auth/slt/exchange` | Row deleted immediately on success |
| IP abuse tracking | `POST /auth/slt/exchange` | 5 failures → 1-hour IP block; counter reset on success |
| URL scrubbing | `AuthCallbackScreen` | `history.replaceState` before any async call |
| `onError` avatar fallback | `ParentDashboard` | Google CDN failure silently falls back to orchard avatar |

---

## Out of Scope

- Google-first registration (new user via Google — deferred; currently redirects to `/register`)
- Polish honorifics on login/callback screens
- Family name fuzzy-match for "orphaned" email accounts
- Revocation of Google OAuth tokens on logout (Morechard logout only clears `mc_token` locally)
- Apple Sign-In
