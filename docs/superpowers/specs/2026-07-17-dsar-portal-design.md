# DSAR Self-Service Portal — Design

## Context

Cybersecurity/compliance audit (2026-07-17) identified genuine gaps in Morechard's GDPR posture. Two items — ROPA and the sub-processor register — are already done (see `docs/notebooklm/` and recent commits `bb394d8`, `449c8fc`, `6dbc9ec`). This spec covers the next item: a self-service Data Subject Access Request (DSAR) portal covering both **access** (export my data) and **erasure** (delete my data) requests, usable by someone who is not currently logged in.

Survey of existing code (done before this design) found more is already built than expected:

- **Erasure**: `handleDeleteFamily` (`worker/src/routes/auth.ts:1116`, route `DELETE /auth/family`) already does soft-delete + immediate PII scrub, and `worker/src/jobs/familyPurge.ts` already runs a daily cron (`runSoftDeletePurge`) that hard-purges family data at T+30 days, plus a separate `runLedgerPurge` that hard-deletes the pseudonymized ledger tombstone at T+7 years (UK Limitation Act, per `docs/governance/lia/lia.md` LIA-3). Co-parent-only removal already exists via `DELETE /auth/me/leave` and `DELETE /auth/family/co-parent/:userId`.
- **Access**: `GET /api/export/json` (`worker/src/routes/export.ts:34`) already produces a free, ungated full portability export. `GET /api/export/pdf` produces tiered PDF exports.
- **Gap**: none of the above is reachable without an authenticated session (magic-link JWT). There is no way today for someone to submit a DSAR request without logging in — which is the normal real-world case for a formal DSAR. `docs/support/08-privacy-data-export-deletion.md` explicitly says anything beyond the self-serve export "requires manual operator escalation to Darren."

This spec closes that gap: a public, unauthenticated request/verification flow that reuses the existing erasure and export logic rather than re-implementing it.

## Scope for this build

**In scope:**
- Public DSAR request form (no login required) for **parent-initiated** requests only.
- Request types: access (export) and erasure (delete).
- Erasure scope: whole family, or a single child within a family.
- Email-based identity verification (must match an existing parent email on the target family).
- Fully automated execution on verification — no manual approval step.
- Lead-parent-with-remaining-co-parent case: auto-promote co-parent to lead, anonymize only the departing lead's row (closes the current gap where `handleDeleteFamily` just blocks this case).
- Link from the privacy policy to the new portal.

**Out of scope (documented follow-up, not built tonight):**
- Child-initiated requests. Children have no email/login usable by a public form; a child-initiated DSAR would need an in-app flow (child logged into their own account) plus a parent-approval step. Flagged as a known gap in the spec, not built here.
- Any manual review/approval queue. Per product decision: Darren is not positioned to arbitrate between separated co-parents, and there isn't enough information at request time to judge legitimacy — so verified requests execute automatically. Residual risk (a parent legitimately, but adversarially, requesting their own child's erasure) is accepted; a parent already has the legal right to request their own child's data be erased, so this isn't a security hole, just a co-parenting conflict the product doesn't referee.

## Data model

New table, `dsar_requests`:

| Column | Notes |
|---|---|
| `id` | PK |
| `request_type` | `access` \| `erasure` |
| `scope` | `family` \| `child` |
| `target_family_id` | FK `families.id` |
| `target_child_id` | FK `users.id`, nullable — set only when `scope = child` |
| `requester_email` | as submitted |
| `matched_user_id` | the `users.id` this email resolved to (a parent on the target family) — null until matched |
| `verification_token_hash` | reuses the existing magic-link token hashing pattern |
| `verified_at` | nullable |
| `status` | `pending_verification` \| `verified` \| `processing` \| `completed` \| `expired` |
| `created_at`, `executed_at` | |

## Request flow

**`POST /api/dsar/request`** (public, no auth)
Body: `{ email, request_type, scope, child_id? }`.
- Look up whether `email` matches an existing parent `users.email`. If `scope = child`, additionally confirm that child belongs to a family the matched parent belongs to.
- If matched: create a `dsar_requests` row (`pending_verification`), send a verification email via the existing Resend/magic-link email infrastructure.
- If not matched: **do not create a row, do not send an email** — return the same generic "if that email is on an account, you'll receive a link" response either way, to avoid account enumeration.

**`GET /api/dsar/verify?token=...`** (public, no auth)
- Validate token against `verification_token_hash`, check not expired (reuse existing magic-link expiry window).
- Mark `verified_at`, `status = processing`.
- Execute inline (both erasure and access are already fast, synchronous operations in the existing code):
  - **Erasure**: call the shared execution function (see below). Sets the same `deleted_at`/anonymization state the existing Uproot flow sets; the existing daily cron in `familyPurge.ts` picks it up for the T+30 hard purge — no new cron needed for the family-scope case.
  - **Access**: generate the export using the existing `GET /api/export/json` logic, store the result in R2, mint an R2 presigned URL with a **native 48-hour expiry** (not cron-cleaned — use R2's presigned URL TTL directly), email the link.
- Mark `status = completed`, `executed_at = now`.

## Erasure execution — shared logic, not a fork

Extract the anonymization logic currently inline in `handleDeleteFamily` (auth.ts:1116) and the co-parent-leave routes into `worker/src/lib/dsarExecution.ts`, callable from both the existing authenticated routes and the new DSAR flow, so behavior never drifts between the two entry points.

- **Family scope, requester is sole parent or non-lead co-parent**: same as today's Uproot/leave behavior.
- **Family scope, requester is lead and a co-parent remains**: **new** path.
  1. Inside a single transaction: update `family_roles` (or `families.lead_user_id`, whichever holds the flag) to promote the remaining co-parent to lead **before** touching the departing lead's PII — do the role swap first, then null `display_name`/`email`/`email_pending`/`password_hash`/`pin_hash` on the departing lead's row, then revoke their sessions. Doing the swap first avoids a window where the row being anonymized still holds the lead flag (which would orphan the family or lose track of who to promote).
  2. Family, ledger, and children are otherwise untouched.
- **Child scope** (new): anonymize that child's `display_name`, `chat_history` rows, and progress tables (`unlocked_modules`, `lesson_completions`, `module_act_progress`, `chat_rate_limits`, `child_badges`, `child_streaks`, `child_nudges`) at execution time; ledger rows referencing that child are pseudonymized in place (identifying link stripped, hash-chain preserved) — same pattern already used for whole-family ledger retention (LIA-3). Family and siblings untouched. Extend `familyPurge.ts`'s daily sweep to also hard-purge child-scoped anonymized rows at T+30, alongside the existing family-scoped sweep.

## Frontend + privacy policy

Simple public form, no auth shell — a static page (e.g. `marketing/src/dsar.html`, built alongside the existing marketing site) posting to `/api/dsar/request`. Fields: email, request type, scope, child selector (only shown/required if scope = child, populated by... nothing — since this is unauthenticated, the requester types the child's display name as free text and it's matched server-side against children on the resolved family after verification, not before, to avoid pre-verification enumeration of a family's children).

Link added to `marketing/src/privacy-policy.html` (the currently-served policy), replacing the existing DPIA-in-progress placeholder note with a real link to the DSAR form. `docs/notebooklm/privacy-policy.md` (the draft with `[Legal Note]` placeholders) should be reconciled separately — not part of this build.

## Error handling

- Unmatched email → generic response, no row created (anti-enumeration).
- Expired/already-used verification token → generic "this link has expired, submit a new request" page.
- Child-name match failure at execution time (requester typo, child already removed) → request marked `status = expired` with no data touched; no automatic retry, requester must resubmit.
- Transaction failure mid-execution (e.g. the lead-swap case) → whole execution wrapped in a D1 transaction; any failure leaves `dsar_requests.status = verified` (not `completed`), nothing partially anonymized, safe to retry via the same token until it expires.

## Testing

- Unit tests for `dsarExecution.ts` covering: family/sole-parent, family/lead-with-coparent (the swap-then-anonymize ordering), child-scope.
- Route tests for `/api/dsar/request` (matched/unmatched email, anti-enumeration response shape) and `/api/dsar/verify` (valid/expired/reused token).
- Manual verification against `morechard-dev` (never production) for the full request → email → verify → execute path before this ships.
