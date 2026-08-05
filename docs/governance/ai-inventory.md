# Morechard AI System Inventory
## Article 4 AI Literacy Record — 2026-06-29

**Document type:** Internal accountability record. Not published to the public site.  
**Controller:** Darren Savery, trading as Morechard (sole trader)  
**Status:** Verified against codebase 2026-06-29; updated 2026-07-16 to record decommissioning of AI System 2 (Child Mentor Chat); AI System 3 (Teen Mentor Chat) added 2026-08-05 — consent basis pending legal review, see spec. Sections marked [OWNER TO COMPLETE] require human judgment.  
**Next review:** [OWNER TO COMPLETE — suggest quarterly; 2026-09-29]

---

## AI System 1: Parent Weekly Briefing (Orchard Mentor / Mistrz Sadu)

**Source file:** `worker/src/routes/insights.ts`, function `generateBriefing()`

- **Provider:** OpenAI
- **Model:** `gpt-4o-mini`
- **API endpoint:** `https://api.openai.com/v1/chat/completions`
- **Auth:** `env.OPENAI_API_KEY` (Cloudflare Worker secret)
- **Timeout:** 10 seconds per call
- **Cache:** Output stored in `insight_snapshots` D1 table keyed by ISO week. AI is called at most once per child per week; subsequent loads return cached output with `source='cache'`.

**Purpose:** Generate a personalised weekly coaching note for parents summarising their child's financial behaviour — consistency, responsibility, planning horizon, and savings progress — and recommending a parenting action (the "nudge").

**Inputs passed to the model (from `insights.ts` lines 1289–1330):**
| Field | Source |
|---|---|
| `consistency_score` | D1 `insight_snapshots` — % of tasks completed on time |
| `responsibility_score` (first_time_pass_rate) | D1 — % of tasks approved without revision |
| `planning_horizon` | D1 — average days between goal creation and goal-complete |
| `available_balance_pence` | D1 ledger — current available balance |
| `goals_locked_pence` | D1 ledger — balance reserved for active goals |
| `trends.consistency / responsibility / horizon` | Computed delta vs. prior week snapshot |
| `velocity.mode` | Derived — 'seedling' (task-count) or 'professional' (earnings-based) |
| `effort_preference` | Derived — 'high_yield' or 'steady' based on task selection patterns |
| `locale` | Family setting — 'en' or 'pl' |
| `child_name` | Child profile display_name (nickname — no legal name) |
| Jar allocations (if enabled) | Spend/Save/Give jar balances |
| Co-parent name and family surname | Family record (used for persona framing only) |

**Outputs:** JSON object `{ observation, behavioral_root, the_nudge }` — three coaching text strings displayed to the parent inside `InsightsTab.tsx → LiveBriefingCard`.

**Decision-making:** Informational only. The AI observation is displayed to the parent as guidance. No automated decisions with binding effect. All chore approvals, reward payments, and account-level decisions are made by the parent.

**Fallback:** If the AI call times out or errors, `buildRuleBasedBriefing()` returns a hardcoded decision-tree response using the same data fields. Fallback content is rendered with `source='fallback'` and does **not** carry the "AI-generated" disclosure label.

**Risk classification:** Limited risk (EU AI Act Article 50 transparency obligations apply).  
[OWNER TO COMPLETE: confirm this classification. Inputs include a child's financial behaviour data and the output influences parenting decisions about a minor. If the system is characterised as influencing significant decisions about children, Annex III item 3(a) may apply — see Annex III flag below.]

**Disclosure in place:**
- In-app: "AI-generated" badge in the `LiveBriefingCard` header; "AI-generated coaching note" in the card footer. Both conditional on `briefing.source !== 'fallback'`. Added 2026-06-29 (`InsightsTab.tsx`).
- Privacy policy: Section 9 of privacy policy v1.4 (deployed 2026-06-28).

**Children's data involved:** Yes. Child activity data (scores, balance, goals) is an input. The child is identified by nickname only (no legal name passed to the API).

**Human oversight mechanism:** Parent reviews all AI outputs before taking any action. The parent decides whether to follow the nudge recommendation, share it with the child, or discard it.

**PostHog event capture:** `$ai_generation` event fired on each successful AI call (`worker/src/lib/posthog.ts`). Captures model, latency, input messages, and output text for LLM observability. Fire-and-forget; non-blocking.

**Known limitations:** [OWNER TO COMPLETE — e.g. model accuracy on edge cases, language quality for Polish persona, behaviour at low data volumes (< 3 tasks / < 7 days history)]

---

## AI System 2: Child Mentor Chat — DECOMMISSIONED 2026-07-16

**Status:** Removed from the codebase. `worker/src/routes/chat.ts`, `chat-history.ts`, and `chat-modules.ts` (routes `POST /api/chat`, `GET /api/chat/history`, `GET /api/chat/modules`) were deleted and unregistered from `worker/src/index.ts`. The corresponding client functions (`postChat`, `getChatHistory`, `getChatModules`) were removed from `app/src/lib/api.ts`.

**Why removed:** This endpoint let a child send unmoderated free-text to an LLM. It was discovered live in production without having gone through a deliberate ship decision — no moderation layer, no crisis-detection/escalation path, no confirmed COPPA/GDPR-K consent basis for collecting free-text from a minor, and no frontend ever consumed it (dead surface area from day one — grep confirms zero UI callers). Given Morechard's separated/co-parenting positioning and its hash-chained, court-submissible ledger (Shield AI export tier), an unmoderated child chat log sitting in the same trust boundary was assessed as an active liability rather than a feature to harden: a flagged disclosure with no defined escalation path, or a chat transcript surfaced in a custody dispute, were both live risks with no mitigation in place. Full analysis: internal council review, 2026-07-16.

**What replaces it:** AI System 1 (Parent Weekly Briefing) remains the sole conversational/generative AI surface. Child-facing coaching stays in the existing templated Seedling/Professional nudge system (structured, non-generative, pre-written per trigger), which was already carrying the substantive educational content the chat endpoint would have duplicated.

**Data retained:** The `chat_history`, `chat_rate_limits`, and `unlocked_modules` D1 tables are not dropped — any rows already written while the endpoint was live remain subject to the standard account-deletion purge (`worker/src/jobs/familyPurge.ts`). No new rows can be written; the write paths no longer exist. `unlocked_modules` continues to be written by the unrelated, non-AI Learning Lab unlock rules (`worker/src/lib/labTriggers.ts` — deterministic thresholds on ledger/goal data, not a generative or profiling system).

**If free-text child chat is reconsidered in future:** it should be scoped and funded as its own feature, gated on (1) legal sign-off on COPPA/GDPR-K consent for minor free-text collection, (2) a co-parenting-specific escalation design that never feeds chat content into the court-submissible ledger/Shield AI export without separate explicit consent, (3) a real human escalation path (not just a moderation API call) for self-harm/abuse-adjacent content, and (4) an audit of any legacy logged data before reactivation.

---

## AI System 3: Teen Mentor Chat

**Source files:** `worker/src/routes/mentorChat.ts`, `worker/src/lib/mentorChat/*.ts`

- **Provider:** OpenAI
- **Models:** `gpt-4o-mini` (chat replies, message/output classification), `omni-moderation-latest` (moderation pre-check)
- **Scope:** Teen accounts only (13–17, enforced server-side against `users.birth_date` with exact day-level age math, added migration 0088). Not available to children under 13.
- **Purpose:** Topic-locked conversational financial mentoring — money, chores, financial literacy only. Personality: supportive, motivating, honest, firm-but-fair; reflects the teen's thinking back rather than deciding for them.
- **Safety pipeline:** (1) OpenAI Moderation API pre-check on every inbound message. (2) Topic-locked system prompt (not relied on alone for containment). (3) Post-check classifier on both the child's message and the assistant's own draft reply, routing to on_topic / off_topic / distress / abuse_pattern, with an explicit fail-safe: any abuse signal overrides a co-occurring distress signal, since wrongly alerting a potentially abusive parent is a worse failure than wrongly withholding a distress alert.
- **Human oversight / escalation:** Distress branch → immediate in-chat crisis resources (region/locale-aware) + real-time email alert to both parents (`worker/src/lib/mentorChat/alerts.ts`, reuses `EmailService`). Abuse-pattern branch → in-chat child-protection resources, parents explicitly NOT notified, since a parent may be the source of risk. Neither branch allows the model to counsel or discuss the disclosed content — acknowledgment + resources + stop.
- **Data retention & export boundary:** `mentor_chat_messages` / `mentor_chat_escalations` — separate tables, never joined into the hash-chained ledger or Shield AI forensic PDF export. Subject to the standard account-deletion purge (`worker/src/jobs/familyPurge.ts`).
- **Children's data involved:** Yes — teen free-text content, including references to family circumstances. Identified by nickname/display_name only, consistent with the rest of the product.
- **Consent basis:** [OWNER TO COMPLETE — legal review pending, see `docs/superpowers/specs/2026-08-04-teen-mentor-chat-design.md`, "Consent flow — UNRESOLVED, blocking". Do not mark this resolved until that review is complete.]
- **Rate limiting:** 20 messages/hour, 60/day per child, enforced server-side.
- **Fallback behavior:** If the chat completion call fails or times out, the route returns a 503 rather than a degraded/fabricated reply — no rule-based fallback exists for open-ended chat (unlike AI System 1's briefing fallback), since a wrong guess at conversational content is a worse outcome than a visible "try again" error.

---

## Annex III Risk Assessment — resolved 2026-06-29, superseded 2026-07-16

**Item:** Module unlock matrix, originally `detectUnlockSlug()` in `worker/src/routes/chat.ts` (now deleted — see AI System 2, decommissioned 2026-07-16).

**Previous concern:** The `distinct_ips_7d` trigger used IP/location-adjacent data to characterise a child's behaviour and influence which curriculum modules they could access — a combination that risked Annex III item 3(a) classification (educational access systems for children).

**2026-06-29 resolution:** `distinct_ips_7d` was removed from the AI input pipeline entirely. The field was no longer fetched, passed to the AI, or used in pillar selection or prompt construction.

**2026-07-16 update:** The entire chat-based unlock path (`detectUnlockSlug()`, keyword matching against a child's free-text messages) no longer exists — it was deleted along with the Child Mentor Chat endpoint. The only remaining Learning Lab unlock mechanism is `worker/src/lib/labTriggers.ts`, which is deterministic, rules-based, and non-AI: fixed thresholds against ledger/goal/streak data (e.g. cumulative earnings ≥ £X, active goal count, reliability %). It performs no free-text analysis, no behavioural profiling beyond simple threshold checks, and no AI model call.

**Residual question:** [OWNER TO COMPLETE] Seek specialist legal advice on whether deterministic threshold-based content gating (no AI inference, no free-text input) still reaches Annex III item 3(a) as an "educational access system." The removal of both the IP signal and the AI-driven keyword-matching path substantially narrows the risk profile from the original assessment.

---

## PostHog opt-out — confirmation

PostHog is initialised in `app/src/lib/analytics.ts`, invoked from `app/src/main.tsx` (line 15).

The following opt-outs are applied **at the initialisation layer**, before any events are captured:

| Control | Implementation |
|---|---|
| Session replay disabled for all child devices | `disable_session_recording: isChildDevice()` at init (line 83). `isChildDevice()` checks `getDeviceIdentity()?.role === 'child'`. |
| Person profiles only for identified users | `person_profiles: 'identified_only'` (line 79) — no anonymous profiles created. |
| Analytics consent gate | `hasAnalyticsConsent()` reads `mc_analytics_consent` from localStorage. PostHog only activated post-consent. |
| Child replay guard in `replayAllowed()` | Returns `false` if `isChildDevice()` is true, even if family has accepted analytics. |
| Consent revocation | `revokeAnalyticsConsent()` calls `posthog.opt_out_capturing()` mid-session without reload. |

All five controls are in place at the initialisation layer. Child session replay is never enabled regardless of parental consent status.

---

*This document is an internal accountability record under EU AI Act Article 4 and UK ICO Children's Code. It is not legal advice. It should be reviewed by a data-protection and AI-law specialist before being relied upon, particularly in relation to the Annex III flag above.*
