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
| `status` | `pending_verification` \| `processing` \| `completed` \| `expired` \| `needs_clarification` |
| `target_child_name_raw` | free-text child name as typed by the requester, only set when `scope = child` |
| `created_at`, `executed_at` | |

## Request flow

**`POST /api/dsar/request`** (public, no auth)
Body: `{ email, request_type, scope, child_name? }`. Note: `child_name` is **free text**, not an ID — an unauthenticated requester has no way to look up a child's internal ID, and exposing one before verification would let a stranger enumerate a family's children. Store it verbatim in `target_child_name_raw`; it's resolved to an actual child row at execution time (below), not at submission time.
- Look up whether `email` matches an existing parent `users.email`.
- If matched: create a `dsar_requests` row (`pending_verification`), send a verification email via the existing Resend/magic-link email infrastructure.
- If not matched: **do not create a row, do not send an email** — return the same generic "if that email is on an account, you'll receive a link" response either way, to avoid account enumeration.

**`GET /api/dsar/verify?token=...`** (public, no auth)
- **Atomic claim first**, before anything else, to prevent double-click / email-prefetch races from running execution twice:
  ```sql
  UPDATE dsar_requests
  SET status = 'processing', verified_at = unixepoch()
  WHERE token_hash = ? AND status = 'pending_verification'
  ```
  If 0 rows affected (already claimed, expired, or unknown token), return a generic "this link has already been used or has expired" page and stop — do not execute anything.
- Only the instance that wins the claim proceeds to execute:
  - **Erasure, `scope = family`**: call the shared execution function (see below). Sets the same `deleted_at`/anonymization state the existing Uproot flow sets; the existing daily cron in `familyPurge.ts` picks it up for the T+30 hard purge — no new cron needed here.
  - **Erasure, `scope = child`**: resolve `target_child_name_raw` against children on the matched parent's family — case-insensitive, trimmed match, scoped to `target_family_id`. If exactly one child matches, proceed. If zero or more than one match (typo, duplicate names, blended-family edge case), set `status = needs_clarification` and email the requester asking them to resubmit with the exact in-app display name or contact support — **do not silently expire**, and do not touch any data.
  - **Access**: generate the export using the existing `GET /api/export/json` logic, store the result in R2, mint an R2 presigned URL with a **1-hour expiry** (short-lived by design — see Error handling), email the link with a note that the link expires quickly and a new request must be submitted if missed.
- Mark `status = completed`, `executed_at = now`.

## Erasure execution — shared logic, not a fork

Extract the anonymization logic currently inline in `handleDeleteFamily` (auth.ts:1116) and the co-parent-leave routes into `worker/src/lib/dsarExecution.ts`, callable from both the existing authenticated routes and the new DSAR flow, so behavior never drifts between the two entry points.

**Transaction boundary**: D1/Workers transactions have statement-count and wall-clock limits — a child or family can have thousands of `chat_history`/ledger rows, so the transaction must cover only small, fixed-size **identity-state** writes, never a bulk table sweep. The pattern below already matches how `familyPurge.ts` works today (immediate identity anonymization, deferred bulk purge via cron) — this design extends that same split to the new cases rather than introducing a new one.

- **Family scope, requester is sole parent or non-lead co-parent**: same as today's Uproot/leave behavior — one small transaction against the `users`/`sessions` rows for that person.
- **Family scope, requester is lead and a co-parent remains**: **new** path. One transaction: update `family_roles` (or `families.lead_user_id`, whichever holds the flag) to promote the remaining co-parent to lead **before** touching the departing lead's PII — role swap first, then null `display_name`/`email`/`email_pending`/`password_hash`/`pin_hash` on the departing lead's row, then revoke their sessions. Doing the swap first avoids a window where the row being anonymized still holds the lead flag (which would orphan the family or lose track of who to promote). Family, ledger, and children are otherwise untouched — no bulk tables involved, so no cron follow-up needed here beyond what the existing T+30 family purge already does.
- **Child scope** (new): one small transaction nulls that child's `users.display_name` and sets a `purge_pending_at` marker (reusing the same tombstone pattern `families.deleted_at` already uses) — this is the only synchronous write. All bulk cleanup — `chat_history` rows, progress tables (`unlocked_modules`, `lesson_completions`, `module_act_progress`, `chat_rate_limits`, `child_badges`, `child_streaks`, `child_nudges`) — is deferred to `familyPurge.ts`'s existing daily cron, extended to also sweep child-scoped `purge_pending_at` markers, batched to stay under D1 limits the same way the existing family sweep already must.

**Ledger integrity — do not mutate historical ledger rows.** The ledger is a cryptographic hash chain (each row's hash covers the previous row plus its own fields); changing any field on a historical row — including nulling or replacing a `child_id` — breaks every subsequent hash in the chain. So ledger rows are **never touched** by any erasure path, family or child scope. `ledger.child_id` (or equivalent FK) keeps pointing at the same immutable `users.id` forever; anonymization happens exactly once, on the `users` row itself (nulling `display_name` etc.), so the same ID simply stops resolving to a real name. This is already how the existing family-scope Uproot flow behaves (`docs/governance/lia/lia.md` LIA-3) — the child-scope path here follows the identical rule, and the earlier "pseudonymized in place" wording in this spec was inaccurate and is corrected here.

## Frontend + privacy policy

Simple public form, no auth shell — a static page (e.g. `marketing/src/dsar.html`, built alongside the existing marketing site) posting to `/api/dsar/request`. Fields: email, request type, scope, child selector (only shown/required if scope = child, populated by... nothing — since this is unauthenticated, the requester types the child's display name as free text and it's matched server-side against children on the resolved family after verification, not before, to avoid pre-verification enumeration of a family's children).

Link added to `marketing/src/privacy-policy.html` (the currently-served policy), replacing the existing DPIA-in-progress placeholder note with a real link to the DSAR form. `docs/notebooklm/privacy-policy.md` (the draft with `[Legal Note]` placeholders) should be reconciled separately — not part of this build.

## Error handling

- Unmatched email → generic response, no row created (anti-enumeration).
- Verification token already claimed/expired → the atomic `UPDATE ... WHERE status = 'pending_verification'` claim returns 0 rows; generic "this link has already been used or has expired" page, nothing executes. This also covers concurrent double-click / email-prefetch races — only the instance that wins the claim runs.
- Child-name match failure at execution time (0 or >1 matches — typo, duplicate names, blended-family edge case) → `status = needs_clarification`, requester emailed to resubmit with the exact in-app display name; no data touched, no silent expiry.
- Identity-state transaction failure (e.g. the lead-swap case) → the transaction covers only the small identity write, so failure is all-or-nothing and cheap to retry; since the claim already flipped status to `processing`, a failed execution needs an explicit retry path (re-run execution against `processing` rows) rather than relying on the requester re-clicking an already-consumed token.
- R2 presigned download link expires after 1 hour (not cron-cleaned — enforced natively by R2's presigned URL TTL); delivery email states this explicitly and tells the requester to submit a new request if missed.

## Testing

- Unit tests for `dsarExecution.ts` covering: family/sole-parent, family/lead-with-coparent (the swap-then-anonymize ordering, verifying `family_roles` is updated before PII is nulled), child-scope (verifying the identity-write is small/synchronous and no ledger row is ever mutated).
- Unit test proving ledger rows are byte-for-byte unchanged (and hash-chain still validates) after both a family-scope and a child-scope erasure.
- Route tests for `/api/dsar/request` (matched/unmatched email, anti-enumeration response shape) and `/api/dsar/verify` (valid claim, already-claimed/expired token returns 0-row no-op, concurrent double-request race, ambiguous/zero child-name match → `needs_clarification`).
- Manual verification against `morechard-dev` (never production) for the full request → email → verify → execute path before this ships.
