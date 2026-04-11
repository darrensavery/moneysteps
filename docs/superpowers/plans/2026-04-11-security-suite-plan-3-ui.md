# Security Suite — Plan 3: UI Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two `onComingSoon` stubs in `SecuritySettings.tsx` with fully functional PIN Management and Active Sessions sub-screens, wire the `useGatekeeper` hook into the chore-approval flow, and handle the `?settings=security&view=pin` deep-link from the Gatekeeper "Forgot PIN" link.

**Architecture:** `SecuritySettings` becomes a thin router that owns a `view` state (`'menu' | 'pin' | 'sessions'`). Two new sibling files — `PinManagementSettings.tsx` and `ActiveSessionsSettings.tsx` — each handle their own sub-screen state independently. `ParentSettingsTab` passes `profile` (already loaded) to `SecuritySettings` so PIN/session screens know `has_password` and `has_pin`. The chore-approval action in `PendingTab` wraps its existing confirm handler with `challenge()` from `useGatekeeper`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (CSS vars design tokens), React Router v6 (`useSearchParams`), Lucide icons, `app/src/lib/api.ts` functions (`setParentPin`, `resetPinWithPassword`, `verifyPin`, `getSessions`, `revokeSession`, `revokeOtherSessions`), `app/src/hooks/useGatekeeper.tsx`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/src/components/settings/sections/SecuritySettings.tsx` | **Modify** | Thin router: `view` state, deep-link handling, passes `profile` down |
| `app/src/components/settings/sections/PinManagementSettings.tsx` | **Create** | PIN set / change / forgot flow (3 internal states) |
| `app/src/components/settings/sections/ActiveSessionsSettings.tsx` | **Create** | Session list, UA parsing, individual + bulk revoke |
| `app/src/components/dashboard/ParentSettingsTab.tsx` | **Modify** | Pass `profile` prop to `SecuritySettings` |
| `app/src/components/dashboard/PendingTab.tsx` | **Modify** | Wrap chore-approval with `useGatekeeper` challenge |

---

## Context for agentic workers

This is Plan 3 of 3 in the Security Suite feature. Plans 1 and 2 are already deployed:

- **Plan 1 (done):** Worker routes and D1 migration. The following API functions already exist in `app/src/lib/api.ts`:
  - `setParentPin(password, newPin)` → `POST /auth/pin/set`
  - `resetPinWithPassword(password, newPin)` → `POST /auth/pin/reset-with-password`
  - `verifyPin(pin)` → `POST /auth/verify-pin` (returns `{ ok: true }` or throws with the server error message)
  - `getSessions()` → `GET /auth/sessions` → `{ sessions: SessionRow[] }`
  - `revokeSession(jti)` → `DELETE /auth/sessions/:jti`
  - `revokeOtherSessions()` → `DELETE /auth/sessions?others=true`
  - `MeResult` already has `has_password: boolean` and `has_pin: boolean`
  - `SessionRow` interface: `{ jti: string; issued_at: number; user_agent: string | null }`

- **Plan 2 (done):** `useGatekeeper` hook at `app/src/hooks/useGatekeeper.tsx`. Returns `{ challenge, GatekeeperModal }`. The `GatekeeperModal` is a component (stable reference via `useCallback`) that must be rendered inline in JSX. Its "Forgot PIN?" link already navigates to `/parent?settings=security&view=pin`.

### Design tokens used in the codebase
```
--color-surface         (card backgrounds)
--color-surface-alt     (hover state, input bg)
--color-border          (borders)
--color-text            (primary text)
--color-text-muted      (secondary text)
--brand-primary         (teal accent, buttons)
```

### Shared atoms (`app/src/components/settings/shared.tsx`)
Already exports: `useToast`, `Toast`, `SettingsRow`, `SectionCard`, `SectionHeader`, `ReadOnlyBadge`. Import from `'../shared'` (one level up from sections/).

### JWT jti for "current device" detection
The JWT is stored in `localStorage` under key `mc_token`. Parse it client-side with `atob`:
```ts
function getCurrentJti(): string | null {
  try {
    const token = localStorage.getItem('mc_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.jti ?? null
  } catch {
    return null
  }
}
```

### Shake animation
Add a `@keyframes shake` to the Tailwind config or inline via `style`. The gatekeeper already uses it, so add to `app/src/index.css` if not already there. Use class `animate-[shake_0.5s_ease-in-out]` (Tailwind arbitrary animation). The keyframes:
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-6px); }
  40%       { transform: translateX(6px); }
  60%       { transform: translateX(-4px); }
  80%       { transform: translateX(4px); }
}
```
Check `app/src/index.css` first — if `@keyframes shake` already exists, skip adding it.

---

## Task 1: SecuritySettings router + deep-link handling

**Files:**
- Modify: `app/src/components/settings/sections/SecuritySettings.tsx`
- Modify: `app/src/components/dashboard/ParentSettingsTab.tsx`

**What this task does:** Refactor `SecuritySettings` from a dumb display component into a thin router with `view` state (`'menu' | 'pin' | 'sessions'`). Accept `profile: MeResult | null` as a prop so sub-screens can read `has_password` and `has_pin`. Handle the `?settings=security&view=pin` deep-link that the Gatekeeper's "Forgot PIN" link navigates to. Update `ParentSettingsTab` to pass the already-loaded `profile` to `SecuritySettings`.

- [ ] **Step 1: Read current SecuritySettings.tsx**

Read `app/src/components/settings/sections/SecuritySettings.tsx` to understand current props/imports.

- [ ] **Step 2: Read ParentSettingsTab.tsx line 348-356 (section view dispatch)**

Read `app/src/components/dashboard/ParentSettingsTab.tsx` lines 344–360 to see how the `security` section is currently rendered. Note that `profile` is already available in that component as `const [profile, setProfile] = useState<MeResult | null>(null)`.

- [ ] **Step 3: Rewrite SecuritySettings.tsx**

Replace the entire file content:

```tsx
/**
 * SecuritySettings — Security & Access router.
 * Owns sub-screen view state and handles deep-link ?view=pin or ?view=sessions.
 */

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Lock, Eye } from 'lucide-react'
import type { MeResult } from '../../../lib/api'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { PinManagementSettings }   from './PinManagementSettings'
import { ActiveSessionsSettings }  from './ActiveSessionsSettings'

type SecurityView = 'menu' | 'pin' | 'sessions'

interface Props {
  profile:      MeResult | null
  toast:        string | null
  onBack:       () => void
  onComingSoon: () => void
}

export function SecuritySettings({ profile, toast, onBack, onComingSoon }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<SecurityView>('menu')

  // Handle deep-link: /parent?settings=security&view=pin
  useEffect(() => {
    const v = searchParams.get('view')
    if (v === 'pin' || v === 'sessions') {
      setView(v)
      // Clean the query params so navigating back works cleanly
      setSearchParams({}, { replace: true })
    }
  }, [])

  if (view === 'pin') {
    return (
      <PinManagementSettings
        profile={profile}
        onBack={() => setView('menu')}
      />
    )
  }

  if (view === 'sessions') {
    return (
      <ActiveSessionsSettings
        onBack={() => setView('menu')}
      />
    )
  }

  // Menu
  const hasPinSetup = profile?.has_pin ?? false
  const hasPassword = profile?.has_password ?? false

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      <SectionHeader title="Security & Access" onBack={onBack} />
      <SectionCard>
        <SettingsRow
          icon={<Lock size={15} />}
          label={hasPassword ? 'PIN Management' : 'Set a Password First'}
          description={
            hasPassword
              ? hasPinSetup
                ? 'Change or reset your parent PIN'
                : 'Set up a 4-digit parent PIN'
              : 'A password is required before setting a PIN'
          }
          onClick={hasPassword ? () => setView('pin') : onComingSoon}
        />
        <SettingsRow
          icon={<Eye size={15} />}
          label="Active Sessions"
          description="View and log out of all devices accessing the Family Orchard"
          onClick={() => setView('sessions')}
        />
      </SectionCard>
    </div>
  )
}
```

- [ ] **Step 4: Update ParentSettingsTab.tsx — pass profile to SecuritySettings**

Find the line in `ParentSettingsTab.tsx` that renders `SecuritySettings` (around line 351):
```tsx
if (view.section === 'security')   return <SecuritySettings   toast={toast} onBack={back} onComingSoon={comingSoon} />
```

Replace with:
```tsx
if (view.section === 'security')   return <SecuritySettings   profile={profile} toast={toast} onBack={back} onComingSoon={comingSoon} />
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors related to `SecuritySettings` props or missing imports. (PinManagementSettings and ActiveSessionsSettings do not exist yet — TypeScript will error on those imports. That is expected and will be fixed in Tasks 2 and 3. If the only errors mention those two files, proceed.)

- [ ] **Step 6: Commit**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git add app/src/components/settings/sections/SecuritySettings.tsx app/src/components/dashboard/ParentSettingsTab.tsx
git commit -m "feat(settings): SecuritySettings router with view state and deep-link handling"
```

---

## Task 2: PinManagementSettings component

**Files:**
- Create: `app/src/components/settings/sections/PinManagementSettings.tsx`

**What this task does:** Build the 3-state PIN management flow: (1) `verify-current` — user enters their email **password** as the master key (not the current PIN); (2) `set-new` — enter a new 4-digit PIN then confirm it; (3) `forgot` — enter email password to reset the PIN. On success, show "PIN updated" toast and navigate back to the Security menu. If biometrics are available but not registered, nudge after save.

**States:**
- `verify-current`: shown when `profile.has_pin === true`. Password field (type=password). Wrong password → shake + "Incorrect password". Correct → store password in component state, move to `set-new`.
- `set-new`: two 4-dot rows ("New PIN" and "Confirm PIN"). Both rows use the same digit pad — first row fills first, then second row. Confirm must match new PIN; if not: "PINs don't match", both rows clear. On match: calls `setParentPin(password, newPin)`.
- `forgot`: single password field (type=password). On submit → calls `resetPinWithPassword(password, newPin)` where `newPin` is collected in a subsequent `set-new` step. Flow: `forgot` (enter password) → `set-new` (enter+confirm new PIN).

**Note on `verify-current` vs `forgot`:**
- If `profile.has_pin === false`: skip `verify-current`, go straight to `set-new` (first-time setup). No password is needed for first-time setup — `setParentPin` is only called after `set-new`, and the password field in `verify-current` is what produces the `password` arg. For first-time setup with no current PIN, we still need the password — show the password field as `verify-current` to collect it, with copy "Enter your account password to enable PIN" instead of "Enter your current password".
- If `profile.has_pin === true`: show `verify-current` with copy "Enter your account password to change your PIN".
- "Forgot PIN?" link appears in `verify-current` only (when `has_pin` is true), transitions to `forgot`.

**4-dot PIN input pattern:** Two separate digit states (`newDigits` and `confirmDigits`, each `string[]` of length 4). A single shared digit pad. While `newDigits` is not full, pad writes to `newDigits`. Once `newDigits` is full, pad writes to `confirmDigits`. When `confirmDigits` is full, auto-submit.

- [ ] **Step 1: Check if @keyframes shake exists in index.css**

Read `app/src/index.css` and search for `@keyframes shake`. If it's missing, add it.

```bash
grep -n "keyframes shake" "e:/Web-Video Design/Claude/Apps/Pocket Money/app/src/index.css"
```

If not found, open `app/src/index.css` and append at the end:
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-6px); }
  40%       { transform: translateX(6px); }
  60%       { transform: translateX(-4px); }
  80%       { transform: translateX(4px); }
}
```

- [ ] **Step 2: Create PinManagementSettings.tsx**

Create `app/src/components/settings/sections/PinManagementSettings.tsx`:

```tsx
/**
 * PinManagementSettings — Set, change, or reset parent 4-digit PIN.
 *
 * States:
 *   verify-current  — collect account password (master key)
 *   set-new         — enter + confirm new 4-digit PIN
 *   forgot          — collect account password to reset PIN (no current PIN check)
 */

import { useState, useCallback } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { MeResult } from '../../../lib/api'
import { setParentPin, resetPinWithPassword } from '../../../lib/api'
import { isBiometricsAvailable, hasBiometricCredential, registerBiometrics } from '../../../lib/biometrics'
import { SectionHeader } from '../shared'

const PIN_LENGTH = 4

type PinState = 'verify-current' | 'set-new' | 'forgot'

interface Props {
  profile: MeResult | null
  onBack:  () => void
}

// ── Dot row ───────────────────────────────────────────────────────────────────

function DotRow({ digits, shake, label }: { digits: string[]; shake: boolean; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold text-[var(--color-text-muted)] text-center uppercase tracking-wide">{label}</p>
      <div className={`flex justify-center gap-4 ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
        {digits.map((d, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
              d
                ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)]'
                : 'bg-transparent border-[var(--color-border)]'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ── Digit pad ─────────────────────────────────────────────────────────────────

function DigitPad({ onDigit, onBackspace }: { onDigit: (d: string) => void; onBackspace: () => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {['1','2','3','4','5','6','7','8','9'].map(d => (
        <button
          key={d}
          type="button"
          onClick={() => onDigit(d)}
          className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
        >
          {d}
        </button>
      ))}
      <div />
      <button
        type="button"
        onClick={() => onDigit('0')}
        className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[22px] font-bold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
      >
        0
      </button>
      <button
        type="button"
        onClick={onBackspace}
        className="h-14 rounded-2xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[18px] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:scale-95 transition-all cursor-pointer"
        aria-label="Backspace"
      >
        ⌫
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PinManagementSettings({ profile, onBack }: Props) {
  const hasPinAlready = profile?.has_pin ?? false

  // Start state: if no PIN set yet, skip verify-current and go straight to set-new.
  // But we still need the password for setParentPin, so we use verify-current
  // with first-time copy.
  const initialState: PinState = 'verify-current'

  const [pinState,    setPinState]    = useState<PinState>(initialState)
  const [password,    setPassword]    = useState('')
  const [pwError,     setPwError]     = useState('')
  const [pwShake,     setPwShake]     = useState(false)
  const [pwBusy,      setPwBusy]      = useState(false)

  // PIN entry
  const [newDigits,   setNewDigits]   = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [confDigits,  setConfDigits]  = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [pinError,    setPinError]    = useState('')
  const [pinShake,    setPinShake]    = useState(false)
  const [pinBusy,     setPinBusy]     = useState(false)

  // Biometric nudge after save
  const [showBioNudge, setShowBioNudge] = useState(false)

  // Which API fn to call — set when password is verified in forgot vs verify-current flow
  const [apiFn, setApiFn] = useState<'set' | 'reset'>('set')

  // ── Password step ──────────────────────────────────────────────────────────

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || pwBusy) return
    setPwBusy(true)
    setPwError('')

    // We verify the password is correct by attempting setParentPin with a
    // dummy pin — but that would actually SET the pin. Instead, just trust
    // the password and pass it to set-new; the server will reject it there
    // if wrong. This matches the spec: "verify-current step collects the
    // master key, transitions to set-new; server always receives it."
    // Store password and move to set-new.
    setApiFn(pinState === 'forgot' ? 'reset' : 'set')
    setPwBusy(false)
    setPinState('set-new')
  }

  // ── PIN digit handler ──────────────────────────────────────────────────────

  const handleDigit = useCallback((digit: string) => {
    if (pinBusy) return
    setPinError('')

    const newFull = newDigits.every(d => d !== '')

    if (!newFull) {
      setNewDigits(prev => {
        const next = [...prev]
        const idx  = next.findIndex(d => d === '')
        if (idx === -1) return prev
        next[idx] = digit
        return next
      })
    } else {
      setConfDigits(prev => {
        const next = [...prev]
        const idx  = next.findIndex(d => d === '')
        if (idx === -1) return prev
        next[idx] = digit
        // Auto-submit when confirm is full
        if (idx === PIN_LENGTH - 1) {
          const newPin  = newDigits.join('')
          const confPin = next.join('')
          setTimeout(() => handleConfirmFull(newPin, confPin), 0)
        }
        return next
      })
    }
  }, [pinBusy, newDigits])

  const handleBackspace = useCallback(() => {
    if (pinBusy) return
    // Backspace from confirm first, then new
    const confFilled = confDigits.findLastIndex(d => d !== '')
    if (confFilled >= 0) {
      setConfDigits(prev => { const n = [...prev]; n[confFilled] = ''; return n })
      return
    }
    const newFilled = newDigits.findLastIndex(d => d !== '')
    if (newFilled >= 0) {
      setNewDigits(prev => { const n = [...prev]; n[newFilled] = ''; return n })
    }
  }, [pinBusy, newDigits, confDigits])

  async function handleConfirmFull(newPin: string, confPin: string) {
    if (newPin !== confPin) {
      setPinShake(true)
      setPinError("PINs don't match")
      setNewDigits(Array(PIN_LENGTH).fill(''))
      setConfDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => setPinShake(false), 600)
      return
    }
    setPinBusy(true)
    setPinError('')
    try {
      if (apiFn === 'reset') {
        await resetPinWithPassword(password, newPin)
      } else {
        await setParentPin(password, newPin)
      }
      // Success — check biometric nudge
      if (isBiometricsAvailable() && !hasBiometricCredential()) {
        setShowBioNudge(true)
      } else {
        onBack()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Server rejected password — go back to password step with error
      setPwError(msg)
      setPinState(apiFn === 'reset' ? 'forgot' : 'verify-current')
      setNewDigits(Array(PIN_LENGTH).fill(''))
      setConfDigits(Array(PIN_LENGTH).fill(''))
    } finally {
      setPinBusy(false)
    }
  }

  // ── Biometric nudge handlers ───────────────────────────────────────────────

  async function handleEnableBiometrics() {
    await registerBiometrics().catch(() => {})
    onBack()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (showBioNudge) {
    return (
      <div className="space-y-4">
        <SectionHeader title="PIN Updated" onBack={onBack} />
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
          <p className="text-[15px] font-bold text-[var(--color-text)]">Enable Face ID for faster access?</p>
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            Instead of entering your PIN every time, use biometrics to approve sensitive actions in seconds.
          </p>
          <button
            type="button"
            onClick={handleEnableBiometrics}
            className="w-full py-3 rounded-xl text-[14px] font-bold bg-[var(--brand-primary)] text-white cursor-pointer"
          >
            Enable Face ID / Touch ID
          </button>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  // ── verify-current / forgot — password collection step ────────────────────

  if (pinState === 'verify-current' || pinState === 'forgot') {
    const isForgot = pinState === 'forgot'
    const title    = isForgot ? 'Forgot PIN' : hasPinAlready ? 'Change PIN' : 'Set Up PIN'
    const heading  = isForgot
      ? 'Reset PIN with password'
      : hasPinAlready
        ? 'Enter your account password to change your PIN'
        : 'Enter your account password to enable PIN'

    return (
      <div className="space-y-4">
        <SectionHeader title={title} onBack={onBack} />
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{heading}</p>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setPwError('') }}
              placeholder="Account password"
              autoComplete="current-password"
              autoFocus
              className={`w-full px-3 py-2.5 text-[14px] rounded-xl border bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${pwShake ? 'animate-[shake_0.5s_ease-in-out]' : ''} ${pwError ? 'border-red-400' : 'border-[var(--color-border)]'}`}
            />
            {pwError && <p className="text-[12px] text-red-500">{pwError}</p>}
            <button
              type="submit"
              disabled={!password.trim() || pwBusy}
              className="w-full py-3 rounded-xl text-[14px] font-bold bg-[var(--brand-primary)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {pwBusy ? 'Checking…' : 'Continue'}
            </button>
          </div>

          {/* Forgot PIN link — only in verify-current when PIN already set */}
          {!isForgot && hasPinAlready && (
            <button
              type="button"
              onClick={() => { setPassword(''); setPwError(''); setPinState('forgot') }}
              className="w-full text-center text-[12px] text-[var(--color-text-muted)] underline underline-offset-2 cursor-pointer hover:text-[var(--color-text)]"
            >
              Forgot PIN? Reset with password
            </button>
          )}
        </form>
      </div>
    )
  }

  // ── set-new — 4-dot double entry ──────────────────────────────────────────

  const newFull  = newDigits.every(d => d !== '')

  return (
    <div className="space-y-4">
      <SectionHeader
        title={apiFn === 'reset' ? 'Reset PIN' : hasPinAlready ? 'Change PIN' : 'Set Up PIN'}
        onBack={() => {
          // Go back to password step, not all the way out
          setNewDigits(Array(PIN_LENGTH).fill(''))
          setConfDigits(Array(PIN_LENGTH).fill(''))
          setPinError('')
          setPinState(apiFn === 'reset' ? 'forgot' : 'verify-current')
        }}
      />

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 space-y-6">
        {/* Dot rows */}
        <div className="space-y-4">
          <DotRow digits={newDigits}  shake={false}    label="New PIN" />
          <DotRow digits={confDigits} shake={pinShake} label="Confirm PIN" />
        </div>

        {/* Error */}
        <div className="h-4 flex items-center justify-center">
          {pinError && <p className="text-[12px] font-semibold text-red-500">{pinError}</p>}
          {pinBusy  && <p className="text-[12px] text-[var(--color-text-muted)]">Saving…</p>}
        </div>

        {/* Digit pad */}
        <DigitPad
          onDigit={handleDigit}
          onBackspace={handleBackspace}
        />
      </div>

      <p className="text-center text-[11px] text-[var(--color-text-muted)] px-4 leading-relaxed">
        {newFull ? 'Now confirm your PIN' : 'Enter a 4-digit PIN you'll remember'}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles (PinManagementSettings only)**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit 2>&1 | grep -i "pinmanagement\|PinManagement" | head -20
```

Expected: No errors for this file. (ActiveSessionsSettings import in SecuritySettings will still error — that's fine.)

- [ ] **Step 4: Commit**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git add app/src/components/settings/sections/PinManagementSettings.tsx app/src/index.css
git commit -m "feat(settings): PinManagementSettings — PIN set/change/forgot flow"
```

---

## Task 3: ActiveSessionsSettings component

**Files:**
- Create: `app/src/components/settings/sections/ActiveSessionsSettings.tsx`

**What this task does:** Display all active (non-revoked, non-expired) sessions returned by `GET /auth/sessions`. Show each as a card with a parsed device label, relative age, and a "current device" badge for the session matching the JWT's `jti`. Allow revoking individual sessions (optimistic removal) and revoking all other sessions. Show a contextual empty state and error state.

**UA parsing rules (ordered, first match wins):**
1. Contains `"Morechard"` → `"Morechard Mobile App"`
2. Contains `"iPhone"` → `"Safari on iPhone"`
3. Contains `"iPad"` → `"Safari on iPad"`
4. Contains `"Android"` + `"Firefox"` → `"Firefox on Android"`
5. Contains `"Android"` → `"Chrome on Android"`
6. Contains `"Macintosh"` + `"Chrome"` → `"Chrome on Mac"`
7. Contains `"Macintosh"` + `"Firefox"` → `"Firefox on Mac"`
8. Contains `"Macintosh"` → `"Safari on Mac"`
9. Contains `"Windows"` + `"Firefox"` → `"Firefox on Windows"`
10. Contains `"Windows"` → `"Chrome on Windows"`
11. Anything else / empty → `"Unknown Device"`

**Relative time rules:**
- < 60s: `"just now"`
- < 60min: `"X minutes ago"`
- < 24h: `"X hours ago"`
- < 30d: `"X days ago"`
- else: `"X months ago"`

- [ ] **Step 1: Create ActiveSessionsSettings.tsx**

Create `app/src/components/settings/sections/ActiveSessionsSettings.tsx`:

```tsx
/**
 * ActiveSessionsSettings — view and revoke parent login sessions.
 */

import { useState, useEffect } from 'react'
import { Monitor, Smartphone, Tablet, AlertCircle, Loader2 } from 'lucide-react'
import type { SessionRow } from '../../../lib/api'
import { getSessions, revokeSession, revokeOtherSessions } from '../../../lib/api'
import { SectionHeader } from '../shared'

// ── UA parsing ────────────────────────────────────────────────────────────────

function parseUA(ua: string | null): string {
  if (!ua) return 'Unknown Device'
  if (ua.includes('Morechard'))                          return 'Morechard Mobile App'
  if (ua.includes('iPhone'))                             return 'Safari on iPhone'
  if (ua.includes('iPad'))                               return 'Safari on iPad'
  if (ua.includes('Android') && ua.includes('Firefox')) return 'Firefox on Android'
  if (ua.includes('Android'))                            return 'Chrome on Android'
  if (ua.includes('Macintosh') && ua.includes('Chrome')) return 'Chrome on Mac'
  if (ua.includes('Macintosh') && ua.includes('Firefox'))return 'Firefox on Mac'
  if (ua.includes('Macintosh'))                          return 'Safari on Mac'
  if (ua.includes('Windows') && ua.includes('Firefox'))  return 'Firefox on Windows'
  if (ua.includes('Windows'))                            return 'Chrome on Windows'
  return 'Unknown Device'
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(unixSeconds: number): string {
  const diffMs  = Date.now() - unixSeconds * 1000
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60)                          return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)                          return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)                            return `${diffH} hour${diffH === 1 ? '' : 's'} ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30)                            return `${diffD} day${diffD === 1 ? '' : 's'} ago`
  const diffMo = Math.floor(diffD / 30)
  return `${diffMo} month${diffMo === 1 ? '' : 's'} ago`
}

// ── Device icon ────────────────────────────────────────────────────────────────

function DeviceIcon({ label }: { label: string }) {
  if (label.includes('iPhone') || label.includes('Android') || label.includes('Mobile')) {
    return <Smartphone size={18} className="text-[var(--brand-primary)]" />
  }
  if (label.includes('iPad')) {
    return <Tablet size={18} className="text-[var(--brand-primary)]" />
  }
  return <Monitor size={18} className="text-[var(--brand-primary)]" />
}

// ── JWT jti extraction ────────────────────────────────────────────────────────

function getCurrentJti(): string | null {
  try {
    const token = localStorage.getItem('mc_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.jti ?? null
  } catch {
    return null
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActiveSessionsSettings({ onBack }: Props) {
  const [sessions,  setSessions]  = useState<SessionRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [revoking,  setRevoking]  = useState<string | null>(null)   // jti being revoked
  const [revokeAll, setRevokeAll] = useState(false)

  const currentJti = getCurrentJti()

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const result = await getSessions()
      setSessions(result.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sessions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleRevoke(jti: string) {
    setRevoking(jti)
    try {
      await revokeSession(jti)
      // Optimistic remove
      setSessions(prev => prev.filter(s => s.jti !== jti))
    } catch {
      // Silent — session list will be slightly stale but correct on next load
    } finally {
      setRevoking(null)
    }
  }

  async function handleRevokeAll() {
    setRevokeAll(true)
    try {
      await revokeOtherSessions()
      // Keep only the current session in the list
      setSessions(prev => prev.filter(s => s.jti === currentJti))
    } catch {
      // Silent
    } finally {
      setRevokeAll(false)
    }
  }

  const otherSessions = sessions.filter(s => s.jti !== currentJti)

  return (
    <div className="space-y-4">
      <SectionHeader title="Active Sessions" onBack={onBack} />

      {loading && (
        <div className="flex items-center justify-center py-10 gap-2 text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-[13px]">Loading sessions…</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-[var(--color-surface)] border border-red-200 rounded-xl p-5 flex flex-col items-center gap-3 text-center">
          <AlertCircle size={22} className="text-red-500" />
          <p className="text-[13px] text-[var(--color-text-muted)]">Could not load sessions. Try again.</p>
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 rounded-xl text-[13px] font-bold bg-[var(--brand-primary)] text-white cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {sessions.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 text-center">
              <p className="text-[13px] text-[var(--color-text-muted)]">No active sessions found.</p>
            </div>
          ) : (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
              {sessions.map((session, idx) => {
                const isCurrent = session.jti === currentJti
                const label     = parseUA(session.user_agent)
                const age       = relativeTime(session.issued_at)
                const isRevoking = revoking === session.jti

                return (
                  <div
                    key={session.jti}
                    className={`flex items-center gap-3 px-4 py-3.5 ${idx < sessions.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}
                  >
                    {/* Device icon */}
                    <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)]">
                      <DeviceIcon label={label} />
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-[var(--color-text)] truncate">{label}</p>
                        {isCurrent && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                            current
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{age}</p>
                    </div>

                    {/* Revoke button — only for non-current sessions */}
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(session.jti)}
                        disabled={isRevoking}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition-colors"
                      >
                        {isRevoking ? '…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Revoke all others */}
          {otherSessions.length > 0 && (
            <button
              type="button"
              onClick={handleRevokeAll}
              disabled={revokeAll}
              className="w-full py-3 rounded-xl text-[14px] font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              {revokeAll ? 'Revoking…' : 'Revoke All Other Devices'}
            </button>
          )}

          {/* Empty other sessions state — only current device */}
          {otherSessions.length === 0 && sessions.length > 0 && (
            <p className="text-center text-[12px] text-[var(--color-text-muted)]">No other devices logged in.</p>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify full TypeScript build is clean**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit 2>&1 | head -40
```

Expected: Zero errors (all three files now exist — SecuritySettings, PinManagementSettings, ActiveSessionsSettings).

- [ ] **Step 3: Commit**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git add app/src/components/settings/sections/ActiveSessionsSettings.tsx
git commit -m "feat(settings): ActiveSessionsSettings — session list, UA parsing, revoke"
```

---

## Task 4: Wire useGatekeeper into chore approvals

**Files:**
- Modify: `app/src/components/dashboard/PendingTab.tsx`

**What this task does:** Find the existing "approve" action in `PendingTab.tsx` and wrap it with `challenge()` from `useGatekeeper`. The chore-approval button already calls some async function — wrap that call so it only executes after the parent passes the biometric/PIN challenge. Render `<GatekeeperModal />` inside PendingTab's JSX.

- [ ] **Step 1: Read PendingTab.tsx to find the approve action**

Read `app/src/components/dashboard/PendingTab.tsx` fully to understand:
- What function/handler fires when the parent clicks "Approve"
- Where the component's JSX return is
- Current imports

- [ ] **Step 2: Add useGatekeeper import and wire challenge**

At the top of `PendingTab.tsx`, add the import:
```tsx
import { useGatekeeper } from '../../hooks/useGatekeeper'
```

Inside the component function body, add:
```tsx
const { challenge, GatekeeperModal } = useGatekeeper()
```

Find the approve handler (the function that is called when the parent approves a chore). Wrap its body call with `challenge`:

**Before** (the existing approve call — find the actual function name in the file):
```tsx
await approveCompletion(completionId)  // or whatever the actual call is
```

**After** — wrap the existing call site:
```tsx
challenge(async () => {
  await approveCompletion(completionId)  // keep the existing logic exactly
})
```

If the approve handler is inline (e.g., `onClick={() => handleApprove(id)}`), wrap it:
```tsx
onClick={() => challenge(() => handleApprove(id))}
```

- [ ] **Step 3: Render GatekeeperModal in PendingTab's JSX**

In the JSX return of PendingTab, add `<GatekeeperModal />` as the first element inside the outermost container:

```tsx
return (
  <div className="...">
    <GatekeeperModal />
    {/* rest of existing JSX unchanged */}
  </div>
)
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit 2>&1 | head -30
```

Expected: Zero errors.

- [ ] **Step 5: Commit**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git add app/src/components/dashboard/PendingTab.tsx
git commit -m "feat(approvals): gate chore approvals behind useGatekeeper PIN/biometric challenge"
```

---

## Task 5: Build and smoke-test

**Files:** None created/modified — verification only.

**What this task does:** Confirm the Vite build succeeds and do a quick manual walkthrough of the new screens.

- [ ] **Step 1: Run the Vite build**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npm run build 2>&1 | tail -20
```

Expected: `✓ built in ...ms` with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 2: Verify no runtime import issues**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money/app"
npx tsc --noEmit 2>&1
```

Expected: Zero output (clean).

- [ ] **Step 3: Smoke-test checklist (manual — describe what to verify)**

Open the dev server (`npm run dev` from `app/`) and navigate to Settings → Security & Access:

1. **Menu screen:** "PIN Management" row appears. If the test account has `has_password: true` and `has_pin: false`, row reads "Set up a 4-digit parent PIN". If `has_password: false`, row reads "Set a Password First" and tapping it shows the Coming Soon toast.

2. **Active Sessions:** Tap "Active Sessions" row — sessions screen loads showing at least the current device with a teal "current" badge. Relative age shows correctly.

3. **PIN setup flow:** Tap "PIN Management" → password step → enter correct account password → Continue → "New PIN" dots appear → enter 4 digits → "Confirm PIN" dots appear → re-enter same 4 digits → success.

4. **Gatekeeper from Forgot PIN link:** Close the PIN screen. Open a tab to any parent dashboard view, trigger a gatekeeper modal (by approving a chore). Tap "Forgot PIN? Manage in Settings". Verify the modal closes and you land on Settings → Security → PIN Management screen (deep-link resolved via `?settings=security&view=pin`).

5. **Chore approval gating:** Navigate to approvals tab. If a pending chore exists, tap Approve. Verify the Gatekeeper modal appears (or passes through grace window if recently verified).

- [ ] **Step 4: Final commit (if any fixes needed from smoke-test)**

```bash
cd "e:/Web-Video Design/Claude/Apps/Pocket Money"
git add -p
git commit -m "fix(security-ui): smoke-test corrections"
```

If nothing to fix, skip this step.

---

## Self-Review Notes

### Spec coverage check

| Spec requirement | Task covering it |
|-----------------|-----------------|
| SecuritySettings becomes thin router | Task 1 |
| `view` state: `'menu' \| 'pin' \| 'sessions'` | Task 1 |
| `profile` passed to SecuritySettings | Task 1 |
| Deep-link `?settings=security&view=pin` | Task 1 |
| `has_password: false` → "Set a Password First" row | Task 1 |
| `verify-current` step — password (master key) required | Task 2 |
| "Forgot PIN?" link → transitions to `forgot` state | Task 2 |
| `set-new` — New PIN + Confirm PIN dots | Task 2 |
| Confirm mismatch → shake + "PINs don't match" | Task 2 |
| `setParentPin(password, newPin)` on success | Task 2 |
| `resetPinWithPassword(password, newPin)` on forgot | Task 2 |
| Biometric nudge post-PIN-save | Task 2 |
| Session list with UA parsing | Task 3 |
| "current" badge from JWT jti | Task 3 |
| Relative age from `issued_at` | Task 3 |
| Individual revoke → optimistic remove | Task 3 |
| "Revoke all other devices" button | Task 3 |
| Empty state / error state | Task 3 |
| Gatekeeper on chore approval | Task 4 |
| `<GatekeeperModal />` rendered | Task 4 |

### Type consistency check
- `MeResult` is imported from `'../../../lib/api'` in both SecuritySettings and PinManagementSettings ✓
- `SessionRow` imported from `'../../../lib/api'` in ActiveSessionsSettings ✓
- `setParentPin`, `resetPinWithPassword` signatures match api.ts: `(password: string, newPin: string)` ✓
- `getSessions` returns `{ sessions: SessionRow[] }` ✓
- `revokeSession(jti: string)`, `revokeOtherSessions()` match api.ts ✓
- `useGatekeeper` returns `{ challenge, GatekeeperModal }` — matches hook implementation ✓
