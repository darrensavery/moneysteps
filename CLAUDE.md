# Morechard PWA — Claude Code Context

## Project Overview
Morechard is a family pocket money PWA.
Parents manage chores, goals, approvals, and payments.
Children track earnings, savings goals, and progress.

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
Morechard is evolving away from Firebase toward a **Cloudflare‑native stack**
to take advantage of:

- Cloudflare Pages + Functions
- Cloudflare D1 (SQL database)
- Cloudflare environment bindings
- Simpler mental model, lower long‑term cost, tighter platform integration

### Migration Rules
- Cloudflare D1 (SQL) is the **target data layer**
- Firebase should NOT be introduced in new code
- If legacy Firebase patterns exist:
  - Treat them as transitional
  - Do not expand or deepen Firebase usage
  - Prefer migration or abstraction over extension

If a storage or data-model decision is required:
- Default to Cloudflare D1 + SQL
- Ask before proposing Firebase-based solutions

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
- `pocket-money-v3/pwa-v3/index.html` — single-file app (~344KB)
- `test-app.js` — Playwright test suite (repo root)
- `pocket-money-v3/pwa-v3/start-server.bat` — local dev server (localhost:3000)
- `app/src/lib/deviceIdentity.ts` — Device identity model (one device = one user)
- `app/src/lib/biometrics.ts` — WebAuthn biometric wrapper (Face ID / Touch ID)
- `app/src/screens/LockScreen.tsx` — Auto-challenges biometrics on app open
- `app/src/components/registration/Stage3SecureApp.tsx` — Biometric + PIN setup

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
- [ ] Build 'Parent Job Create' API & UI
- [ ] Build 'Child Mark Done' UI (Virtual Ledger interaction)
- [ ] Implement Parent Approval -> Immutable Ledger Write

### **Phase 4: Behavioral Education (The "Simulator" Logic)**
- [x] Build 'Goal Planning' Module — Savings Grove with effort-to-earn mentor, goal creation sheet, purchase flow, parental boosting portal
- [ ] Implement 'Real-World' explainers for Ledger entries (e.g., Inflation/Interest)
- [ ] Create Child 'Equity' Dashboard (Unified view of all virtual assets)

### **Phase 5: The AI Mentor (Behavioral Nudging)**
- [ ] Integrate AI Personality for Child ('Coaching' tone)
- [ ] Implement AI 'Nudges' based on spending patterns
- [ ] Build Parent 'Insights' AI (Summarizing child behavior for the week)

### **Phase 6: Compliance & Legal (The "Audit" Factor)**
- [ ] Build 'Court-Ready' PDF Audit Export for co-parents
- [ ] Implement Ledger 'Seal' (Verification page for the PDF)
- [ ] Finalize COPPA/GDPR-K Privacy Controls (Nicknames only)

### **Phase 7: Monetization & Global Scale**
- [ ] Integrate Stripe with PPP (Purchasing Power Parity) for GBP/USD/PLN
- [ ] Build 'Lifetime License' vs. 'Subscription' Paywall logic
- [ ] Implement US/UK/PL specific tax/invoice generation (Stripe Tax)

### **Phase 8: Polish & Passive Automation**
- [x] Add Sentry Error Tracking (24/7 solo-dev monitoring)
- [ ] Implement PostHog Session Replays (UX friction hunting)
- [ ] Final PWA Optimization (Offline caching & Push notifications)