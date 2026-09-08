-- Persist a chore's chosen category icon instead of re-guessing it from the
-- title text on every render. Values are market_rates.category strings (or
-- 'General' for chores that don't fit a category) — nullable so existing
-- chores keep falling back to the keyword-based guess in the app.
ALTER TABLE chores ADD COLUMN icon_key TEXT;
