-- Run this in your Supabase SQL editor
-- Creates a single-row JSON store for the wantlist state

create table if not exists wantlist_state (
  id text primary key default 'main',
  sets jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- RLS: open policy (single-user personal tool, no auth)
alter table wantlist_state enable row level security;

create policy "allow all"
  on wantlist_state for all
  using (true)
  with check (true);

-- Seed the initial row so upsert always finds a target
insert into wantlist_state (id, sets)
values ('main', '[]')
on conflict (id) do nothing;
