# Teen Mentor Chat — Design Spec

**Date:** 2026-08-04
**Status:** Approved for planning
**Supersedes context:** `docs/governance/ai-inventory.md` — AI System 2 (Child Mentor Chat), decommissioned 2026-07-16. This is a fresh feature, not a resurrection: new tables, new safety pipeline, new consent flow. The old `chat_history` / `chat_rate_limits` tables remain dead and subject to the standard purge; nothing here writes to them.

## Why

Real feedback from teenagers using Morechard indicates they'd value being able to talk through money decisions with the AI Mentor directly, not just receive one-way nudges/briefings. The original chat endpoint was killed because it shipped with no moderation layer, no crisis-escalation path, no confirmed minor-consent basis, and no legal sign-off — not because chat itself is unbuildable. This spec addresses the four conditions the governance doc set for ever reconsidering it — but note condition 1 is a design proposal, not a resolved legal question (see Consent flow, below):

1. A design for a consent basis specific to minor free-text (teen-only, fully parent-visible) — **status: unresolved, requires legal review before build**, not satisfied by this spec
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
2. **Topic-lock system prompt.** The mentor model is instructed to discuss money, chores, and financial literacy only, in the tone described above, and to never make decisions on the teen's behalf. **This alone is not resilient to jailbreaking** — teens routinely probe boundaries via persona adoption, hypothetical framing, and multi-turn prompt injection. The output-side check in layer 3 is the real enforcement mechanism, not the prompt.
3. **Post-check + crisis classifier.** A second pass on the input (informed by the moderation score) and the model's own output. Also enforces topic containment on the way out: if the assistant's own output drifts off-topic (checked via a lightweight classifier call, not just the system prompt's word), the response is discarded and replaced with a hardcoded redirect string before it reaches the client. This routes to one of four outcomes:
   - **Off-topic** → model redirects gracefully in-chat ("that's outside what I can help with — want to talk to a parent about it?"). No escalation, no logging beyond the normal message record.
   - **Distress / self-harm signal** → the mentor does **not** attempt to counsel, discuss, or engage on the substance of what was disclosed — it is a financial-literacy tool, not a mental-health support system, and has no training, supervision, or liability coverage to act as one. Response is a brief, warm acknowledgment, immediate in-chat crisis resources, and a clear statement that a parent has been notified — then the mentor declines to continue on that topic (redirects back to finance, or ends the turn). A real-time alert fires to both parents in parallel. No moderation queue or delay — there is no 24/7 human moderator, so the alert must reach a human who knows the child directly and immediately.
   - **Abuse-pattern signal (parent potentially implicated)** → same non-engagement principle: brief acknowledgment, no attempt to counsel or investigate further. In-chat child-protection resources (NSPCC/Childline-style reporting routes) shown to the teen. **Parents are explicitly NOT notified** on this branch, since a parent may be the source of risk. This requires the classifier to distinguish "I'm struggling" from "a parent is hurting me" — both categories need explicit test coverage (see Testing).
   - **Ambiguous / overlapping signal (e.g. self-harm intent mentioned alongside a parent conflict)** → **fail-safe override: default to the abuse-pattern branch.** Wrongly alerting a potentially abusive parent is a more severe and less reversible failure than wrongly withholding a distress alert (the teen still gets in-chat crisis resources either way, and the classifier can be tuned toward sensitivity over time). The classifier must implement this as an explicit priority rule, not an emergent behavior — "any weak abuse/parent-conflict signal suppresses parent notification, full stop," not a confidence-threshold average between the two categories.

### Data model

New tables (do not reuse or resurrect the deleted `chat_history` / `chat_rate_limits` tables):

- **`mentor_chat_messages`**
  `id, family_id, child_id, role ('child' | 'assistant'), content, moderation_flags (json, nullable), created_at`
  Only written for accounts flagged as teen (13+) at the D1 level — the age gate is enforced server-side against the child's stored birth year on every write, not just hidden client-side.

- **`mentor_chat_escalations`**
  `id, message_id, escalation_type ('distress' | 'abuse_pattern'), parents_notified (bool), created_at`
  A separate audit table so the escalation history survives independently of message retention policy, and so "was a parent notified, and when" is a single indexable fact rather than something reconstructed from message content.

**Retention & export boundary:** chat messages are excluded from the hash-chained ledger and the Shield AI forensic PDF export by construction — a separate table never joined into the export query, not a filter flag that could be forgotten or bypassed. Subject to the same account-deletion purge as the rest of family data (`worker/src/jobs/familyPurge.ts`).

### Consent flow — UNRESOLVED, blocking

**This is not a solved problem. Do not start implementation until it is.**

The design below (parent-visible, teen-only, one-time acknowledgment screen) is a proposal, not a legal basis. Registration-time consent was collected for a chore/ledger product; this feature is a materially different processing activity — a generative AI system capable of eliciting and storing disclosures about self-harm, distress, or parental abuse from a minor. Under UK GDPR and the ICO Children's Code, the applicable basis (consent or otherwise, under Article 6/8) generally needs to be specific to the processing purpose it's being relied on for, not inherited from an unrelated prior consent screen. Darren is a solo founder without in-house legal — nothing about this design has been reviewed by counsel, and this document does not constitute legal advice.

**Proposed design, pending legal review:**

Because this is teen-only and fully parent-visible (both parents in co-parenting families, same as the rest of Morechard's data model), the intent is that there's minimal private-from-parent data collection to separately justify. One new explicit screen would be shown once to the teen before first use:

> "Your AI Mentor chats are visible to your parent(s). If something you write suggests you're in danger, we'll show you help resources — and in some cases, alert your parent(s) too."

Acknowledgement would be stored as a timestamped consent record, following the existing consent-flag pattern elsewhere in the schema — but **this mechanism itself, and whether it constitutes an adequate basis for this specific processing activity, must be confirmed by a data-protection/AI-law specialist before build starts.** This is a hard gate on the implementation plan, not a task inside it.

**Related, same legal-review dependency:** a 13+ teen is generally presumed under UK GDPR/ICO guidance to have independent capacity to exercise their own data rights (subject access, erasure) — which can conflict with the parent-visibility design above if a teen objects to a parent seeing specific chat content. This spec does not resolve that conflict; it needs the same legal review as the consent basis, not a separate follow-up, since both questions turn on the same underlying "whose data right applies here" analysis.

### Parent-facing UI

- New "AI Mentor Chat" panel inside the existing `InsightsTab.tsx`, visible to both parents in a family. Read-only transcript list per child, newest first.
- On the teen's side, the chat UI carries a persistent, subtle "Visible to parents" indicator at all times — not just a one-time acknowledgment screen at first use. The teen should never be able to forget or misjudge that a given message will be seen, especially mid-disclosure.
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

## Blocking prerequisite

**Legal review of the consent basis (see Consent flow, above) must be completed before implementation begins.** Everything else in this spec can be planned and built in parallel with that review, but the feature cannot ship — and arguably should not be implemented against production data flows — until this is resolved. Track this as a gate at the start of the implementation plan, not a follow-up task.

## Open items for implementation planning

- Exact wording/category thresholds for the abuse-pattern vs. distress classifier split — needs careful prompt design, likely with a held-out test set of example messages before launch.
- Exact crisis-resource content (region-aware — UK/US/PL, matching existing locale handling elsewhere in the app).
- **Real-time parent alert delivery mechanism — resolved to: email-only for v1.** In-app banners alone are insufficient for a distress escalation (a parent may not have the app open), and push notification infrastructure does not exist in the product yet (Phase 8 roadmap, unbuilt). Rather than pulling Phase 8 forward as a co-requisite, this feature ships using the existing email infrastructure (`worker/src/lib/email.ts`, already used for auth and the support-agent incident notifier) for the distress-escalation alert — accepting the latency gap vs. push for v1. Revisit once push notifications are built as part of Phase 8. Decided 2026-08-04.
