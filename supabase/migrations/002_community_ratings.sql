-- Community: friends, private competitions, Elo history for casual matches

alter table matches add column if not exists ratings_applied boolean default false;

alter table ranking_history alter column tournament_id drop not null;
alter table ranking_history add column if not exists community_match_id uuid;

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users(id),
  addressee_id uuid not null references users(id),
  status varchar(20) not null default 'PENDING',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (requester_id, addressee_id)
);

create table if not exists community_competitions (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  slug varchar(120) not null unique,
  description text,
  format varchar(20) not null default 'DOUBLES',
  status varchar(20) not null default 'OPEN',
  invite_code varchar(12) not null unique,
  created_by_id uuid not null references users(id),
  max_players int default 16,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists competition_members (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references community_competitions(id) on delete cascade,
  user_id uuid not null references users(id),
  role varchar(20) not null default 'PLAYER',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (competition_id, user_id)
);

create table if not exists community_matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references community_competitions(id) on delete cascade,
  format varchar(20) not null default 'DOUBLES',
  status varchar(20) not null default 'SCHEDULED',
  player_a1_id uuid not null references users(id),
  player_a2_id uuid references users(id),
  player_b1_id uuid not null references users(id),
  player_b2_id uuid references users(id),
  winner_side varchar(1),
  set1_a int default 0,
  set1_b int default 0,
  set2_a int default 0,
  set2_b int default 0,
  set3_a int default 0,
  set3_b int default 0,
  played_at timestamptz,
  recorded_by_id uuid references users(id),
  ratings_applied boolean default false,
  notes varchar(300),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_friendships_requester on friendships(requester_id);
create index if not exists idx_friendships_addressee on friendships(addressee_id);
create index if not exists idx_comp_members_user on competition_members(user_id);
alter table community_matches add column if not exists confirmed_by_id uuid references users(id);
alter table community_matches add column if not exists court_number int;
alter table community_competitions add column if not exists number_of_courts int default 2;


alter table users add column if not exists bio varchar(500);
alter table users add column if not exists avatar_url varchar(500);

create table if not exists profile_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  media_type varchar(20) not null,
  url varchar(500) not null,
  caption varchar(200),
  sort_order int default 0,
  is_avatar boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_profile_media_user on profile_media(user_id);
