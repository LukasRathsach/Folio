-- Run this in your Supabase SQL editor
-- Each row is one user's wantlist (id = auth user UUID)

create table if not exists wantlist_state (
  id text primary key,
  sets jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- User-scoped RLS: each user can only read/write their own row
alter table wantlist_state enable row level security;

drop policy if exists "allow all" on wantlist_state;
drop policy if exists "users own their data" on wantlist_state;

create policy "users own their data"
  on wantlist_state for all
  using (id = auth.uid()::text)
  with check (id = auth.uid()::text);
