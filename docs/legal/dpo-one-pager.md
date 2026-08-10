# Morechard — Information for School DPOs and Safeguarding Leads

*One-page briefing for a school considering a Morechard pilot. Not a legal document — see linked pages for the underlying detail.*

## What Morechard is

A chore-tracker and pocket-money app for families, including separated and co-parenting households. Parents assign chores and manage rewards; children track earnings and savings goals. An optional AI Mentor delivers financial-literacy content based on the child's own activity.

## Your role in a pilot: promotion only

If your school partners with us, your role is limited to making parents aware Morechard exists (newsletter, notice board, handout). **You will not receive any dashboard, pupil-level data, or usage statistics**, and Morechard does not become a supplier processing data on your behalf in the ordinary sense. Full detail: [School Partnership & Data Protection Statement](https://morechard.com/security/school-partnership-statement).

## Data protection posture

| Area | Status |
|---|---|
| Privacy Policy | Published, UK GDPR / GDPR-K / COPPA aligned — [read it](https://morechard.com/privacy-policy) |
| DPIA | Internal draft (v0.1) covering children's data, the ledger, and AI features — **not yet reviewed by a specialist data-protection solicitor**. [Summary](https://morechard.com/security/dpia-summary) |
| Children's data | Nicknames only by schema design — no legal name or date of birth ever required or stored |
| Data residency | Hosted on Cloudflare (target: EU West) — formal pinning/confirmation in progress |
| Data Processing Agreements | Not yet executed with our own infrastructure providers; in progress. A standby Art. 28 template exists for any future arrangement that does involve data sharing with a school |
| Named contact | security@morechard.com |

## Security posture

- TLS in transit; platform-level encryption at rest (Cloudflare D1); client-side AES-GCM encryption for any stored payout details.
- Real server-side WebAuthn biometric verification with clone detection — not a client-side toggle.
- Server-revocable sessions, rate limiting, bot protection (Cloudflare Turnstile) on all authentication flows.
- Internal, source-code-level security review completed July 2026 (284 database query sites confirmed parameterised; secrets scanning across full history).
- **Not yet in place:** external penetration test, SOC 2, ISO 27001. **In progress:** Cyber Essentials certification (the UK government-backed baseline most relevant to school suppliers) — application underway as of August 2026, timeline TBC.

Full detail: [Security Center](https://morechard.com/security)

## Safeguarding

- No open-ended AI chat is currently live in the product — children's free-text input is limited to short labels (e.g. naming a savings goal).
- A teen AI chat feature was built and safety-tested, then **deliberately not launched** once we identified it would require special-category-data handling (UK GDPR Article 9) and a dedicated legal basis we didn't yet have in place.
- Because there's no open-ended input surface today, there is currently no automated disclosure-escalation pipeline in the app — we say this plainly rather than imply a capability that doesn't exist. Full detail: [Safeguarding Statement](https://morechard.com/security/safeguarding).

## What we're asking you to weigh

This is an honest snapshot from a small, self-funded team, not a finished enterprise compliance program. The strongest points: nickname-only children's data by design, a genuine (if unaudited) technical security posture, and a track record of deliberately not shipping a feature (Teen Mentor Chat) rather than shipping it unsafely. The open items: no specialist legal review of the DPIA yet, no Cyber Essentials certificate yet (in progress), and data residency pending formal confirmation. We'd rather a DPO weigh the real picture than a polished one.

**Contact:** security@morechard.com — happy to join a call.

---
*Sources: this document summarises `docs/governance/dpia.md`, `docs/governance/sub-processors.md`, `docs/governance/ai-inventory.md`, and the public Security Center pages linked above, as of 10 August 2026. It is not legal advice and does not replace your own DPO's independent assessment.*
