# Folio — Roadmap

## Done (v0.1)

- Core wantlist: add/remove illustrator folders and cards manually
- pokemontcg.io integration — card images, set names, artist info, Cardmarket Trend Prices
- Semantic search: card name or illustrator, order-independent, all special rarities
- Auto-create illustrator folder when adding from search
- Artist recommendations — all cards by same artist sorted SIR→IR→HR→SR, marks already-added
- Card image lightbox (click to enlarge)
- Per-card EUR/DKK currency toggle
- Interest + price rating (1–5 stars) per illustrator
- Owned toggle per card
- CSV + JSON export
- localStorage backup + Supabase sync (debounced, per-user)
- Email/password auth via Supabase (login, signup, sign-out)
- Profile panel (collection stats, sign out)
- **Portfolio tab** — owned cards in a gallery view grouped by illustrator
- **Toast notifications** — errors and save failures surfaced to the user

---

## v0.2 — Full Card Database (next sprint)

The single biggest gap: pokemontcg.io doesn't have every card, and API calls add latency.
The fix is to mirror all special rarity cards into a Supabase `cards` table.

### Multi-source strategy (priority order)

1. **Supabase `cards` table** (cached, fast, ~5 000 cards) — primary source after seeding
2. **pokemontcg.io** — fallback for cards not yet in cache, and source for seeding
3. **TCGdex** (`api.tcgdex.net`) — fallback for cards not in pokemontcg.io (different set coverage)

### What to build

- [ ] `cards` table in Supabase with trigram full-text search (`pg_trgm`)
- [ ] `scripts/seed-cards.js` — one-off Node script that pulls all special rarity cards from pokemontcg.io and upserts to Supabase (needs `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] Update search to hit Supabase first, fall back to pokemontcg.io
- [ ] TCGdex fallback for cards not found in either source
- [ ] Weekly price refresh (Supabase Edge Function cron)

Schema addition:
```sql
create extension if not exists pg_trgm;

create table if not exists cards (
  id            text primary key,
  name          text not null,
  rarity        text,
  artist        text,
  set_id        text,
  set_name      text,
  image_small   text,
  image_large   text,
  cm_price      numeric(10,2),
  cm_url        text,
  synced_at     timestamptz default now()
);

create index if not exists cards_name_trgm   on cards using gin (name   gin_trgm_ops);
create index if not exists cards_artist_trgm on cards using gin (artist gin_trgm_ops);
create index if not exists cards_rarity      on cards (rarity);

alter table cards enable row level security;
create policy "cards readable by authenticated" on cards for select to authenticated using (true);
```

---

## v0.3 — Prices & Tracking

- [ ] **Bulk price refresh** — re-fetch Cardmarket prices for all wantlist cards in one click
- [ ] **Price history** — store daily snapshots, show sparkline per card
- [ ] **Price alerts** — flag cards that changed >X% since added
- [ ] **Set completion** — % of SIR/IR owned vs. total available per expansion
- [ ] **Card condition** field (NM / LP / MP / HP / DMG)
- [ ] **DKK as default** user preference (stored in Supabase profile row)

---

## v0.4 — UX & Social

- [ ] **Public portfolio link** — read-only shareable URL
- [ ] **"Missing from set" view** — SIR/IR not yet in wantlist for a given expansion
- [ ] **Trade list** — mark cards as available for trade
- [ ] **Improved mobile layout** — bottom nav, larger touch targets
- [ ] **PWA** — offline support, installable

---

## Architecture notes (senior backend / security)

**Security (current state ✓)**
- Supabase anon key in client is correct — RLS policies enforce row-level isolation
- `wantlist_state` rows protected by `id = auth.uid()::text`
- No secrets in git (`.env` gitignored)

**What to harden before public launch**
- Add `updated_at` trigger in Postgres instead of setting it client-side (prevents clock skew)
- Rate-limit auth attempts (Supabase dashboard → Auth → Rate Limits)
- Set Supabase `Site URL` + `Redirect URLs` to only allow the Vercel domain

**Performance**
- Current single JSON blob (max ~500 cards) is fast enough for personal use
- Once friends use it: switch to the normalized `cards` + `wantlist_items` schema (v0.2)
- All saves are debounced 1 500ms — no risk of write storms
