# Teen Mentor Chat — Design Spec

**Date:** 2026-08-04
**Status:** Approved for planning
**Supersedes context:** `docs/governance/ai-inventory.md` — AI System 2 (Child Mentor Chat), decommissioned 2026-07-16. This is a fresh feature, not a resurrection: new tables, new safety pipeline, new consent flow. The old `chat_history` / `chat_rate_limits` tables remain dead and subject to the standard purge; nothing here writes to them.

## Why

Real feedback from teenagers using Morechard indicates they'd value being able to talk through money decisions with the AI Mentor directly, not just receive one-way nudges/briefings. The original chat endpoint was killed because it shipped with no moderation layer, no crisis-escalation path, no confirmed minor-consent basis, and no legal sign-off — not because chat itself is unbuildable. This spec satisfies the four conditions the governance doc set for ever reconsidering it:

1. Legal-shaped consent basis for minor free-text (teen-only, fully parent-visible — see below)
2. A co-parenting-aware design that keeps chat out of the court-submissible ledger/Shield AI export
3. A real human escalation path for self-harm/abuse-adjacent content
4. This spec itself, as the audit trail the original launch lacked

## Scope

**In scope:** a topic-locked, moderated chat surface between a teen (13+) and the AI Mentor, covering money, chores, and financial literacy only. Personality: supportive, motivating, honest, and firm-but-fair when necessary — reflects the teen's thinking back to them and encourages their own decision-making rather than deciding for them (matches the existing Seedling/Professional nudge voice, extended into a conversational format).

**Out of scope (this iteration):** children under 13 (they keep the existing templated nudge system only), any use of chat content in the hash-chained ledger or Shield AI forensic PDF export, any new payment/pricing SKU (this is bundled into the existing AI Mentor tier).

## Architecture

Reuses the existing OpenAI relationship already live for AI System 1 (`worker/src/routes/insights.ts`, `gpt-4o-mini`) — no new vendor.

### Safety pipeline

Every teen message passes through three layers before a response reaches the child:

1. **Pre-check — OpenAI Moderation API.** Every inbound message is scored for self-harm, violence, and sexual-content categories before it reaches the mentor model.
2. **Topic-lock system prompt.** The mentor model is instructed to discuss money, chores, and financial literacy only, in the tone described above, and to never make decisions on the teen's behalf.
3. **Post-check + crisis classifier.** A second pass on the input (informed by the moderation score) and the model's own output routes to one of three outcomes:
   - **Off-topic** → model redirects gracefully in-chat ("that's outside what I can help with — want to talk to a parent about it?"). No escalation, no logging beyond the normal message record.
   - **Distress / self-harm signal** → in-chat crisis resources shown immediately to the teen, AND a real-time alert fires to both parents. No moderation queue or delay — there is no 24/7 human moderator, so the alert must reach a human who knows the child directly and immediately.
   - **Abuse-pattern signal (parent potentially implicated)** → in-chat child-protection resources (NSPCC/Childline-style reporting routes) shown to the teen. **Parents are explicitly NOT notified** on this branch, since a parent may be the source of risk. This requires the classifier to distinguish "I'm struggling" from "a parent is hurting me" — both categories need explicit test coverage (see Testing).

### Data model

New tables (do not reuse or resurrect the deleted `chat_history` / `chat_rate_limits` tables):

- **`mentor_chat_messages`**
  `id, family_id, child_id, role ('child' | 'assistant'), content, moderation_flags (json, nullable), created_at`
  Only written for accounts flagged as teen (13+) at the D1 level — the age gate is enforced server-side against the child's stored birth year on every write, not just hidden client-side.

- **`mentor_chat_escalations`**
  `id, message_id, escalation_type ('distress' | 'abuse_pattern'), parents_notified (bool), created_at`
  A separate audit table so the escalation history survives independently of message retention policy, and so "was a parent notified, and when" is a single indexable fact rather than something reconstructed from message content.

**Retention & export boundary:** chat messages are excluded from the hash-chained ledger and the Shield AI forensic PDF export by construction — a separate table never joined into the export query, not a filter flag that could be forgotten or bypassed. Subject to the same account-deletion purge as the rest of family data (`worker/src/jobs/familyPurge.ts`).

### Consent flow

Because this is teen-only and fully parent-visible (both parents in co-parenting families, same as the rest of Morechard's data model), there's no private-from-parent data collection to justify separately — it rides on the parental consent already collected at registration. One new explicit screen is required before first use, shown once to the teen:

> "Your AI Mentor chats are visible to your parent(s). If something you write suggests you're in danger, we'll show you help resources — and in some cases, alert your parent(s) too."

Acknowledgement is stored as a timestamped consent record, following the existing consent-flag pattern elsewhere in the schema.

### Parent-facing UI

- New "AI Mentor Chat" panel inside the existing `InsightsTab.tsx`, visible to both parents in a family. Read-only transcript list per child, newest first.
- Escalation events (distress or abuse-pattern) get a visible badge on the relevant message, consistent with how nudge/insight cards already surface signals elsewhere in the product.
- Abuse-pattern escalations do not appear as a parent-facing badge/alert by design (parents aren't notified on that branch) — only distress escalations surface to parents.

### Rate limiting

- Per-child hourly cap (starting point: 20 messages/hour, carried over from the original build's one working guardrail) plus a daily cap, enforced server-side in the route handler.
- Purpose is cost/abuse control, not a safety mechanism — the safety pipeline above is unconditional regardless of rate-limit state.

### Pricing

Bundled into the existing AI Mentor tier (the same tier already delivering Orchard Mentor briefings and nudges). No new SKU, no new paywall logic.

## Rollout & testing

- Ship behind the existing Core AI / Shield AI tier-gating pattern, dark-launched to a test family first rather than a global toggle.
- Required test coverage before wider release:
  1. Off-topic message → graceful in-chat redirect, no escalation record created.
  2. Distress/self-harm test message → crisis resources shown to teen AND both parents receive a real-time alert AND an `mentor_chat_escalations` row is written with `escalation_type='distress'`, `parents_notified=true`.
  3. Abuse-pattern test message (parent implicated) → child-protection resources shown to teen, escalation row written with `parents_notified=false`, and confirm no parent-facing notification of any kind fires.
  4. Rate limit enforcement at the hourly/daily boundary.
  5. Age gate: a sub-13 account cannot reach the chat route even via direct API call, not just hidden in the UI.
- `docs/governance/ai-inventory.md` gets a new "AI System 3: Teen Mentor Chat" entry documenting this design, provider, data flow, and human-oversight mechanism — written and committed as part of this feature, not retrofitted after the fact.

## Open items for implementation planning

- Exact wording/category thresholds for the abuse-pattern vs. distress classifier split — needs careful prompt design, likely with a held-out test set of example messages before launch.
- Exact crisis-resource content (region-aware — UK/US/PL, matching existing locale handling elsewhere in the app).
- Real-time parent alert delivery mechanism (push notification vs. in-app banner vs. both) — should match whatever notification channel already exists for other time-sensitive parent alerts, if one does; otherwise needs its own small design decision during planning.
