# High Contrast Mode — Design Spec

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning

## Problem

An accessibility audit of the app (`app/src`) found no verified WCAG contrast compliance: the brand palette (Grove Teal `#00959c` on Parchment/white ≈ 2.7:1) fails the 4.5:1 AA minimum for normal text, borders/focus rings are unverified against the 3:1 non-text minimum, and there is no accessibility tooling in CI. Rather than change the default brand palette, add an opt-in High Contrast mode that meets WCAG 2.1 AA (4.5:1 text, 3:1 non-text) when active, without touching the default visual identity.

## Decisions

1. **Independent toggle, not a third theme.** High Contrast is orthogonal to Light/Dark/System (already `ThemePreference` in `app/src/lib/theme.tsx`). Four real combinations exist: light, dark, light+HC, dark+HC — driven by two independent HTML attributes, `data-theme` and `data-contrast`.
2. **Tuned-brand palette, not black & white.** HC mode keeps Grove Teal / Harvest Gold as the identity but shifts them to darker/more saturated variants calibrated to hit 4.5:1 for text and 3:1 for large/bold or non-text elements. Values are computed against real contrast math, not eyeballed.
3. **Non-text contrast is in scope.** Borders, dividers, icon strokes, focus rings, and progress-bar fills get strengthened HC tokens to meet the 3:1 minimum (WCAG 1.4.11), alongside the 4.5:1 text rule.
4. **Both parent and child accounts.** Same per-user mechanism as the existing `theme` setting — each account (parent or child) sets its own HC preference via `user_settings`.
5. **OS-level `prefers-contrast: more` is respected as a fallback**, independent of the light/dark preference. If a user has never set an explicit HC preference (nothing in `localStorage('mc_high_contrast')` or `user_settings.high_contrast`), the app defaults to `matchMedia('(prefers-contrast: more)').matches` — mirroring how `system` already falls back to `prefers-color-scheme` for light/dark. This is a fully independent signal: OS-level high contrast is honored even if the user has explicitly pinned Light or Dark, since those two preferences (color scheme vs. contrast level) are orthogonal at the OS level too.
6. **Migrate hardcoded colors to Tailwind utility tokens, not raw `var()` arbitrary values.** The app runs Tailwind v4 with zero `tailwind.config.*` (confirmed absent) — all styling lives in `app/src/index.css`. Add an `@theme inline` block mapping the existing runtime-swappable `--color-*` custom properties (already defined in `:root` / `[data-theme="dark"]`) into real Tailwind utility names (e.g. `text-main`, `bg-surface`, `border-subtle`) instead of `text-[var(--color-text)]` arbitrary-value syntax. The HC override still works underneath since each utility resolves to the same swappable CSS variable.
7. **Testing: token math + rendered DOM, not just token math.** A static unit test checks the actual HC hex/token pairs against WCAG contrast math (fast feedback on palette edits). Additionally, `@axe-core/playwright` runs against the 4 core loops (parent dashboard, child dashboard, chore/expense sheets, settings) plus registration, in both HC-on and HC-off states — this catches computed/rendered failures a static pair check can't (opacity modifiers like `bg-teal-500/20`, layered backgrounds, future hardcoded regressions).

## Architecture

### Data model

- New column: `user_settings.high_contrast INTEGER NOT NULL DEFAULT 0` (migration `00XX_high_contrast.sql`, boolean-as-int, consistent with existing flags on that table).
- `worker/src/routes/settings.ts`: extend `GET/PATCH /api/settings` to read/write `high_contrast` alongside `theme`/`locale`/`app_view`, same `z.enum`/validation pattern as `VALID_THEMES`.

### Theme engine (`app/src/lib/theme.tsx`)

- New state parallel to `preference`/`resolved`: `highContrastPreference: boolean | 'system'`-style resolution mirroring the existing `resolve()` function — but for contrast:
  - `readStoredContrastPreference()` reads `localStorage('mc_high_contrast')`.
  - If unset, resolve via `systemPrefersMoreContrast()` (`matchMedia('(prefers-contrast: more)')`), matching the existing `systemPrefersDark()` pattern.
  - `applyToDOM` sets `data-contrast="high"` on `<html>` when active (omitted entirely when inactive, so CSS selectors stay simple).
- `setHighContrast(v: boolean)` persists to `localStorage` and fire-and-forget syncs to `PATCH /api/settings` (same pattern as `setTheme`).
- Listen for `matchMedia('(prefers-contrast: more)').addEventListener('change', ...)` the same way the existing dark-mode listener works, active only when no explicit user preference is stored.

### CSS (`app/src/index.css`)

- Add `@theme inline` block mapping current `--color-*` tokens to Tailwind utility names.
- Add two override blocks:
  ```css
  [data-contrast="high"] { /* light+HC: darker teal, near-black text, stronger borders/focus rings */ }
  [data-theme="dark"][data-contrast="high"] { /* dark+HC: brighter tuned teal/gold, near-white text, stronger borders/focus rings */ }
  ```
- Every value in both blocks is checked against real contrast math (4.5:1 text / 3:1 non-text) before merging — computed, not eyeballed.

### Component migration

- Sweep the 102 hardcoded `text-[#…]` / `border-[#…]` / `bg-[#…]` occurrences across the 16 identified files (`ParentSettingsTab.tsx`, `theme.tsx`'s own `ThemePicker`, registration stages, `MicroToast`, `JarCard`, `SparklineCard`/`SparklineExpanded`, `InsightsTab`, `Logo`, etc.) to the new named utilities.
- Explicitly exclude intentionally decorative literals (badge gradients, brand wordmark) — those stay as-is; call out any ambiguous cases during implementation rather than blind find-replace.

### UI surface

- `app/src/components/settings/sections/AppearanceSettings.tsx` — already the shared home for `ThemePicker` + language picker for both parent and child settings screens. Add a labelled switch below `ThemePicker`: "High Contrast — meets WCAG AA accessibility standards for text and interface contrast," wired to `useTheme()`'s new `highContrast`/`setHighContrast`.

### Testing

- Static unit test: verify every HC token pair (text/bg, border/bg, focus-ring/bg) against WCAG contrast math (4.5:1 / 3:1), covering both light+HC and dark+HC.
- `@axe-core/playwright` (or `playwright-axe`) pass over: parent dashboard, child dashboard, a chore/expense sheet, settings, registration — run once with HC off, once with HC on.
- Manual spot-check across the same 5 surfaces before shipping.

## Out of scope

- Changing the default (non-HC) brand palette.
- Broader accessibility tooling (`eslint-plugin-jsx-a11y`, full-site axe CI) beyond what's needed to verify this feature — tracked separately as the wider accessibility gap identified in the earlier audit.
- Reduced-motion handling, skip links, aria-live coverage — separate known gaps, not part of this spec.
