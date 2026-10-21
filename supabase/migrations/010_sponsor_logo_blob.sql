-- Persist sponsor logo bytes in Postgres (survives ephemeral app disks).
alter table public.sponsors
  add column if not exists logo_content_type varchar(100);

alter table public.sponsors
  add column if not exists logo_data bytea;
