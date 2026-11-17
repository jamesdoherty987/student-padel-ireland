-- Organiser-controlled reminder emails (auto on/off + optional custom copy).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS reminder_subject VARCHAR(120);

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS reminder_body TEXT;
