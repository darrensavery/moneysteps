---
feature: 23-push-notifications
title: Push Notifications & App Icon Badge
---

### Purpose

Native push notifications (iOS/Android, via Capacitor) tell parents and children when something needs their attention — a chore is ready for approval, a chore was approved and paid, a chore needs a re-do, a new chore was assigned, a goal was boosted, or a gift/contribution came in. A home-screen app icon badge mirrors the same "needs action" count, self-healing on every app open/resume so it stays correct even if a push was missed. Native app only in v1 — no web push for browser-installed PWA users. No in-app notification history/inbox: pushes are ephemeral, and the badge plus the existing Activity/Pending tabs remain the durable record of what needs action.

### Methodology

**No third-party push vendor.** The Worker talks to Apple (APNs) and Google (FCM) directly over REST, each authenticated with a JWT signed in-Worker via `crypto.subtle` — no Firebase Admin SDK, no OneSignal.

**Table: `device_tokens`** (migration 0093)
- `token TEXT PRIMARY KEY` — a physical device token belongs to one installation. Registering the same token under a different `user_id` (a shared family tablet, an account switch) reassigns it via upsert, so a prior user's session doesn't need to be explicitly logged out for the new user to start receiving pushes on that device.
- `user_id`, `platform` (`ios`/`android`), `environment` (`sandbox`/`production` — driven by which APNs provisioning profile signed the build; TestFlight and App Store builds are both `production`), `created_at`, `updated_at`.

**Registration — `POST /api/push/register`** and **`POST /api/push/unregister`**
- Authenticated (`withAuth`). Register upserts the token for the calling user; unregister deletes it, scoped to `token = ? AND user_id = ?` so one user can't remove another's token.
- The client persists its last-registered token locally and calls unregister on logout.
- The client also re-registers on app resume whenever notification permission is already granted, independent of the one-time contextual permission prompt — covering token rotation, reinstalls, and a second account signing into a shared device.

**Sending — `worker/src/lib/push/`**
- `fcm.ts`: RS256 service-account JWT → OAuth token exchange at `oauth2.googleapis.com/token` (cached in KV, ~55 min TTL) → hybrid `notification`+`data` payload POSTed to `fcm.googleapis.com/v1/.../messages:send`. The `notification` field guarantees native OS tray delivery even if the app is killed or Doze-throttled; `data` carries the badge count and deep-link route.
- `apns.ts`: ES256 JWT computed fresh per request (no caching — signing is sub-1ms local CPU) → POSTed to `api.push.apple.com` or `api.sandbox.push.apple.com` per the token's stored `environment`, with `apns-topic`/`apns-push-type`/`apns-priority` headers and `aps.badge` set to the badge count. Prunes a token on 410, or on 400 only when the parsed `reason` is `BadDeviceToken`/`Unregistered` — a blanket 400-prunes-everything rule would wipe every iOS token on a single misconfiguration.
- `send.ts`: fans a push out to every device a user is registered on via `Promise.allSettled`, so one bad token doesn't block the rest; prunes any token flagged by its sender as dead. Never throws — safe to call from `ctx.waitUntil(...)`.
- `notify.ts`: `notifyChild()`/`notifyParents()` helpers used at all six trigger sites, each wrapping its own D1 pending-count lookup and the send in a try/catch so a database hiccup can't surface as an unhandled rejection inside `waitUntil`.
- `pendingCount.ts`: `getParentPendingCount()`/`getChildPendingCount()` compute the badge number live from existing tables (no separate notification-log table to keep in sync) — reused by both the push payload and a `GET /api/push/pending-count` endpoint the client calls to self-heal the badge.

**Trigger sites (all via `ctx.waitUntil`, non-blocking):**
| Event | Recipient | Route |
|---|---|---|
| Chore submitted, ready to approve | Parent(s) | `/parent?tab=activity` |
| Chore approved & paid | Child | `/child?tab=chores` |
| Chore needs a re-do | Child | `/child?tab=chores` |
| New chore assigned | Child | `/child?tab=chores` |
| Goal boosted | Child | `/child?tab=goals` |
| Gift/contribution received | Parent(s) | `/parent?tab=activity` |

Route values are query-param based (`?tab=`), not URL sub-paths — this app has only top-level `/parent`/`/child` routes with internal tab state (no router hierarchy for individual chores/goals), so both dashboards read `?tab=` on mount and on any later change to re-open the right tab.

**Client (`app/src/lib/push.ts`, `PushNotificationListener.tsx`)**
- Permission is requested contextually, not on first launch: a parent is prompted right after creating their first chore, a child right after their first chore is assigned.
- Foreground receive: no native banner (suppressed by design), badge updates from the payload's `data.pendingCount`.
- Tapped, warm start: `navigate(route)` via the SPA router — no page reload.
- Tapped, cold start: covered by `pushNotificationActionPerformed`, which Capacitor fires on both platforms for a notification-triggered launch.
- Badge writes always go through `safeSetBadge()`, guarded with `Badge.isSupported()` + try/catch — Android launcher badge support is OEM-fragmented (Samsung native, Pixel dots-only, others may throw).

### Dependencies

- **External packages / services**: `@capacitor/push-notifications`, `@capawesome/capacitor-badge`; Apple APNs and Google FCM directly (no intermediary push vendor); a Firebase project is required client-side only, to let the Android FCM SDK obtain device tokens.
- **Internal modules**: `worker/src/lib/push/*` (tokens, fcm, apns, send, notify, pendingCount); `worker/src/routes/push.ts` (`/api/push/register`, `/unregister`, `/pending-count`); trigger call sites in `chores.ts`, `completions.ts`, `goals.ts`, `give-requests.ts`; `app/src/lib/push.ts`, `app/src/components/PushNotificationListener.tsx`; deep-link tab handling in `ParentDashboard.tsx`/`ChildDashboard.tsx`.
- **APIs / services**: `oauth2.googleapis.com`, `fcm.googleapis.com`, `api.push.apple.com` / `api.sandbox.push.apple.com`.
- **Manual native-portal setup still required before production traffic**: Apple Developer (APNs `.p8` key), Firebase Console (Android app + `google-services.json`), Xcode (Push Notifications capability), and seven Worker secrets — see CLAUDE.md's "Outstanding — Push notifications and badge native configuration" section.

> **Status:** Code-reviewed and unit-tested (worker + app suites green); real-device verification (physical iOS/Android hardware, a live APNs/FCM round-trip) is still outstanding — the same gap this project has hit before with WebAuthn and the JWT cookie migration, for the same reason (no device/emulator and `wrangler dev --remote` doesn't run in this build environment). See `docs/superpowers/specs/2026-08-11-push-notifications-design.md` §5 for the manual verification checklist.
