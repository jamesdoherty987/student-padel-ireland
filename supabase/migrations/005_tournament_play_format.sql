-- Singles or doubles entry for official tournaments
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS play_format VARCHAR(20) NOT NULL DEFAULT 'DOUBLES';
