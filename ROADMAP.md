# TCG Wantlist — Roadmap

## Done (v0.1)

- Core wantlist: add/remove illustrator folders and cards manually
- pokemontcg.io integration — card images, set names, artist info
- Cardmarket Trend Price via `cardmarket.prices.trendPrice` from TCG API
- Semantic search: card name or illustrator, order-independent, all special rarities (SIR/IR/HR/SR/RR/AR/…)
- Auto-create illustrator folder when adding from search
- Artist recommendations — all cards by same artist, sorted SIR→IR→HR→SR, marks already-added
- Card image lightbox (click to enlarge)
- Per-card EUR/DKK currency toggle
- Interest rating 1–5 stars + Price rating 1–5 stars per illustrator
- Owned toggle per card
- CSV + JSON export
- localStorage backup + Supabase sync (debounced)
- Per-user auth (email/password via Supabase)
- Simple profile panel (stats: illustrators, cards, owned, totals)

---

## v0.2 — Portfolio & Deployment (næste sprint)

- [ ] **Vercel hosting** — connect GitHub repo, set env vars, auto-deploy
- [ ] **Portfolio view** — dedicated tab/page showing only owned cards grouped by set or illustrator
- [ ] **Set completion** — % owned vs. total available SIR/IR per expansion set
- [ ] **Improved mobile layout** — bottom nav, touch-friendly card rows
- [ ] **Disable email confirmation in Supabase** (or add confirm-and-redirect flow)

---

## v0.3 — Prices & Tracking

- [ ] **Price history** — store daily Trend Price snapshots, show sparkline per card
- [ ] **Price alerts** — flag cards that dropped/rose more than X% since added
- [ ] **DKK as default** — user preference stored in profile
- [ ] **Bulk price refresh** — re-fetch Cardmarket prices for all cards in one click
- [ ] **Grade / condition field** per card (NM, LP, MP…)

---

## v0.4 — Discovery & Social

- [ ] **Public profile link** — share your wantlist as read-only URL
- [ ] **"Missing from set" view** — show SIR/IR not yet in wantlist for a given expansion
- [ ] **Trade list** — mark cards as "available for trade" vs. "need to buy"
- [ ] **Set browser** — browse all SIR/IR from a specific expansion without searching

---

## Data source note

pokemontcg.io is the best free public API for mainline TCG cards (has Cardmarket prices).
It does NOT cover TCG Pocket (digital-only cards — no public API exists for those).
For Cardmarket prices, we rely on `cardmarket.prices.trendPrice` returned by pokemontcg.io.
Official Pokemon API or pkmncards.com do not offer machine-readable APIs.
