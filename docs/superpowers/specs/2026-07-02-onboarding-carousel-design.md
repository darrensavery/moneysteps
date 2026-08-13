# First-Launch Onboarding Carousel — Design

## Problem

A fresh, unauthenticated user currently lands on `LandingGate` — a single static screen with brand copy ("Welcome to the Orchard") and three CTAs (Create Family Account / Join your Family / Sign In). There is no explainer of what Morechard actually does before the user is asked to commit to an account. Consumer apps commonly use a short first-launch carousel to establish value before the signup wall; Morechard has none.

## Goals

- Explain the app's core value props (chores → real earnings, financial education, parental control, tamper-proof ledger) in a short, skippable, swipeable sequence.
- Show exactly once per fresh install — never interrupt returning users, and never re-show after it's been seen or skipped.
- Reuse existing infrastructure (routing pattern, brand tokens, Framer Motion, localStorage flag convention) rather than introducing new dependencies.
- Leave `LandingGate` and the registration flow untouched — the carousel sits *before* them, not instead of them.

## Non-goals

- Not a replacement for `LandingGate`'s CTAs — the carousel always ends by routing into `LandingGate`, where account creation actually happens.
- Not localized copy variants per region (UK/US/PL) in this pass — copy is written region-neutral, matching `LandingGate`'s current approach.
- Not an in-app "tour" of live screens — this is a pre-auth marketing/explainer sequence, not product walkthrough tooltips.

## Routing & flow

Fresh unauthenticated flow today:

```
RootGate → (no device identity) → LandingGate → Create/Join/Sign In
```

Revised:

```
RootGate → (no device identity AND mc_has_seen_onboarding !== '1') → OnboardingCarousel → LandingGate
RootGate → (no device identity AND mc_has_seen_onboarding === '1') → LandingGate            [unchanged path]
RootGate → (device identity present) → /lock                                                [unchanged path]
```

`RootGate` (`app/src/App.tsx`, current lines ~113–120) gains one additional condition:

```tsx
function RootGate() {
  const identity = getDeviceIdentity()
  if (identity) return <Navigate to="/lock" replace />
  if (localStorage.getItem('mc_has_seen_onboarding') !== '1') {
    return <Navigate to="/onboarding" replace />
  }
  return <LandingGate />
}
```

New route added to the table in `App.tsx` (alongside `/lock`, `/join`, etc.):

```tsx
<Route path="/onboarding" element={<OnboardingCarousel />} />
```

`OnboardingCarousel` sets the flag and navigates to `LandingGate` on:
- Tapping "Get Started" on the final (4th) slide, or
- Tapping "Skip" from any slide (top-right, visible from slide 1 onward)

Both actions perform the same two steps:
```tsx
localStorage.setItem('mc_has_seen_onboarding', '1')
navigate('/', { replace: true })  // RootGate re-evaluates, now falls through to LandingGate
```

Using `replace: true` and re-entering via `/` (rather than navigating directly to a `LandingGate` route) keeps `RootGate` as the single source of truth for the decision tree — no duplicated logic in the carousel about what comes next.

## Component structure

New file: `app/src/screens/OnboardingCarousel.tsx`

```
OnboardingCarousel (screen)
├── SLIDES: static array of 4 { headline, subtext, imageSrc, alt }
├── activeIndex state (0–3)
├── Skip link (top-right, all slides)
├── Slide viewport
│   ├── Framer Motion drag-to-swipe (x-axis, snap to nearest slide on release)
│   └── AnimatePresence crossfade/slide transition between indices
├── Dot pagination (4 dots, tap-to-jump)
└── Bottom CTA
    ├── slides 1–3: "Next" (advances activeIndex)
    └── slide 4: "Get Started" (completes onboarding, see above)
```

Follows the existing screen-component convention (same shape as `LandingGate.tsx`/`LoginScreen.tsx`: `h-svh flex flex-col`, `bg-[var(--color-bg)]` parchment background, `rounded-2xl h-14` solid-teal primary button, `active:scale-[0.98]` press feedback). No new UI primitives needed — this is a straightforward reuse of existing button/badge classes from those two screens.

Each slide's internal layout: artwork positioned above (mobile-width single column — this is a phone-first PWA, so image sits top, text below, rather than a true left/right split) with the subject composed left-of-frame facing right per the composition rule below, so the figure's gaze leads down/across into the headline and subtext underneath.

## Content — 4 slides

| # | Headline | Subtext | Image metaphor |
|---|---|---|---|
| 1 | Chores that actually pay | Every task is tracked as real, earned money — not just a checklist to cross off. | Child completing a task, coin/light motif |
| 2 | Money lessons that actually stick | The AI Mentor turns their own earning and spending into real financial lessons — not a generic course. | Child + glowing insight/lightbulb motif |
| 3 | 25 lessons kids actually finish | The Learning Lab turns saving, spending and earning into short, hands-on lessons — not another course that gets abandoned. | Child walking toward light beside a wall of books |
| 4 | You approve everything | Nothing gets paid or recorded without your sign-off — and once approved, it's locked for good. You're always in control. | Parent reading something glowing on a tablet |

**Revised 2026-08-13** — the original slide 3/4 pairing gave the tamper-proof ledger its own headline slide, on equal footing with the AI Mentor. That conflicts with the project's positioning rule (`project_positioning.md`): the AI Mentor/financial-education angle is the *primary* hook and lead plan driver; the tamper-proof ledger (Legal Integrity Bundle / Shield AI) is explicitly a byproduct, never the headline. Rebalanced so financial education gets 2 of 4 slots (AI Mentor + Learning Lab) and the permanence/tamper-proof detail is folded into slide 4's subtext as a supporting point under parent control, rather than standing alone as its own slide. `carousel-3.webp` and `carousel-4.webp` were regenerated by the user (2026-08-13) to match: a child approaching a wall of books in warm light (Learning Lab) and a parent reading a glowing tablet (approval).

## Visuals

Style: reuses the brand's established Firefly painterly formula (`marketing/blog/_hero-image-prompts.md` — deep teal/gold, impasto oil texture, warm directional light) but as a **cropped character vignette** rather than a full cinematic background scene, so it reads correctly inside a mobile card instead of a wide blog hero banner.

Prompt tail (vignette variant — trims full-scene staging, keeps the painterly people treatment):
> *, warm rays of sunlight casting long shadows, deep teal and gold tones, dark navy shadows, impasto oil painting texture, thick palette knife brushstrokes, visible canvas grain, dreamlike quality, premium feel, no text, tightly cropped portrait composition, simple softly blurred background*

**Rejected approach (2026-08-13)** — tried forcing a forward-facing character flat/illustrated (Content Type → Graphic, "flat digital illustration character... not photorealistic" tail). Failed across three separate attempts on Firefly Image 4 Ultra and two partner models — faces kept rendering photoreal/softly airbrushed regardless of wording. Root cause: any forward-facing close-up face pushes the model toward photoreal rendering; it's not a prompt-wording problem.

**Confirmed fix (2026-08-13)** — abandon face-forward characters entirely and apply the brand's existing hero-image convention (see `reference_firefly_image_style.md`): **faces hidden — back-turned, over-the-shoulder, or silhouette.** Verified against 4 images already in the library: the two back-turned figures (boy reaching into a golden orange tree; boy/climber scaling a gold cliff face) render flawlessly in the painterly illustrated style every time, with zero photoreal drift, while the one forward-facing portrait in the same set is the only one that reads photoreal. No special "flat character" tail needed — the standard hero tail works fine once the face is out of frame:
> *, warm rays of sunlight casting long shadows, deep teal and gold tones, dark navy shadows, impasto oil painting texture, thick palette knife brushstrokes, visible canvas grain, dreamlike quality, premium feel, no text, tightly cropped portrait composition, simple softly blurred background*

Draft per-slide prompts (subject only — append the tail above). All figures back-turned/over-the-shoulder, face not shown:

1. *A child seen from behind, sleeves rolled up, bent to a task, a warm golden glow rising from their hands as if the work itself is turning to light*
2. *A child seen from behind, head tilted up in wonder, a single glowing golden orb of light hovering just above their raised palm*
3. *A parent seen from behind or over-the-shoulder, looking down at a softly glowing golden tablet or ledger held in both hands, as if reviewing something precious*
4. *A close view of interlocking golden chain links glowing softly, each one sealed with light, resting in open palms* (no figure — unchanged, already face-free)

Firefly settings: Content type → Art · Style Reference: existing hero at ~65% · square or portrait crop (not 16:9, to fit mobile card). Output files land in `app/src/assets/onboarding/slide-{1..4}.{webp|png}` and are imported like other screen art (no CMS/dynamic loading needed — this is a static, rarely-changed sequence).

**Composition rule:** subject positioned left-of-frame, back-turned/face hidden, so the figure's implied gaze/posture leads the eye toward the headline/subtext which sits right-of-image (or below, on narrow viewports). Applies to all 4 slides for visual consistency across the sequence and matches the brand's standing face-hidden convention. User is producing the final artwork directly — the prompts above are reference/starting points, not a hard requirement to run through Firefly.

## Data flow / state

No backend calls, no new API surface. Entirely client-side:
- Read: `localStorage.getItem('mc_has_seen_onboarding')` in `RootGate`
- Write: `localStorage.setItem('mc_has_seen_onboarding', '1')` on skip or completion, inside `OnboardingCarousel`
- Local component state: `activeIndex` (number, 0–3) — not persisted, resets if the carousel is left mid-sequence and somehow re-entered (acceptable; re-entry only happens if the flag write failed, an edge case not worth persisting slide position for)

Matches the existing `mc_`-prefixed, string-`'1'` boolean flag convention used by `mc_first_child_added`, `INTRO_DISMISSED_KEY`, etc.

## Error handling

- `localStorage` unavailable/throws (e.g. private browsing edge cases): wrap the `setItem` call; on failure, still navigate to `LandingGate` for that session — worst case the carousel reappears on next launch, which is a minor annoyance, not a broken flow. No user-facing error state needed.
- Image load failure: standard `<img>` `alt` text present per slide; layout doesn't collapse without the image (headline/subtext/CTA are the functional core, image is decorative enhancement).

## Testing

- Manual: clear `localStorage`, reload at `/` → confirm carousel shows, swipe/dot/Next navigation works, Skip and Get Started both land on `LandingGate` and set the flag, reloading after either no longer shows the carousel.
- Manual: with an existing `mc_device_identity` set (simulate returning user) → confirm `/` still redirects straight to `/lock`, carousel never renders.
- No new automated test infra required; if the project has screen-level smoke tests elsewhere, add one asserting `RootGate` routes to `/onboarding` when the flag is absent and to `LandingGate`/`/lock` otherwise.

## Open items for implementation

- Final Firefly-generated image assets need producing before this ships (prompts above are a starting draft, not final-approved art).
- Exact crop/aspect ratio for the vignette images should be confirmed against the slide card's dimensions during implementation, not guessed here.
