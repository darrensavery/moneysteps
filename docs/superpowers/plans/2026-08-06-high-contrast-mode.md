# High Contrast Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in High Contrast mode (parent + child accounts) that meets WCAG 2.1 AA contrast (4.5:1 text, 3:1 non-text) without changing the default brand palette.

**Architecture:** A new `data-contrast="high"` HTML attribute, independent of the existing `data-theme` attribute, drives a CSS override layer in `app/src/index.css`. A Tailwind v4 `@theme inline` block maps the app's existing runtime-swappable `--color-*` custom properties into named utility classes (`text-main`, `bg-surface`, etc.), replacing hardcoded hex Tailwind classes across 16 files so the override layer actually reaches them. State lives in `app/src/lib/theme.tsx` (extending the existing `ThemeProvider`), persisted per-account via a new `user_settings.high_contrast` column, with an OS-level `prefers-contrast: more` fallback.

**Tech Stack:** React + TypeScript, Tailwind CSS v4 (`@theme inline`, no `tailwind.config.*` file), Cloudflare D1 (SQLite), Cloudflare Workers, Vitest (or existing unit test runner — confirm via `app/package.json`), `@axe-core/playwright`.

## Global Constraints

- Never use `--local` on any wrangler D1 command (dev DB: `morechard-dev`, prod DB: `morechard`, requires `--env production`).
- Text contrast in HC mode: ≥4.5:1 (WCAG 2.1 AA, 1.4.3). Non-text (borders, icons, focus rings, progress fill): ≥3:1 (WCAG 2.1 AA, 1.4.11). All values in this plan are computed against these thresholds — do not substitute eyeballed colors.
- HC mode must not change the default (non-HC) palette or existing `data-theme` behavior.
- `data-contrast="high"` attribute is applied/omitted (never set to `"normal"`) so CSS selectors stay simple: `[data-contrast="high"]` and `[data-theme="dark"][data-contrast="high"]`.
- Toggle applies to both parent and child accounts (`user_settings` is already per-`user_id`).
- Spec: `docs/superpowers/specs/2026-08-06-high-contrast-mode-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/migrations/0092_high_contrast_setting.sql` | Add `user_settings.high_contrast` column |
| `worker/src/routes/settings.ts` | Read/write `high_contrast` via `GET`/`PATCH /api/settings` (modify) |
| `worker/src/routes/settings.test.ts` | New/extended tests for the `high_contrast` field (create if no existing test file, else modify) |
| `app/src/lib/theme.tsx` | `highContrast` state, `prefers-contrast` fallback, `data-contrast` DOM attribute, `HighContrastToggle` component (modify) |
| `app/src/lib/theme.test.ts` | Unit tests for contrast-preference resolution logic (create) |
| `app/src/lib/contrastRatio.ts` | Pure WCAG contrast-ratio math + the HC token table, used by both the CSS-comment-verification test and (optionally) any future palette tooling (create) |
| `app/src/lib/contrastRatio.test.ts` | Unit test asserting every HC token pair meets its threshold (create) |
| `app/src/index.css` | `@theme inline` utility mapping + `[data-contrast="high"]` / `[data-theme="dark"][data-contrast="high"]` override blocks (modify) |
| `app/src/components/settings/shared.tsx` | `Toast` component — migrate hardcoded hex to token utilities (modify) |
| `app/src/screens/LandingScreen.tsx`, `JoinFamilyScreen.tsx` | Migrate hardcoded hex to token utilities (modify) |
| `app/src/components/registration/Stage2FamilyConstitution.tsx`, `Stage3SecureApp.tsx`, `RegistrationShell.tsx`, `Stage4CoParentBridge.tsx` | Migrate hardcoded hex to token utilities (modify) |
| `app/src/components/dashboard/InsightsTab.tsx`, `JarCard.tsx`, `ParentSettingsTab.tsx`, `SparklineCard.tsx`, `SparklineExpanded.tsx` | Migrate hardcoded hex to token utilities (modify) |
| `app/src/components/celebration/MicroToast.tsx`, `app/src/components/review/ReviewPromptSheet.tsx`, `app/src/components/ui/Logo.tsx` | Migrate hardcoded hex to token utilities (modify) |
| `app/src/components/settings/sections/AppearanceSettings.tsx` | Add the High Contrast toggle UI (modify) |
| `app/e2e/high-contrast-a11y.spec.ts` | `@axe-core/playwright` sweep across 5 core surfaces, HC on/off (create) |

---

### Task 1: DB migration + settings API

**Files:**
- Create: `worker/migrations/0092_high_contrast_setting.sql`
- Modify: `worker/src/routes/settings.ts:24,45-50,57-98,102-164`
- Test: `worker/src/routes/settings.test.ts` (check if it exists first; if not, create it — search `worker/src` for the existing test pattern used for other route files before writing, so naming/imports match)

**Interfaces:**
- Produces: `user_settings.high_contrast` column (`INTEGER NOT NULL DEFAULT 0`). `GET /api/settings` response gains a `high_contrast: 0 | 1` field. `PATCH /api/settings` accepts an optional `high_contrast: boolean` body field.

- [ ] **Step 1: Write the migration file**

```sql
-- 0092_high_contrast_setting.sql
-- Adds a per-user High Contrast accessibility preference (WCAG 2.1 AA).
-- Independent of `theme` (light/dark) — see docs/superpowers/specs/2026-08-06-high-contrast-mode-design.md
ALTER TABLE user_settings ADD COLUMN high_contrast INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply the migration to `morechard-dev`**

Run: `cd worker && npx wrangler d1 migrations apply morechard-dev --remote`
Expected: migration `0092_high_contrast_setting.sql` applied successfully, no error.

- [ ] **Step 3: Verify the column exists**

Run: `cd worker && npx wrangler d1 execute morechard-dev --remote --command="PRAGMA table_info(user_settings)"`
Expected: a row for `high_contrast`, type `INTEGER`, `dflt_value` `0`.

- [ ] **Step 4: Update the settings schema and defaults in `worker/src/routes/settings.ts`**

Add to the top-level constants (near line 24):
```typescript
const VALID_THEMES  = ['light', 'dark', 'system'] as const;
```
stays as-is — `high_contrast` is a boolean, not an enum, so no new constant needed.

Modify `settingsUpdateSchema` (line 45-50):
```typescript
const settingsUpdateSchema = z.object({
  avatar_id:      z.enum(VALID_AVATARS, { message: 'Invalid avatar_id' }).optional(),
  theme:          z.enum(VALID_THEMES,  { message: 'Invalid theme' }).optional(),
  locale:         z.enum(VALID_LOCALES, { message: 'Invalid locale' }).optional(),
  app_view:       z.any().optional(),
  high_contrast:  z.any().optional().refine(
    v => v === undefined || v === 0 || v === 1 || v === true || v === false,
    'high_contrast must be a boolean',
  ),
});
```

- [ ] **Step 5: Include `high_contrast` in `handleSettingsGet` (lines 57-98)**

Update the `SELECT`:
```typescript
  const settings = await env.DB
    .prepare(`
      SELECT us.user_id, us.avatar_id, us.theme, us.locale, us.app_view, us.high_contrast,
             u.earnings_mode, u.allowance_amount, u.allowance_frequency
      FROM user_settings us
      JOIN users u ON u.id = us.user_id
      WHERE us.user_id = ?
    `)
    .bind(targetId).first();
```
Update the no-row default-insert branch:
```typescript
  if (!settings) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, high_contrast, updated_at)
                VALUES (?,?,?,?,'ORCHARD',0,?) ON CONFLICT(user_id) DO NOTHING`)
      .bind(targetId, 'bottts:spark', 'system', 'en', now).run();
    const userRow = await env.DB
      .prepare('SELECT earnings_mode, allowance_amount, allowance_frequency FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ earnings_mode: string; allowance_amount: number; allowance_frequency: string }>();
    return json({
      user_id: targetId, avatar_id: 'bottts:spark', theme: 'system', locale: 'en', app_view: 'ORCHARD',
      high_contrast: 0,
      earnings_mode: userRow?.earnings_mode ?? 'CHORES',
      allowance_amount: userRow?.allowance_amount ?? 0,
      allowance_frequency: userRow?.allowance_frequency ?? 'WEEKLY',
    });
  }
```

- [ ] **Step 6: Include `high_contrast` in `handleSettingsUpdate` (lines 105-164)**

After the `app_view` block (around line 136), add:
```typescript
  if ('high_contrast' in parsed) {
    updates.push('high_contrast = ?'); values.push(parsed.high_contrast ? 1 : 0);
  }
```
Update both `INSERT ... user_settings` statements in this function (the initial insert-fallback in the `.catch()` block, lines ~150-152) the same way as Step 5's insert — add `high_contrast` column and `0` value:
```typescript
        .prepare(`INSERT INTO user_settings (user_id, avatar_id, theme, locale, app_view, high_contrast, updated_at)
                  VALUES (?,?,?,?,'ORCHARD',0,?) ON CONFLICT(user_id) DO NOTHING`)
```

- [ ] **Step 7: Write a failing test**

First check for an existing settings test file (`worker/src/routes/settings.test.ts` or similar under `worker/src`) and match its existing setup/mocking pattern (DB stub, auth stub) exactly — do not invent a different test harness. Add:

```typescript
describe('high_contrast setting', () => {
  it('defaults to 0 (off) for a new user', async () => {
    // arrange: fresh user with no user_settings row
    // act: GET /api/settings
    // assert: response body includes high_contrast: 0
  });

  it('persists high_contrast: true as 1 via PATCH, and GET reflects it', async () => {
    // act: PATCH /api/settings { high_contrast: true }
    // assert: PATCH response ok: true
    // act: GET /api/settings
    // assert: response body includes high_contrast: 1
  });

  it('rejects a non-boolean high_contrast value', async () => {
    // act: PATCH /api/settings { high_contrast: "yes" }
    // assert: 400-level error response, message mentions high_contrast
  });
});
```
(Fill in the arrange/act/assert with real calls once the existing test file's harness/imports are visible — do not guess the harness shape blind.)

- [ ] **Step 8: Run the test suite to verify it fails, then implement, then verify it passes**

Run: `cd worker && npm test -- settings` (adjust to the actual test script in `worker/package.json` if different)
Expected first: FAIL (column/field doesn't exist yet, or test targets code not yet written)
Then apply Steps 4-6 if not already done, re-run.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add worker/migrations/0092_high_contrast_setting.sql worker/src/routes/settings.ts worker/src/routes/settings.test.ts
git commit -m "feat: add high_contrast user setting (DB + API)"
```

---

### Task 2: Theme engine — `highContrast` state + `prefers-contrast` fallback

**Files:**
- Modify: `app/src/lib/theme.tsx` (entire file — extending existing `ThemeProvider`/`ThemeContext`)
- Create: `app/src/lib/theme.test.ts`

**Interfaces:**
- Consumes: `updateSettings` from `./api` (already imported in `theme.tsx`); now must also accept `{ high_contrast?: boolean }` in its payload type — check `app/src/lib/api.ts` for the `updateSettings` signature and widen it if it's narrowly typed to `{ theme?: ThemePreference }`-shaped fields only.
- Produces: `useTheme()` now returns `{ preference, resolved, setTheme, highContrast: boolean, setHighContrast: (v: boolean) => void }`. `HighContrastToggle` component (new, exported alongside `ThemePicker`).

- [ ] **Step 1: Extend the context type and default value**

```typescript
interface ThemeContextValue {
  preference: ThemePreference
  resolved:   ResolvedTheme
  setTheme:   (t: ThemePreference) => void
  /** Whether High Contrast (WCAG AA) mode is active. */
  highContrast: boolean
  /** Change the High Contrast preference and persist it. */
  setHighContrast: (v: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved:   'light',
  setTheme:   () => {},
  highContrast: false,
  setHighContrast: () => {},
})
```

- [ ] **Step 2: Add the read/resolve helpers, mirroring `readStoredPreference`/`systemPrefersDark`/`resolve`**

```typescript
function readStoredHighContrast(): boolean | null {
  try {
    const v = localStorage.getItem('mc_high_contrast')
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* storage blocked */ }
  return null // no explicit preference stored
}

function systemPrefersMoreContrast(): boolean {
  try {
    return window.matchMedia('(prefers-contrast: more)').matches
  } catch { return false }
}

function resolveHighContrast(): boolean {
  const stored = readStoredHighContrast()
  if (stored !== null) return stored
  return systemPrefersMoreContrast()
}
```

- [ ] **Step 3: Extend `applyToDOM` to take the resolved contrast flag**

```typescript
function applyToDOM(resolved: ResolvedTheme, highContrast: boolean) {
  document.documentElement.setAttribute('data-theme', resolved)
  if (highContrast) {
    document.documentElement.setAttribute('data-contrast', 'high')
  } else {
    document.documentElement.removeAttribute('data-contrast')
  }
  const meta = document.getElementById('meta-theme-color')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1b2d2e' : '#00959c')

  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: resolved === 'dark' ? Style.Dark : Style.Light })
      .catch(() => { /* plugin unavailable (web) */ })
  }
}
```
Update every existing call site of `applyToDOM(r)` inside `ThemeProvider` to pass the current resolved contrast value (added in Step 4) — there are two call sites in the current file (mount effect, and the `prefers-color-scheme` change listener).

- [ ] **Step 4: Add high-contrast state and effects to `ThemeProvider`**

```typescript
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [resolved,   setResolved]        = useState<ResolvedTheme>(() =>
    resolve(readStoredPreference())
  )
  const [highContrast, setHighContrastState] = useState<boolean>(resolveHighContrast)

  useEffect(() => {
    const r = resolve(preference)
    setResolved(r)
    applyToDOM(r, highContrast)
  }, [preference, highContrast])

  useEffect(() => {
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const r = resolve('system')
      setResolved(r)
      applyToDOM(r, highContrast)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference, highContrast])

  // OS-level high-contrast fallback — only live while no explicit user
  // preference is stored (matches the `system` theme fallback pattern).
  useEffect(() => {
    if (readStoredHighContrast() !== null) return
    const mq = window.matchMedia('(prefers-contrast: more)')
    const handler = () => {
      const hc = systemPrefersMoreContrast()
      setHighContrastState(hc)
      applyToDOM(resolved, hc)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [resolved])

  const setTheme = useCallback((t: ThemePreference) => {
    setPreferenceState(t)
    try { localStorage.setItem('mc_theme', t) } catch { /* storage blocked */ }
    updateSettings({ theme: t }).catch(() => { /* offline — localStorage is source of truth */ })
  }, [])

  const setHighContrast = useCallback((v: boolean) => {
    setHighContrastState(v)
    try { localStorage.setItem('mc_high_contrast', v ? '1' : '0') } catch { /* storage blocked */ }
    updateSettings({ high_contrast: v }).catch(() => { /* offline — localStorage is source of truth */ })
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setTheme, highContrast, setHighContrast }}>
      {children}
    </ThemeContext.Provider>
  )
}
```

- [ ] **Step 5: Add the `HighContrastToggle` component below `ThemePicker`**

```typescript
export function HighContrastToggle() {
  const { highContrast, setHighContrast } = useTheme()

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[13px] font-semibold text-main">High Contrast</p>
        <p className="text-[11px] text-muted mt-0.5">
          Meets WCAG AA accessibility standards for text and interface contrast.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={highContrast}
        onClick={() => setHighContrast(!highContrast)}
        className={`
          tap-target-44 relative w-11 h-6 rounded-full transition-colors duration-150 cursor-pointer shrink-0
          ${highContrast ? 'bg-brand' : 'bg-surface-alt border border-subtle'}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-150
            ${highContrast ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  )
}
```
(This uses the `text-main`/`text-muted`/`bg-brand`/`bg-surface-alt`/`border-subtle` utilities defined in Task 3 — written now, wired to real CSS in Task 3.)

- [ ] **Step 6: Write `app/src/lib/theme.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('resolveHighContrast / systemPrefersMoreContrast', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the stored preference when one exists, ignoring OS setting', () => {
    localStorage.setItem('mc_high_contrast', '0')
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-contrast'), // OS says "more contrast"
      addEventListener: () => {}, removeEventListener: () => {},
    }))
    // Re-import or call resolveHighContrast() directly if exported;
    // if not exported, test via a mounted ThemeProvider + useTheme() instead.
    // Assert the resolved value stays false (explicit stored preference wins).
  })

  it('falls back to OS prefers-contrast when nothing is stored', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-contrast'),
      addEventListener: () => {}, removeEventListener: () => {},
    }))
    // Assert the resolved value is true.
  })
})
```
Export `resolveHighContrast` and `systemPrefersMoreContrast` from `theme.tsx` (add to the existing named exports) so this test can call them directly rather than mounting a full provider.

- [ ] **Step 7: Run the test, verify pass**

Run: `cd app && npm test -- theme.test.ts` (adjust to the actual test script in `app/package.json`)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/theme.tsx app/src/lib/theme.test.ts app/src/lib/api.ts
git commit -m "feat: add high-contrast state, prefers-contrast fallback, and toggle to theme engine"
```

---

### Task 3: CSS — Tailwind token mapping + HC override blocks

**Files:**
- Modify: `app/src/index.css`
- Create: `app/src/lib/contrastRatio.ts`
- Create: `app/src/lib/contrastRatio.test.ts`

**Interfaces:**
- Produces: Tailwind utility classes `text-main`, `text-muted`, `bg-page`, `bg-surface`, `bg-surface-alt`, `border-subtle`, `text-brand`, `bg-brand`, `text-accent`, `text-success`, `text-danger`, `text-warning` — all resolving through the existing runtime-swappable `--color-*`/`--brand-*` custom properties, so `[data-theme]`/`[data-contrast]` overrides reach every component that uses them.

- [ ] **Step 1: Write `app/src/lib/contrastRatio.ts` — the pure math + the HC token table**

```typescript
/**
 * WCAG 2.1 relative-luminance / contrast-ratio math (spec formula), plus the
 * concrete hex values used by High Contrast mode. Used by contrastRatio.test.ts
 * to assert every HC pair clears its WCAG AA threshold before it ships.
 */

function srgbChannelToLinear(c8bit: number): number {
  const c = c8bit / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '')
  const r = parseInt(n.substring(0, 2), 16)
  const g = parseInt(n.substring(2, 4), 16)
  const b = parseInt(n.substring(4, 6), 16)
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  const lighter = Math.max(lA, lB)
  const darker  = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}

// ── High Contrast token table ──────────────────────────────────────────────
// Every "text" pair must clear 4.5:1 (WCAG 1.4.3 AA).
// Every "non-text" pair (borders, focus rings, icons) must clear 3:1 (WCAG 1.4.11).
export const HC_LIGHT = {
  bg:          '#FFFFFF',
  surface:     '#FFFFFF',
  surfaceAlt:  '#F2F2F2',
  border:      '#707070',   // non-text, vs bg
  text:        '#0A0A0A',   // text, vs bg
  textMuted:   '#595959',   // text, vs bg
  brand:       '#006A70',   // text/icon, vs bg — darkened from #00959C for AA
  accent:      '#8A6400',   // text/icon, vs bg — darkened from #E6B222 for AA
  success:     '#0F7A38',   // text, vs bg — darkened from #16A34A for AA
  danger:      '#DC2626',   // text, vs bg — verified ≥4.5:1 as-is
  warning:     '#8A5A00',   // text, vs bg — darkened from #F59E0B for AA
} as const

export const HC_DARK = {
  bg:          '#050505',
  surface:     '#101010',
  surfaceAlt:  '#1A1A1A',
  border:      '#8C8C8C',   // non-text, vs bg
  text:        '#FAFAFA',   // text, vs bg
  textMuted:   '#A8A8A8',   // text, vs bg
  brand:       '#00959C',   // text/icon, vs bg — original brand teal already clears AA on near-black
  accent:      '#E6B222',   // text/icon, vs bg — original gold already clears AA on near-black
  success:     '#22C55E',
  danger:      '#F87171',
  warning:     '#FBBF24',
} as const
```

- [ ] **Step 2: Write `app/src/lib/contrastRatio.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { contrastRatio, HC_LIGHT, HC_DARK } from './contrastRatio'

const TEXT_MIN = 4.5
const NON_TEXT_MIN = 3.0

describe('High Contrast token table — WCAG 2.1 AA', () => {
  it('light mode: every text token clears 4.5:1 against its background', () => {
    for (const key of ['text', 'textMuted', 'brand', 'accent', 'success', 'danger', 'warning'] as const) {
      expect(contrastRatio(HC_LIGHT[key], HC_LIGHT.bg)).toBeGreaterThanOrEqual(TEXT_MIN)
    }
  })

  it('light mode: border clears 3:1 against its background', () => {
    expect(contrastRatio(HC_LIGHT.border, HC_LIGHT.bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })

  it('dark mode: every text token clears 4.5:1 against its background', () => {
    for (const key of ['text', 'textMuted', 'brand', 'accent', 'success', 'danger', 'warning'] as const) {
      expect(contrastRatio(HC_DARK[key], HC_DARK.bg)).toBeGreaterThanOrEqual(TEXT_MIN)
    }
  })

  it('dark mode: border clears 3:1 against its background', () => {
    expect(contrastRatio(HC_DARK.border, HC_DARK.bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN)
  })
})
```

- [ ] **Step 3: Run the test to verify it currently passes against the computed table (sanity check of the math itself)**

Run: `cd app && npm test -- contrastRatio.test.ts`
Expected: PASS (all 4 assertions). If any fail, the hex value in `HC_LIGHT`/`HC_DARK` is wrong — recompute, don't loosen the threshold.

- [ ] **Step 4: Add the Tailwind `@theme inline` mapping to `app/src/index.css`**

Insert immediately after the existing `[data-theme="dark"] { ... }` block (after line 107, before the `}` closing the outer `@layer base {`):

```css
  /* ── Tailwind utility mapping (Tailwind v4 @theme inline) ─────────────
     Maps the runtime-swappable --color-*/--brand-* custom properties above
     into real utility class names, so components use `text-main` instead
     of `text-[var(--color-text)]` or a hardcoded hex. Because these are
     `inline` theme values, Tailwind keeps them as `var(...)` references in
     the generated CSS rather than baking in a static value — so light/dark/
     high-contrast overrides via [data-theme]/[data-contrast] still apply. */
  @theme inline {
    --color-page:        var(--color-bg);
    --color-surface:     var(--color-surface);
    --color-surface-alt: var(--color-surface-alt);
    --color-subtle:      var(--color-border);
    --color-main:        var(--color-text);
    --color-muted:       var(--color-text-muted);
    --color-on-brand:    var(--color-text-on-brand);
    --color-brand:       var(--brand-primary);
    --color-accent:      var(--brand-accent);
  }
```

- [ ] **Step 5: Add the High Contrast override blocks**

Insert directly after the `@theme inline` block from Step 4:

```css
  /* ── High Contrast overrides (WCAG 2.1 AA) ─────────────────────────────
     Values computed in app/src/lib/contrastRatio.ts / verified by
     contrastRatio.test.ts. Light-mode brand colors are darkened to clear
     4.5:1 on white; dark-mode brand colors already clear AA on near-black
     so they're kept close to the default palette. */
  [data-contrast="high"] {
    --color-bg:            #FFFFFF;
    --color-surface:       #FFFFFF;
    --color-surface-alt:   #F2F2F2;
    --color-border:        #707070;
    --color-text:          #0A0A0A;
    --color-text-muted:    #595959;
    --brand-primary:       #006A70;
    --brand-accent:        #8A6400;
  }

  [data-theme="dark"][data-contrast="high"] {
    --color-bg:            #050505;
    --color-surface:       #101010;
    --color-surface-alt:   #1A1A1A;
    --color-border:        #8C8C8C;
    --color-text:          #FAFAFA;
    --color-text-muted:    #A8A8A8;
    --brand-primary:       #00959C;
    --brand-accent:        #E6B222;
  }

  /* Non-brand semantic accents (success/danger/warning) used directly as
     hex in several components today — Tasks 5/6 migrate those call sites
     to reference these two custom properties instead. */
  :root {
    --color-success: #16a34a;
    --color-danger:  #dc2626;
    --color-warning: #f59e0b;
  }
  [data-theme="dark"] {
    --color-success: #22c55e;
    --color-danger:  #f87171;
    --color-warning: #fbbf24;
  }
  [data-contrast="high"] {
    --color-success: #0F7A38;
    --color-danger:  #DC2626;
    --color-warning: #8A5A00;
  }
  [data-theme="dark"][data-contrast="high"] {
    --color-success: #22C55E;
    --color-danger:  #F87171;
    --color-warning: #FBBF24;
  }
```

Extend the `@theme inline` block from Step 4 with three more lines so these become real utilities too:
```css
    --color-success: var(--color-success);
    --color-danger:  var(--color-danger);
    --color-warning: var(--color-warning);
```

- [ ] **Step 6: Verify the app builds with the new CSS**

Run: `cd app && npm run build`
Expected: build succeeds, no Tailwind/PostCSS errors about `@theme inline` or unknown utilities.

- [ ] **Step 7: Manual smoke check**

Run the dev server (`npm run dev` from repo root per `CLAUDE.md`), open the app, open DevTools, manually set `document.documentElement.setAttribute('data-contrast', 'high')` in the console. Confirm background/text/border colors visibly shift on a screen that already uses CSS variables (e.g. any screen using `var(--color-text)` today) even before the component migration in Tasks 5-6.

- [ ] **Step 8: Commit**

```bash
git add app/src/index.css app/src/lib/contrastRatio.ts app/src/lib/contrastRatio.test.ts
git commit -m "feat: add high-contrast CSS tokens and Tailwind utility mapping"
```

---

### Task 4: Migrate `ThemePicker` (in `theme.tsx`) and `Toast` (in `settings/shared.tsx`) to token utilities

**Files:**
- Modify: `app/src/lib/theme.tsx:144-171`
- Modify: `app/src/components/settings/shared.tsx:60` (and any other hardcoded hex in that file)

**Interfaces:**
- Consumes: `text-main`, `text-muted`, `bg-surface`, `bg-surface-alt`, `border-subtle` utilities from Task 3.

- [ ] **Step 1: Migrate `ThemePicker` in `theme.tsx`**

Replace:
```typescript
      <p className="text-[13px] font-bold text-[#6b6a66] uppercase tracking-wide mb-2">Display</p>
      <div className="flex rounded-xl overflow-hidden border border-[#D3D1C7] bg-[#f3f2ee] dark:bg-[#1e2e2f] dark:border-[#3a5254]">
```
with:
```typescript
      <p className="text-[13px] font-bold text-muted uppercase tracking-wide mb-2">Display</p>
      <div className="flex rounded-xl overflow-hidden border border-subtle bg-surface-alt">
```
Replace:
```typescript
                ${active
                  ? 'bg-white dark:bg-[#243637] text-[#1C1C1A] dark:text-[#f9f7f2] shadow-sm'
                  : 'text-[#6b6a66] dark:text-[#9bb5b7] hover:text-[#1C1C1A] dark:hover:text-[#f9f7f2]'}
```
with:
```typescript
                ${active
                  ? 'bg-surface text-main shadow-sm'
                  : 'text-muted hover:text-main'}
```
Replace:
```typescript
      <p className="text-[11px] text-[#6b6a66] dark:text-[#9bb5b7] mt-1.5">
```
with:
```typescript
      <p className="text-[11px] text-muted mt-1.5">
```

- [ ] **Step 2: Migrate `Toast` in `app/src/components/settings/shared.tsx:60`**

Replace:
```typescript
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[#1a2e2e] text-white text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
```
with:
```typescript
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-surface text-main text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
```
(This toast currently hardcodes a near-black background regardless of theme — `bg-surface`/`text-main` is the correct token equivalent and also fixes it not respecting light mode, which was a pre-existing bug this migration incidentally corrects.)

- [ ] **Step 3: Visual check**

Run the dev server. Open Settings → Appearance & Display. Toggle Light/Dark and confirm `ThemePicker` still renders correctly (no visual regression) in both. Trigger a toast anywhere in the app (e.g. save a setting) and confirm it still renders correctly in both light and dark.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/theme.tsx app/src/components/settings/shared.tsx
git commit -m "refactor: migrate ThemePicker and Toast to token utility classes"
```

---

### Task 5: Migrate registration screens to token utilities

**Files:**
- Modify: `app/src/screens/LandingScreen.tsx`
- Modify: `app/src/screens/JoinFamilyScreen.tsx`
- Modify: `app/src/components/registration/Stage2FamilyConstitution.tsx`
- Modify: `app/src/components/registration/Stage3SecureApp.tsx`
- Modify: `app/src/components/registration/RegistrationShell.tsx`
- Modify: `app/src/components/registration/Stage4CoParentBridge.tsx`

**Interfaces:**
- Consumes: `text-main`, `text-muted`, `border-subtle` utilities from Task 3.

**Substitution table** (apply exactly, across all 6 files — every occurrence of the left-hand class fragment becomes the right-hand one; `dark:` variants of the same token are simply dropped since the token now handles theme-switching internally):

| Old | New |
|---|---|
| `text-[#1C1C1A]` | `text-main` |
| `text-[#6b6a66]` | `text-muted` |
| `text-[#9b9a96]` | `text-muted` |
| `border-[#D3D1C7]` | `border-subtle` |

- [ ] **Step 1: Migrate `LandingScreen.tsx`**

Line 65: `className="w-[52px] h-[52px] rounded-full object-cover shrink-0 border border-[#D3D1C7]"` → `className="w-[52px] h-[52px] rounded-full object-cover shrink-0 border border-subtle"`
Line 99: `<h1 className="text-2xl font-extrabold text-[#1C1C1A] tracking-tight mb-1.5">Welcome back</h1>` → `<h1 className="text-2xl font-extrabold text-main tracking-tight mb-1.5">Welcome back</h1>`
Line 100: `<p className="text-[14px] text-[#6b6a66]">Who's signing in today?</p>` → `<p className="text-[14px] text-muted">Who's signing in today?</p>`
Line 124: `<div className="text-[13px] text-[#6b6a66] mt-0.5 leading-snug">{tile.description}</div>` → `<div className="text-[13px] text-muted mt-0.5 leading-snug">{tile.description}</div>`
Line 126: `<svg className="text-[#6b6a66] shrink-0" ...>` → `<svg className="text-muted shrink-0" ...>`
Line 135: `<p className="text-[13px] text-[#6b6a66]">` → `<p className="text-[13px] text-muted">`

- [ ] **Step 2: Migrate `JoinFamilyScreen.tsx`**

Apply the substitution table to every line the earlier grep found in this file: 347, 350, 378, 389, 407, 419, 422, 441-442, 458-459, 472-473, 501, 516, 526, 527, 541, 544, 566, 571, 587, 588, 601, 611, 613, 621, 632, 634, 646, 652, 677. Each is a mechanical application of the table above — e.g. line 613's `d ? 'border-teal-500' : 'border-[#D3D1C7]'` becomes `d ? 'border-teal-500' : 'border-subtle'`; line 677's `active ? 'text-[#1C1C1A]' : 'text-[#9b9a96]'` becomes `active ? 'text-main' : 'text-muted'`.

- [ ] **Step 3: Migrate `Stage2FamilyConstitution.tsx`**

Apply the table to lines 98, 105, 129, 152, 154, 157, 168, 173, 184, 185, 191, 194, 199, 202, 207, 248, 293, 312, 317, 318, 344, 356, 358. Note line 356 combines both: `<span className="text-[11px] text-[#9b9a96] border border-[#D3D1C7] rounded-full px-2 py-0.5">{subtitle}</span>` → `<span className="text-[11px] text-muted border border-subtle rounded-full px-2 py-0.5">{subtitle}</span>`.

- [ ] **Step 4: Migrate `Stage3SecureApp.tsx`**

Apply the table to lines 134, 146, 147, 163, 166, 193, 200, 204, 222, 225, 240, 250, 252, 261, 272, 274 (except the `error ? ... :` red-error-state branch — leave `bg-red-50 text-red-700` untouched, only the fallback `border-[#D3D1C7]` in that ternary changes), 286, 293, 314.

- [ ] **Step 5: Migrate `RegistrationShell.tsx`**

Line 241: `<p className="text-sm font-medium text-[#6b6a66]">Setting things up…</p>` → `<p className="text-sm font-medium text-muted">Setting things up…</p>`

- [ ] **Step 6: `Stage4CoParentBridge.tsx` — leave as-is**

Lines 246/252 (`bg-[#25D366]` WhatsApp green, `bg-[#0099FF]` Messenger blue) are third-party brand colors for share buttons, not part of the app's own palette — out of scope for this migration per the spec's "exclude intentionally decorative/brand-external literals" rule. Do not change.

- [ ] **Step 7: Run the app, walk through registration end-to-end**

Run the dev server, go through Stage 1 → 4 of registration (or `JoinFamilyScreen` for the invite path) in both light and dark, confirm no visual regression (text/borders still visible, correct color).

- [ ] **Step 8: Commit**

```bash
git add app/src/screens/LandingScreen.tsx app/src/screens/JoinFamilyScreen.tsx app/src/components/registration/Stage2FamilyConstitution.tsx app/src/components/registration/Stage3SecureApp.tsx app/src/components/registration/RegistrationShell.tsx
git commit -m "refactor: migrate registration screens to token utility classes"
```

---

### Task 6: Migrate dashboard + misc components to token utilities

**Files:**
- Modify: `app/src/components/dashboard/InsightsTab.tsx`
- Modify: `app/src/components/dashboard/JarCard.tsx`
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx`
- Modify: `app/src/components/dashboard/SparklineCard.tsx`
- Modify: `app/src/components/dashboard/SparklineExpanded.tsx`
- Modify: `app/src/components/celebration/MicroToast.tsx`
- Modify: `app/src/components/review/ReviewPromptSheet.tsx`
- Modify: `app/src/components/ui/Logo.tsx`

**Interfaces:**
- Consumes: `text-success`, `text-danger`, `text-warning`, `bg-surface`, `text-main`, `text-brand`, `bg-brand` utilities from Task 3.

- [ ] **Step 1: `InsightsTab.tsx`**

Line 298: `valueColor="text-[#10b981]"` → `valueColor="text-success"` (this is the same semantic "success green" family as the `#16a34a` token — using the shared `text-success` utility instead of a third one-off green keeps the palette consistent).
Line 846: `<span className="text-[10px] font-bold text-[#16a34a]">↑ {choreDelta}</span>` → `<span className="text-[10px] font-bold text-success">↑ {choreDelta}</span>`

- [ ] **Step 2: `JarCard.tsx`**

Line 41: `className="flex-1 flex flex-col items-center gap-2 px-3 py-4 bg-[#1a2e25] border border-white/10 rounded-xl cursor-pointer transition-colors hover:bg-[#1f3a2e] active:bg-[#172a21] min-w-0"` — this is a fixed dark-green card treatment used regardless of theme (decorative "jar" styling, not a text/background pair users read text against in a way that needs to shift with light/dark or HC — it already has its own fixed dark aesthetic by design). Leave as-is; flag for design review separately if HC users report it's illegible, but do not guess a replacement here.

- [ ] **Step 3: `ParentSettingsTab.tsx`**

Line 138: identical pattern to `Toast` in Task 4 Step 2 — replace:
```typescript
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[#1a2e2e] text-white text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
```
with:
```typescript
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-surface text-main text-[13px] font-semibold shadow-xl max-w-xs text-center animate-fade-in-up">
```

- [ ] **Step 4: `SparklineCard.tsx`**

Line 85: `pill = <span className="inline-flex items-center gap-0.5 text-[8px] font-bold rounded px-1 py-0.5 bg-[rgba(22,163,74,0.12)] text-[#16a34a]">↑ {Math.abs(delta)}%</span>` → `pill = <span className="inline-flex items-center gap-0.5 text-[8px] font-bold rounded px-1 py-0.5 bg-success/10 text-success">↑ {Math.abs(delta)}%</span>` (the `rgba(22,163,74,0.12)` background is a low-opacity tint of the same success green — `bg-success/10` reproduces that via Tailwind's opacity modifier now that `success` is a real token).
Line 87: `pill = <span className="inline-flex items-center gap-0.5 text-[8px] font-bold rounded px-1 py-0.5 bg-[rgba(220,38,38,0.1)] text-[#dc2626]">↓ {Math.abs(delta)}%</span>` → `pill = <span className="inline-flex items-center gap-0.5 text-[8px] font-bold rounded px-1 py-0.5 bg-danger/10 text-danger">↓ {Math.abs(delta)}%</span>`

- [ ] **Step 5: `SparklineExpanded.tsx`**

Line 302: `<div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] opacity-50"/>` → `<div className="w-2.5 h-2.5 rounded-full bg-warning opacity-50"/>`

- [ ] **Step 6: `MicroToast.tsx`**

Line 51: `'bg-[#1b2d2e] border border-white/10 shadow-xl',` — this matches `--brand-deep`, the fixed dark celebration-toast treatment (intentionally dark regardless of theme, similar to `JarCard`). Leave as-is unless it is also used as a light-mode-visible surface elsewhere in the same file — check the surrounding component before deciding; if it's genuinely theme-invariant by design (a celebratory dark toast), no change needed.

- [ ] **Step 7: `ReviewPromptSheet.tsx`**

Lines 81, 120, 137: `bg-[var(--brand-primary,#4ade80)] py-3 font-semibold text-[#0f1a14]` → `bg-brand py-3 font-semibold text-on-brand` (this already references the brand CSS variable via a fallback; switching to the `bg-brand` utility from Task 3 is a direct equivalent and picks up the darkened HC-mode teal automatically instead of needing its own override).

- [ ] **Step 8: `Logo.tsx`**

Line 129: `className="font-semibold tracking-tight text-[#1b2d2e] dark:text-[#f9f7f2]"` → `className="font-semibold tracking-tight text-main"` (this is the wordmark text color, which already matches the `--color-text`/`--brand-deep` pairing exactly — safe to migrate, not the LEMON MILK decorative font styling itself, just this text-color class).

- [ ] **Step 9: Run the app, spot-check each surface**

Dev server → parent dashboard (Insights tab, jar cards, sparklines), trigger a celebration/micro-toast, open a review prompt sheet, check the logo in the header — in both light and dark. Confirm no regression.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/dashboard/InsightsTab.tsx app/src/components/dashboard/ParentSettingsTab.tsx app/src/components/dashboard/SparklineCard.tsx app/src/components/dashboard/SparklineExpanded.tsx app/src/components/review/ReviewPromptSheet.tsx app/src/components/ui/Logo.tsx
git commit -m "refactor: migrate dashboard and misc components to token utility classes"
```

---

### Task 7: Add the toggle to Appearance Settings

**Files:**
- Modify: `app/src/components/settings/sections/AppearanceSettings.tsx`

**Interfaces:**
- Consumes: `HighContrastToggle` from `app/src/lib/theme.tsx` (Task 2).

- [ ] **Step 1: Import and render the toggle**

Replace:
```typescript
import { useLocale, type AppLocale } from '../../../lib/locale'
import { ThemePicker } from '../../../lib/theme'
```
with:
```typescript
import { useLocale, type AppLocale } from '../../../lib/locale'
import { ThemePicker, HighContrastToggle } from '../../../lib/theme'
```
Replace:
```typescript
      <SectionCard>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <ThemePicker />
        </div>
        <div className="px-4 py-3.5">
```
with:
```typescript
      <SectionCard>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <ThemePicker />
        </div>
        <div className="px-4 py-3.5 border-b border-[var(--color-border)]">
          <HighContrastToggle />
        </div>
        <div className="px-4 py-3.5">
```

- [ ] **Step 2: Manual verification (parent settings)**

Dev server → Settings → Appearance & Display. Confirm the toggle appears below the theme picker, toggling it flips text/border colors app-wide within the settings screen itself, and the choice survives a page reload (localStorage) and a fresh login (API persistence, per Task 1).

- [ ] **Step 3: Confirm the child settings screen reuses the same component**

Check whether the child-facing settings screen imports `AppearanceSettings` directly or has its own copy — search for `AppearanceSettings` usages. If it's shared, no further work is needed (the spec requires both accounts get it, and the shared-component route satisfies that automatically since `user_settings` is per-`user_id`). If the child settings screen has a separate, duplicate appearance section instead of reusing this component, add `<HighContrastToggle />` there too, matching Step 1's pattern.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/settings/sections/AppearanceSettings.tsx
git commit -m "feat: surface the High Contrast toggle in Appearance settings"
```

---

### Task 8: Rendered-DOM accessibility test (axe)

**Files:**
- Create: `app/e2e/high-contrast-a11y.spec.ts`

**Interfaces:**
- Consumes: whatever Playwright test harness/login helpers already exist under `app/e2e/` (e.g. `app/e2e/auth-cookie.spec.ts` referenced in `CLAUDE.md` — read that file first to match its setup/fixtures/base URL pattern exactly, including how it logs in a test parent/child account, before writing this file).

- [ ] **Step 1: Install the axe Playwright integration**

Run: `cd app && npm install -D @axe-core/playwright`

- [ ] **Step 2: Write the spec, following the existing e2e file's setup pattern**

```typescript
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Mirrors whatever login/navigation helpers app/e2e/auth-cookie.spec.ts uses —
// replace the placeholders below with the real helper calls once that file's
// pattern is confirmed (do not invent a different login flow).

const SURFACES: { name: string; path: string }[] = [
  { name: 'parent dashboard', path: '/parent' },
  { name: 'child dashboard',  path: '/child' },
  { name: 'settings',         path: '/parent/settings/appearance' }, // confirm actual route
  { name: 'registration',     path: '/register' },                   // confirm actual route
]

for (const surface of SURFACES) {
  for (const hc of [false, true]) {
    test(`${surface.name} — axe AA scan (high contrast: ${hc})`, async ({ page }) => {
      // TODO once auth-cookie.spec.ts pattern is confirmed: log in as the
      // appropriate role (parent vs child) for this surface before navigating.
      await page.goto(surface.path)
      if (hc) {
        await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
      }
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }
}
```
Fill in the login helper calls and confirm the real route paths (`/parent/settings/appearance`, `/register`, etc. — check `app/src` routing config, e.g. `App.tsx`, for actual paths) before running — the placeholders above are explicitly marked and must be resolved, not left in.

- [ ] **Step 3: Run the new spec**

Run: `cd app && npx playwright test high-contrast-a11y.spec.ts`
Expected: all 8 tests (4 surfaces × 2 contrast states) PASS with zero axe violations. If a violation appears outside the scope of Tasks 4-6's migration (e.g. a missing `aria-label` unrelated to color), note it but do not silently expand scope — file it as a follow-up rather than fixing unrelated a11y issues inside this plan.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/high-contrast-a11y.spec.ts app/package.json app/package-lock.json
git commit -m "test: add axe accessibility sweep for high-contrast mode"
```

---

## Self-Review Notes

- **Spec coverage:** DB/API (Task 1) ✓, theme engine + prefers-contrast fallback (Task 2) ✓, tuned-brand HC palette + non-text contrast + Tailwind token mapping (Task 3) ✓, component migration (Tasks 4-6, all 16 files from the grep audit accounted for — including the 3 files where hardcoded hex is deliberately left alone, with reasoning given) ✓, UI surface for both parent/child (Task 7) ✓, static token-math test + rendered axe test (Tasks 3 & 8) ✓.
- **Explicitly out of scope, per the spec:** default palette changes, broader a11y tooling (`eslint-plugin-jsx-a11y`, full-site CI), reduced-motion/skip-links/aria-live gaps.
- **Known follow-up needed before Task 8 can run as-written:** the exact Playwright login helper and route paths must be confirmed against `app/e2e/auth-cookie.spec.ts` and the app's router — flagged inline in Task 8, not guessed.
