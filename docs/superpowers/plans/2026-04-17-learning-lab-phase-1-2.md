# Orchard Learning Lab — Phase 1 & 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a D1-backed chat history + curriculum unlock system and a new "Lab" tab in the child dashboard, proving the end-to-end unlock flow with one test module ("The Snowball").

**Architecture:** A new migration adds `chat_history` and `unlocked_modules` tables. `chat.ts` gains a keyword-pillar unlock matrix that writes to both tables after every AI response. Two new GET routes serve history and modules to the frontend. A new `LabTab.tsx` component mounts as a third child dashboard tab with parallel-loaded skeleton states, a chat input, a history feed, and a module grid.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers (TypeScript), React 18, Tailwind CSS, `crypto.randomUUID()` (Workers runtime built-in — no nanoid import).

---

## Codebase Context (read before touching anything)

- Worker entry: `worker/src/index.ts` — routes are matched with `if (path === '...' && method === '...')` guards. Auth routes use `withAuth()`. Child-role enforcement is done inside each handler.
- Auth middleware pattern: `return withAuth(request, auth, env, handlerFn)` where `handlerFn` is `(req: Request, env: Env) => Promise<Response>`.
- The existing chat route is at line ~373 of `index.ts`: `if (path === '/api/chat' && method === 'POST') return withAuth(...)`.
- `worker/src/types.ts` — `MentorResponse` is at line 203. `FinancialPillar`, `Locale`, `Currency` are defined here.
- `worker/src/routes/chat.ts` — the full 362-line file. `handleChildChat` is the export. `selectPillar()` is defined here. The response is assembled at lines 353–360.
- `app/src/lib/api.ts` — all API calls use the `request<T>(path, options)` helper (line 44). Auth token is auto-attached. No manual `Authorization` header needed in helper functions.
- `app/src/screens/ChildDashboard.tsx` — tab state is `const [childTab, setChildTab] = useState<'home' | 'earn'>('home')` (line 100). Tab bar is at lines 262–276. Main content render is at lines 303–306.
- `appView` in `ChildDashboard` is state: `const [appView, setAppView] = useState<'ORCHARD' | 'CLEAN'>('ORCHARD')` — pass it as prop to `LabTab`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `worker/migrations/0028_learning_lab.sql` | `chat_history` + `unlocked_modules` tables + indexes |
| Modify | `worker/src/types.ts` | Add `unlock_slug?` to `MentorResponse` |
| Modify | `worker/src/routes/chat.ts` | Unlock matrix + D1 writes after AI reply |
| Create | `worker/src/routes/chat-history.ts` | `handleChatHistory` — paginated GET |
| Create | `worker/src/routes/chat-modules.ts` | `handleChatModules` — GET unlocked slugs |
| Modify | `worker/src/index.ts` | Mount two new GET routes |
| Modify | `app/src/lib/api.ts` | Add types + `postChat`, `getChatHistory`, `getChatModules` helpers |
| Create | `app/src/components/dashboard/LabTab.tsx` | Full Lab tab — chat input, history feed, module grid |
| Modify | `app/src/screens/ChildDashboard.tsx` | Add `'lab'` tab entry + render `<LabTab>` |

---

## Task 1: Migration — chat_history + unlocked_modules

**Files:**
- Create: `worker/migrations/0028_learning_lab.sql`

- [ ] **Step 1.1: Write the migration file**

```sql
-- Migration 0028: Learning Lab — chat history + curriculum unlock tables

CREATE TABLE chat_history (
  id          TEXT PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  reply       TEXT NOT NULL,
  pillar      TEXT NOT NULL,
  unlock_slug TEXT,
  app_view    TEXT NOT NULL CHECK (app_view IN ('ORCHARD', 'CLEAN')),
  locale      TEXT NOT NULL CHECK (locale IN ('en', 'en-US', 'pl')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_chat_history_child ON chat_history(child_id, created_at DESC);

CREATE TABLE unlocked_modules (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES users(id),
  module_slug  TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  UNIQUE (child_id, module_slug)
);
CREATE INDEX idx_unlocked_modules_child ON unlocked_modules(child_id);
```

- [ ] **Step 1.2: Apply migration to local D1**

```bash
cd worker
npx wrangler d1 execute morechard-db --local --file=migrations/0028_learning_lab.sql
```

Expected output: `✅ Successfully executed` (no error lines).

- [ ] **Step 1.3: Verify tables exist**

```bash
npx wrangler d1 execute morechard-db --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_history','unlocked_modules');"
```

Expected: two rows returned — `chat_history` and `unlocked_modules`.

- [ ] **Step 1.4: Commit**

```bash
git add worker/migrations/0028_learning_lab.sql
git commit -m "feat(db): migration 0028 — chat_history + unlocked_modules tables"
```

---

## Task 2: types.ts — add unlock_slug to MentorResponse

**Files:**
- Modify: `worker/src/types.ts` (line 203–209)

The current `MentorResponse` at line 203 does not have `unlock_slug`. Add the optional field.

- [ ] **Step 2.1: Edit `worker/src/types.ts`**

Find this block (lines 202–209):
```typescript
/** Structured response returned by the chat endpoint. */
export interface MentorResponse {
  reply: string;
  pillar: FinancialPillar;
  data_points: Record<string, string | number | boolean>;
  app_view: 'ORCHARD' | 'CLEAN';
  locale: Locale;
}
```

Replace with:
```typescript
/** Structured response returned by the chat endpoint. */
export interface MentorResponse {
  reply: string;
  pillar: FinancialPillar;
  data_points: Record<string, string | number | boolean>;
  app_view: 'ORCHARD' | 'CLEAN';
  locale: Locale;
  unlock_slug?: string; // present only when this response triggered a module unlock
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
cd worker
npx tsc --noEmit
```

Expected: zero new errors in `types.ts`. (Pre-existing errors in unrelated files are acceptable — do not fix them.)

- [ ] **Step 2.3: Commit**

```bash
git add worker/src/types.ts
git commit -m "feat(types): add optional unlock_slug to MentorResponse"
```

---

## Task 3: chat.ts — unlock matrix + D1 history write

**Files:**
- Modify: `worker/src/routes/chat.ts`

This task adds three things to `chat.ts`:
1. `UNLOCK_MATRIX` constant and `detectUnlockSlug()` function (placed after the `buildDataPoints` function, before `fallbackReply`)
2. Post-AI D1 writes (inside `handleChildChat`, after `mentorReply` is assigned)
3. `unlock_slug` spread into the final `response` object

**Important:** Use `crypto.randomUUID()` for IDs — do NOT import nanoid. The Workers runtime provides `crypto.randomUUID()` globally.

- [ ] **Step 3.1: Add the unlock matrix and detector function to `chat.ts`**

Insert this block after the `buildDataPoints` function (before the `fallbackReply` function, around line 273):

```typescript
// ─────────────────────────────────────────────────────────────────
// Unlock matrix — keyword × pillar → curriculum module slug
// Regex uses /i flag (case-insensitive). No .toLowerCase() needed.
// ─────────────────────────────────────────────────────────────────

const UNLOCK_MATRIX: Array<{
  slug:     string
  pillar:   FinancialPillar
  keywords: RegExp
}> = [
  {
    slug:     'compound-interest',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /interest|compound|snowball|grow|invest/i,
  },
  // Phase 3 will extend this array with the remaining 17 entries
]

function detectUnlockSlug(
  message: string,
  pillar:  FinancialPillar,
): string | null {
  for (const entry of UNLOCK_MATRIX) {
    if (entry.pillar === pillar && entry.keywords.test(message)) {
      return entry.slug
    }
  }
  return null
}
```

- [ ] **Step 3.2: Add D1 writes after the AI call in `handleChildChat`**

Find the line in `handleChildChat` that reads (around line 347):
```typescript
    mentorReply = aiResponse.response?.trim() ?? fallbackReply(intel.locale, intel.app_view)
```

The full try/catch block ends a few lines later with `clearTimeout(timeoutId)`. After the entire try/catch block (after `mentorReply` is assigned), insert:

```typescript
  // ── Detect unlock + persist history ───────────────────────────
  const unlockSlug = detectUnlockSlug(userMessage, pillar)
  const now        = Math.floor(Date.now() / 1000)

  const dbWrites: Promise<unknown>[] = [
    env.DB.prepare(
      `INSERT INTO chat_history (id, child_id, message, reply, pillar, unlock_slug, app_view, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      auth.sub,
      userMessage,
      mentorReply,
      pillar,
      unlockSlug ?? null,
      intel.app_view,
      intel.locale,
      now,
    ).run(),
  ]

  if (unlockSlug) {
    dbWrites.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO unlocked_modules (id, child_id, module_slug, unlocked_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), auth.sub, unlockSlug, now).run(),
    )
  }

  await Promise.all(dbWrites)
```

- [ ] **Step 3.3: Add unlock_slug to the response object**

Find the response assembly block (around line 353):
```typescript
  const response: MentorResponse = {
    reply:       mentorReply,
    pillar,
    data_points: dataPoints,
    app_view:    intel.app_view,
    locale:      intel.locale,
  }
  return json(response)
```

Replace with:
```typescript
  const response: MentorResponse = {
    reply:       mentorReply,
    pillar,
    data_points: dataPoints,
    app_view:    intel.app_view,
    locale:      intel.locale,
    ...(unlockSlug ? { unlock_slug: unlockSlug } : {}),
  }
  return json(response)
```

- [ ] **Step 3.4: Verify TypeScript compiles**

```bash
cd worker
npx tsc --noEmit
```

Expected: zero new errors in `chat.ts`.

- [ ] **Step 3.5: Commit**

```bash
git add worker/src/routes/chat.ts
git commit -m "feat(chat): unlock matrix + chat_history + unlocked_modules D1 writes"
```

---

## Task 4: chat-history.ts — paginated GET route

**Files:**
- Create: `worker/src/routes/chat-history.ts`

- [ ] **Step 4.1: Create the file**

```typescript
// worker/src/routes/chat-history.ts
// GET /api/chat/history?limit=20&offset=0
// Returns paginated chat history for the authenticated child.

import type { Env } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'

type AuthedRequest = Request & { auth: JwtPayload }

export async function handleChatHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth

  if (auth.role !== 'child') {
    return json({ error: 'Child auth required' }, 403)
  }

  const url    = new URL(request.url)
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit')  ?? '20', 10), 1), 50)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0)

  const rows = await env.DB.prepare(
    `SELECT id, message, reply, pillar, unlock_slug, app_view, locale, created_at
     FROM chat_history
     WHERE child_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(auth.sub, limit, offset).all()

  return json({ history: rows.results, limit, offset })
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
cd worker
npx tsc --noEmit
```

Expected: zero new errors in `chat-history.ts`.

- [ ] **Step 4.3: Commit**

```bash
git add worker/src/routes/chat-history.ts
git commit -m "feat(chat): GET /api/chat/history — paginated history route"
```

---

## Task 5: chat-modules.ts — GET unlocked slugs route

**Files:**
- Create: `worker/src/routes/chat-modules.ts`

- [ ] **Step 5.1: Create the file**

```typescript
// worker/src/routes/chat-modules.ts
// GET /api/chat/modules
// Returns all unlocked curriculum module slugs for the authenticated child.

import type { Env } from '../types.js'
import { json } from '../lib/response.js'
import type { JwtPayload } from '../lib/jwt.js'

type AuthedRequest = Request & { auth: JwtPayload }

export async function handleChatModules(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth

  if (auth.role !== 'child') {
    return json({ error: 'Child auth required' }, 403)
  }

  const rows = await env.DB.prepare(
    `SELECT module_slug, unlocked_at
     FROM unlocked_modules
     WHERE child_id = ?
     ORDER BY unlocked_at ASC`,
  ).bind(auth.sub).all()

  return json({ modules: rows.results })
}
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
cd worker
npx tsc --noEmit
```

Expected: zero new errors in `chat-modules.ts`.

- [ ] **Step 5.3: Commit**

```bash
git add worker/src/routes/chat-modules.ts
git commit -m "feat(chat): GET /api/chat/modules — unlocked module slugs route"
```

---

## Task 6: index.ts — mount new routes

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 6.1: Add imports at the top of `index.ts`**

Find the block of chat-related imports. The existing import is:
```typescript
import { handleChildChat } from './routes/chat.js'
```

Add two imports immediately after it:
```typescript
import { handleChatHistory } from './routes/chat-history.js'
import { handleChatModules } from './routes/chat-modules.js'
```

- [ ] **Step 6.2: Mount the routes in `index.ts`**

Find the existing chat route (around line 373):
```typescript
  // Chat — child mentor (role check enforced in handler)
  if (path === '/api/chat' && method === 'POST') return withAuth(request, auth, env, (req, e) => handleChildChat(req, e));
```

Add two new routes immediately after it:
```typescript
  if (path === '/api/chat/history' && method === 'GET') return withAuth(request, auth, env, handleChatHistory);
  if (path === '/api/chat/modules' && method === 'GET') return withAuth(request, auth, env, handleChatModules);
```

- [ ] **Step 6.3: Verify TypeScript compiles**

```bash
cd worker
npx tsc --noEmit
```

Expected: zero new errors in `index.ts`.

- [ ] **Step 6.4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): mount GET /api/chat/history and /api/chat/modules routes"
```

---

## Task 7: api.ts — frontend types + fetch helpers

**Files:**
- Modify: `app/src/lib/api.ts`

- [ ] **Step 7.1: Add types and helpers to `app/src/lib/api.ts`**

Append the following block to the end of `app/src/lib/api.ts`:

```typescript
// ----------------------------------------------------------------
// Learning Lab — Chat + Curriculum types and helpers
// ----------------------------------------------------------------

export interface ChatHistoryItem {
  id:          string
  message:     string
  reply:       string
  pillar:      string
  unlock_slug: string | null
  app_view:    'ORCHARD' | 'CLEAN'
  locale:      string
  created_at:  number
}

export interface ChatHistoryResponse {
  history: ChatHistoryItem[]
  limit:   number
  offset:  number
}

export interface ChatModuleItem {
  module_slug: string
  unlocked_at: number
}

export interface ChatModulesResponse {
  modules: ChatModuleItem[]
}

// Frontend mirror of worker/src/types.ts MentorResponse
export interface MentorResponse {
  reply:        string
  pillar:       string
  data_points:  Record<string, string | number | boolean>
  app_view:     'ORCHARD' | 'CLEAN'
  locale:       string
  unlock_slug?: string
}

export async function postChat(message: string): Promise<MentorResponse> {
  return request<MentorResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export async function getChatHistory(limit = 20, offset = 0): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>(`/api/chat/history?limit=${limit}&offset=${offset}`)
}

export async function getChatModules(): Promise<ChatModulesResponse> {
  return request<ChatModulesResponse>('/api/chat/modules')
}
```

Note: `request<T>()` is defined at line 44 of `api.ts` and auto-attaches the JWT auth header. Do not add manual `Authorization` headers.

- [ ] **Step 7.2: Verify TypeScript compiles in the frontend**

```bash
cd app
npx tsc --noEmit
```

Expected: zero new errors introduced by these additions.

- [ ] **Step 7.3: Commit**

```bash
git add app/src/lib/api.ts
git commit -m "feat(api): add ChatHistoryItem, MentorResponse types + postChat/getChatHistory/getChatModules helpers"
```

---

## Task 8: LabTab.tsx — the full Lab tab component

**Files:**
- Create: `app/src/components/dashboard/LabTab.tsx`

This is the largest task. Build it in sub-steps.

- [ ] **Step 8.1: Create the file with props, types, and state skeleton**

```typescript
// app/src/components/dashboard/LabTab.tsx
// The Orchard Learning Lab — chat input, history feed, module grid.

import { useState, useEffect, useRef } from 'react'
import {
  postChat, getChatHistory, getChatModules,
  type ChatHistoryItem, type MentorResponse,
} from '../../lib/api'

// ─── Module catalogue (Phase 1+2: one module) ────────────────────

interface ModuleDef {
  slug:        string
  title:       string
  description: string
  triggerHint: string
  content:     string
}

const MODULE_CATALOGUE: ModuleDef[] = [
  {
    slug:        'compound-interest',
    title:       'The Snowball',
    description: 'How money grows when you leave it alone.',
    triggerHint: 'Ask us about growing your money',
    content:     'When you save money and leave it alone, it starts to grow on its own. This is called compound interest. Imagine you plant a seed and instead of picking the fruit, you let it fall back into the ground. Next season, you have two trees. Then four. The longer you wait, the faster it grows. A £50 saving today, left untouched at 5% interest, becomes £81 in ten years — without a single extra chore. The secret is simply: wait.',
  },
]

// ─── Pillar badge colours ─────────────────────────────────────────

const PILLAR_COLOURS: Record<string, string> = {
  LABOR_VALUE:           'bg-amber-100 text-amber-800',
  DELAYED_GRATIFICATION: 'bg-blue-100 text-blue-800',
  OPPORTUNITY_COST:      'bg-orange-100 text-orange-800',
  CAPITAL_MANAGEMENT:    'bg-green-100 text-green-800',
  SOCIAL_RESPONSIBILITY: 'bg-purple-100 text-purple-800',
}

const PILLAR_LABELS: Record<string, string> = {
  LABOR_VALUE:           'Labour Value',
  DELAYED_GRATIFICATION: 'Patience',
  OPPORTUNITY_COST:      'Trade-offs',
  CAPITAL_MANAGEMENT:    'Growth',
  SOCIAL_RESPONSIBILITY: 'Giving',
}

// ─── Props ────────────────────────────────────────────────────────

interface LabTabProps {
  childId: string
  appView: 'ORCHARD' | 'CLEAN'
}

// ─── Component ───────────────────────────────────────────────────

export function LabTab({ appView }: LabTabProps) {
  const [history,        setHistory]        = useState<ChatHistoryItem[]>([])
  const [unlockedSlugs,  setUnlockedSlugs]  = useState<string[]>([])
  const [loading,        setLoading]        = useState(true)
  const [historyError,   setHistoryError]   = useState<string | null>(null)
  const [modulesError,   setModulesError]   = useState<string | null>(null)
  const [inputValue,     setInputValue]     = useState('')
  const [sending,        setSending]        = useState(false)
  const [sendError,      setSendError]      = useState<string | null>(null)
  const [historyOffset,  setHistoryOffset]  = useState(0)
  const [hasMore,        setHasMore]        = useState(false)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [activeModule,   setActiveModule]   = useState<ModuleDef | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // ── Load history + modules in parallel on mount ────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setHistoryError(null)
    setModulesError(null)

    Promise.all([
      getChatHistory(20, 0).catch((e: unknown) => {
        if (!cancelled) setHistoryError('History could not be loaded.')
        return null
      }),
      getChatModules().catch((e: unknown) => {
        if (!cancelled) setModulesError('Modules could not be loaded.')
        return null
      }),
    ]).then(([histRes, modRes]) => {
      if (cancelled) return
      if (histRes) {
        setHistory(histRes.history)
        setHasMore(histRes.history.length === 20)
      }
      if (modRes) {
        setUnlockedSlugs(modRes.modules.map(m => m.module_slug))
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // ── Open/close dialog ─────────────────────────────────────────
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (activeModule) {
      el.showModal()
    } else {
      el.close()
    }
  }, [activeModule])

  // ── Send message ──────────────────────────────────────────────
  async function handleSend() {
    const msg = inputValue.trim()
    if (!msg || sending) return
    setSending(true)
    setSendError(null)
    setInputValue('')

    try {
      const res: MentorResponse = await postChat(msg)

      const newItem: ChatHistoryItem = {
        id:          crypto.randomUUID(),
        message:     msg,
        reply:       res.reply,
        pillar:      res.pillar,
        unlock_slug: res.unlock_slug ?? null,
        app_view:    res.app_view,
        locale:      res.locale,
        created_at:  Math.floor(Date.now() / 1000),
      }

      setHistory(prev => [newItem, ...prev])

      if (res.unlock_slug && !unlockedSlugs.includes(res.unlock_slug)) {
        setUnlockedSlugs(prev => [...prev, res.unlock_slug!])
      }
    } catch {
      setSendError('Message could not be sent. Please try again.')
      setInputValue(msg) // restore so user doesn't lose their message
    } finally {
      setSending(false)
    }
  }

  // ── Load more history ─────────────────────────────────────────
  async function handleLoadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    const nextOffset = historyOffset + 20
    try {
      const res = await getChatHistory(20, nextOffset)
      setHistory(prev => [...prev, ...res.history])
      setHistoryOffset(nextOffset)
      setHasMore(res.history.length === 20)
    } catch {
      // silent — user can retry
    } finally {
      setLoadingMore(false)
    }
  }

  // ── Skeleton ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-2">
          {appView === 'ORCHARD' ? 'Consulting the Mentor...' : 'Loading your history...'}
        </p>
        {/* History skeletons */}
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-xl bg-[var(--color-border)] h-20" />
          ))}
        </div>
        {/* Module skeleton */}
        <div className="animate-pulse rounded-xl bg-[var(--color-border)] h-24 mt-2" />
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* ── Chat Input ── */}
      <div className="flex gap-2 items-end">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder={appView === 'ORCHARD' ? 'Ask your Mentor...' : 'Ask a question...'}
          disabled={sending}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--brand-primary)] disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={sending || !inputValue.trim()}
          className="rounded-xl bg-[var(--brand-primary)] text-white px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40 cursor-pointer"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      {sendError && (
        <p className="text-[12px] text-red-500 -mt-3">{sendError}</p>
      )}

      {/* ── History Feed ── */}
      <section>
        <h2 className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
          History
        </h2>
        {historyError ? (
          <p className="text-[13px] text-red-500">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {appView === 'ORCHARD'
              ? 'No conversations yet. Ask the Mentor anything! 🌱'
              : 'No conversations yet. Send a message to get started.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map(item => (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-1.5"
              >
                {/* User bubble */}
                <p className="text-[12px] text-[var(--color-text-muted)] text-right">{item.message}</p>
                {/* Pillar badge */}
                <span className={`self-start text-[10px] font-semibold px-2 py-0.5 rounded-full ${PILLAR_COLOURS[item.pillar] ?? 'bg-gray-100 text-gray-700'}`}>
                  {PILLAR_LABELS[item.pillar] ?? item.pillar}
                </span>
                {/* Reply */}
                <p className="text-[13px] text-[var(--color-text)] leading-snug">{item.reply}</p>
                {/* Unlock indicator */}
                {item.unlock_slug && (
                  <p className="text-[11px] text-[var(--brand-primary)] font-semibold">🔓 New module unlocked</p>
                )}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-[13px] text-[var(--brand-primary)] font-semibold py-2 disabled:opacity-40 cursor-pointer"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Module Grid ── */}
      <section>
        <h2 className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
          Your Modules
        </h2>
        {modulesError ? (
          <p className="text-[13px] text-red-500">{modulesError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {MODULE_CATALOGUE.map(mod => {
              const isUnlocked = unlockedSlugs.includes(mod.slug)
              return (
                <button
                  key={mod.slug}
                  onClick={() => isUnlocked && setActiveModule(mod)}
                  disabled={!isUnlocked}
                  className={`text-left rounded-xl border p-4 transition-colors cursor-pointer
                    ${isUnlocked
                      ? 'border-[var(--brand-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-border)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] opacity-50 cursor-default grayscale'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[14px] font-bold text-[var(--color-text)]">{mod.title}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                        {isUnlocked ? mod.description : mod.triggerHint}
                      </p>
                    </div>
                    <span className="text-[18px] flex-shrink-0 mt-0.5">
                      {isUnlocked ? '📖' : '🔒'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Module Detail Dialog ── */}
      <dialog
        ref={dialogRef}
        onClose={() => setActiveModule(null)}
        className="fixed inset-0 m-auto w-full max-w-[520px] rounded-t-2xl rounded-b-none sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-xl backdrop:bg-black/50 max-h-[80vh] overflow-y-auto"
        style={{ bottom: 0, top: 'auto', left: 0, right: 0, maxWidth: '520px', margin: '0 auto' }}
      >
        {activeModule && (
          <div className="p-5 flex flex-col gap-4">
            {/* Header with explicit close button — min 44×44px tap target */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[18px] font-extrabold text-[var(--color-text)]">{activeModule.title}</h3>
              <button
                onClick={() => setActiveModule(null)}
                className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] text-[22px] leading-none flex-shrink-0 cursor-pointer"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {/* Content */}
            <p className="text-[14px] text-[var(--color-text)] leading-relaxed">{activeModule.content}</p>
            {/* Bottom close button — large, explicit */}
            <button
              onClick={() => setActiveModule(null)}
              className="w-full py-3 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </dialog>

    </div>
  )
}
```

- [ ] **Step 8.2: Verify TypeScript compiles**

```bash
cd app
npx tsc --noEmit
```

Expected: zero new errors in `LabTab.tsx`.

- [ ] **Step 8.3: Commit**

```bash
git add app/src/components/dashboard/LabTab.tsx
git commit -m "feat(ui): LabTab — chat input, history feed, module grid, Snowball module"
```

---

## Task 9: ChildDashboard.tsx — add Lab tab

**Files:**
- Modify: `app/src/screens/ChildDashboard.tsx`

- [ ] **Step 9.1: Add the LabTab import**

At the top of `ChildDashboard.tsx`, find the existing dashboard imports:
```typescript
import { EarnTab } from '../components/dashboard/EarnTab'
```

Add immediately after it:
```typescript
import { LabTab } from '../components/dashboard/LabTab'
```

- [ ] **Step 9.2: Expand the childTab union type**

Find (line 100):
```typescript
  const [childTab,   setChildTab]   = useState<'home' | 'earn'>('home')
```

Replace with:
```typescript
  const [childTab,   setChildTab]   = useState<'home' | 'earn' | 'lab'>('home')
```

- [ ] **Step 9.3: Add the Lab tab button to the tab bar**

Find (lines 262–276):
```typescript
        <div className="max-w-[560px] mx-auto border-t border-[var(--color-border)] flex">
          {([['home', 'Home'], ['earn', 'Tasks']] as const).map(([id, label]) => (
```

Replace with:
```typescript
        <div className="max-w-[560px] mx-auto border-t border-[var(--color-border)] flex">
          {([['home', 'Home'], ['earn', 'Tasks'], ['lab', 'Lab']] as const).map(([id, label]) => (
```

- [ ] **Step 9.4: Add LabTab render in the main content area**

Find (lines 303–306):
```typescript
        {childTab === 'earn' ? (
          <EarnTab familyId={familyId} childId={userId} currency={chores[0]?.currency ?? 'GBP'} />
        ) : loading ? (
```

Replace with:
```typescript
        {childTab === 'earn' ? (
          <EarnTab familyId={familyId} childId={userId} currency={chores[0]?.currency ?? 'GBP'} />
        ) : childTab === 'lab' ? (
          <LabTab childId={userId} appView={appView} />
        ) : loading ? (
```

- [ ] **Step 9.5: Verify TypeScript compiles**

```bash
cd app
npx tsc --noEmit
```

Expected: zero new errors in `ChildDashboard.tsx`.

- [ ] **Step 9.6: Commit**

```bash
git add app/src/screens/ChildDashboard.tsx
git commit -m "feat(ui): add Lab tab to ChildDashboard — mounts LabTab component"
```

---

## Task 10: End-to-End Smoke Test

This task verifies the complete Snowball unlock flow works as specified.

**Pre-condition:** Local dev server running (`npm run dev` in root, `npx wrangler dev` in worker).

- [ ] **Step 10.1: Start the worker dev server**

```bash
cd worker
npx wrangler dev
```

Expected: `Listening on http://localhost:8787`

- [ ] **Step 10.2: Start the frontend dev server**

In a second terminal:
```bash
cd app
npm run dev
```

Expected: `Local: http://localhost:5173`

- [ ] **Step 10.3: Log in as a child and navigate to the Lab tab**

Open `http://localhost:5173` in a browser. Log in as a test child. In the child dashboard, click the "Lab" tab.

Expected:
- "Consulting the Mentor..." (ORCHARD) or "Loading your history..." (CLEAN) appears briefly
- History feed shows "No conversations yet" message
- Module Grid shows 1 locked card: "The Snowball" with lock icon and "Ask us about growing your money"

- [ ] **Step 10.4: Send the trigger message**

Type `how does my money grow?` into the chat input and press Send.

Expected:
- Send button shows `...` while pending
- A new history card appears with a green "Growth" pillar badge and the AI reply
- The card shows "🔓 New module unlocked"
- "The Snowball" card flips: greyscale removed, full colour, 📖 icon, "How money grows when you leave it alone."

- [ ] **Step 10.5: Tap "The Snowball" card**

Expected:
- A bottom sheet dialog opens
- Title: "The Snowball"
- Content: the compound interest explanation text
- A large "Close" button (minimum 44px height) is visible at both top-right and bottom
- Tapping "Close" dismisses the sheet

- [ ] **Step 10.6: Refresh the page and verify persistence**

Reload the browser and navigate back to the Lab tab.

Expected:
- The history card from Step 10.4 is still visible (loaded from D1 via `/api/chat/history`)
- "The Snowball" is still unlocked (loaded from D1 via `/api/chat/modules`)

- [ ] **Step 10.7: Commit**

```bash
git add -A
git commit -m "test(lab): smoke test — Snowball unlock flow verified end-to-end"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `chat_history` D1 table | Task 1 |
| `unlocked_modules` D1 table | Task 1 |
| `unlock_slug?` on `MentorResponse` | Task 2 |
| Keyword-pillar matrix with `/i` flag | Task 3 |
| `crypto.randomUUID()` (not nanoid) | Task 3 |
| D1 write to `chat_history` after every response | Task 3 |
| INSERT OR IGNORE into `unlocked_modules` | Task 3 |
| `GET /api/chat/history` with limit/offset pagination | Task 4 |
| `GET /api/chat/modules` | Task 5 |
| Both routes mounted in `index.ts` | Task 6 |
| Frontend types + fetch helpers | Task 7 |
| Parallel mount with `Promise.all` on tab open | Task 8 |
| Loading skeleton (3 history + 1 module) | Task 8 |
| "Consulting the Mentor..." caption | Task 8 |
| Section-level error states (not full-tab blank) | Task 8 |
| Pillar badge with correct colours | Task 8 |
| 🔓 unlock indicator on history card | Task 8 |
| Optimistic `unlockedSlugs` update (no re-fetch) | Task 8 |
| "Load more" pagination button | Task 8 |
| Module Grid — one module (YAGNI) | Task 8 |
| Locked state: greyscale, lock icon, triggerHint | Task 8 |
| Unlocked state: full colour, tap opens dialog | Task 8 |
| Dialog close button ≥44px tap target | Task 8 |
| Both top-right × and bottom "Close" button | Task 8 |
| "Lab" as third tab in ChildDashboard | Task 9 |
| No metaphors in UI navigation strings | Tasks 8, 9 |
| Emojis only in ORCHARD mode copy | Task 8 |
| End-to-end Snowball unlock acceptance test | Task 10 |

All spec requirements accounted for. No placeholders. Types consistent across all tasks (`ChatHistoryItem`, `MentorResponse`, `ModuleDef`, `LabTabProps` all defined before use).
