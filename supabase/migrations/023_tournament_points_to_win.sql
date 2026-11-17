-- Target score for SIMPLE (first-to-N) scoring. Unused for BEST_OF_3.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS points_to_win INTEGER NOT NULL DEFAULT 21;

COMMENT ON COLUMN tournaments.points_to_win IS
  'SIMPLE mode: first team to this many points wins (win by 2 at N-1). Default 21.';
