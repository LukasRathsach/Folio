# Folio — AI Handoff

Last updated: 2026-05-19

## What this project is

**Folio** is a personal Pokémon TCG collection tracker. Users add illustrator folders, search for cards by name or artist, and track prices, ownership, and interest ratings. Data syncs to Supabase per-user; works offline via localStorage fallback.

Live at Vercel. Single-file React app (`src/App.jsx`).

---

## Roadmap status

### Done (v0.1) — 2026-05-19
- [x] Core wantlist: add/remove illustrator folders and cards manually
- [x] pokemontcg.io integration — card images, set names, artist info, Cardmarket Trend Prices — done 2026-05-19: uses `cardmarket.prices.trendPrice` directly from API response
- [x] Semantic search: card name or illustrator, order-independent, all special rarities — done 2026-05-19: `SPECIAL_RARITIES` covers 12 rarity types
- [x] Auto-create illustrator folder when adding from search
- [x] Artist recommendations — all cards by same artist sorted SIR→IR→HR→SR, marks already-added — done 2026-05-19: fixed Akira Egawa multi-word bug, removed ownedTcgIds dep causing reload loop
- [x] Card image lightbox (click to enlarge) — done 2026-05-19: `CardLightbox` component, click thumbnail
- [x] Per-card EUR/DKK currency toggle
- [x] Interest + price rating (1–5 stars) per illustrator
- [x] Owned toggle per card
- [x] CSV + JSON export
- [x] localStorage backup + Supabase sync (debounced, per-user) — done 2026-05-19: 1500ms debounce, `skipSaveRef` prevents spurious write after load
- [x] Email/password auth via Supabase (login, signup, sign-out) — done 2026-05-19: `AuthScreen`, `onAuthStateChange` listener
- [x] Profile panel (collection stats, sign out) — done 2026-05-19: `ProfilePanel` component
- [x] Portfolio tab — owned cards in a gallery view grouped by illustrator — done 2026-05-19: `Portfolio` component, second tab
- [x] Toast notifications — errors and save failures surfaced to the user — done 2026-05-19: `useToasts` hook, 4s auto-dismiss
- [x] Renamed to Folio — done 2026-05-19
- [x] @vercel/analytics installed and injected — done 2026-05-19

---

## v0.2 — Full Card Database (next sprint)

The single biggest gap: pokemontcg.io doesn't have every card, and API calls add latency.
Fix: mirror all special rarity cards into Supabase `cards` table.

### Multi-source strategy (priority order)
1. **Supabase `cards` table** (cached, fast) — primary after seeding
2. **pokemontcg.io** — fallback + seed source
3. **TCGdex** (`api.tcgdex.net`) — fallback for cards not in pokemontcg.io

### Tasks
- [ ] `cards` table in Supabase with trigram full-text search (`pg_trgm`) — schema in ROADMAP.md
- [ ] `scripts/seed-cards.js` — Node script to pull all special rarity cards from pokemontcg.io and upsert to Supabase (needs `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] Update search to hit Supabase first, fall back to pokemontcg.io
- [ ] TCGdex fallback for cards not found in either source
- [ ] Weekly price refresh (Supabase Edge Function cron)

---

## v0.3 — Prices & Tracking

- [ ] Bulk price refresh — re-fetch Cardmarket prices for all wantlist cards in one click
- [ ] Price history — store daily snapshots, show sparkline per card
- [ ] Price alerts — flag cards that changed >X% since added
- [ ] Set completion — % of SIR/IR owned vs. total available per expansion
- [ ] Card condition field (NM / LP / MP / HP / DMG)
- [ ] DKK as default user preference (stored in Supabase profile row)

---

## v0.4 — UX & Social

- [ ] Public portfolio link — read-only shareable URL
- [ ] "Missing from set" view — SIR/IR not yet in wantlist for a given expansion
- [ ] Trade list — mark cards as available for trade
- [ ] Improved mobile layout — bottom nav, larger touch targets
- [ ] PWA — offline support, installable

---

## Tech stack

- React 18 + Vite, single-file component pattern (all in `src/App.jsx`)
- Supabase JS v2: `supabase.auth`, `from("wantlist_state")` with RLS (`id = auth.uid()::text`)
- pokemontcg.io API — free, no API key, CORS-enabled
- Vercel deployment + @vercel/analytics
- No backend — fully client-side

## Key files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Entire application (~1350 lines) |
| `src/supabase.js` | Supabase client init + `loadFromSupabase` / `saveToSupabase` |
| `schema.sql` | Idempotent SQL for `wantlist_state` table + RLS |
| `ROADMAP.md` | Detailed roadmap with schema additions |

## Known issues / watch out for

- **Supabase "Signups not allowed"**: Dashboard → Authentication → Configuration → Enable Signups must be ON
- **LS_KEY is `"folio-v1"`** (was `"tcg-wantlist-v1"` — old local data won't auto-migrate)
- `skipSaveRef` pattern: prevents spurious Supabase write right after loading user data — don't remove it
- Artist recs only re-fetch when `illustrator` changes (not on card adds) — intentional to prevent reload loop
