-- Tournament invite codes (join via code / QR, same idea as community competitions)

alter table tournaments add column if not exists invite_code varchar(12);

create unique index if not exists idx_tournaments_invite_code on tournaments(invite_code)
  where invite_code is not null;
