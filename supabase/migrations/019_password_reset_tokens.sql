-- One-time password reset tokens (store hash only; raw token is emailed)
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash varchar(64) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists ix_password_reset_tokens_user_id
  on public.password_reset_tokens (user_id);

create index if not exists ix_password_reset_tokens_expires_at
  on public.password_reset_tokens (expires_at);
