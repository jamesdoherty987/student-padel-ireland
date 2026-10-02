-- Co-organisers / tournament-scoped admins
create table if not exists tournament_admins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id uuid not null references users(id),
  role varchar(20) not null default 'MANAGER',
  added_by_id uuid references users(id),
  unique (tournament_id, user_id)
);

create index if not exists idx_tournament_admins_tournament on tournament_admins(tournament_id);
create index if not exists idx_tournament_admins_user on tournament_admins(user_id);
