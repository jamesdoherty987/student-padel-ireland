-- Championship + Plate knockout settings for group → dual-bracket events
alter table tournaments
  add column if not exists enable_plate boolean not null default false;

alter table tournaments
  add column if not exists championship_size integer not null default 16;

alter table tournaments
  add column if not exists plate_size integer not null default 16;
