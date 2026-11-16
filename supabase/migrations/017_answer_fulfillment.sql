-- Organiser checkoffs for custom signup answers (e.g. jersey handed out)
alter table public.tournament_registration_answers
  add column if not exists fulfilled boolean not null default false;

alter table public.tournament_registration_answers
  add column if not exists fulfilled_at timestamptz;

create index if not exists ix_tournament_registration_answers_fulfilled
  on public.tournament_registration_answers (fulfilled)
  where fulfilled = true;
