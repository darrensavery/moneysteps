# UI/UX Design System — Morechard PWA

This is the **master reference for UI/UX patterns, interaction conventions, and component
design decisions** as currently implemented in code. It is distinct from `03-brand-book.md`,
which covers visual identity, voice, and copy rules. Use this file when adding or changing
any screen, component, or interaction — it documents *how things are built*, not *what tone
to use*.

Consult `docs/legacy-ui-reference.md` only for pre-React historical context — it describes a
token set and colour-coded-by-parent system (`--green`/`--purple`/`--blue`) that **no longer
exists**. Everything in this file reflects the current React codebase (`app/src`).

---

## 1. Design Tokens (`app/src/index.css`)

Two token systems coexist deliberately — don't try to unify them casually:

**A. Semantic CSS custom properties** (`--color-*`), used by most hand-written components:

```
--brand-primary        #00959c   Grove Teal — never changes across themes
--brand-accent         #e6b222   Harvest Gold — never changes across themes
--brand-deep           #1b2d2e   Deep Canopy
--brand-parchment      #f9f7f2   Parchment

--color-bg             page background      (light #f9f7f2 / dark #1b2d2e)
--color-surface        card/sheet background (light #ffffff / dark #243637)
--color-surface-alt    muted fill (inactive buttons, input backgrounds)
--color-border         all borders           (light #D3D1C7 / dark #3a5254)
--color-text           primary text          (light #1C1C1A / dark #f9f7f2)
--color-text-muted     secondary/label text
--color-text-on-brand  text on brand-coloured surfaces

--color-success        #16a34a (dark #22c55e)
--color-danger         #dc2626 (dark #f87171)
--color-warning        #f59e0b (dark #fbbf24)
```

Tailwind v4 `@theme inline` bridges these into utility classes (`bg-page`, `text-main`,
`text-muted`, `bg-brand`) — prefer the utility class over `bg-[var(--color-x)]` in new code.

**B. HSL tokens** (`--background`, `--foreground`, `--primary`, `--muted`, `--accent`,
`--destructive`, `--border`, `--ring`, `--radius: 0.75rem`) — used by the shadcn-derived
primitives (`button.tsx`, `card.tsx`, `badge.tsx`) via `hsl(var(--x))`. Leave these alone when
touching component A-style code and vice versa.

**Named type scale**: Tailwind's default scale has gaps at small sizes, so `text-9`…`text-15`
(9px–15px) are defined in the `@theme` block — this documents the de facto scale already used
via arbitrary brackets like `text-[0.8125rem]`. Prefer the named token in new code.

**Depth system** (3-tier shadows, distinct dark-mode variants):
`--shadow-card`, `--shadow-card-hover`, `--shadow-card-urgent` (red-tinted, overdue cards),
`--shadow-header`. Applied via the `.card-depth` utility class (adds a dark-mode inner
top-edge highlight for a "lit from above" effect).

**High Contrast mode** (WCAG 2.1 AA — see §5) forces near-white/near-black surfaces and
darkens brand teal to `#006A70` in light mode to clear 4.5:1 on white. Values are verified in
`app/src/lib/contrastRatio.test.ts` — never hand-tune a high-contrast override without running
that check.

**Premium Shell hardcoded values** (intentionally outside the swappable token system — see §7):
`#0f1a14` dark surface, `#0d9488` teal accent (distinct from `--brand-primary` #00959c —
premium shell only), `#d4a017` gold accent.

---

## 2. Typography

- Font: **Manrope** (Google Fonts), weights 400/500/600/700/800.
- Numbers/prices: always `tabular-nums`. Prices are the hero — `font-bold`, never muted.
- Section labels: `text-[13px] font-extrabold uppercase tracking-wider text-[var(--color-text-muted)]`.
- Button labels: weight 600, sentence case, no all-caps.
- iOS Dynamic Type support: `--os-font-scale` CSS var is written by native `AppDelegate.swift`;
  `html { font-size: calc(16px * var(--os-font-scale, 1)) }` — don't hardcode a root font-size
  that would fight this.
- Android WebView font-boosting fix: `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`
  stops Chromium font-boosting from stacking with native `textZoom`. Don't remove this.

---

## 3. Core Components (`app/src/components/ui`)

### Bottom Sheets — `BaseSheet.tsx`
Single shared primitive underlying every sheet (`CreateChoreSheet`, `PaymentConfirmSheet`,
`SpendGuideSheet`, etc.). Never build a new one-off sheet from scratch.
- Full-screen backdrop `rgba(0,0,0,0.6)`, flex `align-items: flex-end`.
- 3-phase state machine `entering → open → closing`, forced repaint via `requestAnimationFrame`
  before entering `open` so the initial state actually renders.
- iOS-style deceleration easing `cubic-bezier(0.32, 0.72, 0, 1)`, 300ms close — "fast start,
  gentle settle, no overshoot."
- Composes `useAndroidBack` (hardware back closes it), `useBodyScrollLock` (page can't scroll
  under it), `useDragToClose`, `useFocusTrap`.
- Drag handle: `w-10 h-1 rounded-full bg-[var(--color-border)]`, centred at top.
- `role="dialog" aria-modal="true" aria-label={label}`; Escape key closes.
- `close()` fires the `tick()` haptic before the closing animation starts.
- Rendered via `createPortal(…, document.body)`.

### Close buttons (canonical — every dismiss in a sheet/modal/drawer)
```tsx
<button type="button" onClick={onClose}
  className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
  aria-label="Close">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12"/>
  </svg>
</button>
```
32×32px, `rounded-lg` (never `rounded-full`), bordered, SVG ✕ at 14×14 (never the `×` text
character, never a coloured background). Exception: full-width CTA buttons that close *and*
act (e.g. Learning Lab module bottom button) use primary button styling — they're actions, not
dismissals. Source of truth: `ParentSettingsTab.tsx` header close button.

### Buttons — `button.tsx` (CVA variants)
`default` (brand teal, inset highlight/shadow depth), `destructive`, `warning`, `outline`,
`secondary`, `ghost`, `link`. Sizes `default`/`sm`/`lg`/`icon` — `icon` carries
`.tap-target-44`. Global interaction: `active:scale-[0.98]`,
`focus-visible:ring-2 ring-[var(--brand-primary)]`.

Ghost/outlined secondary action pattern (e.g. "Check Going Rates"):
```tsx
className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[12px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
```

Disabled buttons must explain *why* — pass a `disabledReason` (see `SettingsRow`) rendered as
a tooltip, never a silently-greyed-out control.

### Badges — `badge.tsx`
`default`, `secondary`, `outline`, `success`, `warning`, `highlight`. **`highlight` is a Von
Restorff isolation device** — reserve it for exactly one element per view; using it on several
badges at once cancels the "stands out" effect.

### Cards
- `bg-[var(--color-surface)]`, `border border-[var(--color-border)]`.
- Radius: `rounded-xl` (list items) or `rounded-2xl` (hero/feature cards).
- Priority accent: `border-l-4 border-amber-500`. Flash/urgent accent: `border-l-4 border-red-500`.
- Hover: subtle lift matching the existing shadow elevation (`.card-depth`).

### Sticky action bars — `StickyActionBar.tsx`
Single shared primitive for every tab's bottom CTA (Chores "+ Add chore", Activity "Pay out",
Expenses "+ Log shared expense", Insights period toggle). `fixed bottom-0`, centred,
`max-width: 520px`, bottom margin `calc(max(12px, env(safe-area-inset-bottom)) + 68px)` to
clear the fixed bottom nav. Never hand-roll a competing sticky bar — all six tabs must share
identical width/offset by construction.

### Toasts — `MicroToast.tsx`
Bottom-centre, `role="status"`, dark surface `#1b2d2e` + `border-white/10`, swipeable-to-dismiss
(`SwipeDismissCard`), duration scales with message length
(`Math.min(6000, Math.max(2500, len*50))`), pauses countdown on hover/focus. Undo-toast variant
(e.g. archive undo) shows an SVG ring with the `animate-undo-drain` keyframe (4000ms linear
stroke-dashoffset) to visualise remaining undo time.

### Empty / error / loading states
- **Empty state**: never a plain text message — show a Premium Shell (Orchard Mentor) card
  with 3 numbered, name-personalised action tips, followed by a dashed "Add first X" button.
  Source of truth: `EmptyChoresState` in `JobsTab.tsx`.
- **Error** — `ErrorBox.tsx`: `role="alert"`, red-tinted, dark-mode variant, optional inline
  `onRetry`/`retryLabel` recovery action. Don't dead-end an error with no retry path.
- **Loading** — `Skeleton.tsx`: `SkeletonRow`/`SkeletonList`, `animate-pulse`, sized to match
  the real card layout to avoid layout jump, `aria-hidden="true"`. Where the wait has a known
  cause, name it in text instead of a bare skeleton (e.g. Insights: "Analyzing this week's
  chores…").

### Swipe-reveal / swipe-to-archive — `SwipeRevealCard.tsx`
Reveals a destructive action (Archive) behind horizontal drag. `OPEN_THRESHOLD=40px` snaps to
`REVEAL_WIDTH=84px`. One-time `autoPeek` coachmark nudges to `PEEK_WIDTH=32px` then springs
back (state persisted via `app/src/lib/swipeHint.ts` so it only auto-peeks once). Tapping while
open closes it rather than triggering the underlying row (native list convention).
`touchAction: 'pan-y'` preserves vertical scroll.

**Rule: every swipe-reveal destructive action must also have a keyboard/AT-reachable fallback**
(an explicit icon-only button, e.g. `aria-label="Archive chore"` in the card footer) — swipe is
mouse-drag-only on desktop with no keyboard/assistive-tech path. Same reasoning as always
keeping a sheet's close "✕" even though swipe-down-to-close also exists. (This was briefly
regressed — the archive text link was removed as "redundant" with swipe, then restored as an
icon-only button once recognised as an a11y regression. Don't re-make that mistake.)

### Toggle — `Toggle.tsx`
Shared switch primitive (used by `HighContrastToggle`, chore-sheet toggles, etc.) — don't
build a bespoke switch.

### Accordion toggle (chevron, never +/−)
`polyline points="6 9 12 15 18 9"`, rotates 180° when open. **Never use `+`/`−` for accordion
toggles.** Expanded state must survive data reloads — lift `expanded` state to the parent
(e.g. `expandedId` in `ChoresTab`), never keep it local to the row component.

---

## 4. Iconography

Two systems, used for different purposes:

1. **Chore category icons** — custom inline SVGs in `app/src/lib/choreIcons.tsx`
   (`CHORE_CATEGORIES`), 21 hand-drawn stroke icons (viewBox 24×24, `strokeWidth="1.8"`, round
   caps/joins), keyed **exactly** to `market_rates.category` values
   (`worker/migrations/0029_market_rates.sql`) — `"General"` is the only synthetic fallback key.
   A chore's icon is **persisted** on the row (`chore.icon_key`,
   `worker/migrations/0094_chore_icon_key.sql`) and rendered via `ChoreIcon.tsx`
   (`renderCategoryIcon(iconKey || guessChoreCategory(title), size)`); the keyword-matching
   `guessChoreCategory` is only a fallback for chores created before icons were persisted.
   Never re-introduce title-guessing as the primary path — it silently breaks for custom chore
   names and Quick Pick tiles. Icon picker grid in `CreateChoreSheet`: 7 columns, 21 icons; the
   chosen swatch stays teal-tinted persistently, not just while the picker is open.
2. **General UI chrome** (nav, chevrons, etc.) — `lucide-react`, used broadly across the app.
3. Dedicated jar icons — `app/src/components/icons/` (`SpendJarIcon`, `SaveJarIcon`, `GiveJarIcon`).

Chore naming convention (also governs which icon matches): infinitive verb form —
"Walk the Dog", "Wash the Dishes", "Mow the Lawn" — never gerund ("Walking Dog").

---

## 5. Accessibility

- **Global focus ring** (`index.css`): `*:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }` — a deliberate blanket fallback layered under any component's own ring, because many ad hoc buttons had none.
- **High Contrast mode**: `data-contrast="high"` on `<html>`, toggled via `app/src/lib/theme.tsx`. Falls back to OS `prefers-contrast: more` when no explicit preference is stored, same pattern as the light/dark `system` preference. Values verified against WCAG AA in `contrastRatio.ts`/`.test.ts`.
- **Reduced motion**: honoured at the point of each major animated overlay (`MilestoneOverlay`, `PremiumShell`), not globally suppressed — confetti, celebratory haptics, and the Premium Shell border spin are all gated on `prefers-reduced-motion: reduce`. `MilestoneOverlay` listens live via `matchMedia`.
- **44×44 tap targets**: `.tap-target-44` expands only the invisible hit box via a centred `::before` for visually-smaller icon buttons (Apple HIG / WCAG).
- **Swipe fallback rule** — see §3 above. Applies to any future swipe-only interaction, not just archive.
- **Focus management in overlays**: `MilestoneOverlay` moves focus onto the Continue button on every stage transition; `BaseSheet` uses `useFocusTrap`.
- Landmarks: `role="dialog" aria-modal="true" aria-label` on sheets/overlays, `role="alert"` on `ErrorBox`, `role="status"` on `MicroToast`.
- Disabled controls always carry a `disabledReason` tooltip (§3) rather than an unexplained disabled state.

---

## 6. Motion & Haptics

No animation library — all motion is hand-rolled CSS keyframes/transitions plus small React
phase-state machines (`BaseSheet`, `MilestoneOverlay`). Keep it that way; don't introduce
framer-motion for a one-off.

### Haptics — `app/src/lib/haptics.ts`
```ts
tick()               // ImpactStyle.Light, vibrate 10ms   — nav/tab/picker taps
confirm()             // ImpactStyle.Medium, vibrate 20ms  — deliberate approvals/purchases
warn()                // NotificationType.Warning, vibrate [15,60,15] — errors, streak lost
celebrate(tier)       // 'standard' | 'landmark' — Notification.Success, vibrate [10,40,20];
                      // 'landmark' adds a 120ms delay + extra 25ms Medium impact (two-beat feel)
```
Native-first (`@capacitor/haptics`) → `navigator.vibrate()` fallback on web → silent no-op.
**Call from the click handler synchronously**, never after an async round-trip — Android
Chrome requires a live user gesture. `celebrate(tier)` takes the *same* `'standard'|'landmark'`
tier already defined for the celebration overlay (`components/celebration/types.ts`) — pass the
milestone's own tier, don't re-decide haptic weight at the call site. Deliberately **not**
wired into secondary/low-stakes toggles (e.g. Photo Proof, Skip Approval) so they don't
out-rank primary actions.

### Celebrations — `app/src/components/celebration/`
- `MilestoneOverlay.tsx`: full-screen, config-driven per milestone type (`registry.ts`,
  `configs/*.ts`). Stages advance on explicit tap ("Continue" / "Let's go! 🎉"), never
  auto-timed. `'stage' | 'transition' | 'exit'` phase machine, 600ms transition. Payoff
  (confetti + `celebrate()`) fires once per overlay (`confettiSpawned` ref guard), gated on
  `hasPayoff` (tier `standard`/`landmark` only) and `reducedMotion`.
- Confetti = manually appended DOM divs (`mc-leaf-drop` keyframes) in brand palette
  (`#00959c`, `#3fcf9b`, `#e6b222`, `#ffe39a`, `#1d8f6f`) — thematically leaves, not generic
  shapes, tying back to the orchard/tree motif.
- `MicroToast` is the lighter Micro-tier celebration (fires `tick()`, not `celebrate()`).
- `StreakRing.tsx` counts up `previousStreak → newStreak`, firing the payoff via `onComplete`
  once the count-up finishes — don't fire confetti/haptic before the number animation lands.

### General keyframes (`index.css`)
`tab-fade-in` (150ms crossfade — tab panels stay mounted, never remount on switch),
`treeSway`/`leafFall` (ambient brand-motif decoration), `shake` (0.55s form-validation error),
`spark-glow` (brand glow pulse via `color-mix`), `undo-drain` (4000ms linear countdown ring),
`badge-shimmer` (2.8s diagonal sweep on earned badges), `badge-ring-pulse` (2s pulse on
next-up badge when progress ≥60%). Sheet motion uses the iOS easing documented in §3.

---

## 7. Premium Shell — AI Mentor / Orchard Pro cards

The visual language for **any AI-powered or paid-tier feature**. Deliberately breaks from the
standard card surface to signal a different tier. Never redeclare it locally — import from
`app/src/components/ui/PremiumShell.tsx` (`PremiumShell`, `MentorAvatar`, `ProBadge`,
`AiDisclosurePill`, `injectPremiumStyles`).

- **Surface**: `#0f1a14` (deep forest black-green), fixed regardless of light/dark theme —
  never `var(--color-surface)`.
- **Animated border**: `conic-gradient` via `@property --border-angle`, cycling
  Teal `#0d9488` → Gold `#d4a017` → Teal, 4s linear spin, class `.premium-shell` (injected once
  via `injectPremiumStyles()` in a mount `useEffect`). Static diagonal gradient fallback for
  `prefers-reduced-motion`.
- **Glow**: `box-shadow: 0 0 32px rgba(13,148,136,0.15), 0 4px 16px rgba(0,0,0,0.3)` + inner
  radial gradient overlay.
- **Pro badge**: gold `#d4a017` text on `rgba(212,160,23,0.15)`, `1px solid rgba(212,160,23,0.3)`
  border, label `✦ Pro`, always top-right.
- **AI disclosure pill** (`AiDisclosurePill`): "AI-generated" tooltip — an EU AI Act Article 50
  compliance disclosure. Show it **only** on genuinely AI-generated content, never on
  deterministic rule-based fallback text.
- **Mentor Avatar**: 36×36 circle, accent background at 13% opacity, leaf SVG icon in accent
  colour (defaults to `MENTOR_COLORS.accent`).
- **Text palette on dark surface** (`MENTOR_COLORS`): label `#6b9e87`, heading `#f0fdf4`
  (memory: also documented as body `#c4ddd4`/secondary `#8ab8a4` in earlier UI text — check
  the live constant in `PremiumShell.tsx` before hand-copying values), accent `#0d9488`,
  gold `#d4a017`, bright `#4ade80`. Borders/dividers: `rgba(13,148,136,0.2)`.
- **Action block ("The Nudge")**: `rgba(13,148,136,0.12)` bg, `rgba(13,148,136,0.2)` border,
  sparkle icon in teal.
- **CTA button**: primary `linear-gradient(135deg, #0d9488, #0a7c70)`; secondary ghost
  `rgba(255,255,255,0.07)` bg, `rgba(255,255,255,0.1)` border.
- **Footer attribution**: `✦ Orchard Pro · AI-generated coaching note` at 70% opacity muted green.

**Persona accents** (`PERSONA_CONFIG` in `InsightsTab.tsx` — real, implemented, not aspirational):
| Persona | Accent |
|---|---|
| Coach | `#0d9488` (teal, = `MENTOR_COLORS.accent`) |
| Accountant | `#d4a017` (gold) |
| Analyst | `#8b5cf6` (violet) |

**Mandatory for every "Orchard Mentor" card instance** — must call `injectPremiumStyles()` in
a mount `useEffect`:
- `InsightsTab` — `DiscoveryCard` + `LiveBriefingCard` (all personas)
- `HistoryTab` — `MentorEmptyCard` (no pending approvals)
- `JobsTab` — `EmptyChoresState` (child has no chores yet)

**`GrowingTree` component** (`app/src/components/ui/GrowingTree.tsx`) — pure SVG, 5 stages
keyed to savings-goal progress %: 0–19% Seed, 20–39% Sprout, 40–59% Sapling, 60–79% Growing
(Young Tree), 80–100% Full Oak. Used in Child Dashboard's Savings Grove primary goal card
instead of a 🎯 emoji.

---

## 8. Child-facing language constraint (cross-cutting, not just copy)

Any UI element whose label or metaphor is visible to a child under 12 must use vocabulary a
child that age reliably understands. **Do not surface the "grove" metaphor in child-facing UI
text** even though it's used internally (Grove Teal, `SavingsGrove`, `grovePlans` — those
identifiers can stay). This affects component naming choices that leak into UI copy, icon
choice, and empty-state tip wording for child screens — not just string content. Teen/Clean
mode is unaffected and uses precise fintech language. See `03-brand-book.md` for the full copy
rule.

---

## 9. Sort & filter pattern

Use a **native `<select>` dropdown showing every option up front** — not a button that cycles
through options one click at a time (a cycling button hides the alternatives and was replaced
across Chores/Activity/History for exactly this reason). Standard option set for lists with a
price and a date: **A–Z / Z–A / Amount (Highest/Lowest) / Due date**, with due-date sort
putting undated items last (alphabetically, not randomly).

---

## 10. Layout & platform gestures

- Content max-width ~520–560px, centred, with safe-area insets applied to sticky headers/footers.
- Swipe-back gesture direction must match the native tab-switch gesture direction — don't let a
  screen's custom swipe handler fight the OS/tab-bar convention.
- Watch for **stacked bottom padding**: each tab's own bottom padding plus the shared `<main>`
  wrapper's padding can silently add up to large dead scroll space under the fixed bottom nav —
  check the combined total, not just the tab's own value, when adding a new tab.
- Edge fades (left/right gradient) on horizontally-scrolling strips (e.g. child selector) should
  only render when the strip actually overflows (detected via a scroll-width check), not
  unconditionally.

---

## 11. What NOT to do

- Don't use the `×` text character for close buttons — use the SVG path (§3).
- Don't use `rounded-full` for close buttons — use `rounded-lg`.
- Don't use `+`/`−` for accordion toggles — use the chevron SVG.
- Don't render `chore.is_flash`/`chore.is_priority` directly — SQLite returns 0/1 integers and
  React renders a bare `0` as visible text; cast with `!!` first.
- Don't hardcode prices/colours outside CSS variables — the Premium Shell hex values are the
  one deliberate, documented exception.
- Don't reintroduce title-keyword icon guessing as the primary path for chore icons — use the
  persisted `icon_key` (§4).
- Don't remove a swipe-only destructive action's explicit button fallback "because swipe already
  does it" — that's an accessibility regression that has already happened once (§3).
- Don't build a second sticky-bar, sheet, toast, or switch primitive — extend the shared one
  (`StickyActionBar`, `BaseSheet`, `MicroToast`, `Toggle`).
- Don't fire haptics after an `await` on a click handler — fire synchronously in the handler,
  await afterwards.
- Don't use the "grove" metaphor in child-facing copy or component framing (§8).
- Don't skip the retry action on a new `ErrorBox` usage without a specific reason — the pattern
  exists precisely so errors aren't dead ends.

---

## Maintenance rule

When you ship a UI/UX pattern change — a new shared primitive, a token change, an accessibility
fallback, a new animation/haptic convention — update this file in the same change. This file
existing and drifting from the code is worse than it not existing.
