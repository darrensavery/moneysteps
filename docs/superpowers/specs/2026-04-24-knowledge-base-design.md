# Morechard Knowledge Base — Design Spec
**Date:** 2026-04-24
**Status:** Approved

---

## Overview

A Freshdesk-hosted knowledge base covering all parent and child-facing help content for the Morechard PWA. Articles are embedded in-app via the Freshdesk widget and publicly accessible at `morechard.freshdesk.com` (free tier; custom domain upgrade deferred).

**Scope of this project:**
- Freshdesk category and article structure
- ~55–65 fully drafted EN articles (parent + child)
- PL article placeholders with tone guidelines
- Freshdesk widget integration into the Morechard PWA
- Role-aware article surfacing (parent vs. child sessions)

---

## Platform Decision

**Freshdesk Free Tier** — chosen over Notion, GitBook, and a custom Cloudflare Pages solution.

Key reasons:
- Built-in full-text search
- Ticket deflection widget (embeddable in PWA)
- Zero infrastructure maintenance for a solo dev
- Multilingual support with locale-based article routing
- Scales to custom domain (`help.morechard.com`) on paid tier when revenue justifies it

Public URL: `morechard.freshdesk.com`
Future: CNAME to `help.morechard.com` on Freshdesk Growth plan.

---

## Audience

**Parents** — billing, subscriptions, chore management, ledger, co-parenting, legal export, AI Mentor, Learning Lab, safety, troubleshooting.

**Children (ages 10–16)** — chores, earnings, goals, payments, learning modules, AI Mentor introduction.

---

## Freshdesk Category Structure

### Category 1: For Parents

| Folder | Articles |
|--------|----------|
| Getting Started | Registration, adding children, family setup, meet your AI Mentor |
| Chores & Approvals | Creating chores, approving completions, rejecting completions, rate guide, how to resolve a disagreement (process) |
| Pocket Money & Your Permanent Record | How earnings work, what the ledger shows, tamper-proof history explained, Uproot warning (permanent record will be lost) |
| Goals & Savings | Creating a goal, boosting a child's goal, how boosting works, purchasing when a goal is reached |
| Shared Expenses | What shared expenses are, how to log them |
| The Learning Lab | Curriculum overview, financial literacy standards alignment, module library overview, tracking your child's progress, quizzes & rewards |
| The AI Mentor | What the AI Mentor is, activating the AI Mentor (£19.99/yr), what the Mentor discusses with children, privacy & safety boundaries |
| Co-Parenting & The Shield Plan | The Shield Plan explained, Complete vs Shield comparison, tamper-proof records for legal use, generating a court-ready PDF export |
| Billing & Subscriptions | Plans overview, upgrading your plan, cancelling, Stripe portal, activating the AI Mentor add-on |
| Safety & Privacy | How children's data is handled, password resets, co-parent permissions, what children can and cannot see |
| Troubleshooting | Notification issues, app problems, "We still can't agree — what now?" (escalation guide), contacting support |
| Settings & Account | Changing account details, data export, deleting your account (Uproot — full how-to) |

**Uproot appears in two places by design:**
- *Pocket Money & Your Permanent Record* — as a warning ("if you Uproot, this permanent record is erased immediately and cannot be recovered")
- *Settings & Account* — as the functional how-to (requires typing `UPROOT` to confirm)

### Category 2: For Children *(Orchard Lead voice)*

| Folder | Articles |
|--------|----------|
| Getting Started | Joining with a code, what the app does, meeting your Mentor |
| Chores | Marking a chore done, what happens after you mark it done, why a chore was rejected, disagreeing with a decision |
| My Earnings | How my balance works, what the permanent record shows |
| Saving for Goals | Creating a goal, tracking progress, what happens when I reach my goal |
| Getting Paid | How payment works, what "paid out" means |
| Learning & Modules | What the Learning Lab is, how to complete a module, quizzes and rewards, who is the AI Mentor? |

**Estimated total: 55–65 articles**

---

## Article Format

### Parent Articles — 4-Part Structure

1. **What this is** — one sentence explaining the feature
2. **How to do it** — numbered steps, no jargon
3. **Things to know** — edge cases, limits, caveats
4. **Still need help?** — "Contact our support team" (links to Freshdesk ticket form)

**Tone:** Professional, precise, concise. Bank-grade authority — a reliable witness, not a chatty assistant. Technical terms (Uproot, Shield Plan, Permanent Record) explained on first use within each article. No filler.

**Canonical example — The Ledger:**

> **What this is:** The Ledger is the permanent, tamper-proof record of every transaction and chore completion in your family account.
>
> **How to do it:**
> 1. Open the Pocket Money tab.
> 2. Tap on a child's name.
> 3. Select View Ledger to see the full history.
>
> **Things to know:** On the Shield Plan, these records are locked and cannot be edited by parents or children, ensuring they are court-ready. If you choose to Uproot (delete) your account, this permanent record is erased immediately and cannot be recovered.
>
> **Still need help?** Contact our support team.

---

### Child Articles — 3-Part Structure

1. **What's happening** — plain one-sentence explanation
2. **Here's what to do** — numbered steps, short sentences
3. **Still confused?** — "Ask a parent to check the app, or they can contact our support team."

**Tone:** Orchard Lead voice — warm, direct, capable. Treats the child as a real-world participant, not a gamified user. Short sentences. No emojis. No condescension.

**Exception — "Who is the AI Mentor?":** Uses a slightly curious, inviting tone. Frames the Mentor as a partner in the Orchard, not a teacher. The child remains the agent; the Mentor guides alongside them.

---

## Multilingual (PL)

- EN articles authored first (full drafts)
- PL placeholders created for all articles: same titles, same 4-part / 3-part structure, marked `[PL — PENDING TRANSLATION]`
- Child PL articles use the **Mistrz Sadu** persona: direct, formal, no small talk. Financial literacy framed as a serious skill to be mastered — commands respect, not comfort.
- Freshdesk's built-in locale detection routes PL users to PL articles automatically. No additional JS logic required.

---

## Freshdesk Widget Integration

### Placement
- Persistent **"?" help icon** in the bottom navigation bar, visible on all screens for both parent and child views
- On tap: opens Freshdesk widget as a slide-up panel — search box at top, suggested articles below

### Role-Aware Surfacing
Widget is initialised with a role tag after auth resolves:

| Session | Tag | Articles surfaced |
|---------|-----|-------------------|
| Parent | `role_parent` | For Parents category |
| Child | `role_child` | For Children category |
| System-wide | `role_all` | Critical updates, service status |

### Technical Implementation
- Freshdesk widget script added once to `index.html` (async, non-render-blocking)
- Widget initialised in a `useEffect` on app mount; role tag set after auth resolves
- No Cloudflare Worker changes required — purely frontend

### Uproot Safeguard
The "Contact Us" form inside the widget includes a **"Reason for Contact" dropdown**. When a user selects "Delete my account / Uproot," an auto-injected disclaimer is appended to the form body:

> "Warning: Uprooting your account permanently erases your Permanent Record, including all Shield Plan data. This cannot be recovered. Please read the Uproot guide before proceeding."

This acts as a secondary deflection layer before a support agent is involved.

### Contextual Search — Phase 2 (Planned)
Route-aware `useEffect` enhancement deferred to v2. When implemented:
- `/ledger` → pre-surfaces "Understanding your Permanent Record"
- `/learning-lab` → pre-surfaces "How to earn rewards"
- Additional routes mapped as the app grows

Designed as a one-line addition to the existing `useEffect` — no architectural change required.

### What the Widget Does Not Do
- Does not replace in-app error messages or validation
- Does not require a Freshdesk login from the user

---

## Delivery Format

All articles delivered as **markdown files, one per category**, organised sequentially. Ready to paste into Freshdesk's article editor without cross-referencing other files.

PL placeholders included in the same files, below each EN article, clearly marked.

---

## Out of Scope (This Project)

- Freshdesk account creation and onboarding (Freshdesk's own flow)
- Widget JS snippet generation (generated by Freshdesk per account)
- Custom branding of the Freshdesk portal (colour, logo — separate task)
- Custom domain setup (`help.morechard.com`) — deferred to paid tier
- PL article translation (placeholders provided; translation is a separate task)
- Contextual search (Phase 2)
