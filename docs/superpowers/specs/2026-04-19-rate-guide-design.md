# Rate Guide — Design Spec
**Date:** 2026-04-19
**Feature:** Market Rate Guide (Chore Benchmarking)
**Status:** Approved for implementation

---

## Overview

The Rate Guide gives parents a data-backed benchmark when pricing chores, and gives children an Orchard-framed "opportunities" view that lets them suggest chores to their parent. The feature is powered by a seeded D1 table of 30 canonical chores with UK industry medians. US and PL medians start NULL (Pioneer Phase) and are filled by community aggregation over time.

---

## 1. Data Layer

### Migration: `0028_market_rates.sql`

```sql
CREATE TABLE market_rates (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL UNIQUE,
  category        TEXT NOT NULL,
  synonyms        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  uk_median_pence INTEGER,                      -- NULL = Pioneer Phase
  us_median_cents INTEGER,                      -- NULL = Pioneer Phase
  pl_median_grosz INTEGER,                      -- NULL = Pioneer Phase
  data_source     TEXT NOT NULL DEFAULT 'industry_seed'
                  CHECK(data_source IN ('industry_seed', 'community_median')),
  sample_count    INTEGER NOT NULL DEFAULT 0,
  is_orchard_8    INTEGER NOT NULL DEFAULT 0,   -- 1 = primary tile grid
  sort_order      INTEGER NOT NULL DEFAULT 99,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

### `families` table addition

```sql
ALTER TABLE families ADD COLUMN fast_track_enabled INTEGER NOT NULL DEFAULT 0;
```

### Category names (final set)

| Category | Description |
|----------|-------------|
| Outdoor Work | Mowing, washing car, painting/DIY |
| Cleaning | Vacuuming, mopping, windows, bathroom |
| Kitchen | Dishwashing, cooking, setting table, fridge |
| Laundry | Folding, ironing, loading wash |
| Tidying | Bedroom tidy, making bed |
| Garden | Watering, weeding, raking |
| Pets | Walking dog, feeding, cage cleaning |
| Errands | Bins, grocery shop |
| Learning & Skills | Homework, reading (includes music practice, coding, etc.) |
| Good Habits | Brushing teeth, getting dressed, good behavior |

### Value Tiers (derived at query time)

| Tier key | Child label | Range (GBP equivalent) |
|----------|-------------|------------------------|
| `seeds` | Small Seeds | £0 – £1.49 |
| `saplings` | Growing Saplings | £1.50 – £3.99 |
| `oaks` | Great Oaks | £4.00+ |
| `discoverable` | Discoverable | both locale and UK median are NULL |

Tier is computed from the locale column. If the locale column is NULL, the UK median is used as a proxy with a mental multiplier applied:
- PLN proxy: `uk_median_pence × 5`
- USD proxy: `uk_median_pence × 1.27`

`median_is_local: false` is set on the response row when a proxy is used.

### Seed Data — The Official Orchard 8 (`is_orchard_8 = 1`, `sort_order` 1–8)

| sort_order | canonical_name | category | uk_median_pence | synonyms |
|-----------|---------------|----------|----------------|---------|
| 1 | Tidying Room | Tidying | 112 | ["Clean room", "Pick up toys", "Organize room", "sprzątanie pokoju"] |
| 2 | Dishwashing | Kitchen | 80 | ["Unload dishwasher", "Empty dishwasher", "Dishes", "zmywanie"] |
| 3 | Vacuuming | Cleaning | 120 | ["Hoovering", "Sweeping", "odkurzanie"] |
| 4 | Taking Out Bins | Errands | 60 | ["Trash", "Garbage", "Recycling", "wynoszenie śmieci"] |
| 5 | Walking Dog | Pets | 200 | ["Dog exercise", "Pet walk", "spacer z psem"] |
| 6 | Washing Car | Outdoor Work | 333 | ["Clean car", "Auto wash", "Wash the van", "mycie auta"] |
| 7 | Homework/Reading | Learning & Skills | 135 | ["Study", "Book time", "Violin practice", "Maths", "zadanie domowe"] |
| 8 | Making Bed | Tidying | 115 | ["Straightening bed", "Changing sheets", "ścielenie łóżka"] |

### Seed Data — Remaining 22 (`is_orchard_8 = 0`, `sort_order` 9–30)

| sort_order | canonical_name | category | uk_median_pence |
|-----------|---------------|----------|----------------|
| 9 | Mowing Lawn | Outdoor Work | 368 |
| 10 | Mopping | Cleaning | 140 |
| 11 | Cleaning Windows | Cleaning | 154 |
| 12 | Cleaning Bathroom | Cleaning | 210 |
| 13 | Cooking Dinner | Kitchen | 300 |
| 14 | Setting Table | Kitchen | 70 |
| 15 | Cleaning Fridge | Kitchen | 250 |
| 16 | Folding Clothes | Laundry | 100 |
| 17 | Ironing | Laundry | 200 |
| 18 | Loading Wash | Laundry | 90 |
| 19 | Watering Plants | Garden | 191 |
| 20 | Weeding | Garden | 166 |
| 21 | Raking Leaves | Garden | 150 |
| 22 | Feeding Pets | Pets | 50 |
| 23 | Cleaning Cage | Pets | 250 |
| 24 | Grocery Shop | Errands | 150 |
| 25 | Painting/DIY | Outdoor Work | 500 |
| 26 | Babysitting | Outdoor Work | 1866 |
| 27 | Brushing Teeth | Good Habits | 20 |
| 28 | Getting Dressed | Good Habits | 50 |
| 29 | Good Behavior | Good Habits | 200 |
| 30 | Reading | Learning & Skills | 100 |

US and PL median columns are NULL for all 30 rows in the seed.

---

## 2. API Layer

### GET `/api/market-rates`

Auth required. Role-aware response (same data, metadata enables frontend differentiation).

**Query params:**
- `locale` — `en-GB` | `en-US` | `pl` (falls back to user's registered locale)

**Response:**
```json
{
  "tile_source": "hardcoded_defaults",
  "rates": [
    {
      "id": "abc123",
      "canonical_name": "Tidying Room",
      "category": "Tidying",
      "synonyms": ["Clean room", "Pick up toys", "Organize room"],
      "median_amount": 112,
      "median_is_local": true,
      "value_tier": "seeds",
      "value_tier_label": "Small Seeds",
      "is_orchard_8": true,
      "sort_order": 1,
      "data_source": "industry_seed",
      "sample_count": 0
    }
  ]
}
```

**`tile_source` values:**
- `"hardcoded_defaults"` — Phase 1 (now)
- `"locale_frequent"` — Phase 2 (once locale hits Pioneer threshold)
- `"user_frequent"` — Phase 3 (after 4 weeks of family history)

Frontend uses `tile_source` to decide tile grid rendering mode without a refactor.

**`median_amount` field:**
- Currency-neutral (works for pence, cents, groszy)
- When locale column is NULL: proxy value is returned with mental multiplier applied
- Frontend formats using the locale's currency symbol

**`median_is_local` field:**
- `true` — locale column had a real value
- `false` — UK proxy used; child UI shows Pioneer badge + Mentor note

### POST `/api/market-rates/suggest`

Child role only. Creates a suggestion row and fires parent notification.

**Request:**
```json
{
  "canonical_name": "Mowing Lawn",
  "median_amount": 368,
  "currency": "GBP",
  "context": "module:01-effort-vs-reward"
}
```

- `context` is optional. Format: `"module:<slug>"` or `null`.
- Reuses existing `suggestions` table. No schema change needed: `context` is stored in the existing `reason` column (e.g. `"module:01-effort-vs-reward"`). The worker reads it back to construct the parent notification copy.
- Returns `{ "status": "sent" }` — frontend transitions to success state immediately.

### GET `/api/market-rates/cron`

Worker-only (no user auth). CRON skeleton endpoint.

Runs `SELECT COUNT(*) as total FROM market_rates`, logs the count, returns:
```json
{ "status": "ok", "row_count": 30, "message": "aggregation not yet implemented" }
```

Verifies D1 read access from day one.

### `wrangler.toml` CRON trigger

```toml
[[triggers.crons]]
crons = ["0 3 * * 1"]  # Monday 03:00 UTC
```

Handled in the existing `scheduled` export in `worker/src/index.ts`. Calls `runMarketRateAggregation(env)` from `worker/src/jobs/marketRateAggregation.ts` (stub).

---

## 3. Frontend Components

### New files

| File | Purpose |
|------|---------|
| `app/src/hooks/useMarketRates.ts` | Shared hook — fetches `/api/market-rates` once per session (sessionStorage cache). Consumed by CreateChoreSheet, RateGuideSheet, ChoreGuideSheet. |
| `app/src/components/dashboard/RateGuideSheet.tsx` | Parent-facing browsable rate table |
| `app/src/components/dashboard/ChoreGuideSheet.tsx` | Child-facing "Chore Guide" with tier grouping and Suggest Chore |
| `worker/src/jobs/marketRateAggregation.ts` | CRON stub |

### Modified files

| File | Change |
|------|--------|
| `app/src/components/dashboard/CreateChoreSheet.tsx` | Replace title input with tile grid + search + suggestion list |
| `app/src/components/dashboard/JobsTab.tsx` | Add "Check Going Rates" button; update suggestion banner for Fast-Track |
| `app/src/components/dashboard/EarnTab.tsx` | Add "Chore Guide" button |
| `app/src/lib/api.ts` | Add `getMarketRates()`, `suggestChore()` functions |
| `worker/src/routes/chores.ts` | No structural change — suggestion reuses existing flow |
| `worker/src/index.ts` | Wire CRON handler |
| `wrangler.toml` | Add CRON trigger |

### `CreateChoreSheet.tsx` — chore picker redesign

Three-layer layout replaces the plain title input:

```
┌─────────────────────────────────────────┐
│  TILE GRID (2 rows × 4 tiles)           │
│  [Tidy Room] [Dishes] [Vacuum] [Bins]   │
│  [Walk Dog] [Wash Car] [Homework] [Bed] │
├─────────────────────────────────────────┤
│  [ 🔍 Search or enter a chore title ] ] │
├─────────────────────────────────────────┤
│  More Suggestions (shown on focus)      │
│  🌱 Mowing Lawn          £3.68          │
│  🌱 Cooking Dinner       £3.00          │
│  🌱 Cleaning Bathroom    £2.10          │
│  ...                                    │
└─────────────────────────────────────────┘
```

**Tile grid:**
- Accepts `tile_source` prop (`"hardcoded_defaults"` | `"locale_frequent"` | `"user_frequent"`)
- Phase 1: renders the Official Orchard 8 from the `useMarketRates` response (`is_orchard_8 = true`)
- Each tile shows an emoji icon + short label
- Selecting a tile fills `title` and `reward_amount`; reward field gets Spark animation

**Search input:**
- On focus (empty): shows "More Suggestions" vertical list (remaining 22 canonical chores)
- On type: real-time fuzzy filter — case-insensitive substring match against `canonical_name` + `synonyms`
- Canonical matches show `🌱` sprout badge
- No match: user continues with free-text; no rate pre-fill

**Spark animation (reward field):**
- On auto-fill: field gets `ring-2 ring-[--brand-primary]` + a soft green glow fade (CSS keyframe, ~800ms)
- Clears on first manual keystroke
- Signals to parent: "the Truth Engine set this"

### `RateGuideSheet.tsx` — parent view

- Triggered by "Check Going Rates" button at top of JobsTab (above active chores list)
- Bottom sheet, full height
- Category filter pills (horizontal scroll): All | Outdoor Work | Cleaning | Kitchen | Laundry | Tidying | Garden | Pets | Errands | Learning & Skills | Good Habits
- Searchable table: Chore Name | Category | UK Rate
- Pioneer badge on rows where `median_is_local: false`
- No value tier grouping — flat utility view

### `ChoreGuideSheet.tsx` — child view

- Triggered by "Chore Guide" button at top of EarnTab
- Renamed "Chore Guide" (not "Rate Guide") in all child-facing copy
- Grouped by value tier in order: Great Oaks → Growing Saplings → Small Seeds
- Each row: canonical name + formatted rate + "Suggest Chore" button
- Pioneer rows: `median_is_local: false` → shows Mentor note: *"We're still learning what this is worth in [region] — you could be the first!"*

**Suggest Chore flow:**
1. Child taps "Suggest Chore" on a row
2. POST `/api/market-rates/suggest` fires
3. Sheet transitions to success state (not closed):
   - Orchard Mentor voice: *"Proposal sent! Your parent will see that you're ready to grow some Great Oaks."*
   - Single "Done" button to dismiss
4. Prevents re-tap spam (button disabled after first tap)

**Module context:**
- When child navigates to ChoreGuideSheet from within a Learning Lab module, `context` is passed as `"module:<slug>"`
- When browsing directly, `context` is `null`

### `JobsTab.tsx` — suggestion banner updates

**Without module context:**
> "[Child] wants to earn £3.68 by Mowing Lawn."
> [View] [Decline]

**With module context:**
> "[Child] just finished a lesson on Effort & Reward and wants to put it into practice! They'd like to try Mowing Lawn for £3.68."
> [🌱 Accept] [Decline]

Module-linked Accept button: brand-teal border + `🌱` seed icon (distinguishes from standard View).

**Fast-Track disabled (default):**
- Accept / View → opens `CreateChoreSheet` pre-filled with canonical name + median amount (editable)
- Post-save toast: *"That was easy! Want to skip this step next time? [Enable Fast-Track] to approve 'Going Rate' suggestions in one tap."*
- Enabling Fast-Track sets `fast_track_enabled = 1` on the `families` row

**Fast-Track enabled:**
- Suggestion banner shows **Approve** (one-tap → creates chore directly, no sheet) + **Edit** (small text link → opens sheet)
- Approve creates chore with canonical name, median amount, currency, assigned to the suggesting child

---

## 4. Phased Personalisation (`tile_source`)

| Phase | `tile_source` value | Trigger |
|-------|-------------------|---------|
| 1 | `hardcoded_defaults` | Always (now) |
| 2 | `locale_frequent` | Locale Pioneer threshold reached (TBD, e.g. 50+ community entries for locale) |
| 3 | `user_frequent` | Family has ≥4 weeks of chore history |

The tile grid component in `CreateChoreSheet` accepts `tile_source` as a prop. `RateGuideSheet` and `ChoreGuideSheet` always show all 30 canonical chores regardless of phase. No refactor needed to switch phases — the API controls the value, the UI renders accordingly.

---

## 5. Out of Scope (This Phase)

- AI Canonical Mapper (batch LLM grouping of free-text chores)
- Live FX rates (mental multipliers are sufficient proxies)
- US or PL seed data (columns exist, values remain NULL)
- Community aggregation logic in the CRON job
- Settings page toggle for Fast-Track (handled via contextual toast)

---

## 6. Roadmap Update

Add to Phase 5 in CLAUDE.md:

```
- [ ] Rate Guide — market rate benchmarking for chores
  - [x] Design spec (2026-04-19)
  - [ ] D1 migration + 30-row seed
  - [ ] GET /api/market-rates + suggest endpoint + CRON skeleton
  - [ ] CreateChoreSheet tile grid + fuzzy search redesign
  - [ ] RateGuideSheet (parent) + ChoreGuideSheet (child)
  - [ ] Fast-Track suggestion flow
```
