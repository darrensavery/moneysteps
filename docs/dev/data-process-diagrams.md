# Data Process Diagrams (Lucid)

Swimlane diagrams for Morechard's key data flows, maintained in the team Lucid account. Each diagram traces the actual implementation (route, file:line, D1 tables) as of the date noted, grounded by direct codebase inspection — not idealized/aspirational flows. Where a described capability isn't built yet, the diagram says so explicitly (dashed box) rather than inventing steps.

**Maintenance rule:** see `CLAUDE.md` → "Data Process Diagrams — Maintenance Rule". If you change the behavior of any process below (new route, changed table, different step order, new third-party call), update the linked Lucid diagram in the same change, or open a follow-up task to do so.

| # | Process | Lucid Link | Format | Created |
|---|---------|-----------|--------|---------|
| 1 | Parent Registration & Authentication | [Open](https://lucid.app/lucidchart/a4cebae3-b277-4569-b111-e1b037adb5ff/edit) | Single-axis swimlane | 2026-08-03 |
| 2 | Child Profile Creation & Biometric Enrollment | [Open](https://lucid.app/lucidchart/3f37679d-a10e-4e92-b44c-693b5fd6a9d1/edit) | Single-axis swimlane | 2026-08-03 |
| 3 | Chore-to-Ledger Transaction | [Open](https://lucid.app/lucidchart/51e0392d-38a1-46cf-87fb-8b6924e18e1c/edit) | Single-axis swimlane | 2026-08-03 |
| 4 | Data Access / Export | [Open](https://lucid.app/lucidchart/0e109995-ab0c-4fb0-b186-a891b44f2f83/edit) | Single-axis swimlane | 2026-08-03 |
| 5 | Data Erasure | [Open](https://lucid.app/lucidchart/3ae0c3fa-c0f5-4861-8443-b73cb0e88f99/edit) | Single-axis swimlane | 2026-08-03 |
| 6 | AI Mentor Weekly Briefing | [Open](https://lucid.app/lucidchart/2f4b183b-6502-4533-9d76-63ae2165f1f9/edit) | Single-axis swimlane | 2026-08-03 |
| 7 | Payment Processing (Stripe) | [Open](https://lucid.app/lucidchart/edaf6940-d78e-4bf8-9d6d-6cf9e31f4707/edit) | Single-axis swimlane | 2026-08-03 |
| 8 | Court-Ready PDF Export & Ledger Verification | [Open](https://lucid.app/lucidchart/c7e8f785-f431-40b9-8cc8-028133b6ea33/edit) | Single-axis swimlane | 2026-08-03 |
| 9 | Analytics Consent & Collection | [Open](https://lucid.app/lucidchart/809923b0-7aa6-43d5-b86b-e07c38aa44ea/edit) | Single-axis swimlane | 2026-08-03 |
| 10 | Support Ticketing & AI-Assisted Triage | [Open](https://lucid.app/lucidchart/f68a53e0-b9ee-427d-a5c4-6b7128ea1bdf/edit) | Single-axis swimlane | 2026-08-03 |
| 11 | Error Tracking (Sentry) | [Open](https://lucid.app/lucidchart/90fb3ab9-a1e0-4c1e-af17-c576853dc4c8/edit) | Single-axis swimlane | 2026-08-03 |
| 12 | Goal Creation & Funding (Savings Grove) | [Open](https://lucid.app/lucidchart/b8a672b8-4b2b-4d61-bb9a-28f3a62b8c1f/edit) | Single-axis swimlane | 2026-08-03 |
| 13 | Chore Creation & Rate Guide Suggestion | [Open](https://lucid.app/lucidchart/341d0169-fdb9-4475-bb02-0b3ffd426fa2/edit) | Single-axis swimlane | 2026-08-03 |
| 15 | Impulse Speed Bump (Spend Guard) | [Open](https://lucid.app/lucidchart/25e354b5-7d21-408d-868c-f24838e7aad3/edit) | Single-axis swimlane | 2026-08-03 |
| 16 | Child Nudges & Velocity Alerts | [Open](https://lucid.app/lucidchart/401aa5df-6e6c-4a0b-af4a-5ec90fc9600f/edit) | Single-axis swimlane | 2026-08-03 |
| 17 | Weekly Insights & Family Audit | [Open](https://lucid.app/lucidchart/1732ef06-3db5-4481-931c-18cb847f118b/edit) | Single-axis swimlane | 2026-08-03 |
| 18 | Learning Lab Progression | [Open](https://lucid.app/lucidchart/7bee91be-5b73-41dc-b27c-c08279452b12/edit) | Single-axis swimlane | 2026-08-03 |
| 19 | Payment Bridge / Payout Delivery | [Open](https://lucid.app/lucidchart/048a3e79-259c-43cd-bcc2-95c493158922/edit) | Single-axis swimlane | 2026-08-03 |

Note: #14 (Chore Completion Loop) was folded into #3 (Chore-to-Ledger Transaction) rather than documented separately — the approval UI and the ledger-write mechanics are one continuous flow in the codebase.

## Notable gaps surfaced while building these

- **DSAR self-service portal (#4, #5):** `docs/superpowers/specs/2026-07-17-dsar-portal-design.md` and the accompanying plan describe a public, unauthenticated access/erasure request flow. As of 2026-08-03 this is **spec'd but not implemented** — no `dsar_requests` table, no `dsarExecution.ts`, no `/api/dsar/*` routes exist in `worker/src`. Today's real data-access and erasure flows both require an authenticated parent session.
- **Stripe payment processing (#7):** despite `CLAUDE.md` Phase 7 showing "Integrate Stripe with PPP" and "Build Day 15 Paywall" as unchecked, the core Stripe checkout/webhook/license-grant flow **is fully built** (`worker/src/routes/stripe.ts`). Only PPP currency-adjusted pricing and Stripe Tax invoicing remain outstanding — the roadmap checkboxes were describing those two sub-items, not the integration itself.

## Also created (superseded)

An earlier dual-axis (Actor × Platform matrix) version of Process 1 was built and then superseded per user decision in favor of the standard single-axis format used across this whole set: `https://lucid.app/lucidchart/900e34c0-7ba7-4c65-b731-6b5d7c74b0c1/edit`. Kept for reference; not part of the maintained set above.
