# Folio — AI Handoff

Last updated: 2026-05-19

## What this project is

**Folio** is a personal Pokémon TCG collection tracker. Users add illustrator folders, search for cards by name or artist, and track prices, ownership, and interest ratings. Auth is required in every environment, including local dev, and data syncs to Supabase per-user.

Live at Vercel. Single-file React app (`src/App.jsx`).

---

## Roadmap status

Current product focus:
1. **Short term:** database coverage, search quality, and backend sync safety.
2. **Mid term:** mobile-first UX cleanup around the core workflows.
3. **Long term:** defer social, price-history, PWA, and sharing features until the basics are excellent.

Search is the core product surface. Supabase sync is the trust foundation. Do not prioritize new features ahead of those.

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
- [x] Mandatory Supabase sync (debounced, per-user) — done 2026-05-19: 1500ms debounce, `skipSaveRef` prevents spurious write after load; localStorage is only written after successful Supabase save
- [x] Email/password auth via Supabase (login, signup, sign-out) — done 2026-05-19: `AuthScreen`, `onAuthStateChange` listener
- [x] Profile panel (collection stats, sign out) — done 2026-05-19: `ProfilePanel` component
- [x] Portfolio tab — owned cards in a gallery view grouped by illustrator — done 2026-05-19: `Portfolio` component, second tab
- [x] Toast notifications — errors and save failures surfaced to the user — done 2026-05-19: `useToasts` hook, 4s auto-dismiss
- [x] Renamed to Folio — done 2026-05-19
- [x] @vercel/analytics installed and injected — done 2026-05-19

---

## Short Term — Database, Search, Sync

The active sprint should focus on a near-complete card catalog, strong categorisation, fast search, and trustworthy collection persistence.

### Multi-source strategy (priority order)
1. **Supabase `cards` table** (cached, fast) — primary after seeding
2. **pokemontcg.io** — fallback + seed source
3. **TCGdex** (`api.tcgdex.net`) — fallback for cards not in pokemontcg.io

### Tasks
- [x] `cards` table in Supabase with trigram full-text search (`pg_trgm`) — done 2026-05-19: added idempotent schema to `schema.sql`
- [x] `scripts/seed-cards.js` — done 2026-05-19: pulls all special rarity cards from pokemontcg.io and upserts with `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Expand `cards` schema with normalized rarity group, illustrator key, set metadata, source metadata, and optional dex/card number fields
- [ ] Seed/fill gaps from TCGdex and manual override/import path
- [ ] Add database quality checks for duplicates, missing images/artists/rarities, and coverage by set/rarity
- [ ] Update search to hit Supabase first, fall back to pokemontcg.io
- [ ] Improve search ranking: exact name, exact illustrator, newer set tie-breaker, SIR/IR priority
- [ ] Raise search/recommendation quality: normalized artist identity, fuzzy matching, set-aware queries, accurate same-illustrator recommendations, and regression test queries
- [ ] Add same-illustrator exploration from every card result
- [ ] Strengthen sync: dirty state, retry failed saves, block signout on failed save, last successful sync time

---

## Mid Term — Mobile-First Core UX

- [ ] Audit and remove UI that does not directly support finding cards, adding cards, marking owned, exploring illustrator/set relationships, or sync/account safety
- [ ] Rework mobile layout around search-first usage, compact navigation, and larger touch targets
- [ ] Make add-card and owned-toggle flows faster on phone
- [ ] Promote “more by this illustrator” to a first-class workflow
- [ ] Add set/master set browsing only after search quality is solid

---

## Long Term — To Decide Later

- [ ] Public portfolio link — read-only shareable URL
- [ ] Trade list — mark cards as available for trade
- [ ] Price history and alerts
- [ ] Weekly price refresh (Supabase Edge Function cron)
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
- **Auth is mandatory in every environment**: local dev must sign up/login too. Do not reintroduce local-only fallback; changes must sync to Supabase `wantlist_state`.
- `skipSaveRef` pattern: prevents spurious Supabase write right after loading user data — don't remove it
- Artist recs only re-fetch when `illustrator` changes (not on card adds) — intentional to prevent reload loop
