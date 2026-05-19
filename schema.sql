-- Run this in your Supabase SQL editor
-- Each row is one user's wantlist (id = auth user UUID)

create extension if not exists pg_trgm;

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

-- Local card cache. Seeded with scripts/seed-cards.js using the Supabase service role key.
create table if not exists cards (
  id text primary key,
  name text not null,
  rarity text,
  artist text,
  set_id text,
  set_name text,
  set_release_date date,
  image_small text,
  image_large text,
  cm_price numeric(10, 2),
  cm_url text,
  synced_at timestamptz not null default now()
);

alter table cards enable row level security;

drop policy if exists "cards readable by authenticated" on cards;

create policy "cards readable by authenticated"
  on cards for select
  to authenticated
  using (true);

create index if not exists cards_name_trgm
  on cards using gin (name gin_trgm_ops);

create index if not exists cards_artist_trgm
  on cards using gin (artist gin_trgm_ops);

create index if not exists cards_rarity
  on cards (rarity);

create index if not exists cards_set_release_date
  on cards (set_release_date desc);
