# Data Processing Agreement (Template) — Standby

**Status: not yet executed with any party. Not legal advice. Have a solicitor review before use.**

This is a standby Article 28 UK GDPR Data Processing Agreement template, held ready in case a school partnership ever evolves beyond promotion-only into an arrangement where Morechard processes personal data on a school's behalf (e.g. a school-facing dashboard, an imported class roll, or SSO tied to school-issued pupil accounts). It is **not currently attached to any live partnership** — see `marketing/src/security/school-partnership-statement.html` for why the current promotional-only relationship doesn't require one.

Do not send this to a school as a finished agreement. Before first use: have a solicitor review it against the specific data-sharing arrangement, fill in the bracketed fields, and confirm it against the school's own model DPA if they have one (many UK schools use the DfE/LGfL model clauses and will expect to see familiar structure).

---

## 1. Parties

This Agreement is between:
- **[School name]**, of [address] ("the Controller"), and
- **Darren Savery, trading as Morechard**, of 331 Finchampstead Road, Wokingham, Berkshire, RG40 3JT, United Kingdom ("the Processor"),

each a "Party" and together the "Parties."

## 2. Subject matter and duration

This Agreement governs the Processor's processing of personal data on behalf of the Controller for the purpose of [describe the specific arrangement — e.g. "displaying aggregate, non-identifying usage statistics to the school's designated staff member"]. It takes effect on the date of the last signature and continues for the duration of the partnership described in the accompanying [partnership/pilot agreement], unless terminated earlier under Section 11.

## 3. Nature and purpose of processing

[To be completed per arrangement.] Example: "Processing of pupil first names or nicknames and class/year group solely to generate an invite code per pupil, for the sole purpose of enabling parental sign-up to the Morechard app."

## 4. Categories of data subjects

[To be completed.] Example: "Pupils at [school name], aged [X]–[Y]."

## 5. Categories of personal data

[To be completed — list precisely; do not default to "all data." ] Example: "Pupil first name or nickname; year group; unique invite code." Explicitly excludes: full legal surname, date of birth, home address, safeguarding records, SEN records, or any special category data under Article 9.

## 6. Processor obligations (Article 28(3))

The Processor shall:

a. Process personal data only on the Controller's documented instructions, including with regard to transfers to a third country, unless required to do otherwise by UK law;
b. Ensure persons authorised to process the data are subject to a duty of confidentiality;
c. Take appropriate technical and organisational measures as required by Article 32 (see Annex A);
d. Not engage a sub-processor without the Controller's prior specific or general written authorisation (see Annex B — current sub-processor list);
e. Assist the Controller, insofar as reasonably possible, in responding to data subject rights requests;
f. Assist the Controller in ensuring compliance with Articles 32–36 (security, breach notification, DPIA, prior consultation), taking into account the nature of processing and information available to the Processor;
g. At the Controller's choice, delete or return all personal data at the end of the provision of services, and delete existing copies unless UK law requires storage;
h. Make available to the Controller all information necessary to demonstrate compliance with this Article, and allow for and contribute to audits, including inspections, conducted by the Controller or an auditor mandated by the Controller, on reasonable notice.

## 7. Sub-processors

The Processor's current sub-processors are listed in Annex B and in the Processor's public Privacy Policy (Section 4), and are subject to the same data protection obligations set out in this Agreement via written contract. The Controller will be notified of any intended change concerning the addition or replacement of sub-processors, giving the Controller the opportunity to object.

## 8. International transfers

Where any sub-processor is located outside the UK, transfers are made under the UK International Data Transfer Addendum to the EU Standard Contractual Clauses, or another UK GDPR Chapter V transfer mechanism, as detailed in the Processor's Privacy Policy.

## 9. Security measures

See Annex A. In summary: encryption in transit (TLS) and at rest, access controls, session revocation, rate limiting and bot protection on authentication, and a documented (though not yet externally audited) internal security review.

## 10. Breach notification

The Processor shall notify the Controller without undue delay, and in any case within 72 hours of becoming aware, of any personal data breach affecting data processed under this Agreement, providing the information required to allow the Controller to meet its own Article 33/34 obligations.

## 11. Term and termination

Either Party may terminate this Agreement in line with the termination provisions of the underlying partnership agreement. On termination, Section 6(g) applies.

## 12. Governing law

This Agreement is governed by the laws of England and Wales.

---

## Annex A — Technical and organisational measures (summary)

- TLS encryption in transit; platform-level encryption at rest (Cloudflare D1).
- Server-side WebAuthn verification for biometric sign-in, with clone-detection alerting.
- Server-side session management with individual and mass revocation.
- Rate limiting and bot protection (Cloudflare Turnstile) on authentication endpoints.
- Parameterised database queries throughout (verified: 284 query sites, July 2026 review).
- Automated secrets scanning across full commit history; automated dependency vulnerability scanning.
- Point-in-time database recovery plus daily off-platform backup export.
- No external penetration test or SOC 2/ISO 27001 certification currently held — internal source-code-level review only (see public Security Center). Cyber Essentials certification in progress as of August 2026.

## Annex B — Current sub-processors

See `docs/governance/sub-processors.md` for the authoritative, maintained list (Cloudflare, Stripe, OpenAI, Sentry, PostHog, Resend, Google, Zoho Desk, Brevo, Anthropic as of the last review). Do not copy a static list into a signed contract without checking it's current at signature time.
