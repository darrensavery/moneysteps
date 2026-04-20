-- worker/migrations/0029_market_rates.sql
-- Market rates: 30 canonical chores with UK industry medians.
-- US and PL columns are NULL (Pioneer Phase) until community data arrives.

CREATE TABLE market_rates (
  id              TEXT    PRIMARY KEY,
  canonical_name  TEXT    NOT NULL UNIQUE,
  category        TEXT    NOT NULL,
  synonyms        TEXT    NOT NULL DEFAULT '[]',
  uk_median_pence INTEGER,
  us_median_cents INTEGER,
  pl_median_grosz INTEGER,
  data_source     TEXT    NOT NULL DEFAULT 'industry_seed'
                  CHECK(data_source IN ('industry_seed', 'community_median')),
  sample_count    INTEGER NOT NULL DEFAULT 0,
  is_orchard_8    INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 99,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

ALTER TABLE families ADD COLUMN fast_track_enabled INTEGER NOT NULL DEFAULT 0;

-- ── Seed: Official Orchard 8 (is_orchard_8 = 1) ─────────────────────────────
INSERT INTO market_rates (id,canonical_name,category,synonyms,uk_median_pence,is_orchard_8,sort_order,created_at,updated_at) VALUES
  ('mr_01','Tidying Room','Tidying','["Clean room","Pick up toys","Organize room","sprzątanie pokoju"]',112,1,1,unixepoch(),unixepoch()),
  ('mr_02','Dishwashing','Kitchen','["Unload dishwasher","Empty dishwasher","Dishes","zmywanie"]',80,1,2,unixepoch(),unixepoch()),
  ('mr_03','Vacuuming','Cleaning','["Hoovering","Sweeping","odkurzanie"]',120,1,3,unixepoch(),unixepoch()),
  ('mr_04','Taking Out Bins','Errands','["Trash","Garbage","Recycling","wynoszenie śmieci"]',60,1,4,unixepoch(),unixepoch()),
  ('mr_05','Walking Dog','Pets','["Dog exercise","Pet walk","spacer z psem"]',200,1,5,unixepoch(),unixepoch()),
  ('mr_06','Washing Car','Outdoor Work','["Clean car","Auto wash","Wash the van","mycie auta"]',333,1,6,unixepoch(),unixepoch()),
  ('mr_07','Homework/Reading','Learning & Skills','["Study","Book time","Violin practice","Maths","zadanie domowe"]',135,1,7,unixepoch(),unixepoch()),
  ('mr_08','Making Bed','Tidying','["Straightening bed","Changing sheets","ścielenie łóżka"]',115,1,8,unixepoch(),unixepoch());

-- ── Seed: Remaining 22 ───────────────────────────────────────────────────────
INSERT INTO market_rates (id,canonical_name,category,synonyms,uk_median_pence,is_orchard_8,sort_order,created_at,updated_at) VALUES
  ('mr_09','Mowing Lawn','Outdoor Work','["Cut grass","Mow grass","Lawn care","koszenie trawy"]',368,0,9,unixepoch(),unixepoch()),
  ('mr_10','Mopping','Cleaning','["Cleaning floors","Washing floors","mycie podłóg"]',140,0,10,unixepoch(),unixepoch()),
  ('mr_11','Cleaning Windows','Cleaning','["Washing windows","Glass cleaning","mycie okien"]',154,0,11,unixepoch(),unixepoch()),
  ('mr_12','Cleaning Bathroom','Cleaning','["Scrubbing toilet","Cleaning shower","mycie łazienki"]',210,0,12,unixepoch(),unixepoch()),
  ('mr_13','Cooking Dinner','Kitchen','["Making a meal","Prepping dinner","gotowanie obiadu"]',300,0,13,unixepoch(),unixepoch()),
  ('mr_14','Setting Table','Kitchen','["Laying table","Clearing table","nakrywanie do stołu"]',70,0,14,unixepoch(),unixepoch()),
  ('mr_15','Cleaning Fridge','Kitchen','["Emptying fridge","Wiping shelves","mycie lodówki"]',250,0,15,unixepoch(),unixepoch()),
  ('mr_16','Folding Clothes','Laundry','["Sorting laundry","Putting wash away","składanie ubrań"]',100,0,16,unixepoch(),unixepoch()),
  ('mr_17','Ironing','Laundry','["Pressing clothes","Laundry prep","prasowanie"]',200,0,17,unixepoch(),unixepoch()),
  ('mr_18','Loading Wash','Laundry','["Starting washing machine","Laundry load","pranie"]',90,0,18,unixepoch(),unixepoch()),
  ('mr_19','Watering Plants','Garden','["Feeding plants","Watering garden","podlewanie kwiatów"]',191,0,19,unixepoch(),unixepoch()),
  ('mr_20','Weeding','Garden','["Pulling weeds","Garden clearing","pielenie"]',166,0,20,unixepoch(),unixepoch()),
  ('mr_21','Raking Leaves','Garden','["Sweeping leaves","Garden tidy","grabienie liści"]',150,0,21,unixepoch(),unixepoch()),
  ('mr_22','Feeding Pets','Pets','["Pet food","Water bowls","karmienie zwierzaka"]',50,0,22,unixepoch(),unixepoch()),
  ('mr_23','Cleaning Cage','Pets','["Litter box","Hutch cleaning","sprzątanie klatki"]',250,0,23,unixepoch(),unixepoch()),
  ('mr_24','Grocery Shop','Errands','["Running to shop","Buying milk","zakupy"]',150,0,24,unixepoch(),unixepoch()),
  ('mr_25','Painting/DIY','Outdoor Work','["Painting fence","Sanding","Minor repairs","malowanie"]',500,0,25,unixepoch(),unixepoch()),
  ('mr_26','Babysitting','Outdoor Work','["Watching siblings","Child care","opieka nad rodzeństwem"]',1866,0,26,unixepoch(),unixepoch()),
  ('mr_27','Brushing Teeth','Good Habits','["Morning routine","Night routine","mycie zębów"]',20,0,27,unixepoch(),unixepoch()),
  ('mr_28','Getting Dressed','Good Habits','["Ready for school","School uniform","ubieranie się"]',50,0,28,unixepoch(),unixepoch()),
  ('mr_29','Good Behavior','Good Habits','["Being helpful","Listening","dobre zachowanie"]',200,0,29,unixepoch(),unixepoch()),
  ('mr_30','Reading','Learning & Skills','["Daily reading","Book log","czytanie"]',100,0,30,unixepoch(),unixepoch());
