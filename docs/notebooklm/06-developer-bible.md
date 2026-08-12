# MORECHARD DEVELOPER BIBLE (V5.0)

> **Changelog from V4.3:**
> - **§1 rewritten:** chore tracker is now the primary product identity; AI Mentor is the secondary, paywalled layer.
> - **§4 restructured:** clearer separation of registration flow, trial mechanics, and post-trial paywall logic.
> - **§4a added:** Licensing model — one lifetime license unlocks the full app; AI Mentor is a separate annual subscription.
> - **§5 expanded:** added Subscription Cancellation rights (UK/EU statutory compliance obligations).
> - **§10 / §15 pricing tables restructured:** explicit separation of "Lifetime License" and "AI Mentor Annual."
> - **§11 backlog rewritten:** reflects the split-product paywall logic at Day 15.
> - **§16 Sovereign Ledger language refined:** no "Total Equity" — now "Total Funds / Available Balance."
> - **§17 brand rules clarified:** empty states and copy updated for a chore-tracker-first product.
> - **§18 retired then rewritten:** was "Subscription Cancellation & Refund Compliance"; pricing model moved to one-time payments only (2026-08-06), so §18 is now "Refund Compliance (No Subscriptions)" — covers the 14-day cooling-off refund only, no renewal/subscription language.
> - **§19 NEW:** Curriculum Tier Naming — four-tier structure with Level 1 (Seed · 6–9) reserved for Phase 2. Defines the Child `experience_level` toggle (Orchard vs. Clean) controlling how curriculum tiers are displayed.
> - **Licensing model decisions locked:** AI Mentor active during 14-day trial; if user buys lifetime-only at Day 15, AI features lock immediately (Option A); Pro Coach Bundle is offered at Day 15 checkout, not before.

> **Immutability note:** The licensing model in §4a and §18 should be treated as frozen once the first paid signup is processed. Changes to trial length, refund windows, or product-bundle structure after that point create legal and operational risk.

---

## 1) System Overview & Core Identity

**What the app does:** Morechard is a **chore tracker for families** — including separated and co-parenting households. Chores can be assigned per household without cross-visibility, approvals are logged immutably, and the ledger acts as a shared, unambiguous record of what was earned and when.

On top of the chore tracker sits an optional **financial literacy layer** — an AI Mentor that delivers age-appropriate, behaviourally-triggered lessons using the child's real chore, saving, and goal data as examples. The AI Mentor is a separate annual subscription.

The underlying ledger uses cryptographic SHA-256 verification and can produce PDF audit reports suitable for family or legal use, but this is infrastructure, not the marketed product.

**Core user roles:**
- **Parent** (Custodian / Observer / Approver)
- **Child** (Learner, Ages 10–16 at launch; Ages 6–9 planned Phase 2 — see §19)
- **AI Mentor** (Performance Coach / Neutral Arbiter — subscription-gated)

**Core flows (in order of product priority):**
1. Chore assignment, child completion marking, and parent approval.
2. Immutable transaction logging with cryptographic SHA-256 verification.
3. AI-powered financial literacy coaching triggered by real saving / spending / chore behaviour. *(AI subscription required after the 14-day trial.)*
4. One-click generation of PDF audit reports for family / legal use.

---

## 2) Tech Stack & Services
* **Frontend:** High-performance PWA using Tailwind CSS and Shadcn UI.
* **Backend / services:** Cloudflare Workers (Serverless).
* **Auth:** Cloudflare Access or Auth.js (integrated with authorised ID logging).
* **Database:** Cloudflare D1 (Relational SQL).
* **Hosting:** Cloudflare.
* **Build tools:** Vite / Cloudflare Wrangler.
* **Payments:** Stripe (see §10 / §15 for regional pricing).
* **AI Engine:** Gemini or GPT-4o-mini (focus: contextual nudges triggered by real app behaviour, not static courses).

---

## 3) Data Model (Relational SQL)

### Entity: Transaction Ledger
- `record_hash` (SHA-256 chain), `amount` (Integer — Pence / Groszy / Cents), `family_id` (FK), `parent_id` (FK), `server_timestamp`, `ip_address`, `verification_status` (Enum).
- **Constraint:** No deletion; errors require "Reversal" entries referencing the original record.

### Entity: Family / Governance (single `families` table)
- `family_id`, `governance_mode` (Enum: `AMICABLE` | `STANDARD`), `authorised_ids`, `timestamp`, `ip_address`.
- `base_currency` (GBP | PLN | USD), `region` (UK | PL | US).
- **Licensing columns** (see §4a):
    - `trial_start_date` (nullable — NULL until first Value Event).
    - `trial_end_date` (nullable — computed `trial_start_date + 14 days`).
    - `has_lifetime_license` (Boolean, default `FALSE`).
    - `lifetime_license_purchased_at` (nullable — timestamp of chore-tracker unlock payment).
    - `ai_subscription_status` (Enum: `NONE` | `ACTIVE` | `CANCELLED` | `EXPIRED`).
    - `ai_subscription_started_at` (nullable).
    - `ai_subscription_expiry` (nullable — next renewal date if `ACTIVE`).
    - `ai_auto_renew` (Boolean, default `TRUE`).
- **Requirement:** Handshake logic (mutual consent) for all governance changes.
- **Schema rule:** `families` is the single source of truth for governance, region, and licensing state.

### Entity: Children (Linked to `families`)
- `child_id`, `display_name` (Mandatory — nicknames encouraged), `family_invite_code` (6-digit String).
- `age_tier` (Enum: `SEED` (reserved Phase 2) | `SPROUT` | `SAPLING` | `OAK` — see §19).
- `experience_level` (Enum: `ORCHARD` | `CLEAN` — controls metaphor exposure in curriculum surfaces; see §19).

### Entity: Chore Ledger
- `household_id` (Private Silo), `task_description`, `status`, `child_id`.
- **Partitioning:** Private household silos prevent cross-visibility between parents.

### Entity: Payment Audit Log
- Immutable Stripe transaction record. One row per Stripe event. Never deleted.

---

## 4) Key User Journeys & Registration

### The 4-Stage "High-Integrity" Registration
1. **Identity:** Lead parent sign-up. Toggle: "Single Parent" vs. "Co-Parenting Team."
2. **Constitution:** Select Region (UK / PL / US) and Governance Mode (`AMICABLE` vs. `STANDARD`). Region determines currency, locale, and compliance path (COPPA / GDPR-K).
3. **Child Setup:** Input `display_name` and `age_tier`. System generates 6-digit invite code for device linking.
4. **Co-Parent Bridge:** Option to invite via email, or share the 6-digit family code manually.

### The 14-Day Trial (Whole-App Trial)
- **Coverage:** During the trial, the entire app is active — chore tracker, ledger, approvals, goals, audit PDF export, and the AI Mentor. The user experiences the full product.
- **Trigger:** Countdown is NULL until `ledger_entry_count >= 1`.
- **Activation Events:** The clock starts only when the first "Value Event" occurs — **Chore Logged**, **Allowance Set**, or **Purchase Recorded**.
- **UI Element:** A "Trial Progress Bar" on the Dashboard labelled **"Trial — [X] days left"** (no marketing euphemisms; the label is literal).
- **Day 15 — Hard Lock:** The entire app redirects to `/paywall`. No read-only mode (except data export — see §18).

### The Day 15 Paywall
The paywall presents three options (see §10 / §15 for regional pricing):

1. **Essential (Lifetime)** — unlocks the chore tracker, ledger, approvals, goals, and audit PDF permanently. One-time payment.
2. **Pro Coach Bundle (Year 1)** — Essential Lifetime + first year of AI Mentor, at a discount vs. buying separately.
3. **Add AI Mentor later** — after purchasing Essential, user can add the AI subscription from the dashboard at any time.

The Pro Coach Bundle is **only offered at Day 15 checkout and on the post-purchase dashboard upsell card**. It is not shown inside the app during the trial — the trial is a product demo, not a discount promotion.

### Post-Paywall State Logic
| Purchase | `has_lifetime_license` | `ai_subscription_status` | Behaviour |
|---|---|---|---|
| Essential only | `TRUE` | `NONE` | Full chore tracker; AI Mentor surfaces locked, showing upsell card. **AI features lock immediately at payment confirmation.** |
| Pro Coach Bundle | `TRUE` | `ACTIVE` (1-year expiry) | Full chore tracker + AI Mentor active. Renews annually unless cancelled. |
| No purchase by Day 15 | `FALSE` | `NONE` | App fully locked. Only `/paywall` and `/export` routes accessible. |

### Governance Modes (unchanged)
- `AMICABLE`: Transaction → notification to other parent.
- `STANDARD`: Transaction → Pending state → required second parent approval → Immutable Ledger Write.

### AI Mentor (Child Service) — Trigger-Based Coaching Only
- **Spending Velocity:** Nudge on "Delayed Gratification."
- **Value Audit:** Challenge high-frequency digital purchases (loot boxes, scam-adjacent goals).
- **Integrity Trigger (EXIF-based):** When a child accumulates 3 consecutive `verification_confidence = 'Low'` proof uploads, the Mentor automatically switches pillar to `LABOR_VALUE` and delivers the **"Hard Work vs. Shortcuts"** lesson. Tone is encouraging, never accusatory. Implemented in `chat.ts → selectPillar()` and `intelligence.ts → queryConsecutiveLowConfidence()`. Resets as soon as the child submits a non-Low upload.
- **Batching Trigger (EXIF-based):** When EXIF `DateTimeOriginal` shows ≥3 chores completed within a 60-minute window in the last 7 days, the Mentor delivers the **"Power of Small Steps"** lesson on building daily habits vs. cramming. Pillar: `LABOR_VALUE`. Implemented in `intelligence.ts → queryBatchingDetected()`. Both triggers can unlock curriculum modules (`01-effort-vs-reward` for integrity, `07-the-patience-tree` for batching) if the child's chat message matches the UNLOCK_MATRIX keywords.
- **Privacy constraint:** EXIF GPS and IP data are never surfaced to child or parent views — they inform the confidence score only. The lesson trigger fires from the confidence score, not from raw GPS/IP.
- **Behavioural Data-Signal Triggers (8 total):** The following triggers are checked in `selectPillar()` before keyword matching. Each maps directly to a Learning Lab module unlock:
  | Trigger | Condition | Module | Pillar |
  |---------|-----------|--------|--------|
  | The Burner | Balance → 0 within 24h of a ledger credit (last 30d) | 04-needs-vs-wants | DELAYED_GRATIFICATION |
  | Stagnant Earner | 0 completions in 14d after >2 completions in prior 14d | 18-money-and-mental-health | LABOR_VALUE |
  | Inflation Nudge | Chore reward increased since child last completed it | 14-inflation | CAPITAL_MANAGEMENT |
  | Crypto Curious | Keywords: Robux/skins/NFT/crypto/bitcoin | 20-cryptocurrency | CAPITAL_MANAGEMENT (keyword only) |
  | Device Swapper | ≥3 distinct IP addresses in 7d (from child_logins) | 05-scams-digital-safety | SOCIAL_RESPONSIBILITY |
  | The Default | ≥2 chores with due_date < today, not yet completed | 12-good-vs-bad-debt | DELAYED_GRATIFICATION |
  | The Hoarder | Balance > £100 AND 0 spending in 60d | 13-compound-growth | CAPITAL_MANAGEMENT |
  | Social Pinger | Keywords: "how much did [Name] earn", jealous, compare | 18b-social-comparison | SOCIAL_RESPONSIBILITY (keyword only) |
  Implemented in `intelligence.ts` (query functions) and `chat.ts` (selectPillar + UK/US/PL prompt injections + UNLOCK_MATRIX).
- **Independence Score:** Tracks autonomy (child-initiated vs. parent-initiated actions).
- *Full trigger registry lives in the learning lab doc (`08-learning-lab.md`), not here.*

### AI Advisor (Parent Service)
- Delivers "Scouting Reports" on consistency and discipline.
- Gated behind active AI subscription.

---

## 4a) Licensing Model — One Lifetime License + Optional AI Subscription

> This section formalises the licensing decisions locked in V5.0. Changes after first paid signup require a migration plan and user notifications.

### Product 1: Essential (Lifetime License)
- **What it unlocks:** Chore assignment and approval, ledger, goals, audit PDF export, parental dashboards, co-parent bridge.
- **Price:** £34.99 (UK) · 99 PLN (PL, intro) · $49.99 (US). One-time payment.
- **State:** `has_lifetime_license = TRUE`.
- **Expiry:** Never.
- **Lock behaviour:** None after purchase. Lifetime access to all chore-tracker surfaces.

### Product 2: AI Mentor (Annual Subscription)
- **What it unlocks:** Learning Lab modules, AI-triggered coaching nudges, child-facing AI Mentor chat (scoped to curriculum triggers), parent-facing Scouting Reports.
- **Price:** £19.99 / yr (UK) · 59 PLN / yr (PL) · $24.99 / yr (US). First-year available at a discount in the Pro Coach Bundle.
- **State:** `ai_subscription_status = 'ACTIVE'`.
- **Prerequisite:** `has_lifetime_license = TRUE`. The AI subscription cannot be purchased without the Essential Lifetime License.
- **Trial coverage:** Active during the initial 14-day whole-app trial, for all users.
- **Post-Day-15 if user buys Essential only:** AI features lock **immediately** on payment confirmation. Dashboard shows upsell card for AI Mentor. The user has seen the product during trial and can opt in later.
- **Auto-renewal:** `ai_auto_renew = TRUE` by default. User can toggle off in dashboard at any time.
- **Cancellation:** See §18 for statutory rights and implementation requirements.

### Invariants Enforced by Middleware
1. **Never bundle the two licence checks.** `has_lifetime_license` and `ai_subscription_status` are checked independently by two separate helper functions. There is no `hasAccess()` that collapses them.
2. **AI without Essential is impossible.** Stripe webhook must reject any AI subscription activation where `has_lifetime_license = FALSE`.
3. **Trial state is immutable once set.** `trial_start_date` is write-once. Resetting the trial requires a manual `payment_audit_log` entry from a support operator.

---

## 5) Security, Privacy & Constraints
* **Auth constraints:** Changing governance modes requires a "Mutual Consent Handshake."
* **Data Minimisation (Child Protection):**
    * **Identity:** Never mandate legal names. Use `display_name` for all UI / AI interactions.
    * **Authentication:** Access managed via 6-digit `family_invite_code`. No child email required.
* **Messaging Constraint:** **STRICT BAN** on human-to-human chat functionality between parents.
* **Trial State Persistence:** `trial_start_date` and licensing state stored in D1. `/paywall` redirect handled via Worker Middleware. Middleware checks `has_lifetime_license` first; if `FALSE` and `trial_end_date < NOW()`, redirect to `/paywall`.
* **Subscription cancellation rights:** See §18.

---

## 6) Internationalisation & Performance
* **Trilingual UI:** Full support for English (EN-GB / EN-US) and Polish (PL).
* **Linguistic Freedom:** Users may toggle UI / AI language regardless of payment currency.
* **Currency Rebase Hook:** SQL function to batch-convert ledger units for families moving regions, creating a "Rebase" ledger entry to preserve the SHA-256 chain.
* **Regional AI Personas:**
    * **UK:** Collaborative tone.
    * **US:** Direct tone. Benchmarks in USD. Uses "Allowance" and optional "Job / Task" strings (see §14).
    * **Poland:** Direct / formal tone ("Neutralny Arbiter"). Local cost-of-living benchmarks (Groszy / PLN).

---

## 7) Repo & Code Conventions
* **Patterns to follow:**
    * Financial models must use LaTeX.
    * AI must use "Process Language" (growth mindset).
    * All currency must be stored as integers (smallest unit — pence / grosz / cent).
    * Licensing checks for chore tracker and AI mentor must be **separate function calls**, never combined.
* **Patterns to avoid:**
    * **NO** human-to-human chat.
    * **NO** deletion of ledger entries.
    * **NO** "Small Talk" in the Polish AI persona.
    * **NO** bundled paywall logic — the chore tracker lock and AI mentor lock are independent.

---

## 8) Payment & Licensing Schema
* **Columns on `families`** (see §3 for authoritative list):
    * `trial_start_date`, `trial_end_date`, `has_lifetime_license`, `lifetime_license_purchased_at`, `ai_subscription_status`, `ai_subscription_started_at`, `ai_subscription_expiry`, `ai_auto_renew`.
* **Table:** `payment_audit_log` — immutable Stripe transaction record.
* **Indices:** `idx_family_trial`, `idx_family_lifetime_license`, `idx_family_ai_subscription`.
* **Stripe product mapping:**
    * **Essential Lifetime** — one-time product, one Stripe price ID per region.
    * **AI Mentor Annual** — recurring product, one Stripe price ID per region.
    * **Pro Coach Bundle** — composite checkout: one `invoice_items` entry for Essential + one for AI Mentor annual, sold at a bundled discount. Stripe treats these as two separate products under one checkout session. This preserves clean renewal logic (the AI subscription renews at its own price, not the bundle price).

---

## 9) Known Issues / Technical Debt
* **Migration Debt:** Requires batch-insert scripts for Firebase-to-D1.
* **UI Bloat:** Explicit directive to focus strictly on the Ledger and the AI Coach.
* **Pricing model is now frozen post-first-signup.** Any future change to trial length, refund policy, or product structure requires a documented migration path and statutory user notifications (§18).

---

## 10) Regional Pricing & Anti-Arbitrage (PPP Optimised)

### UK (GBP)
- **Essential (Lifetime):** £34.99
- **AI Mentor (Annual):** £19.99/yr
- **Pro Coach Bundle (Year 1 only):** £44.98 *(£10 off vs. buying separately; AI renews at £19.99/yr thereafter)*

### Poland (PLN) — Introductory Launch Pricing
- **Essential (Lifetime):** 99.00 PLN *(Regular: 129 PLN)*
- **AI Mentor (Annual):** 59.00 PLN/yr
- **Pro Coach Bundle (Year 1 only):** 139.00 PLN *(Regular: 159 PLN; AI renews at 59 PLN/yr thereafter)*

### The Guardrail
- **Currency Lock:** Fixed at registration based on selected Region.
- **Anti-Arbitrage:** Worker-side validation of `PaymentMethod.card.country` vs. Stripe Price ID region. UK cards blocked from PLN prices and vice versa.
- **Renewal pricing:** AI Mentor always renews at the **standalone** annual price, never at the bundle price. Stripe Price IDs must enforce this — do not create a recurring price ID tied to the bundle discount.

---

## 11) Implementation Backlog (STRICT SCOPE)
1. **D1 Schema Update:** Transition legacy data to V5.0 schema (Nicknames, Governance modes, split licensing state).
2. **Registration UI:** 4-stage Shadcn flow (Identity → Constitution → Child → Bridge).
3. **Double-Lock Logic:** Implementation of "Pending" status for Standard Governance mode.
4. **Stripe PPP Guard:** Worker-side check for Card Country vs. Currency.
5. **The 14-Day Trial Lock:** Middleware for trial countdown and `/paywall` redirect.
6. **Split Paywall UI:** Day 15 paywall offers Essential, Pro Coach Bundle, and "Add AI later" paths.
7. **AI Subscription Add-On Flow:** Post-purchase dashboard upsell card for users who bought Essential only.
8. **AI Auto-Lock:** On Essential-only purchase, AI Mentor surfaces lock immediately at payment confirmation.
9. **Cancellation Flow:** Self-serve subscription cancellation (§18).
10. **Renewal Reminder Notifications:** Statutory notices before auto-renewal (§18).
11. **The Migration Hook:** SQL utility for historical currency rebasing.

---

## 12) Adaptive Onboarding & Tone-Switch Logic
* **Objective:** Contextualise "Friction Points" (like Email Auth) based on the chosen Governance Mode to maximise conversion and trust.

### 12.1 Messaging Matrix (Co-Parent Invitation)
* **`governance_mode == 'AMICABLE'`**
    * **Header:** "Secure Your Family Record"
    * **Value Prop:** Focus on "Privacy," "Device Sync," and "Shared Goals."
    * **Email Auth Reason:** "To keep your child's data secure and synchronised across all devices."
* **`governance_mode == 'STANDARD'`**
    * **Header:** "Establish Verified Accountability"
    * **Value Prop:** Focus on "Integrity," "Audit Trails," and "Verification."
    * **Email Auth Reason:** "To ensure every approval is tied to a unique Digital Signature for a high-integrity audit trail."

### 12.2 Technical Hook
* **Component:** `InviteCoParentCard.tsx` (Shadcn Alert / Info).
* **Logic:** Conditional rendering of the `headerText` and `descriptionText` based on the `family.governance_mode` state stored in D1.
* **Child Onboarding (Global):** Regardless of mode, child access remains "Privacy-First" using the 6-digit `family_invite_code` only (no email required).

---

## 13) The "Neutrality" Clause
* **Instruction for AI:** The AI Mentor must never use "Legal" or "Court" terminology unless explicitly asked by the parent.
* **The "Peace-Pipe" Reframe:** Refer to the ledger as the "Shared Truth" for Amicable families and the "Verification Vault" for Standard families.
* **Household composition neutrality:** AI Mentor and curriculum copy must use singular / plural parent references interchangeably ("your parent or parents"). Never assume two parents, never assume one, never assume household composition.

---

## 14) Global Region & Locale Logic
* **Region Trigger:** In Stage 2 (Constitution), user must select a Region: `UK`, `PL`, or `US`.
* **The "Allowance" Toggle:**
    - If `Region == US`: Swap all "Pocket Money" strings for "Allowance."
    - If `Region == US`: Swap "Chore" for "Job / Task" (optional, based on user preference).
* **Currency Anchor:**
    - `US` → USD ($).
    - `UK` → GBP (£).
    - `PL` → PLN (zł).
* **2026 Compliance (COPPA / GDPR):**
    - US Region triggers a "COPPA-Compliant Notice" during child onboarding (supported by the nickname-only strategy).
    - UK / PL Regions trigger GDPR-K compliance paths.

---

## 15) Regional Pricing IDs (USD)
* **US Market (USD):**
    - **Essential (Lifetime):** $49.99
    - **AI Mentor (Annual):** $24.99/yr
    - **Pro Coach Bundle (Year 1 only):** $69.99 *(AI renews at $24.99/yr thereafter)*
* **Logic:** Stripe Worker must verify `PaymentMethod.card.country == 'US'` to unlock USD pricing IDs.

---

## 16) The "Sovereign Ledger" Philosophy
* **Core Rule:** Morechard is a **Record of Ownership**, not a **Transfer of Funds**. The ledger exists to give families — especially those across two households — a shared, unambiguous record of what was earned and when.
* **AI Instruction:** The Mentor must refer to the balance as **"Your Total Funds"** or **"Available Balance."** It should never imply the app *is* a bank account.
* **The "Settlement" Nudge:** When a large purchase is logged, the AI should nudge the child: *"You've logged this. Make sure you've settled the physical payment with your parent or parents."*
* **The "Audit" Value:** The ledger's value isn't moving money — it's knowing the balance. No more "how much does she owe him for the grass cutting?" friction between households.
* **Curriculum implication:** Any learning lab module that teaches a real-world financial instrument Morechard does not simulate (banking, interest, stocks, subscriptions) must open with an "Honest Framing" preamble — see `08-learning-lab.md` for the technique registry.

---

## 17) Brand Identity — The Orchard Layer

### 17.1) Brand Name
**Morechard** (formerly MoneySteps). The name evokes an orchard — growth, nature, seasons, harvest.

### 17.2) The Core Rule
Functional UI (buttons, headers, navigation, form labels) must remain plain English.
Orchard metaphors appear **only** in: Empty States, Loading Screens, Notifications, Success Celebrations, AI tip introductions, and Learning Lab Hooks / Closing Lines (see §19 and `08-learning-lab.md`).
They are a charming coat of paint — never a replacement for clarity.

**Never replace** the words "Money," "Pounds," "Zloty," "£," "zł," "$" with a metaphor.

---

### 17.3) Empty State Copy

**Empty Chores screen (primary entry point — this is the first screen a new user sees)**
- Headline: `Your plot is ready.`
- Body: `No chores added yet. Add the first one to get started.`

**Zero Savings screen**
- Headline: `The grove is quiet for now.`
- Body: `Every big harvest starts with a single seed. Set a savings goal to get growing.`

**No AI Mentor subscription (post-paywall, Essential-only users)**
- Headline: `The Head Gardener's quarters are closed.`
- Body: `Add the AI Mentor to unlock behaviour-based coaching for [child's display name]. £19.99/yr.`

---

### 17.4) Loading Messages (rotate randomly, max 40 chars)
1. `Checking the soil…`
2. `Letting the roots settle…`
3. `Sunlight reaching the grove…`
4. `Counting what's in the ground…`
5. `Your orchard is waking up…`

---

### 17.5) Success & Celebration

**Big savings goal reached ("Harvest" moment)**
- Headline: `Harvest time. 🌿`
- Body: `You saved every penny and reached your goal — that's £[X] grown from nothing. Well done.`

**Task completion animation**
- A single SVG leaf (~20px) rises from the ticked checkbox, drifts upward ~40px with a gentle arc, fades out over ~600ms.
- Runs once only. No sound. No bounce. Invisible unless you're watching for it.

---

### 17.6) AI "Head Gardener" Tip Template

```
The Head Gardener has a suggestion.
[Tip in plain language — always numbers-first. E.g., "Setting aside £2 a week means you'd reach your goal 3 weeks earlier."]
Want to give it a try?
```

**Rules:**
- Intro line is always identical — it becomes a recognisable signal.
- Tip body is always plain English, numbers first. No metaphor inside the tip.
- CTA is always a soft question. Never "Tap here."

---

### 17.7) Push Notification Copy

```
🌧 Your allowance has arrived.
£[X] landed in your account — a fresh start for the week. Open the app to see it grow.
```

This was the original illustrative example. Shipped v1 (native iOS/Android push, see `docs/superpowers/specs/2026-08-11-push-notifications-design.md`) covers six real trigger events instead — chore submitted (to parents), chore approved & paid, chore needs a re-do, new chore assigned, goal boosted, and gift/contribution received — and the actual copy is plain and direct with no Orchard metaphor, e.g. `"{chore} approved! +{amount} added"`, matching the child-facing-language rule that child-facing UI copy skips the metaphor layer. Treat the table below as the general house-style default; push notifications are the one row where the shipped implementation is plainer than the rule.

---

### 17.8) Orchard Language Usage Table

| Context                       | Orchard language       | Plain language                        |
|-------------------------------|------------------------|---------------------------------------|
| Empty states                  | ✅ One metaphor line   | ✅ Functional subtext always follows  |
| Loading screens               | ✅ Full metaphor       | —                                     |
| Success / celebrations        | ✅ Headline word only  | ✅ Numbers and facts in body          |
| Buttons & nav                 | ❌ Never               | ✅ Always                             |
| AI tips                       | ✅ Intro line only     | ✅ Tip content always plain           |
| Push notifications            | ✅ One word / phrase   | ✅ Amount in first sentence           |
| Learning Lab — Hook (Act 1)   | ✅ One-line opener     | —                                     |
| Learning Lab — Lesson (Act 2) | ❌ Never               | ✅ Always                             |
| Learning Lab — Lab (Act 3)    | ❌ Never               | ✅ Always                             |
| Learning Lab — Quiz (Act 4)   | ❌ Never               | ✅ Always                             |

---

## 18) Refund Compliance (No Subscriptions)

> **Statutory basis:** Consumer Rights Act 2015; Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013. Applies to UK users; PL users covered by equivalent EU distance-selling rules.
>
> **All products are ONE-TIME payments.** There are no subscriptions, no auto-renewal, and nothing to "cancel" in the recurring sense — see `project_pricing` (Complete £44.99, Complete AI £64.99, Shield AI £149.99, AI Mentor upgrade £29.99, all one-off). The former "AI Mentor Annual Subscription" model, its renewal notifications, and its dedicated "Cancel AI Mentor" UX requirement are retired; the sections below described that model and have been removed. The only "cancellation" that exists today is the 14-day cooling-off refund (§18.1), already shipped in `app/src/components/settings/sections/BillingSettings.tsx` and `worker/src/routes/stripe.ts` (`handleCancelPlan`, `DELETE /api/billing/cancel`).

### 18.1 14-Day Cooling-Off Period
- **Any paid plan (Complete / Complete AI / Shield AI):** A UK user has a **statutory 14-day right to cancel** and obtain a full refund from the date of purchase, provided they have not consented to the supply of digital content starting within the cooling-off period AND acknowledged that doing so waives the right to cancel. Implementation: the paywall checkout must present a clear "I want immediate access and understand I waive my 14-day refund right" checkbox. If the user declines, the app remains locked until Day 14 has passed OR they cancel via the refund flow.
- **Refund mechanics:** Full refund issued via Stripe refund API within 14 days of cancellation request. `payment_audit_log` records both the original charge and the refund as separate immutable rows. Since every plan is one-off, there is no "renewal" cooling-off window to track — the 14 days run once, from the single purchase date.
- **No dark patterns:** Cancellation takes no more steps than purchase — one confirmation dialogue is the maximum allowed. A user emailing the designated support address stating they wish to cancel is legally binding; the support system must treat such emails as cancellation requests, not support tickets.

### 18.2 Data Export
- All users — including those whose trial has expired without purchase — have access to `/export`. Export includes:
    - Full chore ledger (CSV).
    - All goals created and their outcomes (CSV).
    - Child display names and associated transactions (JSON).
- Export is always free, always available, never gated behind purchase.
- GDPR / UK-GDPR data portability compliance: export must be machine-readable and include all personal data Morechard holds on the family.

### 18.3 Account Deletion
- Account deletion available via Settings → Account → Delete Account.
- Deletion is a soft delete followed by hard delete after 30-day grace period (allows accidental-deletion recovery).
- Hard delete removes all PII. Ledger records are anonymised (replace `parent_id` / `child_id` with hashed identifiers) but not deleted — preserves the SHA-256 chain and satisfies §3's no-deletion constraint.

---

## 19) Curriculum Tier Naming & Experience Level

> This section formalises the curriculum structure referenced throughout `08-learning-lab.md`. Details of modules, triggers, and pedagogical design live in that document.

### 19.1 Four-Tier Structure
The curriculum is structured in four age tiers, of which three are built for launch:

| Tier | Age Range | Status | Metaphor Label | Functional Label |
|------|-----------|--------|----------------|------------------|
| Level 1 | 6–9 | **Phase 2 (reserved)** | Seed | Level 1 |
| Level 2 | 10–12 | **Launch** | Sprout | Level 2 |
| Level 3 | 13–15 | **Launch** | Sapling | Level 3 |
| Level 4 | 16+ | **Launch** | Oak | Level 4 |

At launch, Level 1 is displayed in the UI as **greyed-out with a "Coming 2026" label**. Parents selecting a child under 10 during registration receive a message explaining that curriculum content for younger children is in development and the child's data will be ready to use when Level 1 launches.

### 19.2 Experience Level Toggle
Each child has an `experience_level` setting on their profile: `ORCHARD` (default) or `CLEAN`.

- **`ORCHARD`** (default for Level 1 and Level 2, ages 6–12): Tier labels displayed as metaphor names — **Seed / Sprout / Sapling / Oak**. Learning Lab Hooks use one-line Orchard openers. Loading and Empty states retain full Orchard metaphor. This is the default for younger children.
- **`CLEAN`** (default for Level 3 and Level 4, ages 13+; also available as opt-in for any child): Tier labels displayed as functional names — **Level 1 / Level 2 / Level 3 / Level 4**. Learning Lab content is rendered in "Clean Persona" (see curriculum doc). Orchard metaphors persist only in Loading screens and Success celebrations.

Parents can toggle a child's `experience_level` in Settings. The toggle does not re-trigger modules — it changes presentation, not progression.

### 19.3 Tier-Level Interaction with Licensing
- Access to Learning Lab modules requires `ai_subscription_status = 'ACTIVE'`.
- Without the AI subscription, the Learning Lab tab on the child's app shows the upsell card from §17.3.
- Tier progression (`age_tier` advancement) is independent of subscription state — the child's age tier updates whether or not the AI is subscribed. If a family lapses and re-subscribes, the child resumes at their current tier with all previously unlocked modules preserved.