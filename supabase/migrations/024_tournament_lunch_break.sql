-- Optional lunch break used when generating the draw schedule.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS lunch_break_start TIME;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS lunch_break_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tournaments.lunch_break_start IS
  'Local Ireland time when lunch starts (event day). Null = no lunch gap on generate.';
COMMENT ON COLUMN tournaments.lunch_break_minutes IS
  'Length of lunch break in minutes. 0 = disabled.';
