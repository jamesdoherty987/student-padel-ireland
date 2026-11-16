-- Organiser allowlist: listed emails get free entry when they sign up
create table if not exists public.tournament_free_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  email varchar(255) not null,
  note varchar(200),
  created_by_id uuid references public.users (id) on delete set null,
  used_by_registration_id uuid references public.registrations (id) on delete set null,
  constraint uq_tournament_free_entry_email unique (tournament_id, email)
);

create index if not exists ix_tournament_free_entries_tournament_id
  on public.tournament_free_entries (tournament_id);

create index if not exists ix_tournament_free_entries_email
  on public.tournament_free_entries (email);
