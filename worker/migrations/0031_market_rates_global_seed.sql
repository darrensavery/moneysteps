-- Migration 0031: Market Rates — global seed values (UK + US + PL)
-- Updates existing rows with community-validated medians across all three
-- locales. Inserts two new rows (Dusting, Hanging Wash) not in the original seed.
-- All amounts are in minor units: GBP pence, USD cents, PLN groszy.

-- ── Update existing Orchard 8 rows ──────────────────────────────────────────

UPDATE market_rates SET
  category        = 'Tidying',
  synonyms        = '["bedroom clean","pick up toys","tidy up","sprzątanie pokoju"]',
  uk_median_pence = 110,
  us_median_cents = 150,
  pl_median_grosz = 1000,
  updated_at      = unixepoch()
WHERE id = 'mr_01'; -- Tidying Room

UPDATE market_rates SET
  category        = 'Kitchen',
  synonyms        = '["loading dishwasher","dishes","washing up","zmywanie","zmywarka"]',
  uk_median_pence = 80,
  us_median_cents = 115,
  pl_median_grosz = 500,
  updated_at      = unixepoch()
WHERE id = 'mr_02'; -- Dishwashing

UPDATE market_rates SET
  category        = 'Cleaning',
  synonyms        = '["hoovering","sweeping","cleaning floors","odkurzanie"]',
  uk_median_pence = 120,
  us_median_cents = 175,
  pl_median_grosz = 1000,
  updated_at      = unixepoch()
WHERE id = 'mr_03'; -- Vacuuming

UPDATE market_rates SET
  category        = 'Bins',
  synonyms        = '["trash","garbage","recycling","emptying bins","wynoszenie śmieci"]',
  uk_median_pence = 60,
  us_median_cents = 90,
  pl_median_grosz = 200,
  updated_at      = unixepoch()
WHERE id = 'mr_04'; -- Taking Out Bins

UPDATE market_rates SET
  category        = 'Pets',
  synonyms        = '["walking dog","pet exercise","wyprowadzanie psa","spacer z psem"]',
  uk_median_pence = 200,
  us_median_cents = 275,
  pl_median_grosz = 1500,
  updated_at      = unixepoch()
WHERE id = 'mr_05'; -- Walking Dog

UPDATE market_rates SET
  category        = 'Vehicle',
  synonyms        = '["valeting","car wash","washing van","mycie auta","mycie samochodu"]',
  uk_median_pence = 330,
  us_median_cents = 450,
  pl_median_grosz = 3000,
  updated_at      = unixepoch()
WHERE id = 'mr_06'; -- Washing Car

UPDATE market_rates SET
  category        = 'Tidying',
  synonyms        = '["straighten bed","change sheets","tidy bed","ścielenie łóżka"]',
  uk_median_pence = 115,
  us_median_cents = 150,
  pl_median_grosz = 200,
  updated_at      = unixepoch()
WHERE id = 'mr_08'; -- Making Bed

-- ── Update non-Orchard-8 rows ────────────────────────────────────────────────

UPDATE market_rates SET
  category        = 'Outdoor',
  synonyms        = '["cutting grass","lawn work","garden trim","koszenie trawy"]',
  uk_median_pence = 370,
  us_median_cents = 500,
  pl_median_grosz = 4500,
  updated_at      = unixepoch()
WHERE id = 'mr_09'; -- Mowing Lawn

UPDATE market_rates SET
  category        = 'Kitchen',
  synonyms        = '["laying table","dinner prep","clearing table","nakrywanie do stołu"]',
  uk_median_pence = 70,
  us_median_cents = 100,
  pl_median_grosz = 300,
  updated_at      = unixepoch()
WHERE id = 'mr_14'; -- Setting Table

UPDATE market_rates SET
  category        = 'Laundry',
  synonyms        = '["folding laundry","sorting socks","składanie ubrań","składanie prania"]',
  uk_median_pence = 100,
  us_median_cents = 140,
  pl_median_grosz = 1000,
  updated_at      = unixepoch()
WHERE id = 'mr_16'; -- Folding Clothes

UPDATE market_rates SET
  category        = 'Gardening',
  synonyms        = '["feeding plants","garden watering","podlewanie kwiatów","podlewanie ogrodu"]',
  uk_median_pence = 170,
  us_median_cents = 225,
  pl_median_grosz = 500,
  updated_at      = unixepoch()
WHERE id = 'mr_19'; -- Watering Plants

UPDATE market_rates SET
  category        = 'Gardening',
  synonyms        = '["pulling weeds","garden clearing","weeding beds","pielenie"]',
  uk_median_pence = 160,
  us_median_cents = 215,
  pl_median_grosz = 1500,
  updated_at      = unixepoch()
WHERE id = 'mr_20'; -- Weeding

UPDATE market_rates SET
  category        = 'Pets',
  synonyms        = '["feeding dog","feeding cat","feeding fish","pet food","karmienie zwierzaka"]',
  uk_median_pence = 50,
  us_median_cents = 75,
  pl_median_grosz = 200,
  updated_at      = unixepoch()
WHERE id = 'mr_22'; -- Feeding Pets

-- ── Insert new rows not in original seed ────────────────────────────────────

INSERT OR IGNORE INTO market_rates
  (id, canonical_name, category, synonyms,
   uk_median_pence, us_median_cents, pl_median_grosz,
   data_source, sample_count, is_orchard_8, sort_order,
   created_at, updated_at)
VALUES
  ('mr_31', 'Dusting', 'Household',
   '["polishing","wiping surfaces","ścieranie kurzy"]',
   110, 150, 700,
   'industry_seed', 0, 0, 31,
   unixepoch(), unixepoch()),

  ('mr_32', 'Hanging Wash', 'Laundry',
   '["laundry","drying clothes","putting washing out","wieszanie prania"]',
   90, 125, 500,
   'industry_seed', 0, 0, 32,
   unixepoch(), unixepoch());
