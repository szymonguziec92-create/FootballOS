-- Wklej ten skrypt w Supabase: SQL Editor -> New query -> Run.
-- Tworzy prywatną tabelę synchronizacji: każdy użytkownik widzi tylko własne dane.

create table if not exists public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

drop policy if exists "Users manage own app data" on public.app_data;
create policy "Users manage own app data"
  on public.app_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
