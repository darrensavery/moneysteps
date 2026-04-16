Project summary:
Morechard is a fintech Progressive Web App (PWA) designed for separated and co-parenting families. It functions as a "Truth Engine" that provides legal-grade, audit-ready financial records and a behavioral AI coach to de-escalate conflict between parents while teaching financial literacy and independence to children.
Core requirements:
Immutable ledger where transactions are never deleted and errors require reversal entries.
Cryptographic hashing (SHA-256) for every ledger row, incorporating the previous row's hash.
Audit trail logging server_timestamp and ip_address for every entry.
Verification workflow toggle between "Auto-Verify" (Amicable Mode) and "Manual-Approval" (Standard Mode).
Mutual consent handshake requiring both parents to sign off on governance mode changes.
AI Tone Meter to scan messages for aggression and suggest neutral rewrites.
AI Behavioral Mentor providing age-appropriate financial coaching aligned with UK and Polish national standards.
Reverse trial logic that hard-locks the app after 14 to 31 days unless a license is purchased.
Dual-ledger chore system providing private silos for each household.
Court-admissible PDF export including the financial audit log and governance record.
Bilingual UI and currency support for GBP and PLN.
Technical constraints:
Must be implemented as a high-performance PWA to avoid App Store fees.
Database must be Cloudflare D1 (SQL) migrated from Firebase (NoSQL).
Currency must be stored as Integers (Pence/Groszy).
All financial models in AI interactions must use LaTeX.
UI must use 12px corner radius for all cards and buttons.
Specific color palette: Deep Teal (#007A78), Ochre Gold (#D4A017), Charcoal (#2D3436).
Typography must be Inter (headlines/body) and JetBrains Mono (data fields).
Polish users must have the AI coach default to the Polish language.
Auth constraints: NOT SPECIFIED IN SOURCES.
Decisions already made:
Transition from Firebase collections to flattened relational tables with Foreign Keys (family_id, parent_id).
Storage of exchange rate snapshots at the exact moment of transaction verification.
Implementation of a 4px Teal border for "Verified" records and Ochre border for "Action Needed" in the UI.
Use of "Process Language" instead of "Outcome Language" for AI coaching scripts.
Formal/Informal language shift for Polish users based on age (16+ uses Pan/Pani).
Pricing set at £34.99 Lifetime License and £14.99–£19.99/year for AI services.
Dependencies & integrations:
Cloudflare Workers (Backend/Hosting)
Cloudflare D1 (Database)
Stripe (Payments/Subscription management)
Gemini or GPT-4o-mini (AI Coach/Tone Meter)
Tailwind CSS and Shadcn UI (Frontend)
Edge cases & risks:
Batch-insert scripts required to avoid Cloudflare Worker execution limits during migration.
"No Bailout" clause: AI must refuse to provide funds if the budget is zero.
Identification of digital risks like "loot boxes" for UK users and BNPL debt spirals for Polish users.
Potential lack of brand recognition compared to competitors with physical cards.
Open questions / gaps:
Specific implementation details for meeting UK/EU "Open Banking" and minor data privacy laws.
Final duration of the trial period (sources conflict between 14 and 31 days).
Specific authentication provider for the Cloudflare stack.
Acceptance criteria:
Every transaction row contains a valid SHA-256 cryptographic fingerprint linked to the previous entry.
PDF exports include a full Governance Log showing parent agreement timestamps.
AI Tone Meter successfully blocks or suggests rewrites for aggressive language before transmission.
App functionality (except "Buy" or "Export Data") is fully restricted upon trial expiration.
Database enforces integer-only currency storage and rejects deletion attempts.

Add chore Leaderboard to letkids compete with siblings
END OUTPUT.