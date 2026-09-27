-- Placeholder partner accounts can claim a password on signup.
alter table users add column if not exists must_set_password boolean default false;
