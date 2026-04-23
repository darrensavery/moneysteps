# Family-Aware AI Mentor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI-generated and fallback string in the Morechard mentor dynamically adjust to the actual family composition (child count, parent count, parenting mode) queried from D1 at call time.

**Architecture:** A new `FamilyContext` object is built once per AI call from three parallel D1 queries and injected into every system prompt as a `FAMILY CONTEXT` block with explicit phrasing rules. The rule-based fallback (`buildRuleBasedBriefing`) receives the same object so both the AI path and the fallback path are family-aware. The client-side `MentorEmptyCard` empty-state already receives `childCount` and just needs its body copy updated.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1 (SQLite), React (TSX), OpenAI gpt-4o-mini

---

## File Map

| File | Change |
|---|---|
| `worker/src/types.ts` | Add `FamilyContext` interface |
| `worker/src/lib/intelligence.ts` | Add `getFamilyContext()` export |
| `worker/src/routes/chat.ts` | Thread `FamilyContext` through prompt builders; add `FAMILY CONTEXT` block + sibling rules |
| `worker/src/routes/insights.ts` | Thread `FamilyContext` through `generateBriefing` + `buildRuleBasedBriefing`; update all 8 fallback branches; add collaboration nudge |
| `app/src/components/dashboard/HistoryTab.tsx` | `MentorEmptyCard` body copy already correct — verify only |

---

## Task 1: Add `FamilyContext` to `worker/src/types.ts`

**Files:**
- Modify: `worker/src/types.ts`

- [ ] **Step 1: Add the interface after the existing `ParentingMode` type**

Open `worker/src/types.ts`. After line 52 (`export type ParentingMode = 'single' | 'co-parenting';`), insert:

```typescript
export interface FamilyContext {
  parenting_mode:   'single' | 'co-parenting';
  child_count:      number;
  child_names:      string[];    // first names of all children
  parent_names:     string[];    // first names of lead + all co-parents
  family_name:      string;      // families.name fallback: "the family"
  co_parent_active: boolean;     // both parents approved ≥1 chore in last 30d
  approval_skew:    number | null; // % of approvals by most-active parent (last 30d); null when single or <5 approvals
  has_shield:       boolean;     // Shield plan active — suppresses collaboration nudges
}
```

- [ ] **Step 2: Type-check**

```bash
cd "worker" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/types.ts
git commit -m "feat(types): add FamilyContext interface"
```

---

## Task 2: Add `getFamilyContext()` to `worker/src/lib/intelligence.ts`

**Files:**
- Modify: `worker/src/lib/intelligence.ts`

- [ ] **Step 1: Add the import**

At the top of `intelligence.ts`, the import line already reads:
```typescript
import type { D1Database } from '@cloudflare/workers-types'
import type { ChildIntelligence, Currency, Locale } from '../types.js'
```

Change it to:
```typescript
import type { D1Database } from '@cloudflare/workers-types'
import type { ChildIntelligence, Currency, Locale, FamilyContext } from '../types.js'
```

- [ ] **Step 2: Add `getFamilyContext()` at the bottom of the file, after `detectScrambler`**

Append to the end of `worker/src/lib/intelligence.ts`:

```typescript
// ─────────────────────────────────────────────────────────────────
// Family Context — queried fresh on every AI call (not cached)
// ─────────────────────────────────────────────────────────────────

export async function getFamilyContext(
  db: D1Database,
  familyId: string,
): Promise<FamilyContext> {
  const THIRTY_DAYS = 30 * 86_400
  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS

  const [familyRow, parentRows, childRows, approvalRows] = await Promise.all([
    // 1. Family metadata
    db
      .prepare(`SELECT parenting_mode, name, has_shield FROM families WHERE id = ?`)
      .bind(familyId)
      .first<{ parenting_mode: string; name: string | null; has_shield: number }>(),

    // 2. Parent names (lead + co_parent roles)
    db
      .prepare(`
        SELECT u.display_name
        FROM   family_roles fr
        JOIN   users u ON u.id = fr.user_id
        WHERE  fr.family_id = ?
          AND  fr.role = 'parent'
        ORDER  BY CASE fr.parent_role WHEN 'lead' THEN 0 ELSE 1 END
      `)
      .bind(familyId)
      .all<{ display_name: string }>(),

    // 3. Child names
    db
      .prepare(`
        SELECT display_name FROM users
        WHERE  family_id = ? AND role = 'child'
        ORDER  BY created_at ASC
      `)
      .bind(familyId)
      .all<{ display_name: string }>(),

    // 4. Approval counts per parent in last 30d (for skew + active detection)
    db
      .prepare(`
        SELECT authorised_by, COUNT(*) AS cnt
        FROM   ledger
        WHERE  family_id = ?
          AND  entry_type = 'credit'
          AND  authorised_by IS NOT NULL
          AND  created_at >= ?
        GROUP  BY authorised_by
      `)
      .bind(familyId, cutoff)
      .all<{ authorised_by: string; cnt: number }>(),
  ])

  // ── Derive values ──────────────────────────────────────────────
  const parenting_mode = (familyRow?.parenting_mode ?? 'single') as 'single' | 'co-parenting'
  const has_shield     = Boolean(familyRow?.has_shield)
  const family_name    = familyRow?.name?.trim() || 'the family'

  const parent_names = (parentRows.results ?? [])
    .map(r => r.display_name.split(' ')[0] || '')
    .filter(Boolean)

  const child_names = (childRows.results ?? [])
    .map(r => r.display_name.split(' ')[0] || '')
    .filter(Boolean)

  const child_count = Math.max(1, child_names.length)

  // Approval skew: % held by the single most-active parent
  const approvals = approvalRows.results ?? []
  const totalApprovals = approvals.reduce((s, r) => s + r.cnt, 0)

  let approval_skew: number | null = null
  let co_parent_active = false

  if (parenting_mode === 'co-parenting' && totalApprovals >= 5) {
    const maxApprovals = Math.max(...approvals.map(r => r.cnt))
    approval_skew = Math.round((maxApprovals / totalApprovals) * 100)
    // Both parents active = at least 2 distinct approvers with ≥1 approval each
    co_parent_active = approvals.length >= 2
  }

  return {
    parenting_mode,
    child_count,
    child_names,
    parent_names,
    family_name,
    co_parent_active,
    approval_skew,
    has_shield,
  }
}
```

- [ ] **Step 3: Type-check**

```bash
cd "worker" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/lib/intelligence.ts
git commit -m "feat(intelligence): add getFamilyContext() — parallel D1 queries for family composition"
```

---

## Task 3: Thread `FamilyContext` through `chat.ts`

**Files:**
- Modify: `worker/src/routes/chat.ts`

This task has three sub-steps: (a) import + query, (b) update `buildSystemPrompt` signature, (c) update each locale prompt builder.

- [ ] **Step 1: Update the import in `chat.ts`**

Change the existing import from `../types.js`:
```typescript
import type { Env } from '../types.js'
import type { ChildIntelligence, FinancialPillar, MentorResponse } from '../types.js'
```
to:
```typescript
import type { Env } from '../types.js'
import type { ChildIntelligence, FamilyContext, FinancialPillar, MentorResponse } from '../types.js'
```

And update the intelligence import to include `getFamilyContext`:
```typescript
import { getChildIntelligence, getFamilyContext } from '../lib/intelligence.js'
```

- [ ] **Step 2: Query `FamilyContext` in `handleChildChat`**

Inside `handleChildChat`, find the existing intelligence query:
```typescript
  const intel = await getChildIntelligence(env.DB, auth.sub)
  if (!intel) {
    return json({ error: 'Child profile not found' }, 404)
  }
```

Replace with:
```typescript
  const [intel, familyCtx] = await Promise.all([
    getChildIntelligence(env.DB, auth.sub),
    getFamilyContext(env.DB, auth.family_id).catch(() => null),
  ])
  if (!intel) {
    return json({ error: 'Child profile not found' }, 404)
  }
  // Guaranteed non-null — use safe defaults if DB query failed
  const resolvedFamilyCtx: FamilyContext = familyCtx ?? {
    parenting_mode:   'single',
    child_count:      1,
    child_names:      [intel.display_name.split(' ')[0]],
    parent_names:     [],
    family_name:      'the family',
    co_parent_active: false,
    approval_skew:    null,
    has_shield:       false,
  }
```

- [ ] **Step 3: Pass `resolvedFamilyCtx` to `buildSystemPrompt` and `selectPillar`**

Find:
```typescript
  const pillar = selectPillar(intel, userMessage)
  const systemPrompt = buildSystemPrompt(intel, pillar)
```

Replace with:
```typescript
  const pillar = selectPillar(intel, userMessage)
  const systemPrompt = buildSystemPrompt(intel, pillar, resolvedFamilyCtx)
```

- [ ] **Step 4: Update `buildSystemPrompt` signature**

Find:
```typescript
function buildSystemPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
  switch (intel.locale) {
    case 'en-US': return buildUSPrompt(intel, pillar)
    case 'pl':    return buildPLPrompt(intel, pillar)
    default:      return buildUKPrompt(intel, pillar)
  }
}
```

Replace with:
```typescript
function buildSystemPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
  switch (intel.locale) {
    case 'en-US': return buildUSPrompt(intel, pillar, familyCtx)
    case 'pl':    return buildPLPrompt(intel, pillar, familyCtx)
    default:      return buildUKPrompt(intel, pillar, familyCtx)
  }
}
```

- [ ] **Step 5: Add `buildFamilyContextBlock()` helper — insert before `buildSystemPrompt`**

```typescript
// ── Family Context block — injected at the top of every child-chat system prompt ──

function buildFamilyContextBlock(familyCtx: FamilyContext, currentChildName: string, locale: string): string {
  const isPl = locale === 'pl'
  const siblings = familyCtx.child_names.filter(n => n !== currentChildName)
  const hasSiblings = familyCtx.child_count > 1 && siblings.length > 0

  const siblingBlock = hasSiblings
    ? (isPl
        ? `ZASADY DOTYCZĄCE RODZEŃSTWA (obowiązkowe):
- Możesz wspomnieć o rodzeństwie WYŁĄCZNIE przy wspólnych rodzinnych kamieniach milowych lub niezależnych świętowaniach (np. "Świetny tydzień dla Sadu!").
- Zakaz porównywania postępów. Zakaz ujawniania celów, kwot ani postępów rodzeństwa.
- Pozytywne nastawienie: świętuj wspólnie, nigdy nie porównuj.
- Imiona rodzeństwa: ${siblings.join(', ')}.`
        : `SIBLING RULES (mandatory):
- Reference siblings ONLY for shared family milestones or independent celebrations (e.g. "Great week for the Orchard!").
- Never compare progress. Never disclose another child's goal name, target amount, or progress percentage.
- Positive-only: celebrate together, never benchmark.
- Sibling name(s): ${siblings.join(', ')}.`)
    : ''

  if (isPl) {
    return `KONTEKST RODZINNY:
- Tryb rodzicielski: ${familyCtx.parenting_mode === 'co-parenting' ? 'współrodzicielstwo' : 'jeden rodzic'}
- Liczba dzieci w rodzinie: ${familyCtx.child_count}
- Nazwa rodziny: ${familyCtx.family_name}
${hasSiblings ? siblingBlock : '- To jedyne dziecko w tej rodzinie. Nie wspominaj o rodzeństwie.'}`
  }

  return `FAMILY CONTEXT:
- Parenting mode: ${familyCtx.parenting_mode}
- Number of children in this family: ${familyCtx.child_count}
- Family name: ${familyCtx.family_name}
${hasSiblings ? siblingBlock : '- This is the only child in this family. Do not reference siblings.'}`
}
```

- [ ] **Step 6: Update `buildUKPrompt` to accept and inject `familyCtx`**

Find:
```typescript
function buildUKPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
```

Replace with:
```typescript
function buildUKPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
```

Then find the `return` statement at the top of `buildUKPrompt` (the line starting with `` return `You are the Orchard Mentor ``). Prepend the family context block to the returned string by replacing:

```typescript
  return `You are the Orchard Mentor — a warm, collaborative financial coach for UK children.
```

with:

```typescript
  const familyBlock = buildFamilyContextBlock(familyCtx, intel.display_name.split(' ')[0], intel.locale)

  return `${familyBlock}

You are the Orchard Mentor — a warm, collaborative financial coach for UK children.
```

- [ ] **Step 7: Update `buildUSPrompt` to accept and inject `familyCtx`**

Find:
```typescript
function buildUSPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
```

Replace with:
```typescript
function buildUSPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
```

Find the `return` statement in `buildUSPrompt` (the line starting with `` return `You are the Performance Coach ``). Replace:

```typescript
  return `You are the Performance Coach — a direct, outcome-focused financial mentor for US children.
```

with:

```typescript
  const familyBlock = buildFamilyContextBlock(familyCtx, intel.display_name.split(' ')[0], intel.locale)

  return `${familyBlock}

You are the Performance Coach — a direct, outcome-focused financial mentor for US children.
```

- [ ] **Step 8: Update `buildPLPrompt` to accept and inject `familyCtx`**

Find:
```typescript
function buildPLPrompt(intel: ChildIntelligence, pillar: FinancialPillar): string {
```

Replace with:
```typescript
function buildPLPrompt(intel: ChildIntelligence, pillar: FinancialPillar, familyCtx: FamilyContext): string {
```

Find the `return` statement in `buildPLPrompt` (the line starting with `` return `Jesteś Mistrzem Sadu ``). Replace:

```typescript
  return `Jesteś Mistrzem Sadu — formalnym, bezpośrednim mentorem finansowym dla polskich dzieci.
```

with:

```typescript
  const familyBlock = buildFamilyContextBlock(familyCtx, intel.display_name.split(' ')[0], intel.locale)

  return `${familyBlock}

Jesteś Mistrzem Sadu — formalnym, bezpośrednim mentorem finansowym dla polskich dzieci.
```

- [ ] **Step 9: Type-check**

```bash
cd "worker" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add worker/src/routes/chat.ts worker/src/lib/intelligence.ts
git commit -m "feat(chat): inject FamilyContext into all locale system prompts with sibling rules"
```

---

## Task 4: Thread `FamilyContext` through `insights.ts`

**Files:**
- Modify: `worker/src/routes/insights.ts`

This is the largest task. It has four sub-steps: (a) import + query, (b) update `BriefingInput` + `buildSystemPrompt`, (c) update `buildRuleBasedBriefing` all 8 branches, (d) add collaboration nudge.

- [ ] **Step 1: Update imports in `insights.ts`**

Find the existing import:
```typescript
import { Env } from '../types.js';
```

Replace with:
```typescript
import { Env, FamilyContext } from '../types.js';
```

Find:
```typescript
import { captureAiGeneration } from '../lib/posthog.js';
```

Add after it:
```typescript
import { getFamilyContext } from '../lib/intelligence.js';
```

- [ ] **Step 2: Query `FamilyContext` in `handleInsights`**

Inside `handleInsights`, find the section after the effectiveChildId check (around line 46). Find:
```typescript
  const periodStart = getPeriodStart(period);
  const now         = Math.floor(Date.now() / 1000);
```

Replace with:
```typescript
  const periodStart = getPeriodStart(period);
  const now         = Math.floor(Date.now() / 1000);

  // Family context — queried fresh, not cached
  const familyCtx = await getFamilyContext(env.DB, family_id).catch((): FamilyContext => ({
    parenting_mode:   'single',
    child_count:      1,
    child_names:      [],
    parent_names:     [],
    family_name:      'the family',
    co_parent_active: false,
    approval_skew:    null,
    has_shield:       false,
  }));
```

- [ ] **Step 3: Add `FamilyContext` to `BriefingInput`**

Find the `BriefingInput` interface:
```typescript
interface BriefingInput {
  consistencyScore:       number | null;
  firstTimePassRate:      number | null;
  planningHorizon:        number | null;
  trends:                 ReturnType<typeof buildTrends>;
  velocityContext:        { mode: 'seedling'; avg_tasks_per_week: number } | { mode: 'professional'; avg_earned_pence_week: number };
  effortPreference:       'high_yield' | 'steady' | null;
  availableBalancePence:  number;
  goalsLockedPence:       number;
  locale:                 'en' | 'pl';
  childName:              string;
  honorific:              string;
}
```

Replace with:
```typescript
interface BriefingInput {
  consistencyScore:       number | null;
  firstTimePassRate:      number | null;
  planningHorizon:        number | null;
  trends:                 ReturnType<typeof buildTrends>;
  velocityContext:        { mode: 'seedling'; avg_tasks_per_week: number } | { mode: 'professional'; avg_earned_pence_week: number };
  effortPreference:       'high_yield' | 'steady' | null;
  availableBalancePence:  number;
  goalsLockedPence:       number;
  locale:                 'en' | 'pl';
  childName:              string;
  honorific:              string;
  familyCtx:              FamilyContext;
}
```

- [ ] **Step 4: Pass `familyCtx` into both briefing call sites in `handleInsights`**

Find the cache-miss call to `generateBriefing`:
```typescript
      mentorBriefing = await generateBriefing(env, effectiveChildId, {
        consistencyScore,
        firstTimePassRate,
        planningHorizon,
        trends,
        velocityContext,
        effortPreference,
        availableBalancePence: Math.max(0, availableBal),
        goalsLockedPence:      goalsLocked,
        locale,
        childName,
        honorific,
      });
```

Replace with:
```typescript
      mentorBriefing = await generateBriefing(env, effectiveChildId, {
        consistencyScore,
        firstTimePassRate,
        planningHorizon,
        trends,
        velocityContext,
        effortPreference,
        availableBalancePence: Math.max(0, availableBal),
        goalsLockedPence:      goalsLocked,
        locale,
        childName,
        honorific,
        familyCtx,
      });
```

- [ ] **Step 5: Add `buildInsightsFamilyBlock()` helper in `insights.ts`**

Insert this function just before `buildSystemPrompt` in `insights.ts`:

```typescript
function buildInsightsFamilyBlock(familyCtx: FamilyContext, childName: string, locale: 'en' | 'pl'): string {
  const isPl = locale === 'pl'
  const coParentLine = familyCtx.parenting_mode === 'co-parenting' && familyCtx.parent_names.length >= 2
    ? (isPl
        ? `Rodzice: ${familyCtx.parent_names.join(' i ')}. Zwracaj się do obojga rodziców, gdy to stosowne.`
        : `Parents: ${familyCtx.parent_names.join(' and ')}. Address both parents when contextually relevant.`)
    : (isPl
        ? 'Rodzina z jednym rodzicem. Nie używaj "oboje rodziców" ani nie wspominaj o współrodzicielstwie.'
        : 'Single-parent family. Never say "both parents" or reference a co-parent.')

  const siblingLine = familyCtx.child_count > 1
    ? (isPl
        ? `Rodzina ma ${familyCtx.child_count} dzieci. Możesz świętować sukcesy całej rodziny (np. "Cały Sad kwitnie"), ale NIGDY nie porównuj postępów dzieci.`
        : `This family has ${familyCtx.child_count} children. You may celebrate whole-family milestones (e.g. "The whole Orchard is thriving"), but NEVER compare children's progress.`)
    : (isPl
        ? `${childName} jest jedynym dzieckiem w tej rodzinie.`
        : `${childName} is the only child in this family.`)

  const nudgeRule = familyCtx.parenting_mode === 'co-parenting' && !familyCtx.has_shield
    && familyCtx.co_parent_active && (familyCtx.approval_skew ?? 0) > 80
    ? (isPl
        ? 'WSKAZÓWKA WSPÓŁPRACY (dozwolona raz w briefingu): Zauważyliśmy, że ostatnio zatwierdzenia pochodzą głównie od jednego rodzica — partner może chcieć bardziej zaangażować się w tym tygodniu. Ton: obserwacja, nie dyrektywa.'
        : 'COLLABORATION NUDGE (allowed once in this briefing): We\'ve noticed most approvals have come from one parent recently — your co-parent might enjoy being more involved this week. Tone: observation, never directive.')
    : ''

  if (isPl) {
    return `KONTEKST RODZINNY (obowiązkowy):
- ${coParentLine}
- ${siblingLine}
- Nazwa rodziny: ${familyCtx.family_name}
- ZAKAZ używania "dzieci" (użyj imienia dziecka lub "Twoje dziecko").
${nudgeRule}`
  }

  return `FAMILY CONTEXT (mandatory):
- ${coParentLine}
- ${siblingLine}
- Family name: ${familyCtx.family_name}
- NEVER say "the kids" — use the child's name or "your child".
${nudgeRule}`
}
```

- [ ] **Step 6: Update `buildSystemPrompt` in `insights.ts` to inject the family block**

Find the `buildSystemPrompt` function in `insights.ts` (not the one in `chat.ts` — this one takes `locale`, `isTeenMode`, `childName`, `honorific`):

```typescript
function buildSystemPrompt(
  locale: 'en' | 'pl',
  isTeenMode: boolean,
  childName: string,
  honorific: string,
): string {
```

Replace with:

```typescript
function buildSystemPrompt(
  locale: 'en' | 'pl',
  isTeenMode: boolean,
  childName: string,
  honorific: string,
  familyCtx: FamilyContext,
): string {
```

Then in both the Polish (`if (isPl)`) and English (`return`) return strings, prepend the family block. Find the Polish return:

```typescript
    return `Jesteś "Mistrzem Sadu" (Mistrz Sadu) — wysokiej klasy konsultantem finansowym dla rodziców. \
```

Replace with:

```typescript
    const familyBlock = buildInsightsFamilyBlock(familyCtx, childName, locale)
    return `${familyBlock}

Jesteś "Mistrzem Sadu" (Mistrz Sadu) — wysokiej klasy konsultantem finansowym dla rodziców. \
```

Find the English return (near end of `buildSystemPrompt`):
```typescript
  // ── English persona: Collaborative Coach (Orchard Lead) ──────────────────
  return `You are the 'Orchard Lead', a collaborative financial coach for parents. \
```

Replace with:
```typescript
  // ── English persona: Collaborative Coach (Orchard Lead) ──────────────────
  const familyBlock = buildInsightsFamilyBlock(familyCtx, childName, locale)
  return `${familyBlock}

You are the 'Orchard Lead', a collaborative financial coach for parents. \
```

- [ ] **Step 7: Pass `familyCtx` into `buildSystemPrompt` inside `generateBriefing`**

Find inside `generateBriefing`:
```typescript
  const isTeenMode   = input.velocityContext.mode === 'professional';
  const systemPrompt = buildSystemPrompt(input.locale, isTeenMode, input.childName, input.honorific);
```

Replace with:
```typescript
  const isTeenMode   = input.velocityContext.mode === 'professional';
  const systemPrompt = buildSystemPrompt(input.locale, isTeenMode, input.childName, input.honorific, input.familyCtx);
```

- [ ] **Step 8: Update `buildRuleBasedBriefing` to accept and use `familyCtx`**

Find:
```typescript
function buildRuleBasedBriefing(input: BriefingInput): MentorBriefing {
  const {
    trends, consistencyScore, firstTimePassRate, planningHorizon,
    velocityContext, availableBalancePence, goalsLockedPence, locale,
    childName, honorific,
  } = input;
```

Replace with:
```typescript
function buildRuleBasedBriefing(input: BriefingInput): MentorBriefing {
  const {
    trends, consistencyScore, firstTimePassRate, planningHorizon,
    velocityContext, availableBalancePence, goalsLockedPence, locale,
    childName, honorific, familyCtx,
  } = input;

  // Co-parent address string (e.g. "you and Sarah" or "both of you")
  const coParentName = familyCtx.parenting_mode === 'co-parenting' && familyCtx.parent_names.length >= 2
    ? familyCtx.parent_names.filter(n => n !== familyCtx.parent_names[0])[0] ?? 'your partner'
    : null;
  const parentAddress = coParentName
    ? (locale === 'pl' ? `Ty i ${coParentName}` : `you and ${coParentName}`)
    : (locale === 'pl' ? 'Ty' : 'you');

  // Sibling team line for Pillar 5 (positive-only, no comparisons)
  const siblingTeamLine = familyCtx.child_count > 1
    ? (locale === 'pl'
        ? ` Cały Sad ${familyCtx.family_name} kwitnie w tym tygodniu.`
        : ` The whole ${familyCtx.family_name} Orchard is thriving this week.`)
    : '';
```

- [ ] **Step 9: Update Pillar 5 branch to use `siblingTeamLine` and `parentAddress`**

Find the Pillar 5 block inside `buildRuleBasedBriefing`. It starts with:
```typescript
  if (hasSurplus || goalsFunded) {
```

The `obs` variable in this block currently ends with a period. Update the English `obs` to append `siblingTeamLine`:

Find:
```typescript
      : (isPl
          ? 'Zauważyliśmy, że wszystkie aktywne cele oszczędnościowe zostały w pełni sfinansowane w tym okresie—to ważny kamień milowy w cyklu Zbiorów.'
          : 'We have observed that all active savings goals have been fully funded this period—a significant milestone in the Harvest cycle.');
```

Replace with:
```typescript
      : (isPl
          ? `Zauważyliśmy, że wszystkie aktywne cele oszczędnościowe zostały w pełni sfinansowane w tym okresie—to ważny kamień milowy w cyklu Zbiorów.${siblingTeamLine}`
          : `We have observed that all active savings goals have been fully funded this period—a significant milestone in the Harvest cycle.${siblingTeamLine}`);
```

And find the `hasSurplus` obs line:
```typescript
      ? (isPl
          ? `Zauważyliśmy, że dostępne saldo przekroczyło ${balanceDisplay}—w Sadzie zgromadził się znaczący nadmiar.`
          : `We have noted that the available balance has exceeded ${balanceDisplay}—a meaningful surplus has accumulated in the Orchard.`)
```

Replace with:
```typescript
      ? (isPl
          ? `Zauważyliśmy, że dostępne saldo przekroczyło ${balanceDisplay}—w Sadzie zgromadził się znaczący nadmiar.${siblingTeamLine}`
          : `We have noted that the available balance has exceeded ${balanceDisplay}—a meaningful surplus has accumulated in the Orchard.${siblingTeamLine}`)
```

- [ ] **Step 10: Update remaining 7 branches to substitute child name and parent address**

For each remaining branch (Pillar 3, Pillar 1, Pillar 2, Pillar 4, and the default), the `nudge` strings that reference `${childName}` or `${formalAddr}` are already correct (they use the child's name). No change needed there. However each branch's English `obs` currently uses generic "we" which is fine. The only thing to update is: in the Pillar 4 and default branches, if co-parenting, append a single co-parent acknowledgement to the English nudge.

Find the Pillar 4 English seedling nudge:
```typescript
          : `You might consider introducing the idea of a "Boost" from a parent as a matching contribution—framing it to ${childName} as "the Orchard growing your seed" makes compound interest intuitive.`
```

Replace with:
```typescript
          : `You might consider ${coParentName ? `${parentAddress} introducing` : 'introducing'} the idea of a "Boost" as a matching contribution—framing it to ${childName} as "the Orchard growing your seed" makes compound interest intuitive.`
```

Find the Pillar 4 English professional nudge:
```typescript
          : `You might consider modelling with ${childName} what a 5% or 10% annual return would look like on their current savings balance—this anchors Pillar 4 in a real number rather than an abstract concept.`
```

Replace with:
```typescript
          : `You might consider ${coParentName ? `${parentAddress} modelling` : 'modelling'} with ${childName} what a 5% or 10% annual return would look like on their current savings balance—this anchors Pillar 4 in a real number rather than an abstract concept.`
```

- [ ] **Step 11: Add collaboration nudge as post-processing in `buildRuleBasedBriefing`**

The collaboration nudge is suppressed on Shield and when `co_parent_active = false`. Add it as a post-processing step at the very end of `buildRuleBasedBriefing`, just before the final `return` of each branch.

The cleanest approach: wrap the final return value. Find the last line of `buildRuleBasedBriefing` before the closing brace — the default branch return:

```typescript
  return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
}
```

This is repeated across all branches. Instead of modifying each one, restructure the function to collect into a variable and post-process. Replace every branch's final return:

```typescript
  return { observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' };
```

with:

```typescript
  return applyCollaborationNudge({ observation: obs, behavioral_root: root, the_nudge: nudge, source: 'fallback' }, familyCtx, locale, isSeedling);
```

Then add this helper function just before `buildRuleBasedBriefing`:

```typescript
function applyCollaborationNudge(
  briefing: MentorBriefing,
  familyCtx: FamilyContext,
  locale: 'en' | 'pl',
  isSeedling: boolean,
): MentorBriefing {
  const shouldNudge =
    familyCtx.parenting_mode === 'co-parenting' &&
    !familyCtx.has_shield &&
    familyCtx.co_parent_active &&
    (familyCtx.approval_skew ?? 0) > 80

  if (!shouldNudge) return briefing

  const coParentName = familyCtx.parent_names.length >= 2
    ? familyCtx.parent_names[1]
    : (locale === 'pl' ? 'partner' : 'your partner')

  const nudgeSuffix = locale === 'pl'
    ? ` Zauważyliśmy również, że ostatnio zatwierdzenia pochodzą głównie od jednego rodzica — ${coParentName} może chcieć bardziej zaangażować się w tym tygodniu.`
    : ` We've also noticed most approvals have come from one parent recently — ${coParentName} might enjoy being more involved this week.`

  return {
    ...briefing,
    the_nudge: briefing.the_nudge + nudgeSuffix,
  }
}
```

- [ ] **Step 12: Type-check**

```bash
cd "worker" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add worker/src/routes/insights.ts worker/src/lib/intelligence.ts worker/src/types.ts
git commit -m "feat(insights): inject FamilyContext into parent briefing — family-aware AI + fallback"
```

---

## Task 5: Verify `HistoryTab.tsx` `MentorEmptyCard`

**Files:**
- Verify: `app/src/components/dashboard/HistoryTab.tsx`

The `MentorEmptyCard` was already updated in a prior session to receive `childCount` and produce family-aware copy. This task just confirms correctness.

- [ ] **Step 1: Verify the component matches the spec**

Read `app/src/components/dashboard/HistoryTab.tsx` around line 506–549. Confirm:

1. `childCount: number` is in the props interface ✓
2. `heading` uses `${childName} is all caught up! 🎉` (no "the kids") ✓
3. Single child body (`childCount === 1`, no `goalProgress`): `"Keep an eye on ${childName}'s progress — their next goal milestone is coming up soon."` ✓
4. Multi-child body (no `goalProgress`): `"No pending tasks for ${childName} right now. Check the other children's tabs for any outstanding approvals."` ✓
5. `ActivityTab` passes `childCount={children.length}` from `ParentDashboard.tsx` ✓

- [ ] **Step 2: TypeScript check on the app**

```bash
cd "app" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit (only if any correction was needed)**

```bash
git add app/src/components/dashboard/HistoryTab.tsx app/src/screens/ParentDashboard.tsx
git commit -m "fix(activity): MentorEmptyCard family-aware copy — name over 'the kids'"
```

---

## Task 6: Final type-check and integration smoke test

- [ ] **Step 1: Full worker type-check**

```bash
cd "worker" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Full app type-check**

```bash
cd "app" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual scenario walkthrough (no automated tests — runtime is Cloudflare Workers)**

Start the dev server and open the parent dashboard. Confirm all five spec test scenarios produce correct UI copy:

| Scenario | Expected |
|---|---|
| Single parent, 1 child | No "the kids", no "both parents", no sibling block in child chat |
| Co-parenting, 1 child | Co-parent name in briefing, no sibling references |
| Single parent, 2 children | Sibling team line in child chat, no co-parent language |
| Co-parenting, 2 children, `approval_skew > 80`, both active | Collaboration nudge appears once in rule-based briefing |
| Co-parenting, 2 children, one parent inactive | Nudge suppressed |

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: family-aware AI mentor — FamilyContext flows through all AI surfaces"
```
