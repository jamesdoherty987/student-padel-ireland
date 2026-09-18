-- Student Padel Ireland — Supabase / Postgres schema
-- Run in Supabase SQL editor or via migration tooling.
-- UUIDs + timestamps on all tables.

create extension if not exists "pgcrypto";

create table if not exists universities (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null unique,
  short_name varchar(40) not null,
  slug varchar(80) not null unique,
  logo_url varchar(500),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) not null unique,
  password_hash varchar(255) not null,
  full_name varchar(200) not null,
  phone varchar(40),
  role varchar(20) not null default 'PLAYER',
  university_id uuid references universities(id),
  student_number varchar(80),
  is_active boolean default true,
  is_suspended boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  slug varchar(120) not null unique,
  location varchar(200) not null,
  venue varchar(200) not null,
  event_date date not null,
  start_time time not null,
  number_of_courts int default 4,
  entry_fee_cents int default 5000,
  currency varchar(3) default 'EUR',
  max_teams int default 48,
  registration_deadline timestamptz,
  format varchar(40) default 'GROUP_KNOCKOUT',
  rules text,
  status varchar(40) default 'DRAFT',
  organiser_id uuid not null references users(id),
  match_duration_minutes int default 20,
  group_size int default 4,
  teams_advance_per_group int default 2,
  tie_break_order varchar(200) default 'points,head_to_head,set_difference,game_difference,games_won',
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name varchar(80) not null,
  court_number int not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name varchar(120) not null,
  university_id uuid references universities(id),
  seed int,
  checked_in boolean default false,
  player1_present boolean default false,
  player2_present boolean default false,
  withdrawn boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id),
  slot int not null,
  invitation_accepted boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (team_id, user_id)
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  team_id uuid not null unique references teams(id),
  status varchar(20) default 'PENDING',
  amount_cents int not null,
  currency varchar(3) default 'EUR',
  stripe_session_id varchar(255),
  stripe_payment_intent_id varchar(255),
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id),
  tournament_id uuid not null references tournaments(id),
  stripe_payment_id varchar(255),
  amount_cents int not null,
  currency varchar(3) default 'EUR',
  status varchar(20) default 'PENDING',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name varchar(40) not null,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists group_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  team_id uuid not null references teams(id),
  seed_in_group int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (group_id, team_id)
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round varchar(60) not null,
  stage varchar(40) default 'GROUP',
  group_id uuid references groups(id),
  court_id uuid references courts(id),
  court_number int,
  scheduled_start timestamptz,
  team_a_id uuid references teams(id),
  team_b_id uuid references teams(id),
  team_a_placeholder varchar(120),
  team_b_placeholder varchar(120),
  status varchar(20) default 'SCHEDULED',
  winner_id uuid references teams(id),
  sort_order int default 0,
  next_match_id uuid references matches(id),
  next_match_slot varchar(1),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists match_scores (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references matches(id) on delete cascade,
  set1_a int default 0,
  set1_b int default 0,
  set2_a int default 0,
  set2_b int default 0,
  set3_a int default 0,
  set3_b int default 0,
  current_set int default 1,
  entered_by_id uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  points int default 0,
  rank_ireland int,
  tournaments_played int default 0,
  matches_played int default 0,
  wins int default 0,
  losses int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ranking_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  tournament_id uuid not null references tournaments(id),
  points_delta int not null,
  points_after int not null,
  placement varchar(40),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  title varchar(200) not null,
  body text not null,
  created_by_id uuid not null references users(id),
  is_pinned boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id),
  name varchar(200) not null,
  logo_url varchar(500),
  website varchar(500),
  description text,
  level varchar(40) default 'GOLD',
  is_platform boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists platform_settings (
  id uuid primary key default gen_random_uuid(),
  key varchar(100) not null unique,
  value text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS guidance: enable RLS in Supabase and only allow the FastAPI service role
-- for writes. Never expose SUPABASE_SERVICE_ROLE_KEY to the frontend.
