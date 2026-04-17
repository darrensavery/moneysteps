# Orchard Learning Lab — Phase 1 & 2 Design Spec

## Goal

Build the functional shell of the Orchard Learning Lab: a D1-backed chat history + curriculum unlock system, and a new "Lab" tab in the child dashboard with a History Feed, chat input, and Module Grid. Prove the end-to-end unlock flow with one test module ("The Snowball").

## Scope

Phase 1: Backend (DB + API routes + unlock logic in `chat.ts`)
Phase 2: Frontend (LabTab component + integration into ChildDashboard)

Out of scope: the full 18-module curriculum content (Phase 3), persona tuning for unlock announcements (Phase 4).

---

## Architecture

### Data Flow

1. Child types a message in the Lab tab chat input
2. Frontend POSTs to `POST /api/chat` (existing route)
3. `chat.ts` runs `getChildIntelligence()`, builds locale-aware system prompt, calls AI
4. After AI reply: keyword-pillar matrix checks for a matching `unlock_slug`
5. Two D1 writes in parallel: INSERT into `chat_history`; INSERT OR IGNORE into `unlocked_modules` (only if slug detected)
6. Response returns `MentorResponse` (now with optional `unlock_slug`)
7. Frontend appends exchange to history feed; if `unlock_slug` present, re-fetches modules
8. Module Grid re-renders — "The Snowball" card flips from locked to unlocked

### New D1 Tables (Migration 0028)

**`chat_history`**
```sql
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
```

**`unlocked_modules`**
```sql
CREATE TABLE unlocked_modules (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES users(id),
  module_slug  TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  UNIQUE (child_id, module_slug)
);
CREATE INDEX idx_unlocked_modules_child ON unlocked_modules(child_id);
```

---

## Backend Changes

### `worker/src/types.ts`

Add `unlock_slug?: string` to `MentorResponse`:

```typescript
export interface MentorResponse {
  reply:        string
  pillar:       FinancialPillar
  data_points:  Record<string, string | number | boolean>
  app_view:     'ORCHARD' | 'CLEAN'
  locale:       Locale
  unlock_slug?: string  // present when this response triggered a module unlock
}
```

### `worker/src/routes/chat.ts`

**Keyword-Pillar Unlock Matrix** — deterministic, no LLM involvement:

```typescript
const UNLOCK_MATRIX: Array<{
  slug: string
  pillar: FinancialPillar
  keywords: RegExp
}> = [
  {
    slug:     'compound-interest',
    pillar:   'CAPITAL_MANAGEMENT',
    keywords: /interest|compound|snowball|grow|invest/,
  },
  // Phase 3 will add remaining 17 entries here
]

function detectUnlockSlug(
  message: string,
  pillar: FinancialPillar,
): string | null {
  const lower = message.toLowerCase()
  for (const entry of UNLOCK_MATRIX) {
    if (entry.pillar === pillar && entry.keywords.test(lower)) {
      return entry.slug
    }
  }
  return null
}
```

**Post-AI writes** (after AI reply is received):

```typescript
const unlockSlug = detectUnlockSlug(userMessage, pillar)
const historyId  = nanoid()
const now        = Math.floor(Date.now() / 1000)

const writes: Promise<unknown>[] = [
  env.DB.prepare(
    `INSERT INTO chat_history (id, child_id, message, reply, pillar, unlock_slug, app_view, locale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(historyId, auth.sub, userMessage, mentorReply, pillar,
         unlockSlug ?? null, intel.app_view, intel.locale, now).run(),
]

if (unlockSlug) {
  writes.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO unlocked_modules (id, child_id, module_slug, unlocked_at)
       VALUES (?, ?, ?, ?)`
    ).bind(nanoid(), auth.sub, unlockSlug, now).run()
  )
}

await Promise.all(writes)
```

**Response** includes `unlock_slug` when set:

```typescript
const response: MentorResponse = {
  reply, pillar, data_points, app_view: intel.app_view, locale: intel.locale,
  ...(unlockSlug ? { unlock_slug: unlockSlug } : {}),
}
return json(response)
```

### New Route: `GET /api/chat/history`

Query params: `limit` (integer, default 20, max 50), `offset` (integer, default 0).

Auth: child JWT required.

```typescript
export async function handleChatHistory(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth
  if (auth.role !== 'child') return json({ error: 'Child auth required' }, 403)

  const url    = new URL(request.url)
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  ?? '20', 10), 50)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0',  10), 0)

  const rows = await env.DB.prepare(
    `SELECT id, message, reply, pillar, unlock_slug, app_view, locale, created_at
     FROM chat_history
     WHERE child_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(auth.sub, limit, offset).all()

  return json({ history: rows.results, limit, offset })
}
```

### New Route: `GET /api/chat/modules`

Auth: child JWT required. Returns all unlocked module slugs for the child.

```typescript
export async function handleChatModules(request: Request, env: Env): Promise<Response> {
  const auth = (request as AuthedRequest).auth
  if (auth.role !== 'child') return json({ error: 'Child auth required' }, 403)

  const rows = await env.DB.prepare(
    `SELECT module_slug, unlocked_at FROM unlocked_modules WHERE child_id = ? ORDER BY unlocked_at ASC`
  ).bind(auth.sub).all()

  return json({ modules: rows.results })
}
```

### `worker/src/index.ts`

Mount two new routes (child-auth middleware applied):

```
GET  /api/chat/history  → handleChatHistory
GET  /api/chat/modules  → handleChatModules
```

---

## Frontend Changes

### New file: `app/src/components/dashboard/LabTab.tsx`

Self-contained component. Props:
```typescript
interface LabTabProps {
  childId:  string
  currency: string
  appView:  'ORCHARD' | 'CLEAN'
}
```

**State:**
- `history`: `ChatHistoryItem[]` (loaded from `/api/chat/history`)
- `unlockedSlugs`: `string[]` (loaded from `/api/chat/modules`)
- `loading`: `boolean` (true while either endpoint is pending)
- `error`: `string | null`
- `inputValue`: `string`
- `sending`: `boolean`
- `historyOffset`: `number` (for pagination)
- `hasMore`: `boolean`

**On mount** — fire both requests in parallel:
```typescript
const [histRes, modRes] = await Promise.all([
  fetch('/api/chat/history?limit=20&offset=0', { headers }),
  fetch('/api/chat/modules', { headers }),
])
```

**Loading state** — while `loading === true`, render:
- 3 pulsing skeleton cards (grey rounded rectangles, animate-pulse) in the History Feed area
- 1 pulsing skeleton card in the Module Grid area
- A small caption: `appView === 'ORCHARD' ? 'Consulting the Mentor...' : 'Loading your history...'`

**Error state** — if a fetch fails, show an inline message in the affected section only (the other section still renders). The tab does not go blank.

**Chat Input** — text input + "Send" button. On submit:
1. Set `sending = true`
2. POST to `/api/chat` with `{ message: inputValue }`
3. On success: prepend new exchange to `history`, clear input
4. If response includes `unlock_slug` not already in `unlockedSlugs`: add it to `unlockedSlugs` (no re-fetch needed — optimistic update)
5. Set `sending = false`

**History Feed** — renders `history` array as cards, newest first. Each card:
- Pillar badge (coloured pill: LABOR_VALUE=amber, DELAYED_GRATIFICATION=blue, OPPORTUNITY_COST=orange, CAPITAL_MANAGEMENT=green, SOCIAL_RESPONSIBILITY=purple)
- Reply text
- Small 🔓 icon if `unlock_slug` is set on that card
- User's original message shown above in a muted right-aligned bubble

"Load more" button below the list: increments `historyOffset` by 20, fetches next page, appends to `history`. Hidden when `hasMore === false`.

**Module Grid** — renders the known Phase 1+2 module catalogue (one entry, defined as a static constant in the component):

```typescript
interface ModuleDef {
  slug:         string
  title:        string
  description:  string
  triggerHint:  string
  content:      string
}

const MODULE_CATALOGUE: ModuleDef[] = [
  {
    slug:        'compound-interest',
    title:       'The Snowball',
    description: 'How money grows when you leave it alone.',
    triggerHint: 'Ask us about growing your money',
    content:     `When you save money and leave it alone, it starts to grow on its own. This is called compound interest. Imagine you plant a seed and instead of picking the fruit, you let it fall back into the ground. Next season, you have two trees. Then four. The longer you wait, the faster it grows. A £50 saving today, left untouched at 5% interest, becomes £81 in ten years — without a single extra chore. The secret is simply: wait.`,
  },
]
```

Locked card: greyscale filter, lock icon, `triggerHint` text in muted style.
Unlocked card: full brand colour, title + description, tappable → opens a bottom sheet (`<dialog>` element) with `content` text.

### `app/src/screens/ChildDashboard.tsx`

- Add `'lab'` to the `childTab` union type
- Add "Lab" tab button to the tab bar
- Add conditional render: `{childTab === 'lab' && <LabTab ... />}`
- Import `LabTab`

### `app/src/lib/api.ts`

Add typed interfaces and fetch helpers:

```typescript
export interface ChatHistoryItem {
  id:           string
  message:      string
  reply:        string
  pillar:       string
  unlock_slug:  string | null
  app_view:     'ORCHARD' | 'CLEAN'
  locale:       string
  created_at:   number
}

export interface ChatHistoryResponse {
  history: ChatHistoryItem[]
  limit:   number
  offset:  number
}

export interface ChatModuleItem {
  module_slug:  string
  unlocked_at:  number
}

export interface ChatModulesResponse {
  modules: ChatModuleItem[]
}

// MentorResponse matches worker/src/types.ts — duplicated here for frontend use
export interface MentorResponse {
  reply:        string
  pillar:       string
  data_points:  Record<string, string | number | boolean>
  app_view:     'ORCHARD' | 'CLEAN'
  locale:       string
  unlock_slug?: string
}

// Wraps existing POST /api/chat with auth header
export async function postChat(message: string): Promise<MentorResponse> {
  const res = await fetch('/api/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body:    JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error('Chat request failed')
  return res.json()
}

export async function getChatHistory(limit = 20, offset = 0): Promise<ChatHistoryResponse> {
  const res = await fetch(`/api/chat/history?limit=${limit}&offset=${offset}`, {
    headers: getAuthHeader(),
  })
  if (!res.ok) throw new Error('History fetch failed')
  return res.json()
}

export async function getChatModules(): Promise<ChatModulesResponse> {
  const res = await fetch('/api/chat/modules', { headers: getAuthHeader() })
  if (!res.ok) throw new Error('Modules fetch failed')
  return res.json()
}
```

`getAuthHeader()` is the existing helper already used throughout `api.ts`.

---

## The "Snowball" Unlock — End-to-End Test Scenario

1. Child opens Lab tab → sees 1 locked module card ("The Snowball"), no history
2. Child types: "how does my money grow?"
3. `selectPillar()` returns `CAPITAL_MANAGEMENT` (keyword: "grow")
4. `detectUnlockSlug()` matches: pillar=`CAPITAL_MANAGEMENT` + keyword "grow" → `compound-interest`
5. Worker writes to `chat_history` and `unlocked_modules`
6. Response returns `unlock_slug: 'compound-interest'`
7. Frontend adds slug to `unlockedSlugs` (optimistic)
8. Module Grid re-renders: "The Snowball" card flips to full colour
9. Child taps card → bottom sheet opens with content text

This is the acceptance test for Phase 1+2 completion.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `worker/migrations/0028_learning_lab.sql` | `chat_history` + `unlocked_modules` tables |
| Modify | `worker/src/types.ts` | Add `unlock_slug?` to `MentorResponse` |
| Modify | `worker/src/routes/chat.ts` | Unlock matrix, D1 history write, unlock write |
| Create | `worker/src/routes/chat-history.ts` | `handleChatHistory` route |
| Create | `worker/src/routes/chat-modules.ts` | `handleChatModules` route |
| Modify | `worker/src/index.ts` | Mount two new GET routes |
| Modify | `app/src/lib/api.ts` | `getChatHistory`, `getChatModules`, `postChat` helpers |
| Create | `app/src/components/dashboard/LabTab.tsx` | Full Lab tab component |
| Modify | `app/src/screens/ChildDashboard.tsx` | Add `'lab'` tab, render `<LabTab>` |

---

## Constraints

- No metaphors in UI strings (nav labels, button text, error messages) — metaphors are for coaching copy only
- Emojis: ORCHARD mode only, max 1, nature icons only (🌱 🍎 🌳)
- The "We" rule applies in all AI-generated text; frontend copy is neutral
- `unlocked_modules` write is INSERT OR IGNORE — idempotent, no error if already unlocked
- History is append-only — no delete or edit
- The Module Grid in Phase 1+2 renders ONLY the one seeded module; no placeholder locked cards for future modules (YAGNI)
- Loading skeletons are required — the tab must never appear broken during the ~500ms fetch window
