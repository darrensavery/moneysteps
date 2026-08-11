# Push Notifications + App Icon Badge — Design

Status: Approved (design), pending implementation plan
Date: 2026-08-11

## Goal

Native push notifications (iOS + Android, via Capacitor) for both parents and children, plus a home-screen app icon badge showing "something needs action" — reusing the count logic that already drives the in-app pending badge on the parent Activity tab (`ParentDashboard.tsx`).

Out of scope for v1: web push for browser-installed PWA users (native app only for now); an in-app notification history/inbox (pushes are ephemeral — the badge + existing Activity/Pending tabs remain the durable record of what needs action).

## Section 1: Architecture

```
Native app (iOS/Android)
  → @capacitor/push-notifications requests permission, obtains
    an FCM token (Android) or APNs token (iOS)
  → POST /api/push/register {token, platform, environment, user_id}
    → D1 upsert keyed on token itself (token is UNIQUE/PK):
        INSERT INTO device_tokens (token, user_id, platform, environment, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(token) DO UPDATE SET
          user_id = excluded.user_id, updated_at = CURRENT_TIMESTAMP
      A physical token belongs to one installation; this self-corrects
      a shared tablet even if a prior user never explicitly logged out
      (no cross-account leakage).
  → on explicit logout: also DELETE the row for that token

Worker, on trigger events (chore submitted, chore approved, chore
needs redo, new chore assigned, goal funded, gift received):
  → handler writes its normal response immediately; push send is
    wrapped in ctx.waitUntil() so APNs/FCM latency never blocks the UI
  → looks up recipient's token(s) in D1, computes their current
    "needs action" count (reuse existing pendingCount logic, extended
    for the child side)
  → multi-device fan-out uses Promise.allSettled() so one failed/
    invalid token doesn't drop the rest of the batch
  → Android (FCM): RS256 service-account JWT → exchange at
    oauth2.googleapis.com/token (scope: https://www.googleapis.com/
    auth/firebase.messaging) for an access token → cached in KV
    (~55 min TTL) → POST a hybrid payload to
    fcm.googleapis.com/v1/projects/{project}/messages:send:
        { notification: {title, body}, data: {pendingCount, route} }
    "notification" guarantees native OS tray delivery even if the app
    is killed or Doze-throttled; data-only messages are NOT used as
    the primary channel because Android aggressively suppresses them
    in Doze/killed states. "data" carries the badge count and
    deep-link route.
  → iOS (APNs): ES256 JWT computed fresh per request via
    crypto.subtle (sub-1ms local CPU — not KV-cached, unlike FCM,
    since there's no network round-trip to save) → POST directly to
    api.push.apple.com (or api.sandbox.push.apple.com — see
    environment routing below) as Bearer auth, with required headers
    apns-topic (bundle id), apns-push-type: alert, apns-priority,
    and payload includes "badge": N
  → a 410 (APNs) or UNREGISTERED (FCM) response deletes that token
    row from D1 immediately

Badge display:
  → iOS: automatic from the APNs payload's "badge" field
  → Android: set explicitly via @capawesome/capacitor-badge from the
    "data.pendingCount" field when the push is received (foreground)
    or tapped (background/killed) — launcher badge support is
    OEM-fragmented (Samsung native, Pixel dots-only, others may throw),
    so this call is always wrapped in Badge.isSupported() + try/catch
  → Either platform: on app foreground/resume, client also re-fetches
    its own pending count from the API and sets the badge locally via
    the same guarded call — self-heals if a push was missed, delayed,
    or notification permission was denied
```

### APNs sandbox vs. production routing

Debug/local Xcode builds sign with a Development provisioning profile → Sandbox APNs tokens → must be sent to `api.sandbox.push.apple.com`. **TestFlight builds and App Store builds both sign with a Distribution profile → Production APNs tokens → must be sent to `api.push.apple.com`.** TestFlight is production APNs, not sandbox — this is a common trap. The `environment` value stored per-token in D1 must reflect the provisioning profile the build was actually signed with, not a runtime `NODE_ENV`-style check (a TestFlight build should register as `production`, only local Xcode debug installs register as `sandbox`).

### D1 foreign key enforcement

SQLite (and D1) requires `PRAGMA foreign_keys = ON` to be active on a connection for `ON DELETE CASCADE` to actually fire. Confirm whether Cloudflare D1's Worker binding enables this by default; if not, either set it explicitly per-connection or handle the `device_tokens` cleanup manually inside the existing account-deletion path (`DELETE /auth/family`) rather than relying on the constraint.

## Section 2: Data model

```sql
-- migration 0093_push_notifications.sql
CREATE TABLE device_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
```

No separate `notifications` table for v1. Pending state is derived live from existing tables (chore completions awaiting approval, unaccepted gifts, unread new-chore assignments), same as `pendingCount` does today. Nothing to keep in sync, nothing that can drift. Trade-off accepted explicitly: pushes are ephemeral — if swiped away, there's no in-app history to recover them. Revisit as its own project if this becomes a real complaint.

## Section 3: Trigger events

| Event | Recipient | Copy | `data.route` |
|---|---|---|---|
| Chore marked done, awaiting approval | Parent(s) | "{child} finished {chore} — ready to approve" | `/chores/approvals/{chore_id}` |
| Chore approved & paid | Child | "{chore} approved! +{amount} added" | `/chores/{chore_id}` |
| Chore needs redo | Child | "{chore} needs a re-do — tap to check notes" | `/chores/{chore_id}` |
| New chore assigned | Child | "New chore: {chore}" | `/chores/{chore_id}` |
| Goal funded/boosted | Child | "{goal} got a boost! {progress}% there" | `/goals/{goal_id}` |
| Gift/pool contribution | Parent(s) | "{coparent} sent {amount} for {child}" | `/activity/{transaction_id}` |

Child copy uses the existing Seedling/Professional persona split (`child-nudges.ts`), per the project's child-facing language rule: under-12 vocabulary, no "grove" metaphor on-screen. Parent copy is plain and direct, no persona switching.

**Co-parent race condition:** both parents get the "ready to approve" push. Whoever taps second lands on `/chores/approvals/{chore_id}`, which must fetch live state and show "Already approved by {parent}" instead of erroring if the item is already resolved. This needs an explicit guard added to that screen (`PendingTab.tsx`/`ParentDashboard.tsx`) — not assumed to already exist.

## Section 4: Client integration (iOS/Android)

**New dependencies:** `@capacitor/push-notifications`, `@capawesome/capacitor-badge`.

**Native project setup (config/secrets, not app code):**
- iOS: enable Push Notifications capability in Xcode, generate an APNs `.p8` auth key in Apple Developer → Worker secrets `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`
- Android: Firebase project + `google-services.json` in `android/app/` (needed by the client SDK to obtain tokens; the Worker never calls Firebase's servers directly — it talks to FCM's REST API) → Worker secrets `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`

**Permission timing:** not on first launch. Ask contextually, at the first moment a push would be useful — parent right after creating their first chore, child right after their first chore is assigned. Mirrors how `Stage3SecureApp.tsx` gates the biometric prompt behind a contextual moment rather than asking blind during onboarding.

**Registration flow:**
```
on permission granted → PushNotifications.register()
  → 'registration' listener fires with the token
  → POST /api/push/register {token, platform, environment}
on permission denied → no-op; client-side badge self-heal still works
  when the app is foregrounded, so the feature degrades gracefully
```

**Handling incoming pushes:**
- Foreground (warm, app open): suppress native banner, show an in-app toast instead, update badge locally from `data.pendingCount`
- Tapped, warm start (app backgrounded, not killed): `pushNotificationActionPerformed` fires with React already mounted → navigate via the SPA router (`navigate(route)`) — instant, no state teardown
- Tapped, cold start (app was fully killed): the OS may emit the tap event during boot before listeners attach. On app init, explicitly check for a launch-triggering notification before the router mounts, so the deep link isn't dropped; route via the SPA router once app state has hydrated. `window.location.href` stays reserved for the one case CLAUDE.md already calls out (post-registration stack reset) — not used for push taps in general.

**Badge setting, guarded:**
```ts
async function safeSetBadge(count: number) {
  try {
    const { isSupported } = await Badge.isSupported()
    if (isSupported) await Badge.set({ count })
  } catch (err) {
    console.warn('Badge not supported on this device:', err)
  }
}
```
Used identically for the push-triggered set (Android `data.pendingCount`) and the foreground/resume self-heal.

**Token lifecycle:** re-register on app resume if the stored token differs from the last known one; the upsert (Section 2) handles the rest without extra client logic.

## Section 5: Testing & rollout

**Verifiable headlessly in this build environment:**
- JWT signing correctness (ES256 for APNs, RS256 for FCM) — unit tests against known test vectors
- `/api/push/register` upsert/delete logic (D1)
- Trigger → payload builder output (mocked fetch to FCM/APNs, asserting headers/body shape incl. `apns-topic`, `apns-push-type`, sandbox-vs-production routing)
- 410/`UNREGISTERED` response → token pruned

**Cannot be verified in this environment — needs a real device pass:** push delivery fundamentally cannot be simulated; it needs a real APNs cert hitting a real device and a real FCM token on an Android emulator/device with Google Play Services. This project has hit the same wall before (WebAuthn, JWT cookie migration both shipped "verified by code review + unit tests only" because `wrangler dev --remote` 503s in this sandbox and there's no physical hardware here) — flag as an outstanding item rather than claim it's verified.

Manual checklist for that follow-up pass:
1. Fresh install → contextual permission prompt at the right moment → grant → token registered in D1
2. Push received foreground (in-app toast) / backgrounded (native banner, tap → warm-start SPA nav) / killed (tap → cold-start capture → correct route)
3. Badge appears/increments on iOS home screen and on at least one Android launcher (Pixel + Samsung, given OEM fragmentation) — and clears after the underlying item resolves
4. Logout on a shared device → token deleted → other account doesn't receive stray pushes
5. Two-parent race: both notified, one approves, the other's tap shows "already approved," not an error

**Rollout sequencing:**
1. Ship Worker infra + `device_tokens` table + registration endpoint first, permission-prompt UI behind a flag — silent, verifiable against `morechard-dev`
2. Internal dogfood via TestFlight (remember: production APNs, not sandbox) + an internal Play testing track — update the App Store Connect Privacy Nutrition Label (push token = "Identifier" used for App Functionality) and, if targeting iOS 17+, add a `PrivacyInfo.xcprivacy` manifest entry
3. Once the manual checklist passes on real hardware, flip the flag on for production
