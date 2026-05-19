import { useState, useMemo, useEffect } from "react";

const DKK_RATE = 7.46;
const LS_KEY = "tcg-wantlist-v1";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function searchTCGCards(query, type) {
  const rarity = type === "SIR" ? "Special Illustration Rare" : "Illustration Rare";
  const q = encodeURIComponent(`name:${query}* rarity:"${rarity}"`);
  const res = await fetch(
    `https://api.pokemontcg.io/v2/cards?q=${q}&select=id,name,images,set,artist&orderBy=-set.releaseDate&pageSize=24`
  );
  if (!res.ok) throw new Error("TCG API fejlede");
  const data = await res.json();
  return data.data || [];
}

async function fetchCardmarketPrice(cardName, setName) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("Mangler VITE_ANTHROPIC_API_KEY — pris-hentning deaktiveret.");
    return { price: null, currency: "EUR", url: null };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-calls": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `You are a Cardmarket price lookup tool. Search cardmarket.com/en/Pokemon for Pokemon card prices.
RULES:
- English language cards ONLY (use language=1 in URL or filter)
- Find the Trend Price in EUR
- Exclude UK sellers if possible (seller country filter)
- Return ONLY a raw JSON object with zero extra text, no markdown, no backticks:
  {"price":<number or null>,"currency":"EUR","url":"<full cardmarket product url or null>"}`,
        messages: [
          {
            role: "user",
            content: `Find Cardmarket trend price for Pokemon card: "${cardName}"${
              setName ? `, from set: "${setName}"` : ""
            }. English cards, not UK. Return JSON only.`,
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
    return { price: null, currency: "EUR", url: null };
  } catch (e) {
    console.error("Pris-hentning fejlede:", e);
    return { price: null, currency: "EUR", url: null };
  }
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(sets) {
  triggerDownload(
    new Blob([JSON.stringify(sets, null, 2)], { type: "application/json" }),
    "tcg-wantlist.json"
  );
}

function exportCSV(sets) {
  const rows = [
    ["Illustrator", "Interesse", "Type", "Kortnavn", "Sæt", "Pris EUR", "Pris DKK", "Ejet", "Cardmarket"],
  ];
  sets.forEach((s) => {
    s.cards.forEach((c) => {
      rows.push([
        s.illustrator,
        s.want,
        c.type,
        c.name,
        c.tcgSetName || "",
        c.price ?? "",
        c.price ? (c.price * DKK_RATE).toFixed(2) : "",
        c.owned ? "Ja" : "Nej",
        c.url || "",
      ]);
    });
  });
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "tcg-wantlist.csv");
}

// ─── localStorage ─────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Star Rating ─────────────────────────────────────────────────────────────

function StarRating({ value, onChange }) {
  const [hov, setHov] = useState(null);
  return (
    <div className="stars" onMouseLeave={() => setHov(null)}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          className={"star" + (s <= (hov ?? value) ? " on" : "")}
          onMouseEnter={() => setHov(s)}
          onClick={() => onChange(s)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── Search Modal ─────────────────────────────────────────────────────────────

function SearchModal({ cardName, cardType, onSelect, onClose }) {
  const [q, setQ] = useState(cardName || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const doSearch = async (query) => {
    if (!query.trim()) return;
    setLoading(true);
    setDone(false);
    try {
      setResults(await searchTCGCards(query.trim(), cardType));
    } catch {
      setResults([]);
    }
    setLoading(false);
    setDone(true);
  };

  useEffect(() => {
    if (cardName) doSearch(cardName);
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{cardType} SØGNING · pokemontcg.io</span>
          <button className="x-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-bar">
          <input
            className="modal-input"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(q)}
            placeholder="Fx Charizard ex, Pikachu, Eevee…"
          />
          <button className="modal-go" onClick={() => doSearch(q)}>Søg</button>
        </div>

        {loading && (
          <p className="modal-msg">
            <span className="spinning">⟳</span>&nbsp;Søger pokemontcg.io…
          </p>
        )}
        {!loading && done && results.length === 0 && (
          <p className="modal-msg">Ingen {cardType} resultater — prøv et kortere navn</p>
        )}
        {!loading && done && results.length > 0 && (
          <p className="modal-msg muted">{results.length} resultater · klik for at vælge</p>
        )}

        <div className="modal-grid">
          {results.map((c) => (
            <button key={c.id} className="res-card" onClick={() => onSelect(c)}>
              <img src={c.images.small} alt={c.name} className="res-img" loading="lazy" />
              <div className="res-meta">
                <span className="res-name">{c.name}</span>
                <span className="res-set">{c.set.name}</span>
                {c.artist && <span className="res-artist">✏ {c.artist}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Card Row ─────────────────────────────────────────────────────────────────

function CardRow({ card, currency, onUpdate, onDelete, onArtistDetected }) {
  const [showModal, setShowModal] = useState(false);

  const handleSelect = async (tcgCard) => {
    setShowModal(false);
    const next = {
      id: card.id,
      type: card.type,
      name: tcgCard.name,
      image: tcgCard.images?.large || tcgCard.images?.small || null,
      tcgSetName: tcgCard.set.name,
      loadingPrice: true,
      price: null,
      url: null,
      owned: card.owned,
    };
    onUpdate(next);
    if (tcgCard.artist) onArtistDetected?.(tcgCard.artist);
    const p = await fetchCardmarketPrice(tcgCard.name, tcgCard.set.name);
    onUpdate({ ...next, loadingPrice: false, price: p.price, url: p.url });
  };

  const displayPrice =
    card.price != null
      ? currency === "DKK"
        ? (card.price * DKK_RATE).toFixed(2)
        : card.price.toFixed(2)
      : null;

  return (
    <>
      <div className={"card-row" + (card.owned ? " owned" : "")}>
        <button
          className="thumb-btn"
          onClick={() => setShowModal(true)}
          title="Søg kort (TCG API + Cardmarket)"
        >
          {card.image ? (
            <img className="thumb" src={card.image} alt={card.name} />
          ) : (
            <div className="thumb-ph">?</div>
          )}
        </button>

        <select
          className="type-sel"
          value={card.type}
          onChange={(e) => onUpdate({ ...card, type: e.target.value })}
        >
          <option>IR</option>
          <option>SIR</option>
        </select>

        <input
          className="name-in"
          placeholder="Kortnavn…"
          value={card.name}
          onChange={(e) => onUpdate({ ...card, name: e.target.value })}
        />

        <button
          className="srch-btn"
          onClick={() => setShowModal(true)}
          title="Hent billede + Cardmarket-pris"
        >
          🔍
        </button>

        <div className="price-cell">
          {card.loadingPrice ? (
            <span className="spinning price-spin">⟳</span>
          ) : (
            <>
              <input
                className="price-in"
                type="number"
                placeholder="–"
                value={card.price ?? ""}
                onChange={(e) =>
                  onUpdate({ ...card, price: parseFloat(e.target.value) || null })
                }
              />
              <span className="curr">{currency === "DKK" ? "kr" : "€"}</span>
              {displayPrice && currency === "DKK" && (
                <span className="price-converted">{displayPrice}</span>
              )}
              {card.url && (
                <a
                  href={card.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cm-link"
                  title="Åbn på Cardmarket"
                >
                  ↗
                </a>
              )}
            </>
          )}
        </div>

        <button
          className={"own-btn" + (card.owned ? " owned-on" : "")}
          onClick={() => onUpdate({ ...card, owned: !card.owned })}
          title={card.owned ? "Ejer det — klik for at fjerne" : "Markér som ejet"}
        >
          {card.owned ? "✓" : "○"}
        </button>

        <button className="del" onClick={onDelete}>×</button>
      </div>

      {showModal && (
        <SearchModal
          cardName={card.name}
          cardType={card.type}
          onSelect={handleSelect}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// ─── Illustrator Card ─────────────────────────────────────────────────────────

function IllusCard({ set, currency, onUpdate, onDelete }) {
  const hasLoading = set.cards.some((c) => c.loadingPrice);
  const total = set.cards.reduce((s, c) => s + (c.price || 0), 0);
  const displayTotal =
    currency === "DKK" ? (total * DKK_RATE).toFixed(2) : total.toFixed(2);
  const currSymbol = currency === "DKK" ? "kr" : "€";

  const updCard = (idx, next) =>
    onUpdate({ ...set, cards: set.cards.map((c, i) => (i === idx ? next : c)) });
  const delCard = (idx) =>
    onUpdate({ ...set, cards: set.cards.filter((_, i) => i !== idx) });
  const addCard = () =>
    onUpdate({
      ...set,
      cards: [
        ...set.cards,
        { id: Date.now(), name: "", type: "SIR", price: null, image: null, url: null, loadingPrice: false, owned: false },
      ],
    });

  return (
    <div className="icard">
      <div className="icard-head">
        <div>
          <div className="icard-label">ILLUSTRATOR</div>
          <input
            className="icard-name"
            placeholder="Navn…"
            value={set.illustrator}
            onChange={(e) => onUpdate({ ...set, illustrator: e.target.value })}
          />
        </div>
        <button className="del" onClick={onDelete} style={{ alignSelf: "flex-start" }}>✕</button>
      </div>

      <div className="divider" />

      <div className="cards-list">
        {set.cards.map((c, i) => (
          <CardRow
            key={c.id}
            card={c}
            currency={currency}
            onUpdate={(next) => updCard(i, next)}
            onDelete={() => delCard(i)}
            onArtistDetected={(artist) => {
              if (!set.illustrator) onUpdate({ ...set, illustrator: artist });
            }}
          />
        ))}
      </div>

      <button className="add-card" onClick={addCard}>+ Tilføj kort</button>

      <div className="icard-foot">
        <div>
          <div className="icard-label">VIL HAV</div>
          <StarRating value={set.want} onChange={(v) => onUpdate({ ...set, want: v })} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="icard-label">TOTAL ({currSymbol})</div>
          {hasLoading ? (
            <span className="spinning" style={{ fontSize: 22, color: "#e8b84b" }}>⟳</span>
          ) : (
            <span className="total">
              {parseFloat(displayTotal).toLocaleString("da-DK", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {currSymbol}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const INIT = [{ id: 1, illustrator: "", cards: [], want: 3 }];

export default function App() {
  const [sets, setSets] = useState(() => loadState() ?? INIT);
  const [sort, setSort] = useState("want");
  const [dir, setDir] = useState("desc");
  const [filter, setFilter] = useState("all");
  const [currency, setCurrency] = useState("EUR");

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sets));
    } catch {}
  }, [sets]);

  const upd = (id, next) => setSets((s) => s.map((x) => (x.id === id ? next : x)));
  const del = (id) => setSets((s) => s.filter((x) => x.id !== id));
  const add = () =>
    setSets((s) => [...s, { id: Date.now(), illustrator: "", cards: [], want: 3 }]);

  const toggleSort = (k) => {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSort(k); setDir("desc"); }
  };

  const sorted = useMemo(() => {
    const mapped = sets.map((s) => {
      const cards = filter === "all" ? s.cards : s.cards.filter((c) => c.type === filter);
      const total = cards.reduce((acc, c) => acc + (c.price || 0), 0);
      return { ...s, _cards: cards, _total: total };
    });
    return mapped.sort((a, b) => {
      const v = sort === "price" ? "_total" : "want";
      return dir === "desc" ? b[v] - a[v] : a[v] - b[v];
    });
  }, [sets, sort, dir, filter]);

  const grand = useMemo(() => sorted.reduce((a, s) => a + s._total, 0), [sorted]);
  const grandDisplay =
    currency === "DKK" ? (grand * DKK_RATE).toFixed(2) : grand.toFixed(2);
  const currSymbol = currency === "DKK" ? "kr" : "€";

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="header">
          <div className="logo-row">
            <span className="logo">TCG <em>WANTLIST</em></span>
            <span className="pill">SIR · IR</span>
          </div>
          <p className="sub">
            Billeder via pokemontcg.io · Priser fra Cardmarket (engelske kort, ikke UK)
          </p>
        </div>

        <div className="controls">
          <span className="ctrl-lbl">SORTER</span>
          {["want", "price"].map((k) => (
            <button
              key={k}
              className={"ctrl" + (sort === k ? " active" : "")}
              onClick={() => toggleSort(k)}
            >
              {k === "want" ? "Interesse" : "Pris"}
              {sort === k && <span className="arr">{dir === "desc" ? " ↓" : " ↑"}</span>}
            </button>
          ))}
          <span className="ctrl-lbl" style={{ marginLeft: 12 }}>VIS</span>
          {["all", "IR", "SIR"].map((f) => (
            <button
              key={f}
              className={"ctrl" + (filter === f ? " active" : "")}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Alle" : f}
            </button>
          ))}
          <span className="ctrl-lbl" style={{ marginLeft: 12 }}>VALUTA</span>
          {["EUR", "DKK"].map((c) => (
            <button
              key={c}
              className={"ctrl" + (currency === c ? " active" : "")}
              onClick={() => setCurrency(c)}
            >
              {c}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="export-btn" onClick={() => exportCSV(sets)} title="Eksporter til CSV">CSV</button>
          <button className="export-btn" onClick={() => exportJSON(sets)} title="Eksporter til JSON">JSON</button>
          <span className="ctrl-lbl">TOTAL</span>
          <span className="grand">
            {parseFloat(grandDisplay).toLocaleString("da-DK", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            {currSymbol}
          </span>
        </div>

        <div className="grid">
          {sorted.map((s) => (
            <IllusCard
              key={s.id}
              set={s}
              currency={currency}
              onUpdate={(next) => upd(s.id, next)}
              onDelete={() => del(s.id)}
            />
          ))}
        </div>

        <div className="add-wrap">
          <button className="add-set" onClick={add}>+ Tilføj illustrator</button>
        </div>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d0d0f; color: #e8e4df; font-family: 'DM Sans', sans-serif; min-height: 100vh; }

.app { max-width: 920px; margin: 0 auto; padding: 48px 24px 80px; }

.header { margin-bottom: 40px; }
.logo-row { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 6px; }
.logo { font-family: 'Bebas Neue', sans-serif; font-size: 50px; letter-spacing: 2px; line-height: 1; }
.logo em { color: #e8b84b; font-style: normal; }
.pill { font-family: 'Bebas Neue', sans-serif; font-size: 13px; letter-spacing: 3px; padding: 4px 10px; border: 1px solid #e8b84b44; color: #e8b84b; border-radius: 2px; margin-bottom: 8px; }
.sub { font-size: 12px; color: #4a4855; font-weight: 300; letter-spacing: 0.3px; }

.controls { display: flex; align-items: center; gap: 8px; margin-bottom: 32px; flex-wrap: wrap; }
.ctrl-lbl { font-size: 10px; letter-spacing: 2px; color: #363640; font-weight: 500; }
.ctrl { background: #131318; border: 1px solid #202028; color: #5a5860; font-family: 'DM Sans', sans-serif; font-size: 11px; letter-spacing: 1px; padding: 5px 12px; border-radius: 3px; cursor: pointer; transition: all .15s; text-transform: uppercase; }
.ctrl:hover { border-color: #e8b84b44; color: #e8e4df; }
.ctrl.active { background: #e8b84b14; border-color: #e8b84b66; color: #e8b84b; }
.arr { color: #e8b84b; }
.grand { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 1px; color: #e8b84b; }

.export-btn { background: #131318; border: 1px solid #202028; color: #4a4858; font-family: 'DM Sans', sans-serif; font-size: 10px; letter-spacing: 2px; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: all .15s; text-transform: uppercase; }
.export-btn:hover { border-color: #e8b84b44; color: #e8b84b; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }

.icard { background: #111114; border: 1px solid #1c1c22; border-radius: 8px; padding: 22px; display: flex; flex-direction: column; gap: 14px; transition: border-color .2s; }
.icard:hover { border-color: #2a2a34; }
.icard-head { display: flex; justify-content: space-between; align-items: flex-start; }
.icard-label { font-size: 9px; letter-spacing: 3px; color: #2e2e38; font-weight: 500; margin-bottom: 3px; }
.icard-name { background: transparent; border: none; outline: none; font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 1px; color: #f0ede8; width: 280px; }
.icard-name::placeholder { color: #22222a; }
.divider { height: 1px; background: #18181e; }
.cards-list { display: flex; flex-direction: column; gap: 8px; }
.add-card { align-self: flex-start; background: none; border: 1px dashed #1c1c24; color: #383840; font-family: 'DM Sans', sans-serif; font-size: 11px; letter-spacing: 1px; padding: 5px 12px; border-radius: 3px; cursor: pointer; transition: all .15s; }
.add-card:hover { border-color: #e8b84b44; color: #e8b84b; }
.icard-foot { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 4px; }
.total { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; color: #e8b84b; line-height: 1; }

.stars { display: flex; gap: 2px; }
.star { background: none; border: none; font-size: 20px; cursor: pointer; color: #22222e; transition: color .1s, transform .1s; padding: 0 1px; line-height: 1; }
.star.on { color: #e8b84b; }
.star:hover { transform: scale(1.15); }

.card-row { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 5px; transition: background .15s; }
.card-row.owned { background: #0d1a0f; }

.thumb-btn { background: #0a0a0d; border: 1px solid #1c1c24; border-radius: 5px; cursor: pointer; padding: 0; overflow: hidden; width: 48px; height: 68px; flex-shrink: 0; transition: border-color .15s, box-shadow .15s; display: flex; align-items: center; justify-content: center; }
.thumb-btn:hover { border-color: #e8b84b55; box-shadow: 0 0 12px #e8b84b18; }
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-ph { color: #28283a; font-size: 20px; font-weight: 300; }

.type-sel { background: #0d0d10; border: 1px solid #1a1a22; border-radius: 3px; color: #e8b84b; font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 1px; padding: 4px 5px; cursor: pointer; width: 54px; flex-shrink: 0; }
.type-sel option { background: #111114; }

.name-in { flex: 1; background: transparent; border: 1px solid #1a1a22; border-radius: 3px; color: #b8b4b0; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 5px 9px; outline: none; transition: border-color .15s; min-width: 0; }
.name-in:focus { border-color: #e8b84b44; color: #f0ede8; }
.name-in::placeholder { color: #22222e; }

.srch-btn { background: #131318; border: 1px solid #1c1c24; border-radius: 3px; color: #5a5868; font-size: 13px; padding: 5px 9px; cursor: pointer; flex-shrink: 0; transition: all .15s; line-height: 1; }
.srch-btn:hover { border-color: #e8b84b66; background: #e8b84b10; }

.price-cell { display: flex; align-items: center; gap: 4px; flex-shrink: 0; min-width: 88px; }
.price-in { width: 52px; background: transparent; border: 1px solid #1a1a22; border-radius: 3px; color: #b0acb8; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 5px; outline: none; text-align: right; transition: border-color .15s; }
.price-in:focus { border-color: #e8b84b55; color: #e8b84b; }
.price-in::-webkit-inner-spin-button { display: none; }
input[type=number] { -moz-appearance: textfield; }
.curr { font-size: 11px; color: #383844; letter-spacing: 1px; }
.price-converted { font-size: 11px; color: #4a6644; letter-spacing: 0.5px; }
.cm-link { color: #4a88bf; font-size: 12px; text-decoration: none; transition: color .15s; margin-left: 2px; }
.cm-link:hover { color: #7ab8ef; }
.price-spin { font-size: 18px; color: #e8b84b; margin: 0 auto; }

.own-btn { background: none; border: 1px solid #1a2a1a; color: #2a3a2a; border-radius: 3px; font-size: 13px; cursor: pointer; padding: 4px 7px; line-height: 1.2; transition: all .15s; flex-shrink: 0; }
.own-btn:hover { border-color: #3a6a3a; color: #5a9a5a; }
.own-btn.owned-on { border-color: #3a6a3a88; color: #5aaa5a; background: #1a3a1a; }

@keyframes spin { to { transform: rotate(360deg); } }
.spinning { display: inline-block; animation: spin 0.9s linear infinite; }

.del { background: none; border: 1px solid #1a1a22; color: #323240; border-radius: 3px; font-size: 14px; cursor: pointer; padding: 3px 7px; line-height: 1.2; transition: all .15s; flex-shrink: 0; }
.del:hover { border-color: #8b202044; color: #c0392b; }

.add-wrap { margin-top: 24px; display: flex; justify-content: center; }
.add-set { background: #111114; border: 1px dashed #1c1c24; color: #383844; font-family: 'DM Sans', sans-serif; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; padding: 14px 36px; border-radius: 4px; cursor: pointer; transition: all .2s; width: 100%; max-width: 400px; }
.add-set:hover { border-color: #e8b84b44; color: #e8b84b; background: #e8b84b06; }

.overlay { position: fixed; inset: 0; background: #000000d0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(6px); }
.modal { background: #111114; border: 1px solid #252535; border-radius: 10px; width: 100%; max-width: 700px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 32px 80px #00000080; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 14px; border-bottom: 1px solid #1a1a24; flex-shrink: 0; }
.modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 2px; color: #f0ede8; }
.x-btn { background: none; border: none; color: #484858; font-size: 16px; cursor: pointer; transition: color .15s; padding: 2px 6px; }
.x-btn:hover { color: #e8e4df; }
.modal-bar { display: flex; gap: 8px; padding: 14px 22px; border-bottom: 1px solid #1a1a24; flex-shrink: 0; }
.modal-input { flex: 1; background: #0a0a0d; border: 1px solid #222230; border-radius: 5px; color: #e8e4df; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 9px 14px; outline: none; transition: border-color .15s; }
.modal-input:focus { border-color: #e8b84b66; }
.modal-input::placeholder { color: #28283a; }
.modal-go { background: #e8b84b18; border: 1px solid #e8b84b66; color: #e8b84b; font-family: 'DM Sans', sans-serif; font-size: 12px; letter-spacing: 1px; padding: 9px 20px; border-radius: 5px; cursor: pointer; transition: all .15s; text-transform: uppercase; white-space: nowrap; }
.modal-go:hover { background: #e8b84b28; }
.modal-msg { padding: 10px 22px; font-size: 12px; color: #4a4858; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.modal-msg.muted { color: #303040; }
.modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; padding: 14px 22px 20px; overflow-y: auto; flex: 1; }
.res-card { background: #0d0d10; border: 1px solid #1a1a24; border-radius: 7px; cursor: pointer; padding: 8px; display: flex; flex-direction: column; gap: 7px; transition: all .15s; text-align: left; }
.res-card:hover { border-color: #e8b84b66; background: #e8b84b0a; transform: translateY(-2px); box-shadow: 0 6px 24px #00000040; }
.res-img { width: 100%; border-radius: 5px; display: block; aspect-ratio: 5/7; object-fit: cover; }
.res-meta { display: flex; flex-direction: column; gap: 2px; }
.res-name { font-size: 11px; color: #c0bcb8; font-weight: 500; line-height: 1.3; }
.res-set { font-size: 10px; color: #404050; line-height: 1.3; }
.res-artist { font-size: 9px; color: #e8b84b88; letter-spacing: 0.5px; }
`;
