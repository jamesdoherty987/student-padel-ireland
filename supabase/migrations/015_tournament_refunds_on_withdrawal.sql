-- Organiser/admin switch: whether leave/withdraw copy offers a refund path
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS refunds_on_withdrawal BOOLEAN NOT NULL DEFAULT TRUE;
