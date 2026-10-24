-- Idempotency log for day-before tournament reminder emails
create table if not exists public.tournament_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  sent_at timestamptz not null,
  constraint uq_tournament_reminder_user unique (tournament_id, user_id)
);

create index if not exists ix_tournament_reminder_logs_tournament_id
  on public.tournament_reminder_logs (tournament_id);

create index if not exists ix_tournament_reminder_logs_user_id
  on public.tournament_reminder_logs (user_id);
