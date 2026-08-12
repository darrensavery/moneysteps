# Learning Lab Upsell Card (+ gating fix) — Design Spec

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning

## Problem

Roadmap Phase 5 has an open item: "Implement AI Mentor + Learning Lab upsell card (dashboard upsell for Core-only users)." Investigating the current behavior surfaced two distinct issues:

1. **No upsell exists.** Core-only parents (bought Morechard Core, didn't add AI Mentor + Learning Lab) see nothing where Learning Lab would be on the Insights tab — the section is simply omitted (`{data.learning_lab_enabled && <LabSection .../>}`). There is no indication the feature exists or how to unlock it.
2. **Learning Lab gating is broken for everyone.** `worker/src/routes/insights.ts` computes `learning_lab_enabled` from a `families.license_type` column that is never written by any purchase flow — Stripe webhooks (`stripe.ts`) only ever set `has_ai_mentor` / `has_shield` / `has_lifetime_license`. `license_type` defaults to `'core'` for every real family and is hardcoded to `'core_ai'` only for the demo family (migration `0050_demo_enrichment.sql`). Net effect: **no real paying customer has ever seen the Learning Lab section**, regardless of what they purchased.

Note: the weekly AI Mentor briefing card (`data.mentor_briefing`) is *not* affected — it has no gating at all and is generated for every family regardless of plan, matching the product's "AI Mentor always visible" positioning. The upsell described here is specifically for Learning Lab (the 25-module curriculum), which is the actually-monetized, actually-gated half of the "AI Mentor + Learning Lab" £29.99 SKU.

## Decisions

1. **Fix the gating bug as a prerequisite.** Replace the `license_type` read with the real purchase flags: `learning_lab_enabled = has_ai_mentor || has_shield`. Same pattern already used correctly in `export.ts` and `mentorChat.ts`. The now-fully-dead `license_type` column is left in place (harmless) — schema cleanup is out of scope.
2. **Trigger condition mirrors the existing `DemoUpsellCard`.** Show the upsell only when `trialStatus.is_expired && !trialStatus.has_ai_mentor && !trialStatus.has_shield` — post-trial, Core-only. This keeps the two cards (which target the same audience with different next steps — "try the demo" vs. "buy now") in agreement about who's in scope. During an active trial, Learning Lab simply stays hidden as it does today; extending trial access to it is a separate product decision, out of scope here.
3. **Placement: Insights tab, in the Learning Lab slot.** Replaces the current no-op when `!data.learning_lab_enabled`, rather than a second dashboard-level banner. `DemoUpsellCard` already handles top-of-dashboard awareness for this audience; this card is the contextual, in-place conversion point — shown exactly where the real feature would render.
4. **Visual design reuses the `PremiumShell` system**, not a generic greyed-out lock (`UpsellPrompt.tsx`'s treatment, which is reserved for the demo-family "notify me" flow). Using the same teal/gold `PremiumShell` + `MentorAvatar` treatment as the mentor briefing card makes this read as an aspirational preview of a real, premium feature, consistent with `project_premium_shell.md`.
5. **CTA deep-links straight to the £29.99 purchase**, not just "open settings." Fewest taps to convert for a parent who already knows what they want.
6. **No dismiss/close affordance.** This is a persistent locked-state placeholder occupying the space `LabSection` would otherwise take, not an interruptive banner — consistent with how the Learning Lab section behaves for everyone else (present or absent, never dismissed).

## Architecture

### Backend fix — `worker/src/routes/insights.ts`

Replace (around line 472-477):
```ts
const licenceRow = await env.DB.prepare(`
  SELECT license_type FROM families WHERE id = ?
`).bind(family_id).first<{ license_type: string | null }>().catch(() => null);
const licenceType = licenceRow?.license_type ?? 'core';
const learningLabEnabled = ['core_ai', 'shield'].includes(licenceType);
```
with:
```ts
const licenceRow = await env.DB.prepare(`
  SELECT has_ai_mentor, has_shield FROM families WHERE id = ?
`).bind(family_id).first<{ has_ai_mentor: number; has_shield: number }>().catch(() => null);
const learningLabEnabled = Boolean(licenceRow?.has_ai_mentor) || Boolean(licenceRow?.has_shield);
```

### New component — `app/src/components/dashboard/LearningLabUpsellCard.tsx`

```tsx
interface Props {
  childName: string
  onUpgrade: () => void
}
```
- Wraps content in `PremiumShell` (with `useEffect(() => injectPremiumStyles(), [])` in the parent, same as `FamilyAuditCard`/`InsightsTab` already do).
- `MentorAvatar` + heading "Unlock Learning Lab for {childName}".
- Body copy: "25 short modules that turn {childName}'s real chores and savings into financial lessons — plus deeper AI Mentor coaching."
- CTA button: "Add AI Mentor + Learning Lab — £29.99" → calls `onUpgrade()`.
- No loading/error state needed — it's a static card, no data fetch of its own.

### `InsightsTab` changes

- Accept two new props: `trialStatus: TrialStatus | null` and `onUpgrade: () => void`.
- Replace:
  ```tsx
  {data.learning_lab_enabled && (
    <LabSection ... />
  )}
  ```
  with:
  ```tsx
  {data.learning_lab_enabled ? (
    <LabSection ... />
  ) : (
    trialStatus?.is_expired && !trialStatus.has_ai_mentor && !trialStatus.has_shield && (
      <LearningLabUpsellCard childName={childFirstName} onUpgrade={onUpgrade} />
    )
  )}
  ```

### `ParentDashboard` changes

- `trialStatus` is already fetched (used by `DemoUpsellCard`) — pass it straight through to `<InsightsTab trialStatus={trialStatus} onUpgrade={openBillingUpgrade} .../>`.
- Add `openBillingUpgrade()`: sets `showSettings(true)` and tells `ParentSettingsTab` to open directly on `{type: 'section', section: 'billing', billingSubView: 'plan'}` instead of its default `{type: 'menu'}`.

### `ParentSettingsTab` changes

- `ParentSettingsTab` stays mounted at all times (drawer is a CSS transform, not a mount/unmount), so a plain `initialView` prop consumed only by `useState`'s initializer won't fire on a second open. Add an `openRequest: { view: View; token: number } | null` prop (or equivalent nonce pattern) and a `useEffect` keyed on `token` that calls `setView(view)` when it changes — mirrors how `BillingSettings` already accepts `initialView='plan'` for its own internal sub-view, one level up.

## Non-goals

- No change to trial-period access to Learning Lab.
- No change to the AI Mentor briefing card's always-visible behavior.
- No schema migration to remove the dead `license_type` column.
- No dismiss/"remind me later" state for the new card.
