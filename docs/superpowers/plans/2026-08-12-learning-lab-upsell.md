# Learning Lab Upsell Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Learning Lab entitlement check (currently reads a column no purchase flow ever writes, so it's locked for every real customer), and add a purchase-CTA card that fills the Insights tab's Learning Lab slot for post-trial Core-only parents.

**Architecture:** One-line backend fix swapping a dead `license_type` column read for the real `has_ai_mentor`/`has_shield` flags. One new static React component (`LearningLabUpsellCard`) rendered conditionally in `InsightsTab`. A small prop-threading chain (`ParentDashboard` → `InsightsTab`) to pass `trialStatus`, plus a "jump" mechanism (`ParentDashboard` → `ParentSettingsTab`) so the card's CTA deep-links straight into Settings → Plans & Upgrades.

**Tech Stack:** Cloudflare Worker (TypeScript, D1), React + TypeScript (Vite), Vitest + React Testing Library.

## Global Constraints

- No `--local` wrangler usage; this plan touches no D1 schema, so no migration or `wrangler d1` commands are needed.
- No new dependencies.
- Card copy is parent-facing (Insights tab is the parent dashboard) — no child-vocabulary constraint applies.
- Reuse `PremiumShell` / `MentorAvatar` from `app/src/components/ui/PremiumShell.tsx` — mandatory for any "Orchard Mentor"-branded card per that file's own doc comment.
- Full spec: `docs/superpowers/specs/2026-08-12-learning-lab-upsell-design.md`.

---

### Task 1: Fix the Learning Lab entitlement check

**Files:**
- Modify: `worker/src/routes/insights.ts:472-477`
- Test: `worker/src/routes/insights.learningLab.test.ts` (new)

**Interfaces:**
- Produces: `computeLearningLabEnabled(row: { has_ai_mentor: number | null; has_shield: number | null } | null): boolean` — exported from `insights.ts`, used by the main handler in place of the old inline `licenceType` check.

- [ ] **Step 1: Write the failing test**

Create `worker/src/routes/insights.learningLab.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeLearningLabEnabled } from './insights.js';

describe('computeLearningLabEnabled', () => {
  it('is false for a Core-only family (no ai_mentor, no shield)', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 0, has_shield: 0 })).toBe(false);
  });

  it('is true when has_ai_mentor is set', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 1, has_shield: 0 })).toBe(true);
  });

  it('is true when has_shield is set', () => {
    expect(computeLearningLabEnabled({ has_ai_mentor: 0, has_shield: 1 })).toBe(true);
  });

  it('is false when the family row could not be loaded', () => {
    expect(computeLearningLabEnabled(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/routes/insights.learningLab.test.ts`
Expected: FAIL — `computeLearningLabEnabled` is not exported from `./insights.js` (module has no such export).

- [ ] **Step 3: Add the helper and wire it into the handler**

In `worker/src/routes/insights.ts`, find (around line 471-477):

```ts
  // ── 11. Learning Lab data ─────────────────────────────────────────────────
  const licenceRow = await env.DB.prepare(`
    SELECT license_type FROM families WHERE id = ?
  `).bind(family_id).first<{ license_type: string | null }>().catch(() => null);

  const licenceType = licenceRow?.license_type ?? 'core';
  const learningLabEnabled = ['core_ai', 'shield'].includes(licenceType);
```

Replace with:

```ts
  // ── 11. Learning Lab data ─────────────────────────────────────────────────
  const licenceRow = await env.DB.prepare(`
    SELECT has_ai_mentor, has_shield FROM families WHERE id = ?
  `).bind(family_id).first<{ has_ai_mentor: number | null; has_shield: number | null }>().catch(() => null);

  const learningLabEnabled = computeLearningLabEnabled(licenceRow);
```

Then add the exported helper function near the top of the file, just below the existing imports (it has no dependency on anything else in the file, so placement isn't load-bearing — putting it near the top keeps it easy to find):

```ts
export function computeLearningLabEnabled(
  row: { has_ai_mentor: number | null; has_shield: number | null } | null,
): boolean {
  return Boolean(row?.has_ai_mentor) || Boolean(row?.has_shield);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/routes/insights.learningLab.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full worker test suite to confirm nothing else broke**

Run: `cd worker && npx vitest run`
Expected: PASS — no other test references `license_type` gating for Learning Lab.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/insights.ts worker/src/routes/insights.learningLab.test.ts
git commit -m "fix(insights): gate Learning Lab on real purchase flags, not dead license_type column"
```

---

### Task 2: `LearningLabUpsellCard` component

**Files:**
- Create: `app/src/components/dashboard/LearningLabUpsellCard.tsx`
- Test: `app/src/components/dashboard/__tests__/LearningLabUpsellCard.test.tsx`

**Interfaces:**
- Consumes: `PremiumShell`, `MentorAvatar` from `app/src/components/ui/PremiumShell.tsx` (existing).
- Produces: `LearningLabUpsellCard({ childName: string; onUpgrade: () => void })` — a default-exportless named export `LearningLabUpsellCard`, consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/dashboard/__tests__/LearningLabUpsellCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LearningLabUpsellCard } from '../LearningLabUpsellCard'

describe('LearningLabUpsellCard', () => {
  it('renders the child name in the heading and the price in the CTA', () => {
    render(<LearningLabUpsellCard childName="Ellie" onUpgrade={() => {}} />)

    expect(screen.getByText('Unlock Learning Lab for Ellie')).toBeTruthy()
    expect(screen.getByText(/£29\.99/)).toBeTruthy()
  })

  it('calls onUpgrade when the CTA is clicked', () => {
    const onUpgrade = vi.fn()
    render(<LearningLabUpsellCard childName="Jake" onUpgrade={onUpgrade} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/dashboard/__tests__/LearningLabUpsellCard.test.tsx`
Expected: FAIL — cannot find module `../LearningLabUpsellCard`.

- [ ] **Step 3: Write the component**

Create `app/src/components/dashboard/LearningLabUpsellCard.tsx`:

```tsx
/**
 * LearningLabUpsellCard — shown in the Insights tab's Learning Lab slot for
 * post-trial Core-only parents (has_ai_mentor and has_shield both false).
 * Deep-links to Settings → Plans & Upgrades via onUpgrade.
 */

import { PremiumShell, MentorAvatar } from '../ui/PremiumShell'

interface Props {
  childName: string
  onUpgrade: () => void
}

export function LearningLabUpsellCard({ childName, onUpgrade }: Props) {
  return (
    <PremiumShell>
      <div className="relative p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <MentorAvatar accent="#d4a017" />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-white leading-snug">
              Unlock Learning Lab for {childName}
            </p>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
              25 short modules that turn {childName}'s real chores and savings into financial lessons —
              plus deeper AI Mentor coaching.
            </p>
          </div>
        </div>

        <button
          onClick={onUpgrade}
          className="w-full h-10 rounded-xl text-[13px] font-bold transition-all duration-150 active:scale-[0.98] cursor-pointer"
          style={{ background: '#d4a017', color: '#1a1206' }}
        >
          Add AI Mentor + Learning Lab — £29.99
        </button>
      </div>
    </PremiumShell>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/dashboard/__tests__/LearningLabUpsellCard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dashboard/LearningLabUpsellCard.tsx app/src/components/dashboard/__tests__/LearningLabUpsellCard.test.tsx
git commit -m "feat(insights): add LearningLabUpsellCard component"
```

---

### Task 3: Wire the card into InsightsTab, thread trialStatus, deep-link to billing

**Files:**
- Modify: `app/src/components/dashboard/InsightsTab.tsx:34-38` (Props), `:50-116` (root component + `InsightsDashboard` call), `:120-122` (`InsightsDashboard` signature), `:230-242` (Learning Lab render block)
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx:110-121` (types/Props), `:154-160` (component body)
- Modify: `app/src/screens/ParentDashboard.tsx` (new state + handler, `InsightsTab` call site, `ParentSettingsTab` call site)
- Test: `app/src/components/dashboard/__tests__/InsightsTab.learningLabUpsell.test.tsx` (new)

**Interfaces:**
- Consumes: `LearningLabUpsellCard` (Task 2), `TrialStatus` type (already exported from `app/src/lib/api.ts:341`).
- Produces: `InsightsTab` now requires two new props — `trialStatus: TrialStatus | null` and `onUpgrade: () => void`. `ParentSettingsTab` now accepts optional `settingsJumpView?: View` and `settingsJumpToken?: number`, and exports its `View` type for `ParentDashboard` to reuse.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/dashboard/__tests__/InsightsTab.learningLabUpsell.test.tsx`. This mocks `getInsights` to return a Core-only, non-discovery-phase payload, and checks the upsell card appears only under the post-trial-Core-only condition:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { InsightsTab } from '../InsightsTab'
import * as api from '../../../lib/api'
import type { ChildRecord, InsightsData, TrialStatus } from '../../../lib/api'

afterEach(() => vi.restoreAllMocks())

const child: ChildRecord = {
  id: 'c1', display_name: 'Ellie', avatar_id: 'a1',
} as ChildRecord

const baseData: InsightsData = {
  period: 'month', period_start_epoch: null,
  is_discovery_phase: false, is_demo: false,
  learning_lab_enabled: false,
  current_module: null, completed_module_slugs: [], retention_score: null,
  mentor_briefing: null, discovery_briefing: null,
  sparkline_points: null,
} as unknown as InsightsData

function trial(overrides: Partial<TrialStatus>): TrialStatus {
  return {
    is_activated: true, days_remaining: 0, is_expired: true,
    has_lifetime_license: true, has_ai_mentor: false, has_shield: false,
    ...overrides,
  }
}

describe('InsightsTab — Learning Lab upsell', () => {
  it('shows the upsell card for a post-trial Core-only family', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue(baseData)
    vi.spyOn(api, 'getChildNudges').mockResolvedValue({ nudges: { earn: null, money: null, goals: null } } as never)

    render(
      <InsightsTab
        familyId="fam1"
        child={child}
        children={[child]}
        trialStatus={trial({})}
        onUpgrade={() => {}}
      />,
    )

    await waitFor(() => expect(screen.getByText('Unlock Learning Lab for Ellie')).toBeTruthy())
  })

  it('does not show the upsell card while the trial is still active', async () => {
    vi.spyOn(api, 'getInsights').mockResolvedValue(baseData)
    vi.spyOn(api, 'getChildNudges').mockResolvedValue({ nudges: { earn: null, money: null, goals: null } } as never)

    render(
      <InsightsTab
        familyId="fam1"
        child={child}
        children={[child]}
        trialStatus={trial({ is_expired: false })}
        onUpgrade={() => {}}
      />,
    )

    // Wait for a guaranteed-rendered element (the Responsibility sparkline
    // label) before asserting absence — otherwise the negative assertion
    // could pass during the loading state, before data ever resolves.
    await waitFor(() => expect(screen.getByText('Responsibility')).toBeTruthy())
    expect(screen.queryByText('Unlock Learning Lab for Ellie')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/dashboard/__tests__/InsightsTab.learningLabUpsell.test.tsx`
Expected: FAIL — `InsightsTab` doesn't accept `trialStatus`/`onUpgrade` props yet (TypeScript error) and the card never renders.

- [ ] **Step 3: Thread `trialStatus`/`onUpgrade` through `InsightsTab`**

In `app/src/components/dashboard/InsightsTab.tsx`, add the import (near the top, with the other local imports):

```ts
import { LearningLabUpsellCard } from './LearningLabUpsellCard'
import type { TrialStatus } from '../../lib/api'
```

Update the root `Props` interface (currently lines 34-38):

```ts
interface Props {
  familyId:    string
  child:       ChildRecord
  children:    ChildRecord[]
  trialStatus: TrialStatus | null
  onUpgrade:   () => void
}
```

Update the root component signature and the `InsightsDashboard` call site (currently lines 50 and 112):

```ts
export function InsightsTab({ familyId, child, trialStatus, onUpgrade }: Props) {
```
```tsx
        <InsightsDashboard data={data} child={selectedChild} currency={currency} period={period} trialStatus={trialStatus} onUpgrade={onUpgrade} />
```

Update the `InsightsDashboard` signature (currently lines 120-122):

```ts
function InsightsDashboard({
  data, child, currency, period, trialStatus, onUpgrade,
}: { data: InsightsData; child: ChildRecord; currency: string; period: 'week' | 'month' | 'all'; trialStatus: TrialStatus | null; onUpgrade: () => void }) {
```

Replace the Learning Lab render block (currently lines 230-242):

```tsx
      {/* 6. Learning Lab section (paid add-on only) */}
      {data.learning_lab_enabled ? (
        <LabSection
          childName={child.display_name.split(' ')[0]}
          currentModule={data.current_module}
          labModuleProgress={data.lab_module_progress ?? []}
          labActsCompleted={data.lab_acts_completed ?? 0}
          labTimeInvestedMinutes={data.lab_time_invested_minutes ?? 0}
          labLastActiveAt={data.lab_last_active_at ?? null}
          retentionScore={data.retention_score}
          completedSlugs={data.completed_module_slugs}
        />
      ) : (
        trialStatus?.is_expired && !trialStatus.has_ai_mentor && !trialStatus.has_shield && (
          <LearningLabUpsellCard
            childName={child.display_name.split(' ')[0]}
            onUpgrade={onUpgrade}
          />
        )
      )}
```

- [ ] **Step 4: Export `View` from `ParentSettingsTab` and add the jump props**

In `app/src/components/dashboard/ParentSettingsTab.tsx`, find the `View` type and `Props` interface (currently lines 110-121):

```ts
type View =
  | { type: 'menu' }
  | { type: 'section'; section: TopSection; billingSubView?: 'plan' }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  familyId:         string
  online:           boolean
  onChildrenChange: (children: ChildRecord[]) => void
  onClose:          () => void
}
```

Replace with:

```ts
export type View =
  | { type: 'menu' }
  | { type: 'section'; section: TopSection; billingSubView?: 'plan' }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  familyId:          string
  online:            boolean
  onChildrenChange:  (children: ChildRecord[]) => void
  onClose:           () => void
  settingsJumpView?:  View
  settingsJumpToken?: number
}
```

Find the component body's opening (currently lines 154-162):

```ts
export function ParentSettingsTab({ familyId, online, onChildrenChange, onClose }: Props) {
  const identity        = getDeviceIdentity()
  // Treat as co-parent (less privileged) if identity is missing — never default to lead without identity
  const isLead          = identity != null && identity.parenting_role !== 'CO_PARENT'
  const { locale, setLocale } = useLocale()

  const [view,          setView]          = useState<View>({ type: 'menu' })
  useAndroidBack(true, () => {
    if (view.type === 'section') setView({ type: 'menu' })
```

Replace the destructured props and add a jump effect right after the `view` state declaration:

```ts
export function ParentSettingsTab({ familyId, online, onChildrenChange, onClose, settingsJumpView, settingsJumpToken }: Props) {
  const identity        = getDeviceIdentity()
  // Treat as co-parent (less privileged) if identity is missing — never default to lead without identity
  const isLead          = identity != null && identity.parenting_role !== 'CO_PARENT'
  const { locale, setLocale } = useLocale()

  const [view,          setView]          = useState<View>({ type: 'menu' })

  // Deep-link support: ParentSettingsTab stays mounted while the drawer is
  // closed (it's a CSS transform, not an unmount), so a plain initial-state
  // prop wouldn't fire on a second open. Callers bump settingsJumpToken to
  // force a jump even if settingsJumpView is unchanged from last time.
  useEffect(() => {
    if (settingsJumpView) setView(settingsJumpView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsJumpToken])

  useAndroidBack(true, () => {
    if (view.type === 'section') setView({ type: 'menu' })
```

(`useEffect` is already imported in this file alongside `useState` — confirm the import line includes it; if not, add it to the existing `react` import.)

- [ ] **Step 5: Wire `ParentDashboard`**

In `app/src/screens/ParentDashboard.tsx`, add the import for `View` next to the existing `ParentSettingsTab` import:

```ts
import { ParentSettingsTab, type View as SettingsView } from '../components/dashboard/ParentSettingsTab'
```

Add new state near the existing `showSettings` state:

```ts
const [settingsJump, setSettingsJump] = useState<{ view: SettingsView; token: number }>({
  view: { type: 'menu' },
  token: 0,
})

function openBillingUpgrade() {
  setSettingsJump(j => ({
    view: { type: 'section', section: 'billing', billingSubView: 'plan' },
    token: j.token + 1,
  }))
  setShowSettings(true)
}
```

Update the `InsightsTab` call site (currently `line 434`):

```tsx
<div className={tab === 'insights' ? 'tab-panel' : 'tab-panel hidden'}><InsightsTab familyId={familyId} child={activeChild} children={children} trialStatus={trialStatus} onUpgrade={openBillingUpgrade} /></div>
```

Update the `ParentSettingsTab` call site (currently `lines 404-409`):

```tsx
<ParentSettingsTab
  familyId={familyId}
  online={online}
  onChildrenChange={setChildren}
  onClose={() => setShowSettings(false)}
  settingsJumpView={settingsJump.view}
  settingsJumpToken={settingsJump.token}
/>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/dashboard/__tests__/InsightsTab.learningLabUpsell.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: Run the full frontend test suite and typecheck**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS — no other test/consumer relies on the old `InsightsTab` prop shape or the old (non-exported) `View` type.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/dashboard/InsightsTab.tsx app/src/components/dashboard/ParentSettingsTab.tsx app/src/screens/ParentDashboard.tsx app/src/components/dashboard/__tests__/InsightsTab.learningLabUpsell.test.tsx
git commit -m "feat(insights): wire Learning Lab upsell card into Insights tab, deep-link CTA to billing"
```

---

## Manual verification (after all tasks)

Automated tests cover logic and rendering; this step confirms the real purchase loop end-to-end since none of the above spins up a live Stripe checkout.

1. `npm run dev` (worker + app against `morechard-dev`).
2. In `morechard-dev`, pick or create a test family with `has_lifetime_license = 1`, `has_ai_mentor = 0`, `has_shield = 0`, and a `trial_start_date` more than 14 days in the past (so `is_expired` is true).
3. Load the parent dashboard → Insights tab. Confirm the `LearningLabUpsellCard` renders where Learning Lab would be, with the correct child name.
4. Tap the card's CTA. Confirm the Settings drawer opens directly on Plans & Upgrades (not the settings menu), with the £29.99 AI Mentor + Learning Lab option visible.
5. Update that same family's `has_ai_mentor` to `1` directly in `morechard-dev` (`npx wrangler d1 execute morechard-dev --remote --command="UPDATE families SET has_ai_mentor = 1 WHERE id = '<id>'"`), reload the Insights tab, and confirm `LabSection` now renders in place of the upsell card.
