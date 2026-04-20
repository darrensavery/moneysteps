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

## Navigation Rule
- **Stack Reset on Registration Complete:** Once registration is complete, transition to `/parent` using `window.location.href = '/parent'` (never `navigate('/parent')`). This performs a full-page navigation that clears the history stack so the user cannot swipe/go back to onboarding screens.

## Common Commands

### Daily save routine
git add .
git commit -m "describe what changed"
git push

### Start local server
npm run dev

### Deploy to Cloudflare
wrangler deploy

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

### **Phase 4: Behavioral Education (The "Simulator" Logic)**
- [x] Build 'Goal Planning' Module — Savings Grove with effort-to-earn mentor, goal creation sheet, purchase flow, parental boosting portal
- [ ] Implement 'Real-World' explainers for Ledger entries (e.g., Inflation/Interest)
- [ ] Create Child Funds Dashboard (Unified view: Total Funds / Available Balance)

### **Phase 5: The AI Mentor (Behavioral Nudging)**
- [ ] Integrate AI Personality for Child ('Coaching' tone)
- [ ] Implement AI 'Nudges' based on spending patterns
- [x] Build Parent 'Insights' AI (Summarizing child behavior for the week)
  - [x] `insight_snapshots` D1 table — weekly KPI snapshots with trend deltas (consistency, responsibility, planning horizon)
  - [x] Temporal context: delta calculation vs. prior week snapshot, direction indicators (up/down/flat)
  - [x] Velocity context: Orchard mode (avg tasks/week) vs. Clean mode (avg £ earned/week)
  - [x] Orchard Lead AI briefing via `@cf/meta/llama-3-8b-instruct` with 5s timeout + rule-based fallback
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
- [ ] An AI-driven "Audit" of monthly spending across all children to identify family-wide trends
- [ ] Linking "Seasonal" events (Birthdays, Holidays, School trips) to the Mentor's advice so it can predict future spending needs

### **Phase 6: Compliance & Legal (The "Audit" Factor)**
- [ ] Build 'Court-Ready' PDF Audit Export for co-parents
- [ ] Implement Ledger 'Seal' (Verification page for the PDF)
- [ ] Finalize COPPA/GDPR-K Privacy Controls (Nicknames only)
- [x] Delete Account (Uproot) — `DELETE /auth/family`; lead-only; soft-deletes family row (`deleted_at`), anonymises all user PII (name/email/hashes → NULL), hard-deletes invite codes & registration progress; ledger rows retained anonymised for hash-chain integrity; UI requires typing `UPROOT` to confirm; co-parents must leave before lead can delete

### **Phase 7: Monetization & Global Scale**
- [ ] Integrate Stripe with PPP (Purchasing Power Parity) for GBP/USD/PLN
- [ ] Build Day 15 Paywall — Essential (Lifetime) + Pro Coach Bundle + Add AI Mentor later (see developer-bible §4/§4a)
- [ ] Implement AI Mentor subscription add-on flow (dashboard upsell card for Essential-only users)
- [ ] Implement subscription cancellation & renewal compliance (developer-bible §18)
- [ ] Implement US/UK/PL specific tax/invoice generation (Stripe Tax)

### **Phase 8: Polish & Passive Automation**
- [x] Add Sentry Error Tracking (24/7 solo-dev monitoring)
- [ ] Implement PostHog Session Replays (UX friction hunting)
- [ ] Final PWA Optimization (Offline caching & Push notifications)

### **Infrastructure**
- [ ] Set up Cloudflare staging environment (staging worker + staging D1 + staging Pages branch) with GitHub Actions auto-deploy to production on merge to main
- [ ] Custom domain for the API worker (`api.morechard.com`) — removes `darren-savery.workers.dev` from the Google OAuth consent screen; requires adding custom domain in Cloudflare Workers dashboard, updating redirect URI in Google Cloud Console, and updating the hard-coded `redirectUri` in `worker/src/routes/auth.ts`