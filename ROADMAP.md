# Folio — Roadmap

## Product principle

Folio wins or loses on two things:

1. **Find the right card fast** — search is the core product.
2. **Never lose a collection** — Supabase sync must be boringly reliable.

Do not add broad new features until those two are solid.

---

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
- Mandatory Supabase auth + sync
- Profile panel with collection stats and sign out
- Portfolio tab — owned cards in a gallery view grouped by illustrator
- Toast notifications — errors and save failures surfaced to the user
- Vercel Analytics

---

## Short Term — Database, Search, Sync

Goal: Folio should have a near-complete local card database, excellent search, and collection sync you can trust.

### 1. Card database coverage

- [x] `cards` table in Supabase with trigram full-text search (`pg_trgm`)
- [x] `scripts/seed-cards.js` — seed special rarity cards from pokemontcg.io
- [ ] Expand database schema for better categorisation:
  - normalized rarity group (`SIR`, `IR`, `SR`, `HR`, `UR`, etc.)
  - illustrator search key
  - set series / set id / set name / release date
  - national dex number when available
  - source metadata (`pokemontcg`, `tcgdex`, manual override)
- [ ] Seed from multiple sources:
  - pokemontcg.io as primary source
  - TCGdex as coverage fallback
  - manual override/import path for missing important cards
- [ ] Add database quality checks:
  - duplicate detection by name + set + number
  - missing image/artist/rarity report
  - coverage count by rarity and set

### 2. Search is everything

- [ ] Update app search to hit Supabase first, then external fallback
- [ ] Support fast search by:
  - card name
  - illustrator
  - set name
  - rarity group
  - card number / set number where available
- [ ] Improve ranking:
  - exact name matches first
  - illustrator exact matches next
  - newer sets before older sets when relevance is tied
  - SIR/IR priority for ambiguous searches
- [ ] Raise search quality substantially:
  - normalize illustrator names so recommendations are accurate
  - handle aliases, accents, punctuation, casing, and multi-word names
  - support fuzzy matching for small typos without polluting top results
  - make set-aware queries work, e.g. `151 pikachu`, `mew sar`, `charizard obsidian`
  - separate broad search from exact recommendation logic
- [ ] Make recommendations much more accurate:
  - “same illustrator” must be based on normalized exact artist identity, not loose text matching
  - recommended cards should exclude already-added cards clearly
  - sort recommendations by rarity priority, then release date, then set order
  - show why a recommendation matched when useful, e.g. same illustrator / same set
- [ ] Add a search-quality test set:
  - common card-name searches with expected top results
  - illustrator searches with expected artist matches
  - typo/partial queries that should still work
  - regression checks for known tricky illustrators
- [ ] Add “same illustrator” exploration from every card result
- [ ] Add master set / set-level browsing once search quality is solid

### 3. Sync and collection safety

- [x] Auth required in every environment, including local dev
- [x] localStorage is backup-only after successful Supabase save
- [x] Save errors surface to the user
- [ ] Make sync state stronger:
  - explicit dirty state for unsaved local changes
  - block signout when latest save failed
  - retry failed saves
  - show last successful sync time
- [ ] Add `updated_at` trigger in Postgres instead of client-side timestamps
- [ ] Add export/backup safety button after the sync flow is stable
- [ ] Add basic recovery story: import JSON into authenticated account

---

## Mid Term — Mobile-First Core UX

Goal: remove clutter, make the app feel focused, and make the core card-finding workflows easy on a phone.

### 1. Remove before adding

- [ ] Audit every visible control and remove anything that does not support:
  - finding cards
  - adding cards
  - marking owned
  - exploring illustrator/set relationships
  - safe sync/account state
- [ ] Collapse or hide secondary metadata until needed
- [ ] Simplify ratings if they are not actively useful
- [ ] Keep Portfolio only if it helps collection review; otherwise fold into owned filters

### 2. Mobile-first navigation

- [ ] Rework layout around mobile:
  - bottom nav or compact tab switcher
  - search as the primary first-screen action
  - larger touch targets
  - less dense card rows
- [ ] Make add-card flow fast from search results
- [ ] Make owned toggle obvious and thumb-friendly

### 3. Core exploration workflows

- [ ] “More by this illustrator” as a first-class flow
- [ ] Set/master set view:
  - show all relevant special-rarity cards in a set
  - mark owned/wanted/missing
  - filter by rarity
- [ ] Better missing-cards workflow:
  - cards from same illustrator not yet added
  - cards from same set not yet owned

---

## Long Term — To Decide Later

Hold these until short-term reliability and mid-term UX are strong.

- [ ] Public portfolio/share link
- [ ] Trade list
- [ ] Price history and alerts
- [ ] Weekly automated price refresh
- [ ] PWA/offline install support
- [ ] Social or collection comparison features

---

## Architecture notes

**Security**
- Supabase anon key in client is correct — RLS policies enforce row-level isolation
- `wantlist_state` rows protected by `id = auth.uid()::text`
- Auth is mandatory in every environment
- No secrets in git (`.env` gitignored)

**Database**
- `wantlist_state` is still a JSON blob per user for collection state
- `cards` is the local searchable catalog
- Next likely schema step: keep `cards` as shared catalog, then later normalize user-owned/wanted items only if the JSON blob becomes painful

**Performance**
- Search should move to Supabase first to avoid slow external API calls
- External APIs should become seed/fallback sources, not primary UX dependencies
- Saves are debounced 1 500ms, but need stronger retry/dirty-state handling
