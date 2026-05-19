<!-- AI-CONFIG:START -->
> Shared AI context: read `~/.claude/AI_CONFIG_INDEX.md` first, then this project file. Universal rules and skills live in `~/.claude/`; project-specific context stays here.
<!-- AI-CONFIG:END -->

# TCG Wantlist — CLAUDE.md

## Projektbeskrivelse

En personlig tracker til Pokémon TCG Pocket SIR (Special Illustration Rare) og IR (Illustration Rare) kort, organiseret efter illustrator. Appen henter kortbilleder fra pokemontcg.io og priser fra Cardmarket (engelske kort, ikke UK).

## Tech Stack

- **React 18** med Vite
- **pokemontcg.io API** — gratis, ingen API-nøgle nødvendig, CORS-aktiveret
- **Anthropic API** (`claude-sonnet-4-20250514`) med `web_search_20250305` tool til Cardmarket-priser
- Ingen backend — alt kører client-side

## Projektstruktur

```
tcg-wantlist/
├── CLAUDE.md              # Denne fil
├── index.html             # Vite entry point
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx           # React root
    └── App.jsx            # Hele applikationen (single-file komponent)
```

## Komponenter (alle i App.jsx)

| Komponent       | Ansvar                                                             |
|-----------------|--------------------------------------------------------------------|
| `App`           | Rodkomponent. State for alle illustrator-sæt, sortering, filtrering |
| `IllusCard`     | Et illustrator-sæt med kort, total og stjernebedømmelse           |
| `CardRow`       | Én kortlinje med thumbnail, type, navn, søgeknap og pris          |
| `SearchModal`   | Modal til søgning via pokemontcg.io + auto-hentning af Cardmarket-pris |
| `StarRating`    | 1–5 stjerner, hover-preview                                        |

## API-kald

### pokemontcg.io
Bruges til at søge kortbilleder. Filtrerer på rarity (`Illustration Rare` / `Special Illustration Rare`).

```js
GET https://api.pokemontcg.io/v2/cards
  ?q=name:{query}* rarity:"{rarity}"
  &select=id,name,images,set
  &orderBy=-set.releaseDate
  &pageSize=24
```

### Anthropic API — Cardmarket-pris
Kaldes fra `fetchCardmarketPrice()`. Bruger `web_search`-tool til at finde Trend Price på Cardmarket for engelske kort.

```js
POST https://api.anthropic.com/v1/messages
{
  model: "claude-sonnet-4-20250514",
  tools: [{ type: "web_search_20250305", name: "web_search" }],
  ...
}
```

**Vigtigt:** API-nøglen injiceres automatisk af claude.ai's artifact-runtime. Lokalt skal du sætte `VITE_ANTHROPIC_API_KEY` i `.env` og opdatere `fetchCardmarketPrice()` til at bruge den (se nedenfor).

## Lokal opsætning

```bash
npm install
npm run dev
```

### Miljøvariable (lokalt)

Opret en `.env`-fil i roden:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Opdater derefter headeren i `fetchCardmarketPrice()` i `src/App.jsx`:

```js
headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-calls": "true",
},
```

> **OBS:** Direkte browser-kald til Anthropic API kræver `anthropic-dangerous-direct-browser-calls: true` headeren og er kun beregnet til udvikling/prototyping — ikke produktion.

## State-struktur

```js
// Ét illustrator-sæt
{
  id: number,
  illustrator: string,
  want: number,          // 1–5 stjerner
  cards: [
    {
      id: number,
      name: string,
      type: "IR" | "SIR",
      price: number | null,    // EUR fra Cardmarket
      image: string | null,    // URL fra pokemontcg.io
      url: string | null,      // Cardmarket produktside
      loadingPrice: boolean,
      tcgSetName: string | null,
    }
  ]
}
```

## Sortering og filtrering

- Sorter efter **Interesse** (want-stjerner) eller **Pris** (total EUR pr. sæt)
- Begge veje (↑↓)
- Filtrer på **Alle**, **IR** eller **SIR** — totalprisen i footer opdateres live

## Mulige udvidelser

- [ ] Persist state til `localStorage`
- [ ] Eksport til CSV/JSON
- [ ] DKK-konvertering (EUR × 7.46)
- [ ] "Ejer jeg det allerede" toggle pr. kort
- [ ] Hent illustrator-navn automatisk fra TCG API
