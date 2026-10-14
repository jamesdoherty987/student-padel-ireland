-- Allow organisers to collect entry fees in person instead of online checkout
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS pay_on_arrival BOOLEAN NOT NULL DEFAULT FALSE;
