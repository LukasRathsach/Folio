<!-- AI-CONFIG:START -->
> Shared AI context: read `~/.claude/AI_CONFIG_INDEX.md` first, then this project file. Universal rules and skills live in `~/.claude/`; project-specific context stays here.
<!-- AI-CONFIG:END -->

# Folio — CLAUDE.md

## Projektbeskrivelse

Personlig Pokémon TCG-samlerapp. Tracker SIR/IR/SR/HR og andre special-rarity kort organiseret efter illustrator. Priser fra Cardmarket via pokemontcg.io. Multi-bruger med Supabase Auth. Hosted på Vercel.

GitHub: `LukasRathsach/tcg-wantlist`

## Tech Stack

- **React 18 + Vite** — single-file komponent pattern (alt i `src/App.jsx`)
- **pokemontcg.io API** — kort, billeder, artist, sæt, Cardmarket Trend Price
- **Supabase** — auth (email/password) + JSON blob persistence per bruger
- **Vercel** — hosting, auto-deploy fra `main`
- **@vercel/analytics** — trafik-tracking

Ingen Anthropic API i prod — priser hentes direkte fra pokemontcg.io's `cardmarket.prices.trendPrice`.

## Projektstruktur

```
folio/
├── CLAUDE.md
├── ROADMAP.md          # Feature roadmap med multi-database strategi
├── schema.sql          # Kør i Supabase SQL editor ved opsætning
├── index.html
├── package.json
└── src/
    ├── main.jsx        # React root + Vercel Analytics inject
    ├── App.jsx         # Hele appen (~1300 linjer, single-file)
    └── supabase.js     # Supabase client + loadFromSupabase/saveToSupabase
```

## Komponenter i App.jsx

| Komponent | Ansvar |
|---|---|
| `App` | Root. Auth state, tab navigation, sets state, Supabase sync |
| `GlobalSearch` | Semantisk søgning (kort + illustrator), auto-tilføj til folder |
| `IllusCard` | Et illustrator-sæt med kort, ratings, artist-anbefalinger |
| `CardRow` | Én kortlinje: billede (100px), navn, søg, pris, EUR/DKK toggle, owned |
| `ArtistRecs` | Alle kort af samme artist sorteret SIR→IR→HR→SR, markerer tilføjede |
| `SearchModal` | Modal til at søge og vælge specifik kortversion |
| `CardLightbox` | Forstørret kortvisning ved klik på thumbnail |
| `Portfolio` | Owned-kort som billedgalleri grupperet efter illustrator |
| `ProfilePanel` | Samlerstatistik + log ud |
| `AuthScreen` | Login / signup formular |
| `StarRating` | 1–5 stjerner med farve-prop (amber = interesse, blå = pris-vurdering) |
| `ToastStack` | Fejl- og statusnotifikationer (auto-dismiss 4s) |
| `SyncBadge` | Supabase sync-status i headeren |

## State-struktur

```js
// sets[] — ét illustrator-sæt
{
  id: number,
  illustrator: string,
  want: number,        // 1–5 interesse-stjerner
  priceRating: number, // 1–5 pris-vurdering
  cards: [{
    id: number,
    tcgId: string,     // pokemontcg.io id, fx "sv8pt5-161"
    name: string,
    type: string,      // "SIR" | "IR" | "SR" | "HR" | "RR" | "UR" | ...
    price: number | null,   // EUR fra Cardmarket
    url: string | null,     // Cardmarket produktside
    image: string | null,   // large image URL fra pokemontcg.io
    tcgSetName: string | null,
    owned: boolean,
    loadingPrice: boolean,
  }]
}
```

## API-kald

### pokemontcg.io (primær kilde)
```
GET https://api.pokemontcg.io/v2/cards
  ?q=name:{query}* (rarity:"Special Illustration Rare" OR ...)
  &select=id,name,images,set,artist,cardmarket,rarity
  &orderBy=-set.releaseDate
  &pageSize=50
```
Returnerer `cardmarket.prices.trendPrice` — ingen Anthropic API nødvendig.

### Supabase (persistence)
Tabel: `wantlist_state` — én JSON-blob per bruger (`id = auth.uid()::text`).
RLS: brugere kan kun læse/skrive deres egne rækker.

## Lokal opsætning

```bash
npm install
npm run dev  # localhost:5173
```

`.env` (ikke committed):
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Kør `schema.sql` i Supabase SQL editor første gang.
Supabase: Authentication → Configuration → "Enable Signups" skal være TIL.

## Vigtige konstanter

```js
const DKK_RATE = 7.46;
const LS_KEY = "folio-v1";           // localStorage nøgle
const SAVE_DEBOUNCE_MS = 1500;       // debounce for Supabase save
```

## Roadmap

Se `ROADMAP.md`. Næste store ting: Supabase `cards`-tabel som lokal kortdatabase (seed fra pokemontcg.io) for hurtigere søgning uden ekstern API-afhængighed.
