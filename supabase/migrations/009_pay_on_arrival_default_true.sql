-- New tournaments default to collecting fees at the venue (optional pay-online still available)
ALTER TABLE tournaments
  ALTER COLUMN pay_on_arrival SET DEFAULT TRUE;
