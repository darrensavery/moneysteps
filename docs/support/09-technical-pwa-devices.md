# 09 · Technical, PWA, Devices, Region & Language

Covers installing the app (PWA/Android), cross-device behaviour, offline/sync, push notifications, deep links, region/currency, and language.

**Key facts:**
- Morechard is a **PWA** (installable web app) with an Android build (App Links / deep links). It runs on Cloudflare (Pages + Workers + D1).
- **Device identity: one device = one user.** A device is linked to a single user (parent or child). This is core to the child-safety model.
- Data lives server-side in D1 — the app is not offline-first for writes. A connection is needed to log chores, approve, upload proof, etc.

---

## Installing & running the app

### Symptom: "How do I install it / it's not in the app store"
**Fact:** Morechard is primarily a **PWA** — installed from the browser ("Add to Home Screen"), not necessarily the app store. On Android there's also a native build.
**Resolve:** Guide them: open `app.morechard.com` in their browser → browser menu → "Add to Home Screen" / "Install app." It then behaves like a native app.

### Symptom: "The app looks blank / stuck on a loading (orchard) message"
**Diagnose:** Rotating loading messages ("Checking the soil…") are normal for a moment. A persistent blank/loading screen is usually:
- A stale cached PWA build after a deploy.
- No network.

**Resolve:** Hard-refresh / fully close and reopen the app. If it persists, have them clear the site cache (or reinstall the PWA). Confirm connectivity. If many users report a persistent blank screen right after a release, escalate — could be a bad deploy.

### Symptom: "It logged me out / lost my data after clearing browser data or reinstalling"
**Diagnose:** The **session token** and some device-local data (e.g. saved bank handles — see [05](05-goals-savings-payment-bridge.md)) live in local storage. Clearing browser data logs them out; **server data (ledger, chores, goals, balances) is safe in D1.**
**Resolve:** They just need to log back in (parent: magic link/password; child: re-enter PIN, or be re-invited if the device was fully unlinked). Reassure them account data isn't lost — only the local session.

---

## Cross-device & sync

### Symptom: "I don't see the same thing on my phone and my partner's phone"
**Diagnose:** In co-parenting mode, **households are private silos** — each parent sees their own household's chores; only the shared ledger is common. So different views can be *correct*. Also check both are logged into the **same family** and have synced (reopen app).
**Resolve:** Clarify the silo model (this is a feature for separated families). If they expect a genuinely shared item to appear and it doesn't after refresh on both devices, capture family_id and escalate (sync/consistency).

### Symptom: "My child logged in on a new device and their old device stopped working"
**Fact:** One device = one user, and child sessions are device-scoped. Re-linking on a new device may require a fresh invite code (see [02](02-onboarding-invites-family.md)). This is expected behaviour for the child-safety model, not a bug.

---

## Push notifications

**Facts:** Push notifications are live on the native iOS and Android builds only — not on the browser-installed PWA (no web push in v1). The Worker sends directly to Apple (APNs) and Google (FCM), no third-party push vendor. Six events trigger a push: a chore is submitted (parents), approved & paid (child), needs a re-do (child), a new chore is assigned (child), a goal is boosted (child), and a gift/contribution is received (parents). Each push also updates the home-screen app icon badge. Permission is asked contextually — a parent is prompted right after creating their first chore, a child right after their first chore is assigned — not on first launch.

### Symptom: "I'm not getting notifications"
**Diagnose:**
1. Are they on the native app (App Store/Play Store install), not just the browser-installed PWA? Push is native-only — a PWA user will never receive one, by design, not a bug.
2. Did they grant notification permission when the in-app prompt appeared? (Check device Settings → Notifications → Morechard.)
3. If permission was denied at that first prompt, the app doesn't currently re-ask automatically — they need to enable it manually in device Settings.
**Resolve:** Confirm they're on the native app. Have them check/enable notification permission for Morechard in device Settings. The in-app badge count is a reliable fallback even if a push was missed — it self-corrects every time the app is opened or resumed, so "nothing showing up" for the badge itself (as opposed to the tray notification) is a stronger signal something's actually wrong. If permission is granted, the app is native, and still nothing arrives, note the platform/OS version and escalate — full real-device verification of this feature is still an open engineering item (see `CLAUDE.md`).

---

## Deep links / App Links (Android)

**Facts:** Android App Links let `https://app.morechard.com/...` links (e.g. `auth/verify`) open the app directly. Verification relies on `assetlinks.json`. On-device verification only runs at install time.

### Symptom: "Magic/verify links open a browser instead of the app" (Android)
**Diagnose:** App Links verification can be in `ask`/`legacy_failure` state, or they're on a build where verification didn't complete.
**Resolve:** The link still works in the browser — completing auth there is fine. If they want it to open the app directly, a reinstall of a verified build is needed. This is mostly a polish item; the browser fallback is fully functional. Persistent failures on production builds → engineering (may need the release cert fingerprint in `assetlinks.json`).

---

## Region, currency & language

**Facts:**
- **Currency is locked at registration** (`base_currency`: GBP/PLN/USD) as an anti-arbitrage measure. UK cards can't buy PLN pricing, etc.
- **Language is independent of currency** — users can toggle UI/AI language (EN-GB / EN-US / PL) regardless of payment region.
- US region swaps "Pocket Money" → "Allowance" (and optionally "Chore" → "Job/Task"); PL uses a formal AI persona.

### Symptom: "My currency is wrong / I want to change country"
**Fact:** Currency is fixed at registration and not self-serve changeable (see [02](02-onboarding-invites-family.md)).
**Resolve:** New account with little data → re-register in the right region. Established account → a currency **rebase** is an engineering operation (it writes a "Rebase" ledger entry to preserve the hash chain). Escalate with family_id and target region.

### Symptom: "I want the app in Polish/English"
**Resolve:** Point them to the **language toggle in Settings** — it's independent of their currency/region. No payment or account change needed.

### Symptom: "The US version says 'Allowance' not 'Pocket Money'" (or vice versa)
**Fact:** Intended regional terminology. US = "Allowance"; UK = "Pocket Money." Not a bug.

---

## Escalation triggers for this domain
- Persistent blank/loading screen across many users right after a deploy → engineering (possible bad release).
- Genuinely shared data not syncing across two devices in the same family/household → engineering with family_id.
- Currency rebase for an established account → engineering.
- Production Android App Links stuck in `legacy_failure` → engineering (cert fingerprint in `assetlinks.json`).
