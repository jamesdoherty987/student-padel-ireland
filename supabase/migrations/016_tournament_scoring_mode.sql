-- Simple winner+optional points vs classic best-of-3 sets.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS scoring_mode VARCHAR(20) NOT NULL DEFAULT 'SIMPLE';

COMMENT ON COLUMN tournaments.scoring_mode IS 'SIMPLE = winner + optional points; BEST_OF_3 = set scoring';
