# Teen Mentor Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a topic-locked, moderated chat surface between teen (13+) accounts and the AI Mentor, per `docs/superpowers/specs/2026-08-04-teen-mentor-chat-design.md`.

**Architecture:** Worker route `POST /api/mentor-chat/messages` runs every teen message through a three-layer safety pipeline (OpenAI Moderation API pre-check → topic-locked `gpt-4o-mini` chat call → post-check classifier that also re-validates the model's own output) before persisting to D1 and responding. Distress/abuse-pattern branches never reach the model's raw output — they're replaced with fixed resource copy. Parent visibility is a read-only D1 query into the existing `InsightsTab.tsx`. All of it reuses infrastructure that already exists (`insights.ts`'s OpenAI call pattern, `email.ts`'s `EmailService`, the `has_ai_mentor`/`has_shield` tier columns, the `withAuth`/`JwtPayload` auth model).

**Tech Stack:** Cloudflare Workers + D1 (SQLite), OpenAI `gpt-4o-mini` + Moderation API, React (existing `app/src/components/dashboard/InsightsTab.tsx` shell), Resend via existing `EmailService`.

## Global Constraints

- Feature is teen-only (13+) — never exposed to sub-13 accounts, enforced server-side against a verified birth-date fact (exact day-level age, not calendar-year subtraction), not the client or the existing `teen_mode` UI-framing toggle.
- Chat content is excluded from the hash-chained ledger and Shield AI forensic PDF export by construction (separate tables, never joined into export queries) — not a filter flag.
- Both parents in a family see the same chat transcripts (no asymmetric access).
- The mentor never attempts to counsel, discuss, or engage on self-harm/abuse content — acknowledge briefly, show resources, stop.
- Ambiguous distress/abuse-pattern signals fail-safe to the abuse-pattern branch (no parent notification) — this is an explicit priority rule in the classifier, not a confidence average.
- Bundled into the existing AI Mentor tier (`has_ai_mentor` / `has_shield` / `license_type IN ('core_ai','shield')`) — no new pricing SKU.
- Real-time distress alerts use the existing `EmailService` (`worker/src/lib/email.ts`) — push notifications are out of scope (Phase 8, unbuilt).
- **The consent/legal-review gate blocks Track 2 only.** Track 1 tasks are buildable and fully testable now; Track 2 tasks must not be started until Darren confirms legal review of the consent basis (see spec, "Consent flow — UNRESOLVED, blocking") is complete.
- Migration files follow the existing `NNNN_slug.sql` convention, next available number is `0088`.
- D1 has no native boolean — use `INTEGER NOT NULL CHECK (col IN (0,1))`, matching `analytics_consents`/`marketing_consents`.

---

## Track 1 — Unblocked & Parallel (buildable now)

### Task 1: Add verified birth-date column + parent-facing setter

No birth-date/age column exists anywhere in the schema today (confirmed by grep across `worker/migrations/*.sql` and `worker/src/`). `user_settings.teen_mode` is a parent-toggled UI-framing flag ("Seedling" vs "Professional" tone), not a verified age fact, and cannot be reused for a safety-relevant age gate. This task adds the real column and the one endpoint needed to set it.

**A note on precision:** this stores a full ISO date (`birth_date`), not just a birth year. A year-only field can't distinguish "just turned 13" from "turns 13 in five months" — computing age via `currentYear - birthYear` alone can misjudge a child's age by up to a year depending on whether their birthday has passed, which is not an acceptable error margin for a safety-relevant age gate (e.g. it could expose a 12-year-old, born late in the year, to the feature). Exact date avoids that.

**Files:**
- Create: `worker/migrations/0088_child_birth_date.sql`
- Modify: `worker/src/types.ts` (add `birth_date: string | null` to the `users` row type, near the other `users` fields around line 83)
- Modify: `worker/src/routes/childSettings.ts` — if this file doesn't exist, create it; otherwise add the new route to the existing child-settings route file (grep `worker/src/routes/` for `child.*settings` to confirm actual location before creating)
- Modify: `worker/src/index.ts` (register new route)
- Test: `worker/src/routes/childSettings.test.ts`

**Interfaces:**
- Produces: `PATCH /api/children/:child_id/birth-date` — parent-only, body `{ birth_date: string }` (ISO `YYYY-MM-DD`), validates it parses to a plausible child age (5–19 years old at time of write). Returns `{ birth_date: string }`.
- Produces: `isTeenAccount(birthDate: string | null, now: Date): boolean` exported from `worker/src/lib/ageGate.ts` — returns `true` when exact age (day-level, not calendar-year subtraction) is 13–17 inclusive; returns `false` (never throws) when `birthDate` is `null`/unparseable or resolves to under 13 or 18+.

- [ ] **Step 1: Write the migration**

```sql
-- worker/migrations/0088_child_birth_date.sql
ALTER TABLE users ADD COLUMN birth_date TEXT;
```

- [ ] **Step 2: Apply migration to dev DB and confirm**

Run: `cd worker && npx wrangler d1 migrations apply morechard-dev --remote`
Expected: migration `0088_child_birth_date.sql` listed as applied.

- [ ] **Step 3: Add `birth_date` to the `users` row type in `worker/src/types.ts`**

Add `birth_date: string | null;` immediately after the existing `locale` field on the `users` row interface.

- [ ] **Step 4: Write `worker/src/lib/ageGate.ts`**

```ts
export function isTeenAccount(birthDate: string | null, now: Date = new Date()): boolean {
  if (!birthDate) return false;
  const dob = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;

  return age >= 13 && age <= 17;
}
```

- [ ] **Step 5: Write `worker/src/lib/ageGate.test.ts`**

The boundary cases here are the point of this file — a naive `currentYear - birthYear` calculation would get several of these wrong.

```ts
import { describe, it, expect } from 'vitest';
import { isTeenAccount } from './ageGate.js';

describe('isTeenAccount', () => {
  const now = new Date('2026-08-05T00:00:00Z');

  it('returns false when birth_date is null', () => {
    expect(isTeenAccount(null, now)).toBe(false);
  });

  it('returns false for an unparseable birth_date', () => {
    expect(isTeenAccount('not-a-date', now)).toBe(false);
  });

  it('returns true for someone who already turned 13 earlier this year', () => {
    expect(isTeenAccount('2013-01-01', now)).toBe(true);
  });

  it('returns false for someone who does not turn 13 until later this year', () => {
    expect(isTeenAccount('2013-12-31', now)).toBe(false);
  });

  it('returns true for someone whose 13th birthday is today', () => {
    expect(isTeenAccount('2013-08-05', now)).toBe(true);
  });

  it('returns true for someone who turns 18 later this year (still 17 today)', () => {
    expect(isTeenAccount('2008-12-31', now)).toBe(true);
  });

  it('returns false for someone who already turned 18 earlier this year', () => {
    expect(isTeenAccount('2008-01-01', now)).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `cd worker && npx vitest run src/lib/ageGate.test.ts`
Expected: 7 passing.

- [ ] **Step 7: Locate or create the child-settings route file**

Run: `cd worker && grep -rl "child_id" src/routes/ | grep -i settings`
If a route file already handles per-child settings (e.g. `teen_mode` toggle), add the new endpoint there. Otherwise create `worker/src/routes/childSettings.ts`.

- [ ] **Step 8: Write the failing test for the new endpoint**

```ts
// worker/src/routes/childSettings.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleSetChildBirthDate } from './childSettings.js';

function makeEnv(overrides: Partial<{ first: unknown; run: unknown }> = {}) {
  const first = vi.fn().mockResolvedValue(overrides.first ?? { family_id: 'fam_1' });
  const run = vi.fn().mockResolvedValue(overrides.run ?? { success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as any;
}

describe('handleSetChildBirthDate', () => {
  it('rejects a non-parent caller', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(403);
  });

  it('rejects an implausible birth date', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '1950-01-01' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed date string', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: 'not-a-date' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(400);
  });

  it('accepts a plausible birth date from a parent', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ birth_date: '2013-06-15' });
  });
});
```

- [ ] **Step 9: Run test, verify it fails**

Run: `cd worker && npx vitest run src/routes/childSettings.test.ts`
Expected: FAIL — `handleSetChildBirthDate` not exported.

- [ ] **Step 10: Implement the endpoint**

`childId` is passed in as a parameter, extracted by the route matcher's regex capture group in `worker/src/index.ts` (Step 11) — following the same convention the codebase already uses for other path-param routes, rather than re-parsing `request.url` inside the handler.

```ts
// worker/src/routes/childSettings.ts
import { error, json, parseBody } from '../lib/response.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

function isPlausibleBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dob = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return ageYears >= 5 && ageYears <= 19;
}

export async function handleSetChildBirthDate(request: Request, env: Env, childId: string): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'parent') return error('Forbidden', 403);

  const body = await parseBody(request);
  const birthDate = body?.birth_date;
  if (typeof birthDate !== 'string' || !isPlausibleBirthDate(birthDate)) {
    return error('birth_date must be a plausible ISO date (YYYY-MM-DD)', 400);
  }

  const child = await env.DB.prepare('SELECT family_id FROM users WHERE id = ?')
    .bind(childId).first<{ family_id: string }>();
  if (!child || child.family_id !== auth.family_id) return error('Forbidden', 403);

  await env.DB.prepare('UPDATE users SET birth_date = ? WHERE id = ?')
    .bind(birthDate, childId).run();

  return json({ birth_date: birthDate });
}
```

- [ ] **Step 11: Register the route in `worker/src/index.ts`**

Add near the other `/api/children/` routes, following the existing path-param-via-regex-capture convention used elsewhere in this file:
```ts
const birthDateMatch = path.match(/^\/api\/children\/([^/]+)\/birth-date$/);
if (birthDateMatch && method === 'PATCH') {
  return withAuth(request, auth, env, (req, e) => handleSetChildBirthDate(req, e, birthDateMatch[1]));
}
```
Add the import at the top: `import { handleSetChildBirthDate } from './routes/childSettings.js';`

- [ ] **Step 12: Run test, verify it passes**

Run: `cd worker && npx vitest run src/routes/childSettings.test.ts`
Expected: 4 passing.

- [ ] **Step 13: Commit**

```bash
git add worker/migrations/0088_child_birth_date.sql worker/src/types.ts worker/src/lib/ageGate.ts worker/src/lib/ageGate.test.ts worker/src/routes/childSettings.ts worker/src/routes/childSettings.test.ts worker/src/index.ts
git commit -m "feat: add verified child birth-date field for teen mentor chat age gate"
```

---

### Task 2: D1 schema for chat messages, escalations, and consent log

New tables only — do not reuse the deleted `chat_history`/`chat_rate_limits` tables (confirmed dead in `familyPurge.ts`, no write path exists).

**Files:**
- Create: `worker/migrations/0089_mentor_chat_tables.sql`

**Interfaces:**
- Produces: `mentor_chat_messages(id, family_id, child_id, role, content, moderation_flags, created_at)`
- Produces: `mentor_chat_escalations(id, message_id, escalation_type, parents_notified, created_at)`
- Produces: `mentor_chat_consents(id, user_id, consented, consent_version, ip_address, consented_at)` — same append-only pattern as `marketing_consents`/`analytics_consents`

- [ ] **Step 1: Write the migration**

```sql
-- worker/migrations/0089_mentor_chat_tables.sql
CREATE TABLE IF NOT EXISTS mentor_chat_messages (
  id               TEXT    PRIMARY KEY,
  family_id        TEXT    NOT NULL REFERENCES families(id),
  child_id         TEXT    NOT NULL REFERENCES users(id),
  role             TEXT    NOT NULL CHECK (role IN ('child', 'assistant')),
  content          TEXT    NOT NULL,
  moderation_flags TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_messages_child
  ON mentor_chat_messages (child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_messages_family
  ON mentor_chat_messages (family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mentor_chat_escalations (
  id               TEXT    PRIMARY KEY,
  message_id       TEXT    NOT NULL REFERENCES mentor_chat_messages(id),
  escalation_type  TEXT    NOT NULL CHECK (escalation_type IN ('distress', 'abuse_pattern')),
  parents_notified INTEGER NOT NULL CHECK (parents_notified IN (0, 1)),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_escalations_message
  ON mentor_chat_escalations (message_id);

CREATE TABLE IF NOT EXISTS mentor_chat_consents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  consented       INTEGER NOT NULL CHECK (consented IN (0, 1)),
  consent_version TEXT    NOT NULL,
  ip_address      TEXT    NOT NULL,
  consented_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_consents_user
  ON mentor_chat_consents (user_id, consented_at DESC);
```

- [ ] **Step 2: Apply to dev DB**

Run: `cd worker && npx wrangler d1 migrations apply morechard-dev --remote`
Expected: `0089_mentor_chat_tables.sql` applied, three new tables visible via `npx wrangler d1 execute morechard-dev --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mentor_chat%'"`.

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/0089_mentor_chat_tables.sql
git commit -m "feat: add mentor_chat_messages, mentor_chat_escalations, mentor_chat_consents tables"
```

---

### Task 3: Moderation API wrapper (safety pipeline layer 1)

**Files:**
- Create: `worker/src/lib/mentorChat/moderation.ts`
- Test: `worker/src/lib/mentorChat/moderation.test.ts`

**Interfaces:**
- Consumes: `env.OPENAI_API_KEY` (existing secret, same one `insights.ts` uses)
- Produces: `moderateText(env: Env, text: string): Promise<ModerationResult>` where `ModerationResult = { flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/lib/mentorChat/moderation.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { moderateText } from './moderation.js';

const env = { OPENAI_API_KEY: 'test-key' } as any;

afterEach(() => vi.restoreAllMocks());

describe('moderateText', () => {
  it('returns the parsed moderation result on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.9 } }],
      }),
    }) as any;

    const result = await moderateText(env, 'test message');
    expect(result.flagged).toBe(true);
    expect(result.categories['self-harm']).toBe(true);
  });

  it('throws on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    await expect(moderateText(env, 'test')).rejects.toThrow('OpenAI moderation 500');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/lib/mentorChat/moderation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/lib/mentorChat/moderation.ts
import type { Env } from '../../types.js';

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

export async function moderateText(env: Env, text: string): Promise<ModerationResult> {
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`OpenAI moderation ${res.status}`);
  const data = await res.json() as { results: ModerationResult[] };
  return data.results[0];
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/lib/mentorChat/moderation.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/mentorChat/moderation.ts worker/src/lib/mentorChat/moderation.test.ts
git commit -m "feat: add OpenAI moderation API wrapper for mentor chat safety pipeline"
```

---

### Task 4: System prompt + localized crisis resource copy

**Files:**
- Create: `worker/src/lib/mentorChat/prompts.ts`
- Test: `worker/src/lib/mentorChat/prompts.test.ts`

**Interfaces:**
- Produces: `buildSystemPrompt(locale: 'en' | 'pl'): string`
- Produces: `getCrisisResources(locale: 'en' | 'pl', kind: 'distress' | 'abuse_pattern'): { title: string; body: string }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/lib/mentorChat/prompts.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, getCrisisResources } from './prompts.js';

describe('buildSystemPrompt', () => {
  it('includes the topic-lock instruction', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toContain('money, chores, and financial literacy');
    expect(prompt).toContain('never decide');
  });
});

describe('getCrisisResources', () => {
  it('returns UK-oriented distress resources for en locale', () => {
    const res = getCrisisResources('en', 'distress');
    expect(res.body).toContain('Childline');
  });

  it('returns Polish child-protection resources for pl locale, abuse_pattern kind', () => {
    const res = getCrisisResources('pl', 'abuse_pattern');
    expect(res.body).toContain('116 111');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/lib/mentorChat/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/lib/mentorChat/prompts.ts

export function buildSystemPrompt(locale: 'en' | 'pl'): string {
  const persona = locale === 'pl'
    ? 'Jesteś Mentorem Finansowym Morechard dla nastolatków.'
    : 'You are the Morechard AI Mentor for teenagers.';

  return `${persona}

You only discuss money, chores, and financial literacy. If the teen brings up anything else, gently redirect them back to those topics or suggest they talk to a parent.

Your tone is supportive, motivating, and honest — including firm-but-fair when the teen is about to make a poor financial decision. You never decide anything for the teen. You reflect their thinking back to them, ask clarifying questions, and help them reason it through themselves.

You are not a mental-health support system. If a teen discloses self-harm, distress, or abuse, do not attempt to counsel or discuss it — that is handled by a separate safety system before your response is shown.`;
}

interface CrisisResource {
  title: string;
  body: string;
}

const CRISIS_RESOURCES: Record<'en' | 'pl', Record<'distress' | 'abuse_pattern', CrisisResource>> = {
  en: {
    distress: {
      title: "You're not alone",
      body: 'If you\'re struggling right now, Childline (0800 1111, free, confidential, 24/7) or Samaritans (116 123) can help. We\'ve also let your parent(s) know so someone who cares about you can check in.',
    },
    abuse_pattern: {
      title: 'You deserve to be safe',
      body: 'If someone at home is hurting you, Childline (0800 1111, free, confidential, 24/7) or the NSPCC (0808 800 5000) can help — you can talk to them without anyone else finding out.',
    },
  },
  pl: {
    distress: {
      title: 'Nie jesteś sam/sama',
      body: 'Jeśli teraz się zmagasz, zadzwoń pod 116 111 (Telefon Zaufania dla Dzieci i Młodzieży, bezpłatny, całodobowy). Poinformowaliśmy też Twojego rodzica/rodziców, żeby ktoś mógł Cię wesprzeć.',
    },
    abuse_pattern: {
      title: 'Zasługujesz na bezpieczeństwo',
      body: 'Jeśli ktoś w domu Cię krzywdzi, zadzwoń pod 116 111 — możesz porozmawiać bez wiedzy innych domowników.',
    },
  },
};

export function getCrisisResources(locale: 'en' | 'pl', kind: 'distress' | 'abuse_pattern'): CrisisResource {
  return CRISIS_RESOURCES[locale][kind];
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/lib/mentorChat/prompts.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/mentorChat/prompts.ts worker/src/lib/mentorChat/prompts.test.ts
git commit -m "feat: add mentor chat system prompt and localized crisis resource copy"
```

---

### Task 5: Crisis classifier with fail-safe abuse-pattern override (safety pipeline layer 3)

This is the highest-stakes piece of logic in the feature — it decides which of four branches a message takes, including the explicit fail-safe rule from the spec: any weak abuse/parent-conflict signal suppresses parent notification, full stop, regardless of an accompanying distress signal.

**Files:**
- Create: `worker/src/lib/mentorChat/classifier.ts`
- Test: `worker/src/lib/mentorChat/classifier.test.ts`

**Interfaces:**
- Consumes: `ModerationResult` from Task 3 (`worker/src/lib/mentorChat/moderation.ts`)
- Produces: `type ChatBranch = 'on_topic' | 'off_topic' | 'distress' | 'abuse_pattern'`
- Produces: `classifyChildMessage(env: Env, opts: { text: string; moderation: ModerationResult }): Promise<{ branch: ChatBranch; rawFlags: Record<string, unknown> }>`
- Produces: `classifyAssistantOutput(env: Env, opts: { text: string }): Promise<{ onTopic: boolean }>` — the output-side topic-containment check (jailbreak resilience layer, per spec: the system prompt alone is not resilient to jailbreaking, this is the real enforcement)

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/lib/mentorChat/classifier.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyChildMessage, classifyAssistantOutput } from './classifier.js';

const env = { OPENAI_API_KEY: 'test-key' } as any;

afterEach(() => vi.restoreAllMocks());

function mockClassifyResponse(json: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }),
  }) as any;
}

describe('classifyChildMessage', () => {
  it('returns off_topic for an on-topic-flagged-false, no distress/abuse signal', async () => {
    mockClassifyResponse({ off_topic: true, distress_signal: false, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'what console should I buy',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('off_topic');
  });

  it('returns distress when only distress_signal is true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: true, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'I don\'t see the point in saving, nothing matters anymore',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.8 } },
    });
    expect(result.branch).toBe('distress');
  });

  it('returns abuse_pattern when only abuse_signal is true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: true });
    const result = await classifyChildMessage(env, {
      text: 'my dad takes all my chore money and won\'t give it back',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('abuse_pattern');
  });

  it('fail-safe: returns abuse_pattern when BOTH distress and abuse signals are true', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: true, abuse_signal: true });
    const result = await classifyChildMessage(env, {
      text: 'I want to run away or worse, my dad won\'t stop screaming at me',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.6 } },
    });
    expect(result.branch).toBe('abuse_pattern');
  });

  it('returns on_topic when nothing is flagged', async () => {
    mockClassifyResponse({ off_topic: false, distress_signal: false, abuse_signal: false });
    const result = await classifyChildMessage(env, {
      text: 'should I save for a bike or spend on games',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    });
    expect(result.branch).toBe('on_topic');
  });
});

describe('classifyChildMessage fail-closed behavior', () => {
  it('fails closed to distress when moderation flagged something but the classifier call itself throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await classifyChildMessage(env, {
      text: 'something is really wrong',
      moderation: { flagged: true, categories: { 'self-harm': true }, category_scores: { 'self-harm': 0.7 } },
    });
    expect(result.branch).toBe('distress');
  });

  it('rethrows when the classifier call fails and moderation found nothing (ordinary service error, not a fabricated crisis branch)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(classifyChildMessage(env, {
      text: 'should I buy a game or save',
      moderation: { flagged: false, categories: {}, category_scores: {} },
    })).rejects.toThrow('network error');
  });
});

describe('classifyAssistantOutput', () => {
  it('flags output that drifted off-topic', async () => {
    mockClassifyResponse({ on_topic: false });
    const result = await classifyAssistantOutput(env, { text: 'Let\'s talk about your favorite movie instead' });
    expect(result.onTopic).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/lib/mentorChat/classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/lib/mentorChat/classifier.ts
import type { Env } from '../../types.js';
import type { ModerationResult } from './moderation.js';

export type ChatBranch = 'on_topic' | 'off_topic' | 'distress' | 'abuse_pattern';

interface RawClassification {
  off_topic: boolean;
  distress_signal: boolean;
  abuse_signal: boolean;
}

async function callClassifier(env: Env, systemPrompt: string, userText: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OpenAI classifier ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return JSON.parse(data.choices[0]?.message?.content ?? '{}');
}

export async function classifyChildMessage(
  env: Env,
  opts: { text: string; moderation: ModerationResult },
): Promise<{ branch: ChatBranch; rawFlags: Record<string, unknown> }> {
  const systemPrompt = `Classify the following message from a teenager in a financial-literacy chat app. Respond as JSON: {"off_topic": boolean, "distress_signal": boolean, "abuse_signal": boolean}. "distress_signal" = self-harm, suicidal ideation, or severe emotional distress. "abuse_signal" = any suggestion a parent/guardian is hurting, threatening, or mistreating them, including financially. "off_topic" = the message is not about money, chores, or financial literacy AND has no distress or abuse signal. If uncertain between distress and abuse, set BOTH to true.`;

  let raw: Partial<RawClassification>;
  try {
    raw = await callClassifier(env, systemPrompt, opts.text) as Partial<RawClassification>;
  } catch (err) {
    // Fail-closed: a thrown classifier call must never silently resolve to on_topic.
    // If OpenAI's own moderation pre-check already flagged something, treat that as a
    // real signal — crisis resources are always safe to show, and routing to distress
    // is the least-bad guess when we have no way to tell distress apart from abuse
    // (the moderation API has no caregiver-abuse category to lean on here). If
    // moderation found nothing either, this was very likely an infra blip on an
    // ordinary message — surface it as a normal service error instead of fabricating
    // a crisis branch for a plain network failure.
    if (opts.moderation.flagged) {
      return { branch: 'distress', rawFlags: { classifierFailed: true } };
    }
    throw err;
  }

  const distressSignal = raw.distress_signal === true || opts.moderation.categories['self-harm'] === true;
  const abuseSignal = raw.abuse_signal === true;

  // Fail-safe override: any abuse signal — alone or alongside distress — routes to
  // abuse_pattern, never distress. Wrongly alerting a potentially abusive parent is a
  // worse failure than wrongly withholding a distress alert (teen still gets in-chat
  // crisis resources on the abuse_pattern branch either way).
  let branch: ChatBranch;
  if (abuseSignal) {
    branch = 'abuse_pattern';
  } else if (distressSignal) {
    branch = 'distress';
  } else if (raw.off_topic === true) {
    branch = 'off_topic';
  } else {
    branch = 'on_topic';
  }

  return { branch, rawFlags: raw as Record<string, unknown> };
}

export async function classifyAssistantOutput(
  env: Env,
  opts: { text: string },
): Promise<{ onTopic: boolean }> {
  const systemPrompt = `Classify whether the following chatbot reply stays strictly within money, chores, and financial literacy topics for a teenager. Respond as JSON: {"on_topic": boolean}.`;
  const raw = await callClassifier(env, systemPrompt, opts.text) as { on_topic?: boolean };
  return { onTopic: raw.on_topic !== false };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/lib/mentorChat/classifier.test.ts`
Expected: 8 passing. Two of these tests most directly encode the spec's safety requirements — read their assertions carefully before moving on, don't let them pass by accident: the fail-safe test (`fail-safe: returns abuse_pattern when BOTH...`), and the fail-closed test (`fails closed to distress when moderation flagged something but the classifier call itself throws`).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/mentorChat/classifier.ts worker/src/lib/mentorChat/classifier.test.ts
git commit -m "feat: add mentor chat crisis classifier with fail-safe abuse-pattern override"
```

---

### Task 6: Distress-escalation email alert

**Files:**
- Create: `worker/src/lib/mentorChat/alerts.ts`
- Test: `worker/src/lib/mentorChat/alerts.test.ts`

**Interfaces:**
- Consumes: `EmailService` from `worker/src/lib/email.ts` (`sendTransactional({ to, subject, html, text })`)
- Produces: `notifyParentsOfDistress(env: Env, opts: { familyId: string; childDisplayName: string; locale: 'en' | 'pl' }): Promise<void>` — looks up all parent emails for the family and sends to each in parallel

- [ ] **Step 1: Write the failing test**

```ts
// worker/src/lib/mentorChat/alerts.test.ts
import { describe, it, expect, vi } from 'vitest';
import { notifyParentsOfDistress } from './alerts.js';

vi.mock('../email.js', () => ({
  EmailService: vi.fn().mockImplementation(() => ({
    sendTransactional: vi.fn().mockResolvedValue(undefined),
  })),
}));

function makeEnv() {
  const all = vi.fn().mockResolvedValue({
    results: [{ email: 'parent1@example.com' }, { email: 'parent2@example.com' }],
  });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as any;
}

describe('notifyParentsOfDistress', () => {
  it('sends to every parent email in the family', async () => {
    const env = makeEnv();
    const { EmailService } = await import('../email.js');
    await notifyParentsOfDistress(env, { familyId: 'fam_1', childDisplayName: 'Robin', locale: 'en' });
    const instance = (EmailService as any).mock.results[0].value;
    expect(instance.sendTransactional).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/lib/mentorChat/alerts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/lib/mentorChat/alerts.ts
import { EmailService } from '../email.js';
import type { Env } from '../../types.js';

export async function notifyParentsOfDistress(
  env: Env,
  opts: { familyId: string; childDisplayName: string; locale: 'en' | 'pl' },
): Promise<void> {
  const parents = await env.DB
    .prepare(`SELECT u.email FROM users u
              JOIN family_roles fr ON fr.user_id = u.id
              WHERE fr.family_id = ? AND fr.role = 'parent' AND u.email IS NOT NULL`)
    .bind(opts.familyId)
    .all<{ email: string }>();

  const subject = opts.locale === 'pl'
    ? `Wiadomość od ${opts.childDisplayName} wymaga Twojej uwagi`
    : `A message from ${opts.childDisplayName} needs your attention`;

  const text = opts.locale === 'pl'
    ? `${opts.childDisplayName} napisał(a) coś w czacie z Mentorem AI, co sugeruje, że może potrzebować wsparcia. Zalecamy jak najszybszą rozmowę.`
    : `${opts.childDisplayName} wrote something in their AI Mentor chat that suggests they may need support. We'd recommend checking in with them as soon as you can.`;

  const emailService = new EmailService(env);
  await Promise.all(
    parents.results.map((p) =>
      emailService.sendTransactional({
        to: p.email,
        subject,
        html: `<p>${text}</p>`,
        text,
      }),
    ),
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/lib/mentorChat/alerts.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/mentorChat/alerts.ts worker/src/lib/mentorChat/alerts.test.ts
git commit -m "feat: add distress-escalation parent email alert for mentor chat"
```

---

### Task 7: Core chat route — `POST /api/mentor-chat/messages`

Wires layers 1–3 together. This task also introduces the `MENTOR_CHAT_ENABLED` guard that Track 2's final task will flip on for real families — until then, the route works end-to-end but returns 403 unless a test/internal bypass is used, so this task is fully testable in isolation without needing the consent UI to exist yet.

**Files:**
- Create: `worker/src/routes/mentorChat.ts`
- Modify: `worker/src/index.ts` (register route)
- Modify: `worker/src/types.ts` (add `MENTOR_CHAT_ENABLED?: string` to `Env`)
- Test: `worker/src/routes/mentorChat.test.ts`

**Interfaces:**
- Consumes: `moderateText` (Task 3), `buildSystemPrompt`/`getCrisisResources` (Task 4), `classifyChildMessage`/`classifyAssistantOutput` (Task 5), `notifyParentsOfDistress` (Task 6), `isTeenAccount` (Task 1)
- Produces: `handlePostMentorChatMessage(request: Request, env: Env): Promise<Response>` — request body `{ child_id: string, message: string }`, response `{ reply: string; branch: 'on_topic' | 'off_topic' | 'distress' | 'abuse_pattern' }`

- [ ] **Step 1: Write the failing test (on-topic happy path)**

```ts
// worker/src/routes/mentorChat.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handlePostMentorChatMessage } from './mentorChat.js';
import * as moderation from '../lib/mentorChat/moderation.js';
import * as classifier from '../lib/mentorChat/classifier.js';
import * as alerts from '../lib/mentorChat/alerts.js';

function makeEnv(overrides: { childRow?: unknown; rateCount?: number; consentRow?: unknown } = {}) {
  const first = vi.fn((sql: string) => {
    if (sql.includes('FROM users')) {
      return Promise.resolve(overrides.childRow ?? { family_id: 'fam_1', birth_date: '2013-01-01', locale: 'en', display_name: 'Robin' });
    }
    if (sql.includes('mentor_chat_consents')) {
      return Promise.resolve(overrides.consentRow ?? { consented: 1 });
    }
    if (sql.includes('COUNT(*)')) {
      return Promise.resolve({ n: overrides.rateCount ?? 0 });
    }
    return Promise.resolve(null);
  });
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn((sql: string) => ({ bind: () => bind(sql) }));
  // simpler: make prepare capture sql and bind return object using closures keyed by sql
  const realPrepare = vi.fn((sql: string) => ({
    bind: (..._args: unknown[]) => ({
      first: () => first(sql),
      run,
    }),
  }));
  return {
    DB: { prepare: realPrepare },
    OPENAI_API_KEY: 'test-key',
    MENTOR_CHAT_ENABLED: 'true',
  } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('handlePostMentorChatMessage', () => {
  it('returns the assistant reply for an on-topic message', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'on_topic', rawFlags: {} });
    vi.spyOn(classifier, 'classifyAssistantOutput').mockResolvedValue({ onTopic: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Have you thought about splitting it between saving and spending?' } }] }),
    }) as any;

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'should I buy a game or save' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('on_topic');
    expect(body.reply).toContain('splitting');
  });

  it('returns the off-topic redirect and writes no escalation row', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'off_topic', rawFlags: {} });

    const runCalls: string[] = [];
    const env = makeEnv();
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args);
          return {
            ...bound,
            run: () => { runCalls.push(sql); return bound.run(); },
          };
        },
      };
    };

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'what console should I buy' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('off_topic');
    expect(body.reply).toContain("outside what I can help with");
    expect(runCalls.some((sql) => sql.includes('mentor_chat_escalations'))).toBe(false);
  });

  it('returns crisis resources and notifies parents on distress branch', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: true, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'distress', rawFlags: {} });
    const notifySpy = vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'nothing matters anymore' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toBe('distress');
    expect(body.reply).toContain('Childline');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('does not notify parents on abuse_pattern branch', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockResolvedValue({ branch: 'abuse_pattern', rawFlags: {} });
    const notifySpy = vi.spyOn(alerts, 'notifyParentsOfDistress').mockResolvedValue(undefined);

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'my dad takes my chore money' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(200);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('rejects a sub-13 account', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const env = makeEnv({ childRow: { family_id: 'fam_1', birth_date: '2018-01-01', locale: 'en', display_name: 'Robin' } });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(403);
  });

  it('rejects when the hourly rate limit is exceeded', async () => {
    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const env = makeEnv({ rateCount: 20 });
    const res = await handlePostMentorChatMessage(req, env);
    expect(res.status).toBe(429);
  });

  it('returns 503 when moderation succeeds but the classifier throws with no moderation flag (fail-closed to a plain service error, not a fabricated crisis branch)', async () => {
    vi.spyOn(moderation, 'moderateText').mockResolvedValue({ flagged: false, categories: {}, category_scores: {} });
    vi.spyOn(classifier, 'classifyChildMessage').mockRejectedValue(new Error('network error'));

    const req = new Request('https://x/api/mentor-chat/messages', {
      method: 'POST',
      body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handlePostMentorChatMessage(req, makeEnv());
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/routes/mentorChat.ts
import { error, json, parseBody } from '../lib/response.js';
import { isTeenAccount } from '../lib/ageGate.js';
import { moderateText } from '../lib/mentorChat/moderation.js';
import { buildSystemPrompt, getCrisisResources } from '../lib/mentorChat/prompts.js';
import { classifyChildMessage, classifyAssistantOutput } from '../lib/mentorChat/classifier.js';
import { notifyParentsOfDistress } from '../lib/mentorChat/alerts.js';
import { nanoid } from '../lib/nanoid.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

const HOURLY_LIMIT = 20;
const DAILY_LIMIT = 60;

const OFF_TOPIC_REPLY_EN = "That's outside what I can help with — want to talk to a parent about it instead? I'm here for money, chores, and saving questions any time.";
const OFF_TOPIC_REPLY_PL = 'To wykracza poza to, w czym mogę pomóc — może porozmawiasz o tym z rodzicem? Jestem tu, żeby pomóc z pieniędzmi, obowiązkami i oszczędzaniem.';

export async function handlePostMentorChatMessage(request: Request, env: Env): Promise<Response> {
  if (env.MENTOR_CHAT_ENABLED !== 'true') return error('Not available', 403);

  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Forbidden', 403);

  const body = await parseBody(request);
  const childId = body?.child_id;
  const message = body?.message;
  if (typeof childId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return error('child_id and message are required', 400);
  }
  if (childId !== auth.sub) return error('Forbidden', 403);

  const child = await env.DB
    .prepare('SELECT family_id, birth_date, locale, display_name FROM users WHERE id = ?')
    .bind(childId)
    .first<{ family_id: string; birth_date: string | null; locale: 'en' | 'pl'; display_name: string }>();
  if (!child || child.family_id !== auth.family_id) return error('Forbidden', 403);
  if (!isTeenAccount(child.birth_date)) return error('Not available for this account', 403);

  const consent = await env.DB
    .prepare('SELECT consented FROM mentor_chat_consents WHERE user_id = ? ORDER BY consented_at DESC LIMIT 1')
    .bind(childId)
    .first<{ consented: number }>();
  if (!consent || consent.consented !== 1) return error('Consent required', 403);

  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  const hourlyCount = await env.DB
    .prepare(`SELECT COUNT(*) as n FROM mentor_chat_messages WHERE child_id = ? AND role = 'child' AND created_at > ?`)
    .bind(childId, oneHourAgo)
    .first<{ n: number }>();
  if ((hourlyCount?.n ?? 0) >= HOURLY_LIMIT) return error('Rate limit exceeded', 429);
  const dailyCount = await env.DB
    .prepare(`SELECT COUNT(*) as n FROM mentor_chat_messages WHERE child_id = ? AND role = 'child' AND created_at > ?`)
    .bind(childId, oneDayAgo)
    .first<{ n: number }>();
  if ((dailyCount?.n ?? 0) >= DAILY_LIMIT) return error('Rate limit exceeded', 429);

  let moderationResult;
  let classification;
  try {
    moderationResult = await moderateText(env, message);
    classification = await classifyChildMessage(env, { text: message, moderation: moderationResult });
  } catch {
    // Covers both: the moderation pre-check itself failing (no signal at all to act
    // on), and classifyChildMessage's own fail-closed path re-throwing when moderation
    // found nothing (see classifier.ts) — in both cases this was an infra failure on
    // an otherwise-ordinary message, not a crisis, so surface a plain service error.
    return error('Mentor is unavailable right now, try again shortly', 503);
  }

  const childMessageId = nanoid();
  await env.DB
    .prepare(`INSERT INTO mentor_chat_messages (id, family_id, child_id, role, content, moderation_flags, created_at)
              VALUES (?, ?, ?, 'child', ?, ?, unixepoch())`)
    .bind(childMessageId, child.family_id, childId, message, JSON.stringify(moderationResult))
    .run();

  let reply: string;

  if (classification.branch === 'off_topic') {
    reply = child.locale === 'pl' ? OFF_TOPIC_REPLY_PL : OFF_TOPIC_REPLY_EN;
  } else if (classification.branch === 'distress' || classification.branch === 'abuse_pattern') {
    const resources = getCrisisResources(child.locale, classification.branch);
    reply = `${resources.title}. ${resources.body}`;

    const escalationId = nanoid();
    const parentsNotified = classification.branch === 'distress';
    await env.DB
      .prepare(`INSERT INTO mentor_chat_escalations (id, message_id, escalation_type, parents_notified, created_at)
                VALUES (?, ?, ?, ?, unixepoch())`)
      .bind(escalationId, childMessageId, classification.branch, parentsNotified ? 1 : 0)
      .run();

    if (parentsNotified) {
      await notifyParentsOfDistress(env, {
        familyId: child.family_id,
        childDisplayName: child.display_name,
        locale: child.locale,
      });
    }
  } else {
    const systemPrompt = buildSystemPrompt(child.locale);
    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!chatRes.ok) return error('Mentor is unavailable right now, try again shortly', 503);
    const chatData = await chatRes.json() as { choices: Array<{ message: { content: string } }> };
    const draftReply = chatData.choices[0]?.message?.content ?? '';

    const outputCheck = await classifyAssistantOutput(env, { text: draftReply });
    reply = outputCheck.onTopic
      ? draftReply
      : (child.locale === 'pl' ? OFF_TOPIC_REPLY_PL : OFF_TOPIC_REPLY_EN);
  }

  await env.DB
    .prepare(`INSERT INTO mentor_chat_messages (id, family_id, child_id, role, content, moderation_flags, created_at)
              VALUES (?, ?, ?, 'assistant', ?, NULL, unixepoch())`)
    .bind(nanoid(), child.family_id, childId, reply)
    .run();

  return json({ reply, branch: classification.branch });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Register the route in `worker/src/index.ts`**

Add import: `import { handlePostMentorChatMessage } from './routes/mentorChat.js';`
Add route (after the auth gate, alongside other `/api/mentor-chat/` routes added in Task 9):
```ts
if (path === '/api/mentor-chat/messages' && method === 'POST') {
  return withAuth(request, auth, env, handlePostMentorChatMessage);
}
```

- [ ] **Step 6: Add `MENTOR_CHAT_ENABLED` to `Env` in `worker/src/types.ts`**

Add `MENTOR_CHAT_ENABLED?: string;` to the `Env` interface, alongside other optional string env bindings.

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/mentorChat.ts worker/src/index.ts worker/src/types.ts
git commit -m "feat: add POST /api/mentor-chat/messages with full safety pipeline"
```

---

### Task 8: History routes for child and parent views

**Files:**
- Modify: `worker/src/routes/mentorChat.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/src/routes/mentorChat.test.ts`

**Interfaces:**
- Produces: `handleGetMentorChatHistory(request: Request, env: Env): Promise<Response>` — `GET /api/mentor-chat/messages?child_id=X`. If `auth.role === 'child'`, `child_id` must equal `auth.sub`. If `auth.role === 'parent'`, `child_id` must belong to `auth.family_id`. Returns `{ messages: Array<{ id, role, content, created_at, escalation_type: 'distress' | 'abuse_pattern' | null }> }`. **Parent-facing responses must never include a message flagged `abuse_pattern`'s escalation badge as visible to the parent in a way that implies notification happened** — the escalation type itself can be shown (transcript is fully visible either way per the spec), but this route does not send any notification; that already happened (or didn't) in Task 7.

- [ ] **Step 1: Write the failing test**

```ts
// append to worker/src/routes/mentorChat.test.ts
import { handleGetMentorChatHistory } from './mentorChat.js';

describe('handleGetMentorChatHistory', () => {
  function makeHistoryEnv(rows: unknown[]) {
    const all = vi.fn().mockResolvedValue({ results: rows });
    const first = vi.fn().mockResolvedValue({ family_id: 'fam_1' });
    const bind = vi.fn().mockReturnValue({ all, first });
    const prepare = vi.fn().mockReturnValue({ bind });
    return { DB: { prepare } } as any;
  }

  it('lets a child read their own history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([
      { id: 'm1', role: 'child', content: 'hi', created_at: 1000, escalation_type: null },
    ]));
    expect(res.status).toBe(200);
  });

  it('blocks a child reading another child\'s history', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_2');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([]));
    expect(res.status).toBe(403);
  });

  it('lets a parent read a child in their family', async () => {
    const req = new Request('https://x/api/mentor-chat/messages?child_id=child_1');
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleGetMentorChatHistory(req, makeHistoryEnv([]));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: FAIL — `handleGetMentorChatHistory` not exported.

- [ ] **Step 3: Implement, appending to `worker/src/routes/mentorChat.ts`**

```ts
export async function handleGetMentorChatHistory(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  const url = new URL(request.url);
  const childId = url.searchParams.get('child_id');
  if (!childId) return error('child_id required', 400);

  if (auth.role === 'child') {
    if (childId !== auth.sub) return error('Forbidden', 403);
  } else {
    const child = await env.DB.prepare('SELECT family_id FROM users WHERE id = ?')
      .bind(childId).first<{ family_id: string }>();
    if (!child || child.family_id !== auth.family_id) return error('Forbidden', 403);
  }

  const rows = await env.DB
    .prepare(`SELECT m.id, m.role, m.content, m.created_at, e.escalation_type
              FROM mentor_chat_messages m
              LEFT JOIN mentor_chat_escalations e ON e.message_id = m.id
              WHERE m.child_id = ?
              ORDER BY m.created_at ASC`)
    .bind(childId)
    .all<{ id: string; role: string; content: string; created_at: number; escalation_type: string | null }>();

  return json({ messages: rows.results });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: 10 passing (7 from Task 7 + 3 new).

- [ ] **Step 5: Register the route in `worker/src/index.ts`**

```ts
if (path === '/api/mentor-chat/messages' && method === 'GET') {
  return withAuth(request, auth, env, handleGetMentorChatHistory);
}
```
Update the import line from Task 7 to include `handleGetMentorChatHistory`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/mentorChat.ts worker/src/routes/mentorChat.test.ts worker/src/index.ts
git commit -m "feat: add GET /api/mentor-chat/messages history endpoint for child and parent"
```

---

### Task 9: Tier gating on the chat route

**Files:**
- Modify: `worker/src/routes/mentorChat.ts`
- Test: `worker/src/routes/mentorChat.test.ts`

**Interfaces:**
- Modifies `handlePostMentorChatMessage` to add a tier check before the age/consent checks, matching the pattern in `worker/src/routes/export.ts:132-149` — query `has_ai_mentor, has_shield` from `families` and reject with 403 if neither is set.

- [ ] **Step 1: Write the failing test**

```ts
// append to worker/src/routes/mentorChat.test.ts
it('rejects a family without AI Mentor tier', async () => {
  const req = new Request('https://x/api/mentor-chat/messages', {
    method: 'POST',
    body: JSON.stringify({ child_id: 'child_1', message: 'hi' }),
  });
  (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

  const first = vi.fn((sql: string) => {
    if (sql.includes('has_ai_mentor')) return Promise.resolve({ has_ai_mentor: 0, has_shield: 0 });
    return Promise.resolve(null);
  });
  const bind = vi.fn().mockReturnValue({ first });
  const env = { DB: { prepare: vi.fn(() => ({ bind })) }, MENTOR_CHAT_ENABLED: 'true' } as any;

  const res = await handlePostMentorChatMessage(req, env);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: FAIL (current implementation doesn't check tier, so this test hits the "child not found" path instead and doesn't reliably assert 403 for the right reason — confirm by checking the mock isn't just failing at the child lookup; if needed, extend the mock's `first` to also satisfy the `FROM users` query so the tier check is what's actually being exercised).

- [ ] **Step 3: Implement — add tier check to `handlePostMentorChatMessage`, right after the `MENTOR_CHAT_ENABLED` check**

```ts
  const family = await env.DB
    .prepare('SELECT has_ai_mentor, has_shield FROM families WHERE id = ?')
    .bind(auth.family_id)
    .first<{ has_ai_mentor: number; has_shield: number }>();
  if (!family?.has_ai_mentor && !family?.has_shield) {
    return error('AI Mentor required', 403);
  }
```

- [ ] **Step 4: Update the other tests' mock `env` in this file to satisfy the new `families` query**

In `makeEnv()`, extend the `first` closure so a query containing `has_ai_mentor` resolves to `{ has_ai_mentor: 1, has_shield: 0 }` by default (overridable), so the existing passing tests keep passing with the new check in place.

- [ ] **Step 5: Run test, verify all pass**

Run: `cd worker && npx vitest run src/routes/mentorChat.test.ts`
Expected: 11 passing.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/mentorChat.ts worker/src/routes/mentorChat.test.ts
git commit -m "feat: gate mentor chat behind existing AI Mentor / Shield AI tier"
```

---

### Task 10: Add mentor chat tables to family purge job

**Files:**
- Modify: `worker/src/jobs/familyPurge.ts`
- Test: `worker/src/jobs/familyPurge.test.ts` (extend existing test file if present; otherwise verify manually per Step 3 below — check for an existing test file first)

**Interfaces:**
- Modifies the `familyTables` array (family-id-keyed deletes) to include `mentor_chat_messages`.
- Modifies the `childKeyedTables` array to include nothing new (child_id is redundant with family_id here since `mentor_chat_messages` is deleted by family_id, and `mentor_chat_escalations` cascades via `message_id` — see Step 1).

- [ ] **Step 1: Add `mentor_chat_messages` to the family-keyed table list**

In `worker/src/jobs/familyPurge.ts`, add `'mentor_chat_messages'` to the `familyTables` array alongside `'insight_snapshots'` etc.

Add a corresponding delete for `mentor_chat_escalations`, which has no `family_id` column of its own — it must be deleted via a subquery on `message_id`, added as its own batch statement immediately after the `mentor_chat_messages` deletes are queued (but note: D1 `batch()` executes all statements in the array atomically as one transaction, and per-statement ordering within the array is preserved, so this subquery must run *before* the `mentor_chat_messages` DELETE that would remove the rows it joins against — insert it earlier in the batch array, not after):

```ts
batch.push(env.DB.prepare(
  `DELETE FROM mentor_chat_escalations WHERE message_id IN (SELECT id FROM mentor_chat_messages WHERE family_id = ?)`
).bind(familyId));
```//place this line immediately before the loop that pushes the `familyTables` deletes, so it executes first in the same `env.DB.batch(batch)` call.

- [ ] **Step 2: Check for an existing test file**

Run: `cd worker && ls src/jobs/familyPurge.test.ts 2>/dev/null || echo "no test file"`

- [ ] **Step 3a: If a test file exists, add a case asserting `mentor_chat_messages` and `mentor_chat_escalations` are included in the purge batch** (follow the existing test's mocking pattern for `env.DB.batch` — inspect an existing assertion in that file for the exact mock shape before writing the new one, since the pattern must match what's already there).

- [ ] **Step 3b: If no test file exists, verify manually**

Run: `cd worker && npx tsc --noEmit` to confirm the file still compiles, then manually re-read the modified `familyTables` array and the new escalation-delete statement to confirm the family_id and subquery reference the correct new table/column names from Task 2.

- [ ] **Step 4: Commit**

```bash
git add worker/src/jobs/familyPurge.ts
git commit -m "feat: include mentor chat tables in family purge job"
```

---

### Task 11: Governance doc — AI System 3 entry

**Files:**
- Modify: `docs/governance/ai-inventory.md`

- [ ] **Step 1: Add a new section after "AI System 2: Child Mentor Chat — DECOMMISSIONED"**

```markdown
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
```

- [ ] **Step 2: Update the document header's "Status" and "Next review" lines to reflect the new entry**

Update line 6 to append: `; AI System 3 (Teen Mentor Chat) added [DATE OF THIS COMMIT] — consent basis pending legal review, see spec.`

- [ ] **Step 3: Commit**

```bash
git add docs/governance/ai-inventory.md
git commit -m "docs: add AI System 3 (Teen Mentor Chat) governance entry"
```

---

## Track 2 — Blocked on legal review of the consent basis

**Do not start any task in this track until Darren confirms the consent/SAR legal review from the spec (`docs/superpowers/specs/2026-08-04-teen-mentor-chat-design.md`, "Consent flow — UNRESOLVED, blocking") is complete.** Everything in Track 1 is safe to build and merge in the meantime — it's inert without a consent record (Task 7 already enforces `consent.consented === 1`) and without `MENTOR_CHAT_ENABLED=true` set in the environment.

### Task 12: Consent screen + consent endpoints

**Files:**
- Create: `worker/src/routes/mentorChatConsent.ts`
- Modify: `worker/src/index.ts`
- Create: `app/src/components/chat/MentorChatConsentScreen.tsx`
- Modify: `app/src/lib/api.ts` (add `getMentorChatConsent`, `postMentorChatConsent`)
- Test: `worker/src/routes/mentorChatConsent.test.ts`

**Interfaces:**
- Produces: `GET /api/mentor-chat/consent` → `{ consented: boolean }` for the calling child
- Produces: `POST /api/mentor-chat/consent` → body `{ consented: true }`, writes to `mentor_chat_consents` following the exact append-only pattern in `worker/src/routes/consent.ts` (`marketing_consents`/`analytics_consents` — reference `CURRENT_CONSENT_VERSION`-style versioning, define a new `MENTOR_CHAT_CONSENT_VERSION` constant)

- [ ] **Step 1: Write the failing worker test**

```ts
// worker/src/routes/mentorChatConsent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleGetMentorChatConsent, handlePostMentorChatConsent } from './mentorChatConsent.js';

describe('mentor chat consent', () => {
  it('reports not consented when no row exists', async () => {
    const first = vi.fn().mockResolvedValue(null);
    const env = { DB: { prepare: () => ({ bind: () => ({ first }) }) } } as any;
    const req = new Request('https://x/api/mentor-chat/consent');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleGetMentorChatConsent(req, env);
    const body = await res.json();
    expect(body.consented).toBe(false);
  });

  it('writes an append-only consent row on POST', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const env = {
      DB: { prepare: () => ({ bind: () => ({ run }) }) },
    } as any;
    const req = new Request('https://x/api/mentor-chat/consent', {
      method: 'POST',
      body: JSON.stringify({ consented: true }),
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handlePostMentorChatConsent(req, env);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd worker && npx vitest run src/routes/mentorChatConsent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// worker/src/routes/mentorChatConsent.ts
import { error, json, parseBody, clientIp } from '../lib/response.js';
import { nanoid } from '../lib/nanoid.js';
import type { Env } from '../types.js';
import type { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

export const MENTOR_CHAT_CONSENT_VERSION = 'v1-2026-08';

export async function handleGetMentorChatConsent(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Forbidden', 403);

  const row = await env.DB
    .prepare('SELECT consented FROM mentor_chat_consents WHERE user_id = ? ORDER BY consented_at DESC LIMIT 1')
    .bind(auth.sub)
    .first<{ consented: number }>();

  return json({ consented: row?.consented === 1 });
}

export async function handlePostMentorChatConsent(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Forbidden', 403);

  const body = await parseBody(request);
  if (body?.consented !== true) return error('consented must be true', 400);

  await env.DB
    .prepare(`INSERT INTO mentor_chat_consents (user_id, consented, consent_version, ip_address)
              VALUES (?, 1, ?, ?)`)
    .bind(auth.sub, MENTOR_CHAT_CONSENT_VERSION, clientIp(request))
    .run();

  return json({ consented: true });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd worker && npx vitest run src/routes/mentorChatConsent.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Register routes in `worker/src/index.ts`**

```ts
if (path === '/api/mentor-chat/consent' && method === 'GET')  return withAuth(request, auth, env, handleGetMentorChatConsent);
if (path === '/api/mentor-chat/consent' && method === 'POST') return withAuth(request, auth, env, handlePostMentorChatConsent);
```
Add the import: `import { handleGetMentorChatConsent, handlePostMentorChatConsent } from './routes/mentorChatConsent.js';`

- [ ] **Step 6: Add client API functions to `app/src/lib/api.ts`, near `getInsights`**

```ts
export async function getMentorChatConsent(): Promise<{ consented: boolean }> {
  return request('/api/mentor-chat/consent');
}

export async function postMentorChatConsent(): Promise<{ consented: boolean }> {
  return request('/api/mentor-chat/consent', {
    method: 'POST',
    body: JSON.stringify({ consented: true }),
  });
}
```

- [ ] **Step 7: Build the consent screen component**

```tsx
// app/src/components/chat/MentorChatConsentScreen.tsx
import { useState } from 'react';
import { postMentorChatConsent } from '../../lib/api';

interface Props {
  onConsented: () => void;
}

export function MentorChatConsentScreen({ onConsented }: Props) {
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setSubmitting(true);
    await postMentorChatConsent();
    setSubmitting(false);
    onConsented();
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">Before you chat with your AI Mentor</h2>
      <p className="text-sm text-neutral-600">
        Your AI Mentor chats are visible to your parent(s). If something you write suggests
        you're in danger, we'll show you help resources — and in some cases, alert your
        parent(s) too.
      </p>
      <button
        onClick={handleAccept}
        disabled={submitting}
        className="w-full rounded-lg bg-green-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        I understand, let's chat
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add worker/src/routes/mentorChatConsent.ts worker/src/routes/mentorChatConsent.test.ts worker/src/index.ts app/src/lib/api.ts app/src/components/chat/MentorChatConsentScreen.tsx
git commit -m "feat: add teen mentor chat consent screen and endpoints"
```

---

### Task 13: Teen-facing chat screen with persistent visibility indicator

**Files:**
- Create: `app/src/components/chat/MentorChatScreen.tsx`
- Modify: `app/src/lib/api.ts` (add `getMentorChatHistory`, `postMentorChatMessage`)

**Interfaces:**
- Consumes: `getMentorChatConsent`, `postMentorChatConsent` (Task 12), `MentorChatConsentScreen` (Task 12)
- Produces: `MentorChatScreen` component — gates on consent, then renders a message list + input, with a persistent "Visible to parents" badge always present in the header (not just the one-time consent screen)

- [ ] **Step 1: Add client API functions to `app/src/lib/api.ts`**

```ts
export interface MentorChatMessage {
  id: string;
  role: 'child' | 'assistant';
  content: string;
  created_at: number;
  escalation_type: 'distress' | 'abuse_pattern' | null;
}

export async function getMentorChatHistory(childId: string): Promise<{ messages: MentorChatMessage[] }> {
  return request(`/api/mentor-chat/messages?child_id=${childId}`);
}

export async function postMentorChatMessage(childId: string, message: string): Promise<{ reply: string; branch: string }> {
  return request('/api/mentor-chat/messages', {
    method: 'POST',
    body: JSON.stringify({ child_id: childId, message }),
  });
}
```

- [ ] **Step 2: Build the chat screen**

```tsx
// app/src/components/chat/MentorChatScreen.tsx
import { useState, useEffect, useCallback } from 'react';
import { getMentorChatConsent, getMentorChatHistory, postMentorChatMessage, type MentorChatMessage } from '../../lib/api';
import { MentorChatConsentScreen } from './MentorChatConsentScreen';

interface Props {
  childId: string;
}

export function MentorChatScreen({ childId }: Props) {
  const [consented, setConsented] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<MentorChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const loadHistory = useCallback(async () => {
    const { messages } = await getMentorChatHistory(childId);
    setMessages(messages);
  }, [childId]);

  useEffect(() => {
    getMentorChatConsent().then((res) => {
      setConsented(res.consented);
      if (res.consented) loadHistory();
    });
  }, [loadHistory]);

  if (consented === null) return null;
  if (!consented) {
    return <MentorChatConsentScreen onConsented={() => { setConsented(true); loadHistory(); }} />;
  }

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    const text = draft;
    setDraft('');
    await postMentorChatMessage(childId, text);
    await loadHistory();
    setSending(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-neutral-50 border-b px-4 py-2 text-xs text-neutral-500">
        Visible to parents
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'child' ? 'text-right' : 'text-left'}>
            <div className={`inline-block rounded-lg px-3 py-2 ${m.role === 'child' ? 'bg-green-100' : 'bg-neutral-100'}`}>
              {m.content}
            </div>
            {m.escalation_type && (
              <div className="text-xs text-amber-600 mt-1">Support resources shared</div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t p-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 rounded-lg border px-3 py-2"
          placeholder="Ask your AI Mentor about money..."
        />
        <button onClick={handleSend} disabled={sending} className="rounded-lg bg-green-600 px-4 py-2 text-white disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification (no automated test — this is a thin UI composition over already-tested endpoints)**

Run: `npm run dev`, log in as a teen test account with `birth_date` set (via the Task 1 endpoint) to a date 13–17 years ago, `has_ai_mentor` enabled, and `MENTOR_CHAT_ENABLED=true` set in the worker environment. Confirm: consent screen appears once, chat sends/receives, "Visible to parents" badge is always present, off-topic message redirects gracefully.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chat/MentorChatScreen.tsx app/src/lib/api.ts
git commit -m "feat: add teen-facing mentor chat screen with persistent parent-visibility indicator"
```

---

### Task 14: Parent-facing transcript panel in InsightsTab

**Files:**
- Create: `app/src/components/dashboard/MentorChatTranscriptCard.tsx`
- Modify: `app/src/components/dashboard/InsightsTab.tsx`

**Interfaces:**
- Consumes: `getMentorChatHistory` (Task 13)
- Produces: `MentorChatTranscriptCard` — read-only, rendered inside `InsightsTab`'s existing card list, only shown when the selected child is a teen (checked via a new `is_teen` field the `InsightsData` payload should expose — add this to `handleInsights` in `worker/src/routes/insights.ts` by reusing `isTeenAccount` from Task 1, since `InsightsTab` doesn't otherwise know the child's age band)

- [ ] **Step 1: Add `is_teen` to the insights response**

Modify `worker/src/routes/insights.ts`: in the query that already fetches the child's `birth_date` context (or add a new lightweight query if none exists), include `is_teen: isTeenAccount(child.birth_date)` in the JSON response. Import `isTeenAccount` from `../lib/ageGate.js`.

- [ ] **Step 2: Build the transcript card**

```tsx
// app/src/components/dashboard/MentorChatTranscriptCard.tsx
import { useEffect, useState } from 'react';
import { getMentorChatHistory, type MentorChatMessage } from '../../lib/api';

interface Props {
  childId: string;
}

export function MentorChatTranscriptCard({ childId }: Props) {
  const [messages, setMessages] = useState<MentorChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMentorChatHistory(childId).then((res) => {
      setMessages(res.messages);
      setLoading(false);
    });
  }, [childId]);

  if (loading) return null;
  if (messages.length === 0) return null;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold">AI Mentor Chat</h3>
      <div className="max-h-64 overflow-y-auto space-y-2">
        {[...messages].reverse().map((m) => (
          <div key={m.id} className="text-sm">
            <span className="font-medium">{m.role === 'child' ? 'Them' : 'Mentor'}:</span> {m.content}
            {m.escalation_type === 'distress' && (
              <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Flagged: distress</span>
            )}
            {m.escalation_type === 'abuse_pattern' && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Flagged</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Note on the `abuse_pattern` badge label: per the spec, parents are not notified in real time on this branch, but the transcript itself is still fully visible to both parents (spec: "Parent view... visible to both parents", no carve-out for abuse-pattern messages in the transcript, only in the real-time alert). The badge label is deliberately generic ("Flagged") rather than "Flagged: possible abuse" so a parent browsing transcripts doesn't see language that could itself be inflammatory or tip off a parent who is the actual source of risk before there's been any human review — reference this reasoning if asked to change the copy.

- [ ] **Step 3: Wire into `InsightsTab.tsx`**

In the `InsightsDashboard` (or wherever cards are composed, per the pattern found in Task research — conditionally rendered off `data` fields), add:
```tsx
{data.is_teen && <MentorChatTranscriptCard childId={selectedChild.id} />}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, view Insights tab as a parent for a teen child with existing chat history. Confirm the card appears, shows both parent and child messages, and escalation badges render correctly. Confirm the card does NOT appear for a non-teen child (`is_teen: false`).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/insights.ts app/src/components/dashboard/MentorChatTranscriptCard.tsx app/src/components/dashboard/InsightsTab.tsx
git commit -m "feat: add parent-facing mentor chat transcript card to InsightsTab"
```

---

### Task 15: Feature flag dark-launch

**Files:**
- Modify: Cloudflare Worker environment configuration (via `wrangler.toml` or dashboard secret — confirm actual mechanism by checking `worker/wrangler.toml` for how other boolean env vars are set before editing)

- [ ] **Step 1: Confirm the env-var mechanism**

Run: `cd worker && grep -n "vars\|MENTOR_CHAT\|_ENABLED" wrangler.toml`

- [ ] **Step 2: Add `MENTOR_CHAT_ENABLED = "false"` to the production environment block in `wrangler.toml`, and `"true"` to a dev/preview block if one exists** — mirroring however existing feature flags in this file are scoped per-environment.

- [ ] **Step 3: Dark-launch to Darren's own test family only**

Set `has_ai_mentor = 1` and a valid `birth_date` (13–17 years ago) for a test child via the Task 1 endpoint, confirm the full flow end-to-end in the `morechard-dev` environment with `MENTOR_CHAT_ENABLED=true`, before touching the production value.

- [ ] **Step 4: Commit the wrangler.toml change**

```bash
git add worker/wrangler.toml
git commit -m "feat: add MENTOR_CHAT_ENABLED flag, defaulting off in production"
```

- [ ] **Step 5: When ready for wider release, flip production to `"true"` via a separate, deliberate commit** — not bundled with any other change, so it's independently revertable.

---

## Required test coverage checklist (from spec, cross-referenced to tasks above)

1. Off-topic message → graceful in-chat redirect, no escalation record — covered by Task 7 ("returns the off-topic redirect and writes no escalation row").
2. Distress → resources + parent alert + escalation row — covered by Task 7.
3. Abuse-pattern → resources, no parent alert — covered by Task 7.
4. Rate limit enforcement — covered by Task 7.
5. Age gate rejects sub-13 even via direct API — covered by Task 7 and Task 1.

## Post-implementation

- Update `CLAUDE.md` Phase 5 roadmap section to add the Teen Mentor Chat line item under AI Mentor work, once Track 2 ships.
- Confirm with Darren that the `[OWNER TO COMPLETE]` consent-basis line in the Task 11 governance entry has been resolved before setting `MENTOR_CHAT_ENABLED = "true"` in production (Task 15).
