# Morechard PWA — Claude Code Context

## Project Overview
Morechard is a chore tracker for families — including separated and co-parenting households.
Parents assign chores, approve completions, and manage goals.
Children track earnings, savings goals, and progress.
An optional AI Mentor (annual subscription) delivers financial literacy lessons triggered by the child's real data.

---

## Source of Truth (IMPORTANT)
All authoritative product, brand, and technical knowledge for this project
has been distilled from NotebookLM and is stored locally in:

/docs/notebooklm/

These files are the source of truth.
Claude must consult them automatically when relevant and must not invent
requirements, tone, strategy, or architecture already covered there.

Start with:
/docs/notebooklm/00-index.md

---

## Routing Rule (How Claude Should Decide What to Read)
Before answering or making changes:

1. Check /docs/notebooklm/00-index.md
2. Consult the relevant file(s) based on the task:
   - Coding, data models, APIs, storage, auth, hosting → developer-bible.md
   - UI copy, wording, tone, UX text → ai-personality.md, brand-book.md
   - Roadmap, monetisation, positioning → business-strategy.md
   - Market comparison, differentiation → competitor-analysis.md

If the knowledge base does not specify something:
- Say “Not specified in the Knowledge Base”, OR
- Ask a clarifying question instead of guessing.

---

## Strategic Tech Direction (IMPORTANT)

### Current Direction
Morechard runs on a **Cloudflare‑native stack** taking advantage of:

- Cloudflare Pages + Functions
- Cloudflare D1 (SQL database)
- Cloudflare environment bindings
- Simpler mental model, lower long‑term cost, tighter platform integration

### Data Layer
- Cloudflare D1 (SQL) is the **only data layer** — do not introduce any other database or storage backend
- Default to Cloudflare D1 + SQL for all storage decisions

### SPA Routing
Use 404.html (copied from index.html at build) for Cloudflare Pages SPA routing.
Do NOT use _redirects — Cloudflare's linter flags `/* /index.html 200` as an
infinite loop warning.

---

## Working Expectations for Claude
Claude Code is responsible for:
- reasoning
- implementation
- refactoring
- execution within the defined constraints

Claude Code is NOT responsible for:
- re-interpreting original source documents
- re-deriving product decisions already captured
- inventing assumptions when knowledge is missing

When answering non-trivial questions, Claude may briefly note
which /docs/notebooklm files were consulted.

---

## Key Project Files
- `app/src/lib/deviceIdentity.ts` — Device identity model (one device = one user)
- `app/src/lib/biometrics.ts` — WebAuthn biometric wrapper (Face ID / Touch ID)
- `app/src/screens/LockScreen.tsx` — Auto-challenges biometrics on app open
- `app/src/components/registration/Stage3SecureApp.tsx` — Biometric + PIN setup
- `worker/src/lib/agent/` — Autonomous support agent (Phase 0: shadow mode, diagnosis-only). See `docs/dev/support-agent-runbook.md` for operations and `docs/superpowers/specs/2026-07-13-autonomous-support-agent-design.md` for the authority model.

## Data Process Diagrams — Maintenance Rule
Morechard's key data flows (registration, ledger transactions, DSAR/erasure, AI Mentor briefings, payments, consent, etc.) are documented as swimlane diagrams in the team Lucid account. The full list with hyperlinks lives in `docs/dev/data-process-diagrams.md`.

**If you change the behavior of any documented process** — a new/changed route, a different D1 table touched, a reordered step, a new third-party call, or a spec'd-but-unbuilt flow (e.g. DSAR) becoming real — update the corresponding Lucid diagram via the Lucid MCP integration in the same change, or explicitly flag it as a follow-up task. Do not let the diagrams silently drift from the code.

## Navigation Rule
- **Stack Reset on Registration Complete:** Once registration is complete, transition to `/parent` using `window.location.href = '/parent'` (never `navigate('/parent')`). This performs a full-page navigation that clears the history stack so the user cannot swipe/go back to onboarding screens.

## Outstanding — Android App Links on-device verification

Wave 1 shipped deep-link support + `assetlinks.json` (Google's Digital Asset Links API confirms it's valid). Still to do on a real device/emulator before the feature is fully verified:

1. Start an Android emulator (or attach a device) and confirm `adb devices` shows it.
2. Install a fresh debug build — App Links verification only runs on install:
   ```bash
   cd android && ./gradlew installDebug
   ```
3. Confirm verification succeeded:
   ```bash
   adb shell pm get-app-links com.morechard.app
   ```
   Expect `app.morechard.com: verified` (not `ask` or `legacy_failure`).
4. Fire a test deep link:
   ```bash
   adb shell am start -a android.intent.action.VIEW -d "https://app.morechard.com/auth/verify?token=test"
   ```
   Should open Morechard directly — no browser, no chooser.

Before production release: replace the debug SHA-256 in `app/public/.well-known/assetlinks.json` with the **release cert fingerprint** from Play Console → App integrity → App signing. Keep the upload cert fingerprint.

## Outstanding — Push notifications and badge native configuration

Push notifications (Capacitor v8 plugin) and badge support (CapAwesome plugin) require manual setup in two cloud portals and Xcode before deployment.

**Apple Developer Portal (for iOS APNs):**

1. Go to [developer.apple.com](https://developer.apple.com)
2. Navigate to Certificates, Identifiers & Profiles → Identifiers
3. Select the App ID for `com.morechard.app`
4. Enable the Push Notifications capability (edit identifier if not yet enabled)
5. Generate an APNs authentication key (Auth Key, not certificate):
   - Click "Create a Key" under Push Notifications
   - Name it (e.g., "Morechard Push APNs")
   - Download the `.p8` file
   - Record the Key ID (visible in the portal immediately after generation)
   - Record your Team ID (visible in Account Settings)

**Firebase Console (for Android FCM):**

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project or select an existing one for Morechard
3. Add an Android app with package name `com.morechard.app`
4. Download the generated `google-services.json` file
5. Copy it into `android/app/google-services.json` (create the file if it doesn't exist)

**Xcode (iOS build-time configuration):**

1. Open `ios/App/App.xcworkspace` in Xcode
2. Select the App target
3. Go to Signing & Capabilities
4. Click + Capability and add "Push Notifications"
5. Verify that a Push Notifications capability row now appears

**Worker secrets (Cloudflare):**

Set these secrets for both dev and production environments. The Worker uses them to send notifications via APNs (iOS) and FCM (Android). Retrieve values from the portals above and the `google-services.json` / APNs key download:

```bash
# Dev database:
npx wrangler secret put FCM_PROJECT_ID
npx wrangler secret put FCM_CLIENT_EMAIL
npx wrangler secret put FCM_PRIVATE_KEY
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_PRIVATE_KEY
npx wrangler secret put APNS_BUNDLE_ID

# Production database:
npx wrangler secret put FCM_PROJECT_ID --env production
npx wrangler secret put FCM_CLIENT_EMAIL --env production
npx wrangler secret put FCM_PRIVATE_KEY --env production
npx wrangler secret put APNS_KEY_ID --env production
npx wrangler secret put APNS_TEAM_ID --env production
npx wrangler secret put APNS_PRIVATE_KEY --env production
npx wrangler secret put APNS_BUNDLE_ID --env production
```

**Extracting secret values from firebase:**

- `FCM_PROJECT_ID`: Visible in Firebase project settings (Settings gear → Project settings, listed as "Project ID")
- `FCM_CLIENT_EMAIL`: In the service account JSON (Firebase Settings → Service Accounts → Generate new private key)
- `FCM_PRIVATE_KEY`: Same service account JSON file (base64-encoded private key, copy as-is)
- `APNS_KEY_ID`: The Key ID from the APNs authentication key you downloaded from Apple Developer
- `APNS_TEAM_ID`: Your Apple Developer Team ID
- `APNS_PRIVATE_KEY`: The full content of the `.p8` file downloaded from Apple Developer (copy as-is)
- `APNS_BUNDLE_ID`: Should match `com.morechard.app`

## Database & Deployment Rules (CRITICAL — read before touching any wrangler command)

### The two databases

| Name | ID | Purpose |
|------|----|---------|
| `morechard-dev` | `a6f9fe7d-7e6c-4176-8654-b9d6c83e5cba` | Dev/testing only — seeded with fake data |
| `morechard` | `5e8b4cd3-4807-43e4-bd84-4969da6e402c` | **Production — live user data** |

### The two rules

1. **`--local` is dead.** Local D1 has accumulated schema divergence and cannot be bootstrapped through the migration chain. Never use `--local` on any wrangler command.

2. **`--env production` = production database.** Any wrangler command *without* `--env production` targets `morechard-dev`. Always double-check before running anything destructive.

### Starting the dev server
```bash
npm run dev          # worker (remote morechard-dev) + app, both in watch mode
```

### Querying a database
```bash
# Dev:
cd worker && npx wrangler d1 execute morechard-dev --remote --command="SELECT ..."

# Prod:
cd worker && npx wrangler d1 execute morechard --remote --env production --command="SELECT ..."
```

### Deploying the Worker

Automatic via GitHub Actions (`.github/workflows/worker-deploy.yml`) on every push:
- Any branch/PR touching `worker/**` → uploads a preview **version** (no live traffic shift), tested against the real production DB, at its own preview URL.
- Push to `main` → uploads a version, then promotes it to 100% of live traffic.

This is Cloudflare's "blue/green" primitive (Worker Versions & Gradual Deployments): both the old and new version share the same live `morechard` D1, so there's never a "which one has the real writes" split — only the swap of which version serves requests changes. Requires the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets to be set (see workflow file comments).

Manual equivalent from the CLI:
```bash
cd worker
npm run deploy:preview   # uploads a version, does NOT go live — gives a private preview URL
npm run deploy:promote   # shifts 100% of live traffic to that version instantly
```

Old one-shot method (still works, but skips the safety net above):
```bash
cd worker && npx wrangler deploy --env production
```
This binds the live `morechard` DB, production env vars, and live Stripe keys.
**Never run `wrangler deploy` without `--env production`** — it deploys dev bindings over the production worker.

### Applying a migration to production

Simple migrations (ALTER TABLE, CREATE TABLE, CREATE INDEX — no triggers):
```bash
cd worker
npx wrangler d1 migrations apply morechard --remote --env production
```

Migrations containing SQLite triggers (`CREATE TRIGGER ... BEGIN ... END`):
`migrations apply` splits on `;` and breaks trigger bodies. Use `--file=` instead:
```bash
cd worker
npx wrangler d1 execute morechard --remote --env production --file=migrations/XXXX_name.sql
# Then manually mark it applied:
npx wrangler d1 execute morechard --remote --env production \
  --command="INSERT INTO d1_migrations (name) VALUES ('XXXX_name.sql')"
```

### Bootstrapping morechard-dev (if ever reset or empty)
`wrangler d1 migrations apply morechard-dev` **will not work** — the migration chain has
historical conflicts that only the production DB survived incrementally.
Instead:
```bash
npm run seed:bootstrap   # applies worker/dev/bootstrap_dev_db.sql — drops + recreates all tables
npm run seed:m13         # (or any other seed) to load test data
```

---

## Common Commands

### Daily save routine
```bash
git add .
git commit -m "describe what changed"
git push
```

### Start dev server
```bash
npm run dev    # worker (morechard-dev remote) + Vite app
```

### Deploy Worker to production
```bash
cd worker && npx wrangler deploy --env production
```

### Apply a new migration to production
```bash
cd worker && npx wrangler d1 migrations apply morechard --remote --env production
```

---

## 📝 Live Roadmap & Task Tracking (8-Phase Master Plan)
> **Claude Instruction:** Update this list after every successful implementation. 

### **Phase 1: Core Foundation (The Truth Engine)**
- [x] Initialize Cloudflare D1 Schema (Families, Kids, Ledger)
- [x] Implement SHA-256 Hash Chain Logic in Worker for every transaction
- [x] Build '6-Digit Child Code' Generation & Verification Logic

### **Phase 2: High-Integrity Onboarding**
- [x] Build 4-Stage Adaptive Registration Flow (UK/US/PL)
- [x] Implement Region-Aware UI (Currency & Terminology Logic)
- [x] Set up 'Better Auth' for secure Parent identity management (custom JWT/magic-link — leaner for Cloudflare)

### **Phase 3: The Transaction Loop (The "Sovereign" Ledger)**
- [x] Build 'Parent Job Create' API & UI
- [x] Build 'Child Mark Done' UI (Virtual Ledger interaction)
- [x] Implement Parent Approval -> Immutable Ledger Write

### **Phase 4: Behavioral Education (The "Simulator" Logic)** — CLOSED (2026-07-08)
- [x] Build 'Goal Planning' Module — Savings Grove with effort-to-earn mentor, goal creation sheet, purchase flow, parental boosting portal
- [x] ~~Implement 'Real-World' explainers for Ledger entries (e.g., Inflation/Interest)~~ — **cut, won't build.** The ledger doesn't accrue interest or apply inflation (Sovereign Ledger philosophy, developer-bible §16 — not a bank simulation), so there's no concrete entry type this would attach to. Inflation/interest are already taught via the proactive Inflation Nudge trigger (`intelligence.ts`) and Learning Lab modules 10/13/14 (Interest Trap, Compound Growth, Inflation) — a ledger-row explainer would be a redundant third delivery channel.
- [x] ~~Create Child Funds Dashboard (Unified view: Total Funds / Available Balance)~~ — **cut, won't build.** No confirmed evidence of a real confusion gap in the current child dashboard to justify the new balance-model work (new "locked in goals" calc, API changes).

### **Phase 5: The AI Mentor (Behavioral Nudging)** — reviewed 2026-07-08
- [x] Integrate AI Personality for Child ('Coaching' tone) — already shipped, roadmap was stale. Seedling/Professional child personas defined in `02-ai-personality.md` §3; live in `child-nudges.ts` (35+ dual-tone nudges), `GoalMentorNudge.tsx`, `insights.ts`/`chat.ts` tone-switching.
- [x] Implement AI 'Nudges' based on spending patterns — background sweep in `child-nudges.ts`; real-time gap closed by the Impulse Speed Bump cooldown interstitial (`SpendGuideSheet.tsx` + `impulseSpeedBump.ts`, logged via `POST /api/child-nudges/impulse-outcome`).
- [x] Velocity Alert — already shipped, roadmap was stale. `velocity_7d` mechanic + goal-slippage framing live in `intelligence.ts`, `chat.ts`, `GoalMentorNudge.tsx`.
- [ ] ~~Teen Mentor Chat (13-17 free-text AI chat, live feature)~~ — **shelved 2026-08-06, not cancelled.** Built and merged to `main` (`worker/src/routes/mentorChat.ts`, `worker/src/lib/mentorChat/`), fully tested, but inert — `MENTOR_CHAT_ENABLED` unset in production and the consent-writing UI (Track 2) was never built. Reopened from a decommissioned 2026-07-16 predecessor based on anecdotal teen feedback, then shelved again once the real scope became clear: the crisis-detection dataflow processes special-category (health-adjacent) data under Article 9 UK GDPR, is very likely DPIA-mandatory, and needs a distinct legal basis for both the special-category processing and the parent-disclosure step — a formal legal engagement Darren doesn't have in place, for a feature that only serves the teen subset of users on a non-core part of the product (chore-data financial education is the actual value prop) and would make Darren personally the real-time human escalation path for self-harm/abuse disclosures. Full rationale and re-opening criteria: `docs/governance/ai-inventory.md`, AI System 3.
- [ ] ~~Parental Loan Modeller (live feature)~~ — **decided against, education-only.** A live loan-with-interest flow between parent and child would contradict the Sovereign Ledger philosophy (§16 developer-bible: never simulate a bank instrument the app doesn't support) and adds real interest-bearing debt to a hash-chained ledger built to be court-submissible for separated families — a legal liability surface with no validated demand. The concept stays exclusively as the Learning Lab M10 "Interest Trap" hypothetical calculator. Dead stub `evaluateOnLoanRequest()` (never wired to a route) should be removed as unused code — not yet done.
- [x] Build Parent 'Insights' AI (Summarizing child behavior for the week)
  - [x] `insight_snapshots` D1 table — weekly KPI snapshots with trend deltas (consistency, responsibility, planning horizon)
  - [x] Temporal context: delta calculation vs. prior week snapshot, direction indicators (up/down/flat)
  - [x] Velocity context: Orchard mode (avg tasks/week) vs. Clean mode (avg £ earned/week)
  - [x] Orchard Lead AI briefing via OpenAI `gpt-4o-mini` with 10s timeout + rule-based fallback
  - [x] D1 briefing cache — AI runs once per week per child; subsequent loads return instantly
  - [x] Literacy Matrix integration — all briefings grounded in Pillars 1–5 with explicit Pillar naming
  - [x] Pillar 5 surplus trigger — fires when balance > £100 or all goals funded
  - [x] Polish localisation — `getPolishHonorific()`, Pan/Pani formal address, Mistrz Sadu persona, "Honor i Obowiązek Zbiorów" Pillar 5 framing
  - [x] Two AI personas: Orchard Lead (EN, collaborative) vs. Mistrz Sadu (PL, direct/formal)
  - [x] InsightsTab UI — typewriter animation (source=ai only), trend indicators on KPI gauges, parchment-tinted briefing card
  - [x] 'Copy for Child' modal — Seedling (visual/orchard metaphors) and Professional (velocity/streak) templates with "Drafted by your Orchard Mentor" attribution
- [x] Rate Guide — market rate benchmarking for chores
  - [x] Design spec (2026-04-19)
  - [x] D1 migration + 30-row seed (0029_market_rates.sql)
  - [x] GET /api/market-rates + suggest endpoint + CRON skeleton (Monday 03:00 UTC)
  - [x] CreateChoreSheet tile grid + fuzzy search redesign
  - [x] RateGuideSheet (parent) + ChoreGuideSheet (child)
  - [x] Fast-Track suggestion flow (post-save prompt)
- [x] An AI-driven "Audit" of monthly spending across all children to identify family-wide trends — Family Audit card in parent Insights tab (`GET /api/family-audit`, `family_audit_snapshots` cache table); shares the "Orchard Mentor" header/`ProBadge`/`AiDisclosurePill` design system with the per-child briefing card

### **Phase 6: Compliance & Legal (The "Audit" Factor)** — CLOSED (2026-07-08)
- [x] Build 'Court-Ready' PDF Audit Export for co-parents — already shipped, roadmap was stale. `GET /api/export/pdf` (`export.ts`), tiered basic/behavioral/forensic reports with legal citations, tier-gated behind Shield AI; reachable via Settings → Data & Exports (`DataSettings.tsx`).
- [x] Implement Ledger 'Seal' (Verification page for the PDF) — `VerifyLedgerHashScreen.tsx` + public `GET /api/verify/:hash` (`ledger-verify-public.ts`) already existed but weren't linked. Wired up: PDF exports now print the real chain-head hash as a scannable QR code + clickable `/verify/:hash` link (`export.ts`), so co-parents/courts can jump straight from the document to an auto-verified result with no manual hash entry.
- [x] Finalize COPPA/GDPR-K Privacy Controls (Nicknames only) — confirmed. Registration only collects `display_name` ("nickname recommended" copy in `Stage3ChildOnboarding.tsx`); no `first_name`/`last_name`/`real_name` column exists anywhere in the schema. Soft control only (free-text field isn't validated against real names).
- [x] Delete Account (Uproot) — `DELETE /auth/family`; lead-only; soft-deletes family row (`deleted_at`), anonymises all user PII (name/email/hashes → NULL), hard-deletes invite codes & registration progress; ledger rows retained anonymised for hash-chain integrity; UI requires typing `UPROOT` to confirm; co-parents must leave before lead can delete

### **Phase 7: Monetization & Global Scale**
- [ ] Integrate Stripe with PPP (Purchasing Power Parity) for GBP/USD/PLN
- [x] Payment Bridge V1 — deep-link (Monzo/Revolut/PayPal/Venmo) + Smart Copy (UK bank transfer, Zelle). `paid_out_at` delivery flag, not a ledger write. BLIK deferred to PL market push. Bank-details localStorage is temporary — Spec B replaces with encrypted vault.
- [ ] Build Day 15 Paywall — Morechard Core (£44.99) + Core AI (£64.99) + Shield AI (£149.99); AI Mentor + Learning Lab upgrade (£29.99) for Core-only users (see developer-bible §4/§4a)
- [x] Implement AI Mentor + Learning Lab upsell card (dashboard upsell for Core-only users) — merged to `main` 2026-08-12. Along the way found and fixed a production bug: Learning Lab's entitlement check read `families.license_type`, a column no purchase flow ever writes (defaults to `'core'` for every real family, only ever set to `'core_ai'` for the demo family in a migration) — so Learning Lab was invisible to every real paying customer regardless of what they bought. Fixed to gate on the real `has_ai_mentor`/`has_shield` flags (`worker/src/routes/insights.ts`, `computeLearningLabEnabled`). New `LearningLabUpsellCard` (`app/src/components/dashboard/`) fills the Insights tab's Learning Lab slot for post-trial Core-only parents (same audience predicate as `DemoUpsellCard`), CTA deep-links straight to Settings → Plans & Upgrades via a new jump-token mechanism on `ParentSettingsTab`. AI Mentor's weekly briefing card itself needed no change — it has no entitlement gate and is shown to every family, matching the "always visible" positioning. Spec: `docs/superpowers/specs/2026-08-12-learning-lab-upsell-design.md`; plan: `docs/superpowers/plans/2026-08-12-learning-lab-upsell.md`. Covered by unit tests only (492 worker + 173 app tests passing, clean typecheck) — the plan's live end-to-end verification step (real purchase loop against `morechard-dev`) wasn't run, same `wrangler dev --remote` 503 limitation noted elsewhere in this file.
- [x] Remove subscription cancellation flow — all products are now one-time payments (developer-bible §18). Code was already one-time-only (`BillingSettings.tsx`, `stripe.ts`) with no leftover renewal/subscription-webhook logic; the only stale artifact was `developer-bible.md` §18 itself, which still described a defunct "AI Mentor Annual Subscription" with renewal reminders. Rewrote §18 to "Refund Compliance (No Subscriptions)" — kept only the legally-required 14-day cooling-off refund (already live via `handleCancelPlan` / `DELETE /api/billing/cancel`).
- [ ] ~~Implement US/UK/PL specific tax/invoice generation (Stripe Tax)~~ — **postponed, UK-only for launch.** Launching UK-first; US/PL tax/invoice generation deferred until international expansion is scheduled. UK VAT/invoicing via Stripe Tax still required for launch.

### **Phase 8: Polish & Passive Automation**
- [x] Add Sentry Error Tracking (24/7 solo-dev monitoring)
- [ ] Implement PostHog Session Replays (UX friction hunting)
- [x] Offline caching (`vite-plugin-pwa`/Workbox) — verified 2026-08-06: precaches full app shell (65 entries incl. all JS/CSS chunks, fonts, icons, manifest), SPA navigation fallback to `/index.html` with `/api` and `/auth` denylisted, cache-first for immutable hashed assets/fonts/DiceBear avatars, stale-while-revalidate for Google Fonts CSS. Confirmed via production build (`npm run build`) — `sw.js` output matches `vite.config.ts` config exactly.
- [x] Push notifications (remaining half of "Final PWA Optimization") — native only (iOS via APNs, Android via FCM); **web push is explicitly out of scope** per the design spec, so there is deliberately no service-worker `push` handler. Server-side send lives in `worker/src/lib/push/` (`apns.ts` / `fcm.ts` / `send.ts` / `notify.ts`) with token storage in `device_tokens` (migration `0093_push_notifications.sql`); client registration + deep-link/badge handling in `app/src/lib/push.ts` and `app/src/components/PushNotificationListener.tsx`. Six triggers wired: new chore, completion approved, needs-redo, ready-to-approve, goal boost, give request. Spec: `docs/superpowers/specs/2026-08-11-push-notifications-design.md`; plan: `docs/superpowers/plans/2026-08-11-push-notifications.md`. **Ships verified by unit tests + code review only** — no real-device verification was possible in the build environment (no iOS/Android device or emulator, and `wrangler dev --remote` 503s here), and the APNs/FCM credentials are not yet set as Worker secrets. Needs a real end-to-end run on actual hardware plus the native configuration steps in "Outstanding — Push notifications and badge native configuration" above before it can be called done.
- [x] High Contrast mode (WCAG 2.1 AA, opt-in, parent + child accounts) — merged to `main` 2026-08-07. `data-contrast="high"` attribute drives a CSS override layer independent of `data-theme`; `user_settings.high_contrast` persists per-account (migration `0092_high_contrast_setting.sql`, confirmed applied to `morechard-dev`); OS-level `prefers-contrast: more` fallback when no explicit preference is stored; toggle lives in Appearance Settings for both parent and child. Spec: `docs/superpowers/specs/2026-08-06-high-contrast-mode-design.md`; plan: `docs/superpowers/plans/2026-08-06-high-contrast-mode.md`. Axe (`@axe-core/playwright`) e2e sweep (`app/e2e/high-contrast-a11y.spec.ts`) covers 4 surfaces × 2 contrast states, but only 2/8 cases (registration) have run against a live worker — the other 6 (parent/child dashboard, settings) are blocked by the same sandboxed `wrangler dev --remote` 503 limitation as the JWT/WebAuthn work above; needs a real run from a machine that can reach Cloudflare. Two non-blocking findings from the partial run, not yet filed as tickets: (1) `meta-viewport` WCAG 1.4.4 violation — `user-scalable=no` disables pinch-zoom, pre-existing and unrelated to contrast; (2) a possibly-flaky `color-contrast` finding on the disabled registration "Continue" button, seen once, not reproduced.

### **Infrastructure**
- [x] JWT storage model migrated off `localStorage` — web now uses an `HttpOnly; Secure; SameSite=Lax` cookie (`mc_token`) + CSRF header check (`X-Morechard-Client`), native (Capacitor) uses Keychain/Keystore-backed secure storage instead of `localStorage`/Bearer-in-JS. Closes finding #4 from the 2026-07-15 production security audit (Pass 6). Spec: `docs/superpowers/specs/2026-07-15-jwt-cookie-migration-design.md`; plan: `docs/superpowers/plans/2026-07-15-jwt-cookie-migration.md`. Live Playwright verification of the cookie/CSRF flow still outstanding — `wrangler dev --remote` doesn't run in the sandboxed dev environment used to build this (503 on every route, reproduces on unmodified `main`); the spec (`app/e2e/auth-cookie.spec.ts`) is written and statically verified against the route code but never executed.
- [x] WebAuthn server-side verification shipped — web uses real `@simplewebauthn/server`/`browser` (COSE public key, signature-counter clone-detection with a dedicated Sentry alert fingerprint `webauthn-clone-detected`); native (Capacitor) uses a Web-Crypto ECDSA key pair in IndexedDB gated by a native biometric prompt (`@aparajita/capacitor-biometric-auth`), no custom Swift/Kotlin. Both unlock the device and re-issue a real session on success, unifying the old separate "unlock" and "login" concepts. Closes finding #1 from the 2026-07-15 production security audit (Pass 7) — the other half of the original JWT/WebAuthn handoff. Spec: `docs/superpowers/specs/2026-07-16-webauthn-verification-design.md`; plan: `docs/superpowers/plans/2026-07-16-webauthn-verification.md`. No live device/browser verification was possible in the build environment (no iOS/Android device or emulator, `wrangler dev --remote` 503s here) — ships verified by unit tests + code review only; needs real end-to-end verification on actual hardware.
- [x] Set up Worker blue/green deploys with GitHub Actions auto-deploy to production on merge to main — implemented via Cloudflare Worker Versions & Gradual Deployments (`.github/workflows/worker-deploy.yml`) instead of a separate staging Worker/D1: every branch/PR gets a live preview version against the real production DB (no separate staging DB to keep in sync), and merging to `main` auto-promotes to 100% traffic. **Blocked on user action**: add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets in GitHub before this runs. The app/Pages side already got this for free — Cloudflare Pages auto-builds a live preview per branch/PR.
- [ ] Custom domain for the API worker (`api.morechard.com`) — removes `darren-savery.workers.dev` from the Google OAuth consent screen; requires adding custom domain in Cloudflare Workers dashboard, updating redirect URI in Google Cloud Console, and updating the hard-coded `redirectUri` in `worker/src/routes/auth.ts`