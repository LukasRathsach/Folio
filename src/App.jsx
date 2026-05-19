import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { loadFromSupabase, saveToSupabase, supabase } from "./supabase.js";

const DKK_RATE = 7.46;
const LS_KEY = "tcg-wantlist-v1";
const SAVE_DEBOUNCE_MS = 1500;

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
        s.illustrator, s.want, c.type, c.name,
        c.tcgSetName || "", c.price ?? "",
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

function loadLocalState() {
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
          aria-label={`${s} stjerne${s !== 1 ? "r" : ""}`}
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

  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{cardType} SØGNING · pokemontcg.io</span>
          <button className="x-btn" onClick={onClose} aria-label="Luk søgning">✕</button>
        </div>
        <div className="modal-bar">
          <input
            className="modal-input"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(q)}
            placeholder="Fx Charizard ex, Pikachu, Eevee…"
            aria-label="Søg kort"
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

  const eurVal = card.price != null ? card.price.toFixed(2) : null;
  const dkkVal = card.price != null ? (card.price * DKK_RATE).toFixed(2) : null;

  return (
    <>
      <div className={"card-row" + (card.owned ? " owned" : "")}>
        <button
          className="thumb-btn"
          onClick={() => setShowModal(true)}
          title="Søg kort"
          aria-label="Søg kort på pokemontcg.io"
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
          aria-label="Korttype"
        >
          <option>IR</option>
          <option>SIR</option>
        </select>

        <input
          className="name-in"
          placeholder="Kortnavn…"
          value={card.name}
          onChange={(e) => onUpdate({ ...card, name: e.target.value })}
          aria-label="Kortnavn"
        />

        <button
          className="srch-btn"
          onClick={() => setShowModal(true)}
          title="Hent billede + Cardmarket-pris"
          aria-label="Søg"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>

        <div className="price-cell">
          {card.loadingPrice ? (
            <span className="spinning price-spin">⟳</span>
          ) : (
            <>
              <div className="price-stack">
                <div className="price-row-inner">
                  <input
                    className="price-in"
                    type="number"
                    placeholder="–"
                    value={card.price ?? ""}
                    onChange={(e) =>
                      onUpdate({ ...card, price: parseFloat(e.target.value) || null })
                    }
                    aria-label="Pris i EUR"
                  />
                  <span className="curr">€</span>
                  {card.url && (
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cm-link"
                      title="Åbn på Cardmarket"
                      aria-label="Åbn på Cardmarket"
                    >
                      ↗
                    </a>
                  )}
                </div>
                {currency === "DKK" && dkkVal && (
                  <div className="price-dkk">{dkkVal} kr</div>
                )}
              </div>
            </>
          )}
        </div>

        <button
          className={"own-btn" + (card.owned ? " owned-on" : "")}
          onClick={() => onUpdate({ ...card, owned: !card.owned })}
          title={card.owned ? "Ejer det — klik for at fjerne" : "Markér som ejet"}
          aria-label={card.owned ? "Fjern ejet-markering" : "Markér som ejet"}
          aria-pressed={card.owned}
        >
          {card.owned ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
          )}
        </button>

        <button className="del" onClick={onDelete} aria-label="Slet kort">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
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
    currency === "DKK"
      ? (total * DKK_RATE).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : total.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const ownedCount = set.cards.filter((c) => c.owned).length;

  return (
    <div className="icard">
      <div className="icard-head">
        <div className="icard-head-left">
          <div className="icard-label">ILLUSTRATOR</div>
          <input
            className="icard-name"
            placeholder="Navn…"
            value={set.illustrator}
            onChange={(e) => onUpdate({ ...set, illustrator: e.target.value })}
            aria-label="Illustratornavn"
          />
          {set.cards.length > 0 && (
            <div className="icard-meta">
              <span className="meta-pill">{set.cards.length} kort</span>
              {ownedCount > 0 && (
                <span className="meta-pill owned-pill">{ownedCount} ejet</span>
              )}
            </div>
          )}
        </div>
        <button className="del-set" onClick={onDelete} aria-label="Slet illustrator-sæt">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="divider" />

      {set.cards.length === 0 ? (
        <div className="empty-cards">
          <span className="empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </span>
          <span className="empty-text">Tilføj dit første kort</span>
        </div>
      ) : (
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
      )}

      <button className="add-card" onClick={addCard}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Tilføj kort
      </button>

      <div className="icard-foot">
        <div>
          <div className="icard-label">VIL HAV</div>
          <StarRating value={set.want} onChange={(v) => onUpdate({ ...set, want: v })} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="icard-label">TOTAL</div>
          {hasLoading ? (
            <span className="spinning" style={{ fontSize: 22, color: "#e8b84b" }}>⟳</span>
          ) : (
            <span className="total">{displayTotal} {currSymbol}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sync status indicator ─────────────────────────────────────────────────────

function SyncDot({ status }) {
  if (!supabase) return null;
  const map = {
    idle: { color: "#3a3a4a", title: "Synkroniseret" },
    saving: { color: "#e8b84b", title: "Gemmer…" },
    saved: { color: "#4a9a5a", title: "Gemt til Supabase" },
    error: { color: "#c0392b", title: "Synk fejlede" },
  };
  const { color, title } = map[status] || map.idle;
  return (
    <div className="sync-dot" style={{ background: color }} title={title} aria-label={title} />
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const INIT = [{ id: 1, illustrator: "", cards: [], want: 3 }];

export default function App() {
  const [sets, setSets] = useState(() => loadLocalState() ?? INIT);
  const [sort, setSort] = useState("want");
  const [dir, setDir] = useState("desc");
  const [filter, setFilter] = useState("all");
  const [currency, setCurrency] = useState("EUR");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [loading, setLoading] = useState(!!supabase);
  const saveTimer = useRef(null);

  // Load from Supabase on mount (overrides localStorage if available)
  useEffect(() => {
    if (!supabase) return;
    loadFromSupabase().then((data) => {
      if (data && data.length > 0) setSets(data);
      setLoading(false);
    });
  }, []);

  // Sync: localStorage immediately, Supabase debounced
  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(sets)); } catch {}

    if (!supabase) return;
    setSyncStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveToSupabase(sets);
        setSyncStatus("saved");
        setTimeout(() => setSyncStatus("idle"), 2000);
      } catch {
        setSyncStatus("error");
      }
    }, SAVE_DEBOUNCE_MS);
  }, [sets, loading]);

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
    currency === "DKK"
      ? (grand * DKK_RATE).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : grand.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currSymbol = currency === "DKK" ? "kr" : "€";

  if (loading) {
    return (
      <>
        <style>{CSS}</style>
        <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div style={{ textAlign: "center" }}>
            <span className="spinning" style={{ fontSize: 32, color: "#e8b84b" }}>⟳</span>
            <p style={{ marginTop: 16, color: "#5a5870", fontSize: 12, letterSpacing: 2 }}>HENTER FRA SUPABASE</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="header">
          <div className="logo-row">
            <span className="logo">TCG <em>WANTLIST</em></span>
            <span className="pill">SIR · IR</span>
            <div style={{ flex: 1 }} />
            <SyncDot status={syncStatus} />
          </div>
          <p className="sub">
            Billeder via pokemontcg.io · Priser fra Cardmarket (engelske kort, ikke UK)
          </p>
        </div>

        <div className="controls">
          <div className="ctrl-group">
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
          </div>

          <div className="ctrl-sep" />

          <div className="ctrl-group">
            <span className="ctrl-lbl">VIS</span>
            {["all", "IR", "SIR"].map((f) => (
              <button
                key={f}
                className={"ctrl" + (filter === f ? " active" : "")}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Alle" : f}
              </button>
            ))}
          </div>

          <div className="ctrl-sep" />

          <div className="ctrl-group">
            <span className="ctrl-lbl">VALUTA</span>
            {["EUR", "DKK"].map((c) => (
              <button
                key={c}
                className={"ctrl" + (currency === c ? " active" : "")}
                onClick={() => setCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <div className="ctrl-group">
            <button className="export-btn" onClick={() => exportCSV(sets)} title="Eksporter til CSV">CSV</button>
            <button className="export-btn" onClick={() => exportJSON(sets)} title="Eksporter til JSON">JSON</button>
          </div>

          <div className="ctrl-sep" />

          <span className="ctrl-lbl">TOTAL</span>
          <span className="grand">{grandDisplay} {currSymbol}</span>
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
          <button className="add-set" onClick={add}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tilføj illustrator
          </button>
        </div>
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600&display=swap');

:root {
  --gold: #e8b84b;
  --gold-dim: rgba(232,184,75,0.15);
  --gold-border: rgba(232,184,75,0.25);
  --gold-glow: rgba(232,184,75,0.08);
  --bg: #080809;
  --bg-card: rgba(255,255,255,0.028);
  --bg-elevated: rgba(255,255,255,0.05);
  --border: rgba(255,255,255,0.07);
  --border-hover: rgba(255,255,255,0.12);
  --text: #edeaf5;
  --text-muted: #6a6880;
  --text-dim: #383848;
  --green: #4a9a5a;
  --green-dim: rgba(74,154,90,0.15);
  --red: #c0392b;
  --ease: cubic-bezier(0.16,1,0.3,1);
  --radius: 12px;
  --radius-sm: 6px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(232,184,75,0.04) 0%, transparent 70%);
  color: var(--text);
  font-family: 'Inter', sans-serif;
  min-height: 100vh;
}

button, select, input { font-family: inherit; }
button { cursor: pointer; }

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }

.app { max-width: 960px; margin: 0 auto; padding: 52px 24px 100px; }

/* ── Header ── */
.header { margin-bottom: 44px; }
.logo-row { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 6px; }
.logo { font-family: 'Bebas Neue', sans-serif; font-size: 52px; letter-spacing: 2px; line-height: 1; }
.logo em { color: var(--gold); font-style: normal; }
.pill {
  font-family: 'Bebas Neue', sans-serif; font-size: 12px; letter-spacing: 3px;
  padding: 4px 10px; border: 1px solid var(--gold-border); color: var(--gold);
  border-radius: 3px; margin-bottom: 10px; background: var(--gold-glow);
}
.sub { font-size: 12px; color: var(--text-dim); font-weight: 400; letter-spacing: 0.2px; }

/* ── Sync dot ── */
.sync-dot {
  width: 7px; height: 7px; border-radius: 50%; margin-bottom: 12px; flex-shrink: 0;
  transition: background 0.5s var(--ease);
}

/* ── Controls ── */
.controls {
  display: flex; align-items: center; gap: 8px; margin-bottom: 32px;
  flex-wrap: wrap; background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 14px;
}
.ctrl-group { display: flex; align-items: center; gap: 6px; }
.ctrl-sep { width: 1px; height: 18px; background: var(--border); flex-shrink: 0; }
.ctrl-lbl { font-size: 9px; letter-spacing: 2.5px; color: var(--text-dim); font-weight: 500; text-transform: uppercase; white-space: nowrap; }
.ctrl {
  background: transparent; border: 1px solid transparent; color: var(--text-muted);
  font-size: 11px; letter-spacing: 0.5px; padding: 4px 10px;
  border-radius: 5px; transition: all 0.15s var(--ease); text-transform: uppercase; font-weight: 500;
}
.ctrl:hover { border-color: var(--border-hover); color: var(--text); }
.ctrl.active { background: var(--gold-dim); border-color: var(--gold-border); color: var(--gold); }
.arr { color: var(--gold); }
.grand { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 1px; color: var(--gold); }

.export-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  font-size: 9px; letter-spacing: 2px; padding: 4px 9px; border-radius: 4px;
  transition: all 0.15s var(--ease); font-weight: 500;
}
.export-btn:hover { border-color: var(--gold-border); color: var(--gold); background: var(--gold-glow); }

/* ── Grid ── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 14px; }

/* ── Illustrator Card ── */
.icard {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px;
  display: flex; flex-direction: column; gap: 16px;
  transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
  position: relative;
}
.icard::before {
  content: '';
  position: absolute; inset: 0; border-radius: var(--radius);
  background: linear-gradient(135deg, rgba(232,184,75,0.03) 0%, transparent 50%);
  pointer-events: none; opacity: 0; transition: opacity 0.25s var(--ease);
}
.icard:hover { border-color: var(--border-hover); box-shadow: 0 0 0 1px rgba(232,184,75,0.06), 0 16px 48px rgba(0,0,0,0.3); }
.icard:hover::before { opacity: 1; }

.icard-head { display: flex; justify-content: space-between; align-items: flex-start; }
.icard-head-left { display: flex; flex-direction: column; gap: 3px; }
.icard-label { font-size: 9px; letter-spacing: 3px; color: var(--text-dim); font-weight: 500; text-transform: uppercase; }
.icard-name {
  background: transparent; border: none; outline: none;
  font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px;
  color: var(--text); width: 300px;
}
.icard-name::placeholder { color: #222230; }
.icard-meta { display: flex; gap: 6px; margin-top: 4px; }
.meta-pill {
  font-size: 10px; letter-spacing: 0.5px; color: var(--text-muted);
  background: var(--bg-elevated); border: 1px solid var(--border);
  padding: 2px 8px; border-radius: 99px;
}
.owned-pill { color: var(--green); border-color: rgba(74,154,90,0.25); background: var(--green-dim); }

.del-set {
  background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: var(--radius-sm); padding: 6px; line-height: 0;
  transition: all 0.15s var(--ease); display: flex; align-items: center;
}
.del-set:hover { border-color: rgba(192,57,43,0.4); color: var(--red); background: rgba(192,57,43,0.08); }

.divider { height: 1px; background: var(--border); }

/* ── Empty state ── */
.empty-cards {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 28px 0; color: var(--text-dim);
}
.empty-icon { opacity: 0.4; }
.empty-text { font-size: 12px; letter-spacing: 1px; }

/* ── Cards list ── */
.cards-list { display: flex; flex-direction: column; gap: 4px; }

/* ── Add card button ── */
.add-card {
  align-self: flex-start; background: none; border: 1px dashed rgba(255,255,255,0.08);
  color: var(--text-dim); font-size: 11px; letter-spacing: 0.5px; font-weight: 500;
  padding: 5px 12px; border-radius: 5px; transition: all 0.15s var(--ease);
  display: flex; align-items: center; gap: 6px;
}
.add-card:hover { border-color: var(--gold-border); color: var(--gold); background: var(--gold-glow); }

/* ── Card footer ── */
.icard-foot { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 4px; }
.total { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; color: var(--gold); line-height: 1; }

/* ── Stars ── */
.stars { display: flex; gap: 2px; }
.star { background: none; border: none; font-size: 19px; cursor: pointer; color: var(--text-dim); transition: color 0.1s, transform 0.15s var(--ease); padding: 0 1px; line-height: 1; }
.star.on { color: var(--gold); }
.star:hover { transform: scale(1.2); }

/* ── Card row ── */
.card-row {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 7px; border-radius: 8px;
  transition: background 0.15s var(--ease);
  border-left: 2px solid transparent;
}
.card-row:hover { background: rgba(255,255,255,0.025); }
.card-row.owned { border-left-color: var(--green); background: rgba(74,154,90,0.06); }

/* ── Thumbnail ── */
.thumb-btn {
  background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 7px;
  cursor: pointer; padding: 0; overflow: hidden; width: 46px; height: 66px; flex-shrink: 0;
  transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  display: flex; align-items: center; justify-content: center;
}
.thumb-btn:hover { border-color: rgba(232,184,75,0.4); box-shadow: 0 0 16px rgba(232,184,75,0.12); }
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-ph { color: var(--text-dim); font-size: 18px; font-weight: 300; }

/* ── Type selector ── */
.type-sel {
  background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--gold); font-family: 'Bebas Neue', sans-serif; font-size: 13px; letter-spacing: 1px;
  padding: 4px 5px; cursor: pointer; width: 52px; flex-shrink: 0; appearance: none;
  transition: border-color 0.15s;
}
.type-sel:focus { outline: none; border-color: var(--gold-border); }
.type-sel option { background: #111114; }

/* ── Name input ── */
.name-in {
  flex: 1; background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: #a8a4b0; font-size: 12.5px; font-weight: 400; padding: 5px 9px; outline: none;
  transition: border-color 0.15s var(--ease), color 0.15s; min-width: 0;
}
.name-in:focus { border-color: rgba(232,184,75,0.35); color: var(--text); }
.name-in::placeholder { color: var(--text-dim); }

/* ── Search button ── */
.srch-btn {
  background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text-muted); padding: 6px 8px; flex-shrink: 0;
  transition: all 0.15s var(--ease); line-height: 0; display: flex; align-items: center;
}
.srch-btn:hover { border-color: var(--gold-border); background: var(--gold-glow); color: var(--gold); }

/* ── Price cell ── */
.price-cell { display: flex; align-items: center; gap: 4px; flex-shrink: 0; min-width: 90px; }
.price-stack { display: flex; flex-direction: column; gap: 1px; }
.price-row-inner { display: flex; align-items: center; gap: 3px; }
.price-in {
  width: 50px; background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: #9a96a8; font-size: 12px; padding: 4px 6px; outline: none; text-align: right;
  transition: border-color 0.15s var(--ease), color 0.15s; font-variant-numeric: tabular-nums;
}
.price-in:focus { border-color: rgba(232,184,75,0.4); color: var(--gold); }
.price-in::-webkit-inner-spin-button { display: none; }
input[type=number] { -moz-appearance: textfield; }
.curr { font-size: 10px; color: var(--text-dim); letter-spacing: 1px; font-weight: 500; }
.price-dkk { font-size: 9.5px; color: rgba(74,154,90,0.6); letter-spacing: 0.3px; font-variant-numeric: tabular-nums; }
.cm-link { color: #4a78af; font-size: 11px; text-decoration: none; transition: color 0.15s; }
.cm-link:hover { color: #7ab0ef; }
.price-spin { font-size: 17px; color: var(--gold); margin: 0 auto; }

/* ── Own button ── */
.own-btn {
  background: none; border: 1px solid rgba(74,154,90,0.2); color: var(--text-dim);
  border-radius: var(--radius-sm); padding: 5px 7px; line-height: 0; flex-shrink: 0;
  transition: all 0.15s var(--ease); display: flex; align-items: center;
}
.own-btn:hover { border-color: rgba(74,154,90,0.5); color: var(--green); background: var(--green-dim); }
.own-btn.owned-on { border-color: rgba(74,154,90,0.5); color: var(--green); background: var(--green-dim); }

/* ── Delete button ── */
.del {
  background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: var(--radius-sm); font-size: 13px; padding: 5px 7px; line-height: 0;
  transition: all 0.15s var(--ease); flex-shrink: 0; display: flex; align-items: center;
}
.del:hover { border-color: rgba(192,57,43,0.4); color: var(--red); background: rgba(192,57,43,0.08); }

/* ── Add set ── */
.add-wrap { margin-top: 28px; display: flex; justify-content: center; }
.add-set {
  background: var(--bg-card); border: 1px dashed rgba(255,255,255,0.1); color: var(--text-muted);
  font-size: 11px; letter-spacing: 2px; text-transform: uppercase; font-weight: 500;
  padding: 16px 40px; border-radius: var(--radius); transition: all 0.2s var(--ease);
  width: 100%; max-width: 420px; display: flex; align-items: center; justify-content: center; gap: 8px;
}
.add-set:hover { border-color: var(--gold-border); color: var(--gold); background: var(--gold-glow); box-shadow: 0 0 0 1px rgba(232,184,75,0.04); }

/* ── Spinner ── */
@keyframes spin { to { transform: rotate(360deg); } }
.spinning { display: inline-block; animation: spin 0.9s linear infinite; }

/* ── Modal ── */
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.modal {
  background: rgba(14,14,18,0.96); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px; width: 100%; max-width: 700px; max-height: 88vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(232,184,75,0.06);
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 2.5px; color: var(--text); }
.x-btn {
  background: none; border: 1px solid var(--border); color: var(--text-muted);
  font-size: 14px; border-radius: var(--radius-sm); padding: 5px 8px;
  transition: all 0.15s; line-height: 1;
}
.x-btn:hover { border-color: var(--border-hover); color: var(--text); }
.modal-bar { display: flex; gap: 8px; padding: 14px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-input {
  flex: 1; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 14px; padding: 10px 14px; outline: none;
  transition: border-color 0.15s var(--ease);
}
.modal-input:focus { border-color: var(--gold-border); }
.modal-input::placeholder { color: var(--text-dim); }
.modal-go {
  background: var(--gold-dim); border: 1px solid var(--gold-border); color: var(--gold);
  font-size: 11px; letter-spacing: 1.5px; font-weight: 600;
  padding: 10px 20px; border-radius: 8px; transition: all 0.15s var(--ease);
  text-transform: uppercase; white-space: nowrap;
}
.modal-go:hover { background: rgba(232,184,75,0.22); box-shadow: 0 0 20px rgba(232,184,75,0.12); }
.modal-msg {
  padding: 10px 24px; font-size: 12px; color: var(--text-muted);
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.modal-msg.muted { color: var(--text-dim); }
.modal-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px; padding: 14px 24px 22px; overflow-y: auto; flex: 1;
}
.res-card {
  background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px;
  cursor: pointer; padding: 8px; display: flex; flex-direction: column; gap: 7px;
  transition: all 0.2s var(--ease); text-align: left;
}
.res-card:hover {
  border-color: var(--gold-border); background: var(--gold-glow);
  transform: translateY(-2px); box-shadow: 0 8px 28px rgba(0,0,0,0.4);
}
.res-img { width: 100%; border-radius: 6px; display: block; aspect-ratio: 5/7; object-fit: cover; }
.res-meta { display: flex; flex-direction: column; gap: 2px; }
.res-name { font-size: 11px; color: #c0bcb8; font-weight: 500; line-height: 1.3; }
.res-set { font-size: 10px; color: #404050; line-height: 1.3; }
.res-artist { font-size: 9px; color: rgba(232,184,75,0.5); letter-spacing: 0.3px; }

@media (max-width: 500px) {
  .app { padding: 32px 16px 80px; }
  .grid { grid-template-columns: 1fr; }
  .logo { font-size: 40px; }
  .controls { gap: 6px; }
}
`;
