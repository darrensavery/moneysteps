/**
 * Automated WCAG AA accessibility sweep for the High Contrast mode plan.
 *
 * Covers 4 core surfaces (parent dashboard, child dashboard, appearance
 * settings, registration entry) x 2 contrast states (off / on) = 8 cases,
 * asserting zero axe violations tagged wcag2a/wcag2aa.
 *
 * Login pattern: mirrors app/e2e/auth-cookie.spec.ts's `demoLogin` helper —
 * POST /auth/demo/register is the only public, cookie-issuing login route
 * available in this environment (no seeded magic-link account, no email
 * delivery). That route always issues a JWT with `role: 'parent'` and sets
 * the `mc_session` cookie to `'parent'` (see worker/src/routes/demo.ts).
 *
 * RequireSession (app/src/App.tsx) additionally requires a `mc_device_identity`
 * localStorage entry before it will render either dashboard — auth-cookie.spec.ts
 * never needed this because it only drove fetch() calls, never rendered a
 * guarded route. This spec adds that localStorage write (matching the shape
 * DeviceIdentity already defines in app/src/lib/deviceIdentity.ts) so the
 * dashboards actually mount.
 *
 * KNOWN LIMITATION (child dashboard): there is no demo/child-login route.
 * The child dashboard test below sets a `role: 'child'` device identity
 * pointing at the seeded demo child ('demo-child-ellie' in the
 * 'demo-family-thomson' demo family, worker/migrations/0049_demo_seed.sql)
 * but reuses the same demo JWT, which is hardcoded to `role: 'parent'`
 * (worker/src/routes/demo.ts `issueDemoToken`). Backend routes that call
 * `requireRole(auth, 'child')` will 403 for this session, so ChildDashboard's
 * data-fetching calls are expected to fail and render their ErrorBox/empty
 * states rather than full seeded content. The page shell (nav, headers,
 * static chrome) still mounts and is still a valid target for a contrast
 * sweep of the app's own color tokens, but this is not a full-fidelity
 * child-data render. A real child demo-login endpoint would be needed to
 * close this gap — flagged as a follow-up, not built here (out of scope for
 * an axe-sweep task).
 */
import { test, expect } from 'playwright/test'
import AxeBuilder from '@axe-core/playwright'

const DEMO_FAMILY_ID = 'demo-family-thomson'
const DEMO_LEAD_ID   = 'demo-user-sarah'
const DEMO_CHILD_ID  = 'demo-child-ellie'

async function demoLogin(page: import('playwright/test').Page, emailSuffix: string) {
  const status = await page.evaluate(async (email) => {
    const res = await fetch('/auth/demo/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Playwright A11y', email, marketing_consent: false }),
    })
    return res.status
  }, `playwright-a11y-${emailSuffix}-${Date.now()}@example.com`)
  expect(status).toBe(200)
}

/**
 * Writes mc_device_identity to localStorage so RequireSession lets the
 * guarded /parent or /child route render. Shape matches DeviceIdentity in
 * app/src/lib/deviceIdentity.ts.
 */
async function setDeviceIdentity(page: import('playwright/test').Page, role: 'parent' | 'child') {
  await page.evaluate(
    ({ role, userId }) => {
      localStorage.setItem(
        'mc_device_identity',
        JSON.stringify({
          user_id:        userId,
          family_id:      'demo-family-thomson',
          display_name:   role === 'parent' ? 'Sarah' : 'Ellie',
          role,
          ...(role === 'parent' ? { parenting_role: 'LEAD_PARENT' } : {}),
          initials:       role === 'parent' ? 'SA' : 'EL',
          registered_at:  new Date().toISOString(),
          auth_method:    'none',
        }),
      )
    },
    { role, userId: role === 'parent' ? DEMO_LEAD_ID : DEMO_CHILD_ID },
  )
}

async function loginAsParent(page: import('playwright/test').Page, emailSuffix: string) {
  await page.goto('/')
  await demoLogin(page, emailSuffix)
  await setDeviceIdentity(page, 'parent')
}

async function loginAsChild(page: import('playwright/test').Page, emailSuffix: string) {
  await page.goto('/')
  await demoLogin(page, emailSuffix) // only public login route available; see file header re: role mismatch
  await setDeviceIdentity(page, 'child')
}

async function runAxeScan(page: import('playwright/test').Page) {
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
}

type Surface = {
  name: string
  path: string
  login: (page: import('playwright/test').Page, emailSuffix: string) => Promise<void>
}

const SURFACES: Surface[] = [
  { name: 'parent dashboard', path: '/parent', login: loginAsParent },
  { name: 'child dashboard',  path: '/child',  login: loginAsChild },
  // Appearance & Display has no standalone route — it's a section inside the
  // Settings drawer opened from within /parent (ParentDashboard.tsx renders
  // ParentSettingsTab in a slide-over panel; there is no /parent/settings/*
  // URL). Navigate there via the real UI instead of guessing a path.
  { name: 'settings (appearance)', path: '/parent', login: loginAsParent },
  // /register is public — no login required (confirmed in app/src/App.tsx).
  { name: 'registration', path: '/register', login: async () => {} },
]

for (const surface of SURFACES) {
  for (const hc of [false, true]) {
    test(`${surface.name} — axe AA scan (high contrast: ${hc})`, async ({ page }) => {
      const emailSuffix = `${surface.name.replace(/\s+/g, '-')}-${hc}`
      await surface.login(page, emailSuffix)
      await page.goto(surface.path)

      if (surface.name === 'settings (appearance)') {
        // Open the settings drawer, then navigate to the Appearance & Display
        // section — this mirrors the real in-app navigation; there is no
        // deep-link route for it.
        await page.getByRole('button', { name: /settings/i }).first().click()
        await page.getByRole('button', { name: /appearance/i }).click()
      }

      if (hc) {
        await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
      }

      const results = await runAxeScan(page)
      expect(results.violations).toEqual([])
    })
  }
}
