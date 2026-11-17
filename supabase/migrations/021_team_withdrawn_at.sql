-- When a team/player leaves or is withdrawn
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
