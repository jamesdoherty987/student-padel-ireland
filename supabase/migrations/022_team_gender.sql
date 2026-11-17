-- Organiser-set team gender for group draw placement (M / F / X)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS gender VARCHAR(1);
