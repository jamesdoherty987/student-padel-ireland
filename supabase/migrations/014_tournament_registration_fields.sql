-- Custom signup questions (jersey size, etc.) defined per tournament
create table if not exists public.tournament_registration_fields (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  key varchar(80) not null,
  label varchar(200) not null,
  field_type varchar(20) not null default 'text',
  options_json text not null default '[]',
  required boolean not null default false,
  scope varchar(20) not null default 'player',
  sort_order integer not null default 0,
  constraint uq_tournament_registration_field_key unique (tournament_id, key)
);

create index if not exists ix_tournament_registration_fields_tournament_id
  on public.tournament_registration_fields (tournament_id);

create table if not exists public.tournament_registration_answers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  field_id uuid not null references public.tournament_registration_fields (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  team_player_id uuid references public.team_players (id) on delete cascade,
  value varchar(500) not null default ''
);

create index if not exists ix_tournament_registration_answers_field_id
  on public.tournament_registration_answers (field_id);
create index if not exists ix_tournament_registration_answers_registration_id
  on public.tournament_registration_answers (registration_id);
create index if not exists ix_tournament_registration_answers_team_player_id
  on public.tournament_registration_answers (team_player_id);
