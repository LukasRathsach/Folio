import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { loadFromSupabase, saveToSupabase, supabase } from "./supabase.js";

const DKK_RATE = 7.46;
const LS_KEY = "tcg-wantlist-v1";
const SAVE_DEBOUNCE_MS = 1500;

// ─── API helpers ─────────────────────────────────────────────────────────────

function rarityFilter(type) {
  if (type === "SIR") return 'rarity:"Special Illustration Rare"';
  if (type === "IR")  return 'rarity:"Illustration Rare"';
  return '(rarity:"Special Illustration Rare" OR rarity:"Illustration Rare")';
}

async function fetchCards(q) {
  const res = await fetch(
    `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&select=id,name,images,set,artist,cardmarket,rarity&orderBy=-set.releaseDate&pageSize=50`
  );
  if (!res.ok) throw new Error("TCG API fejlede");
  return (await res.json()).data || [];
}

// Semantic: uses longest word as API filter, then client-filters all words
async function semanticSearch(query, mode, type) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const primary = [...words].sort((a, b) => b.length - a.length)[0];
  const rf = rarityFilter(type);

  const field = mode === "artist" ? "artist" : "name";
  const cards = await fetchCards(`${field}:${primary}* ${rf}`);

  if (words.length === 1) return cards;
  return cards.filter((c) => {
    const haystack = (mode === "artist" ? (c.artist || "") : c.name).toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

// Used by CardRow's inline search modal (keeps rarity typed)
async function searchTCGCards(query, type) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const primary = [...words].sort((a, b) => b.length - a.length)[0];
  const rf = rarityFilter(type);
  const cards = await fetchCards(`name:${primary}* ${rf}`);
  if (words.length === 1) return cards;
  return cards.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
}

function extractPrice(tcgCard) {
  return {
    price: tcgCard.cardmarket?.prices?.trendPrice ?? null,
    url:   tcgCard.cardmarket?.url ?? null,
  };
}

function cardTypeFromRarity(rarity) {
  return rarity === "Special Illustration Rare" ? "SIR" : "IR";
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function exportJSON(sets) {
  triggerDownload(new Blob([JSON.stringify(sets, null, 2)], { type: "application/json" }), "tcg-wantlist.json");
}

function exportCSV(sets) {
  const rows = [["Illustrator","Interesse","Type","Kortnavn","Sæt","Pris EUR","Pris DKK","Ejet","Cardmarket"]];
  sets.forEach((s) => s.cards.forEach((c) => rows.push([
    s.illustrator, s.want, c.type, c.name, c.tcgSetName || "",
    c.price ?? "", c.price ? (c.price * DKK_RATE).toFixed(2) : "",
    c.owned ? "Ja" : "Nej", c.url || "",
  ])));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "tcg-wantlist.csv");
}

// ─── localStorage ─────────────────────────────────────────────────────────────

function loadLocalState() {
  try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

// ─── Global Search ────────────────────────────────────────────────────────────

function GlobalSearch({ sets, onAddCard }) {
  const [q, setQ]           = useState("");
  const [mode, setMode]     = useState("card");   // "card" | "artist"
  const [type, setType]     = useState("all");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  // Build a Set of tcgIds already in the wantlist for O(1) lookup
  const addedIds = useMemo(
    () => new Set(sets.flatMap((s) => s.cards.map((c) => c.tcgId).filter(Boolean))),
    [sets]
  );

  const doSearch = useCallback(async (query = q) => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(false);
    try {
      setResults(await semanticSearch(query, mode, type));
    } catch {
      setResults([]);
    }
    setLoading(false);
    setSearched(true);
  }, [q, mode, type]);

  // Re-run when mode/type changes if there's already a query
  useEffect(() => { if (q.trim()) doSearch(); }, [mode, type]);

  const clear = () => { setQ(""); setResults([]); setSearched(false); inputRef.current?.focus(); };

  return (
    <div className="search-panel">
      {/* Search bar row */}
      <div className="search-bar-row">
        <div className="search-input-wrap">
          <span className="search-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder={mode === "artist" ? "Søg efter illustrator… fx Mitsuhiro Arita" : "Søg efter kort… fx Charizard ex, Pikachu"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            aria-label="Global søgning"
          />
          {q && (
            <button className="search-clear" onClick={clear} aria-label="Ryd søgning">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <button className="btn-primary" onClick={() => doSearch()}>Søg</button>
      </div>

      {/* Filters */}
      <div className="search-filters">
        <div className="btn-group">
          <span className="toolbar-label">Søg på</span>
          {[["card","Kortnavn"],["artist","Illustrator"]].map(([v,l]) => (
            <button key={v} className={"btn-seg" + (mode === v ? " active" : "")} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
        <div className="btn-group">
          <span className="toolbar-label">Type</span>
          {[["all","Alle"],["IR","IR"],["SIR","SIR"]].map(([v,l]) => (
            <button key={v} className={"btn-seg" + (type === v ? " active" : "")} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
        {searched && !loading && (
          <span className="search-count">{results.length} resultater</span>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div className="search-loading">
          <span className="spinning">⟳</span> Søger pokemontcg.io…
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="search-empty">
          <p>Ingen resultater for <strong>"{q}"</strong></p>
          <p className="search-empty-sub">Prøv færre ord eller skift søgemåde</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="search-results-grid">
          {results.map((card) => {
            const already = addedIds.has(card.id);
            const { price } = extractPrice(card);
            return (
              <div key={card.id} className={"result-card" + (already ? " already-added" : "")}>
                <div className="result-img-wrap">
                  <img src={card.images.small} alt={card.name} className="result-img" loading="lazy" />
                  <span className={"result-type-badge" + (card.rarity === "Special Illustration Rare" ? " sir" : " ir")}>
                    {card.rarity === "Special Illustration Rare" ? "SIR" : "IR"}
                  </span>
                </div>
                <div className="result-info">
                  <p className="result-name">{card.name}</p>
                  <p className="result-set">{card.set.name}</p>
                  {card.artist && <p className="result-artist">{card.artist}</p>}
                  {price != null && (
                    <p className="result-price">{price.toFixed(2)} €</p>
                  )}
                </div>
                <button
                  className={"result-add-btn" + (already ? " added" : "")}
                  onClick={() => !already && onAddCard(card)}
                  disabled={already}
                  aria-label={already ? "Allerede tilføjet" : `Tilføj ${card.name}`}
                >
                  {already ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Star Rating ─────────────────────────────────────────────────────────────

function StarRating({ value, onChange }) {
  const [hov, setHov] = useState(null);
  return (
    <div className="stars" onMouseLeave={() => setHov(null)}>
      {[1,2,3,4,5].map((s) => (
        <button key={s} className={"star" + (s <= (hov ?? value) ? " on" : "")}
          onMouseEnter={() => setHov(s)} onClick={() => onChange(s)}
          aria-label={`${s} stjerne${s !== 1 ? "r" : ""}`}>★</button>
      ))}
    </div>
  );
}

// ─── Inline Search Modal (CardRow) ────────────────────────────────────────────

function SearchModal({ cardName, cardType, onSelect, onClose }) {
  const [q, setQ] = useState(cardName || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const doSearch = async (query) => {
    if (!query.trim()) return;
    setLoading(true); setDone(false);
    try { setResults(await searchTCGCards(query.trim(), cardType)); }
    catch { setResults([]); }
    setLoading(false); setDone(true);
  };

  useEffect(() => { if (cardName) doSearch(cardName); }, []);
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{cardType} søgning</span>
          <button className="modal-close" onClick={onClose} aria-label="Luk">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-bar">
          <input className="modal-input" value={q} autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(q)}
            placeholder="Fx Charizard ex, Pikachu…" aria-label="Søg kort" />
          <button className="btn-primary" onClick={() => doSearch(q)}>Søg</button>
        </div>
        <div className="modal-status">
          {loading && <span className="status-row"><span className="spinning">⟳</span> Søger…</span>}
          {!loading && done && results.length === 0 && <span className="status-row muted">Ingen resultater</span>}
          {!loading && done && results.length > 0 && <span className="status-row muted">{results.length} resultater</span>}
        </div>
        <div className="modal-grid">
          {results.map((c) => (
            <button key={c.id} className="res-card" onClick={() => onSelect(c)}>
              <img src={c.images.small} alt={c.name} className="res-img" loading="lazy" />
              <div className="res-meta">
                <span className="res-name">{c.name}</span>
                <span className="res-set">{c.set.name}</span>
                {c.artist && <span className="res-artist">{c.artist}</span>}
                {c.cardmarket?.prices?.trendPrice != null && (
                  <span className="res-price">{c.cardmarket.prices.trendPrice.toFixed(2)} €</span>
                )}
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

  const handleSelect = (tcgCard) => {
    setShowModal(false);
    const { price, url } = extractPrice(tcgCard);
    onUpdate({ id: card.id, type: card.type, name: tcgCard.name, tcgId: tcgCard.id,
      image: tcgCard.images?.large || tcgCard.images?.small || null,
      tcgSetName: tcgCard.set.name, price, url, loadingPrice: false, owned: card.owned });
    if (tcgCard.artist) onArtistDetected?.(tcgCard.artist);
  };

  const displayPrice = card.price != null
    ? (currency === "DKK" ? card.price * DKK_RATE : card.price).toFixed(2)
    : "";

  return (
    <>
      <div className={"card-row" + (card.owned ? " owned" : "")}>
        <button className="thumb-btn" onClick={() => setShowModal(true)} aria-label="Søg kort">
          {card.image ? <img className="thumb" src={card.image} alt={card.name} /> : <span className="thumb-ph">?</span>}
        </button>
        <select className="select-input" value={card.type}
          onChange={(e) => onUpdate({ ...card, type: e.target.value })} aria-label="Korttype">
          <option>IR</option><option>SIR</option>
        </select>
        <input className="text-input" placeholder="Kortnavn…" value={card.name}
          onChange={(e) => onUpdate({ ...card, name: e.target.value })} aria-label="Kortnavn" />
        <button className="icon-btn" onClick={() => setShowModal(true)} aria-label="Søg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <div className="price-cell">
          <input className="price-input" type="number" placeholder="—" value={displayPrice}
            onChange={(e) => {
              const raw = parseFloat(e.target.value) || null;
              onUpdate({ ...card, price: currency === "DKK" && raw ? raw / DKK_RATE : raw });
            }} aria-label={`Pris i ${currency}`} />
          <span className="curr-label">{currency === "DKK" ? "kr" : "€"}</span>
          {card.url && <a href={card.url} target="_blank" rel="noopener noreferrer" className="cm-link" title="Åbn på Cardmarket">↗</a>}
        </div>
        <button className={"own-btn" + (card.owned ? " active" : "")}
          onClick={() => onUpdate({ ...card, owned: !card.owned })}
          aria-pressed={card.owned} title={card.owned ? "Ejet" : "Markér som ejet"}>
          {card.owned
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>}
        </button>
        <button className="icon-btn danger" onClick={onDelete} aria-label="Slet kort">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
      {showModal && <SearchModal cardName={card.name} cardType={card.type}
        onSelect={handleSelect} onClose={() => setShowModal(false)} />}
    </>
  );
}

// ─── Illustrator Card ─────────────────────────────────────────────────────────

function IllusCard({ set, currency, onUpdate, onDelete }) {
  const total = set.cards.reduce((s, c) => s + (c.price || 0), 0);
  const currSymbol = currency === "DKK" ? "kr" : "€";
  const displayTotal = (currency === "DKK" ? total * DKK_RATE : total)
    .toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ownedCount = set.cards.filter((c) => c.owned).length;

  const updCard = (idx, next) =>
    onUpdate({ ...set, cards: set.cards.map((c, i) => (i === idx ? next : c)) });
  const delCard = (idx) =>
    onUpdate({ ...set, cards: set.cards.filter((_, i) => i !== idx) });
  const addCard = () =>
    onUpdate({ ...set, cards: [...set.cards,
      { id: Date.now(), name: "", type: "SIR", price: null, image: null, url: null, tcgId: null, loadingPrice: false, owned: false }] });

  return (
    <div className="icard">
      <div className="icard-head">
        <div className="icard-head-left">
          <label className="field-label">Illustrator</label>
          <input className="icard-name-input" placeholder="Navn…" value={set.illustrator}
            onChange={(e) => onUpdate({ ...set, illustrator: e.target.value })} aria-label="Illustratornavn" />
          <div className="icard-badges">
            <span className="badge">{set.cards.length} kort</span>
            {ownedCount > 0 && <span className="badge success">{ownedCount} ejet</span>}
          </div>
        </div>
        <button className="icon-btn danger" onClick={onDelete} aria-label="Slet">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>

      <div className="divider" />

      {set.cards.length === 0 ? (
        <div className="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.3}}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <p>Ingen kort endnu</p>
          <p className="empty-sub">Søg og tilføj kort ovenfor</p>
        </div>
      ) : (
        <div className="cards-list">
          {set.cards.map((c, i) => (
            <CardRow key={c.id} card={c} currency={currency}
              onUpdate={(next) => updCard(i, next)}
              onDelete={() => delCard(i)}
              onArtistDetected={(artist) => {
                if (!set.illustrator) onUpdate({ ...set, illustrator: artist });
              }} />
          ))}
        </div>
      )}

      <button className="add-card-btn" onClick={addCard}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Tilføj kort manuelt
      </button>

      <div className="divider" />

      <div className="icard-foot">
        <div>
          <div className="field-label">Interesse</div>
          <StarRating value={set.want} onChange={(v) => onUpdate({ ...set, want: v })} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="field-label">Total</div>
          <span className="total-val">{displayTotal} {currSymbol}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sync badge ───────────────────────────────────────────────────────────────

function SyncBadge({ status }) {
  if (!supabase) return null;
  const map = { idle: ["#6d7175","Synkroniseret"], saving: ["#916a00","Gemmer…"], saved: ["#008060","Gemt"], error: ["#d82c0d","Fejl"] };
  const [color, label] = map[status] || map.idle;
  return (
    <span className="sync-badge" style={{ color }}>
      <span className="sync-dot" style={{ background: color }} />{label}
    </span>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const INIT = [{ id: 1, illustrator: "", cards: [], want: 3 }];

export default function App() {
  const [sets, setSets]         = useState(() => loadLocalState() ?? INIT);
  const [sort, setSort]         = useState("want");
  const [dir, setDir]           = useState("desc");
  const [filter, setFilter]     = useState("all");
  const [currency, setCurrency] = useState("EUR");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [loading, setLoading]   = useState(!!supabase);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    loadFromSupabase().then((data) => {
      if (data && data.length > 0) setSets(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(sets)); } catch {}
    if (!supabase) return;
    setSyncStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await saveToSupabase(sets); setSyncStatus("saved"); setTimeout(() => setSyncStatus("idle"), 2000); }
      catch { setSyncStatus("error"); }
    }, SAVE_DEBOUNCE_MS);
  }, [sets, loading]);

  const upd = (id, next) => setSets((s) => s.map((x) => (x.id === id ? next : x)));
  const del = (id) => setSets((s) => s.filter((x) => x.id !== id));
  const add = () => setSets((s) => [...s, { id: Date.now(), illustrator: "", cards: [], want: 3 }]);

  // Add card from global search — finds or creates illustrator folder
  const addCardToWantlist = useCallback((tcgCard) => {
    const { price, url } = extractPrice(tcgCard);
    const newCard = {
      id: Date.now(), tcgId: tcgCard.id,
      name: tcgCard.name, type: cardTypeFromRarity(tcgCard.rarity),
      price, url, image: tcgCard.images?.large || tcgCard.images?.small || null,
      tcgSetName: tcgCard.set.name, loadingPrice: false, owned: false,
    };
    const artist = tcgCard.artist || "Ukendt";
    setSets((prev) => {
      const idx = prev.findIndex((s) => s.illustrator.toLowerCase() === artist.toLowerCase());
      if (idx >= 0) {
        return prev.map((s, i) => i === idx ? { ...s, cards: [...s.cards, newCard] } : s);
      }
      return [...prev, { id: Date.now() + 1, illustrator: artist, cards: [newCard], want: 3 }];
    });
  }, []);

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
  const grandDisplay = (currency === "DKK" ? grand * DKK_RATE : grand)
    .toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f1f1f1" }}>
        <div style={{ textAlign:"center", color:"#616161" }}>
          <span className="spinning" style={{ fontSize:28, color:"#005bd3" }}>⟳</span>
          <p style={{ marginTop:12, fontSize:13 }}>Henter fra Supabase…</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        <div className="page-header">
          <div className="page-header-inner">
            <div>
              <h1 className="page-title">TCG Wantlist</h1>
              <p className="page-sub">SIR · IR kort sorteret efter illustrator · priser fra Cardmarket via pokemontcg.io</p>
            </div>
            <SyncBadge status={syncStatus} />
          </div>
        </div>

        {/* Global search */}
        <GlobalSearch sets={sets} onAddCard={addCardToWantlist} />

        {/* Collection toolbar */}
        <div className="section-heading">
          <h2 className="section-title">Min liste</h2>
          <div className="toolbar">
            <div className="toolbar-left">
              <div className="btn-group">
                <span className="toolbar-label">Sorter</span>
                {["want","price"].map((k) => (
                  <button key={k} className={"btn-seg" + (sort === k ? " active" : "")} onClick={() => toggleSort(k)}>
                    {k === "want" ? "Interesse" : "Pris"}{sort === k && <span>{dir === "desc" ? " ↓" : " ↑"}</span>}
                  </button>
                ))}
              </div>
              <div className="btn-group">
                <span className="toolbar-label">Vis</span>
                {[["all","Alle"],["IR","IR"],["SIR","SIR"]].map(([f,l]) => (
                  <button key={f} className={"btn-seg" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>{l}</button>
                ))}
              </div>
              <div className="btn-group">
                <span className="toolbar-label">Valuta</span>
                {["EUR","DKK"].map((c) => (
                  <button key={c} className={"btn-seg" + (currency === c ? " active" : "")} onClick={() => setCurrency(c)}>{c}</button>
                ))}
              </div>
            </div>
            <div className="toolbar-right">
              <button className="btn-plain" onClick={() => exportCSV(sets)}>CSV</button>
              <button className="btn-plain" onClick={() => exportJSON(sets)}>JSON</button>
              <div className="total-chip">
                <span className="total-chip-label">Total</span>
                <span className="total-chip-val">{grandDisplay} {currency === "DKK" ? "kr" : "€"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          {sorted.map((s) => (
            <IllusCard key={s.id} set={s} currency={currency}
              onUpdate={(next) => upd(s.id, next)} onDelete={() => del(s.id)} />
          ))}
        </div>

        <div className="add-wrap">
          <button className="btn-primary large" onClick={add}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tilføj illustrator manuelt
          </button>
        </div>

      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600&display=swap');

:root {
  --p-color-bg:               #f1f1f1;
  --p-color-bg-surface:       #ffffff;
  --p-color-bg-surface-hover: #f7f7f7;
  --p-color-bg-fill-disabled: rgba(0,0,0,0.05);
  --p-color-border:           #e3e3e3;
  --p-color-border-hover:     #bababa;
  --p-color-border-focus:     #005bd3;
  --p-color-text:             #303030;
  --p-color-text-secondary:   #616161;
  --p-color-text-disabled:    #b5b5b5;
  --p-color-text-interactive: #005bd3;
  --p-color-icon:             #616161;
  --p-color-interactive:      #005bd3;
  --p-color-interactive-hov:  #004aad;
  --p-color-interactive-bg:   rgba(0,91,211,0.08);
  --p-color-success:          #008060;
  --p-color-success-bg:       #ccf5e7;
  --p-color-critical:         #d82c0d;
  --p-color-critical-bg:      #fed5d7;
  --p-space-1: 4px; --p-space-2: 8px; --p-space-3: 12px;
  --p-space-4: 16px; --p-space-5: 20px; --p-space-6: 24px;
  --p-space-8: 32px; --p-space-10: 40px;
  --p-border-radius-1: 4px; --p-border-radius-2: 8px;
  --p-border-radius-3: 12px; --p-border-radius-full: 9999px;
  --p-shadow-card: 0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
  --p-shadow-card-hover: 0 0 0 1px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.1);
  --p-shadow-modal: 0 0 0 1px rgba(0,0,0,0.1), 0 20px 60px rgba(0,0,0,0.2);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--p-color-bg); color: var(--p-color-text);
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
button, select, input { font-family: inherit; font-size: 14px; }
button { cursor: pointer; }

.app { max-width: 1040px; margin: 0 auto; padding: var(--p-space-6) var(--p-space-5) var(--p-space-10); }

/* ── Page header ── */
.page-header { margin-bottom: var(--p-space-4); }
.page-header-inner { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--p-space-4); }
.page-title { font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
.page-sub { font-size: 13px; color: var(--p-color-text-secondary); margin-top: 2px; }
.sync-badge { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; white-space: nowrap; padding-top: 4px; }
.sync-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; transition: background 0.4s; }

/* ── Global search panel ── */
.search-panel {
  background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); padding: var(--p-space-4);
  margin-bottom: var(--p-space-5); box-shadow: var(--p-shadow-card);
  display: flex; flex-direction: column; gap: var(--p-space-3);
}
.search-bar-row { display: flex; gap: var(--p-space-2); }
.search-input-wrap {
  flex: 1; display: flex; align-items: center; gap: var(--p-space-2);
  background: var(--p-color-bg); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); padding: 0 var(--p-space-2);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.search-input-wrap:focus-within { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.search-icon { color: var(--p-color-text-disabled); flex-shrink: 0; line-height: 0; }
.search-input { flex: 1; background: transparent; border: none; outline: none;
  color: var(--p-color-text); padding: 8px 0; font-size: 14px; }
.search-input::placeholder { color: var(--p-color-text-disabled); }
.search-clear { background: none; border: none; color: var(--p-color-text-disabled); line-height: 0; padding: 4px; border-radius: 3px; transition: color 0.12s; flex-shrink: 0; }
.search-clear:hover { color: var(--p-color-text); }
.search-filters { display: flex; align-items: center; gap: var(--p-space-3); flex-wrap: wrap; }
.search-count { font-size: 12px; color: var(--p-color-text-secondary); margin-left: auto; }
.search-loading { font-size: 13px; color: var(--p-color-text-secondary); display: flex; align-items: center; gap: 8px; padding: var(--p-space-2) 0; }
.search-empty { padding: var(--p-space-5) 0; text-align: center; color: var(--p-color-text-secondary); }
.search-empty p { font-size: 14px; }
.search-empty-sub { font-size: 12px; color: var(--p-color-text-disabled); margin-top: 4px; }

/* ── Search results grid ── */
.search-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--p-space-2);
  max-height: 480px; overflow-y: auto;
  padding-right: 4px;
}
.result-card {
  background: var(--p-color-bg); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); overflow: hidden;
  display: flex; flex-direction: column;
  transition: border-color 0.12s, box-shadow 0.12s;
  position: relative;
}
.result-card:hover { border-color: #bababa; box-shadow: var(--p-shadow-card-hover); }
.result-card.already-added { opacity: 0.55; }
.result-img-wrap { position: relative; aspect-ratio: 5/7; overflow: hidden; }
.result-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.result-type-badge {
  position: absolute; top: 6px; left: 6px;
  font-size: 9px; font-weight: 650; letter-spacing: 0.5px;
  padding: 2px 6px; border-radius: 3px;
}
.result-type-badge.sir { background: #1a1a2e; color: #a78bfa; }
.result-type-badge.ir  { background: #1a2a1a; color: #6ee7b7; }
.result-info { padding: 8px; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.result-name { font-size: 11px; font-weight: 600; color: var(--p-color-text); line-height: 1.3; }
.result-set  { font-size: 10px; color: var(--p-color-text-secondary); }
.result-artist { font-size: 10px; color: var(--p-color-text-secondary); }
.result-price { font-size: 11px; font-weight: 600; color: var(--p-color-success); margin-top: 2px; font-variant-numeric: tabular-nums; }
.result-add-btn {
  margin: 0 8px 8px; padding: 6px; border-radius: var(--p-border-radius-1);
  border: 1px solid var(--p-color-border); background: var(--p-color-bg-surface);
  color: var(--p-color-icon); line-height: 0; transition: all 0.12s;
  display: flex; align-items: center; justify-content: center;
}
.result-add-btn:not(:disabled):hover { background: var(--p-color-interactive); border-color: var(--p-color-interactive); color: #fff; }
.result-add-btn.added { background: var(--p-color-success-bg); border-color: transparent; color: var(--p-color-success); cursor: default; }

/* ── Section heading ── */
.section-heading { margin-bottom: var(--p-space-3); }
.section-title { font-size: 16px; font-weight: 600; margin-bottom: var(--p-space-2); }

/* ── Toolbar ── */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--p-space-3);
  background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); padding: var(--p-space-2) var(--p-space-3); flex-wrap: wrap; }
.toolbar-left { display: flex; align-items: center; gap: var(--p-space-3); flex-wrap: wrap; }
.toolbar-right { display: flex; align-items: center; gap: var(--p-space-2); }
.toolbar-label { font-size: 12px; font-weight: 550; color: var(--p-color-text-secondary); white-space: nowrap; }
.btn-group { display: flex; align-items: center; gap: var(--p-space-1); }
.btn-seg { background: transparent; border: 1px solid transparent; color: var(--p-color-text-secondary);
  font-size: 13px; font-weight: 450; padding: 4px 10px; border-radius: var(--p-border-radius-1);
  transition: background 0.12s, border-color 0.12s, color 0.12s; }
.btn-seg:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border); color: var(--p-color-text); }
.btn-seg.active { background: var(--p-color-interactive-bg); border-color: var(--p-color-interactive); color: var(--p-color-interactive); font-weight: 550; }
.btn-primary { background: #404040; color: #fff; border: none; font-size: 13px; font-weight: 550;
  padding: 6px 14px; border-radius: var(--p-border-radius-1); transition: background 0.12s;
  display: inline-flex; align-items: center; gap: var(--p-space-1); }
.btn-primary:hover { background: #303030; }
.btn-primary.large { padding: 10px 20px; font-size: 14px; }
.btn-plain { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-text-secondary);
  font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: var(--p-border-radius-1); transition: all 0.12s; }
.btn-plain:hover { border-color: var(--p-color-border-hover); color: var(--p-color-text); background: var(--p-color-bg-surface-hover); }
.total-chip { background: var(--p-color-bg-fill-disabled); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); padding: 4px 12px; display: flex; align-items: baseline; gap: 6px; }
.total-chip-label { font-size: 11px; font-weight: 550; color: var(--p-color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.total-chip-val { font-size: 15px; font-weight: 600; color: var(--p-color-text); font-variant-numeric: tabular-nums; }

/* ── Grid ── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(460px, 1fr)); gap: var(--p-space-3); }

/* ── Illustrator card ── */
.icard { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); padding: var(--p-space-4);
  display: flex; flex-direction: column; gap: var(--p-space-4);
  box-shadow: var(--p-shadow-card); transition: box-shadow 0.15s, border-color 0.15s; }
.icard:hover { box-shadow: var(--p-shadow-card-hover); border-color: #d4d4d4; }
.icard-head { display: flex; justify-content: space-between; align-items: flex-start; }
.icard-head-left { display: flex; flex-direction: column; gap: var(--p-space-1); }
.field-label { font-size: 12px; font-weight: 550; color: var(--p-color-text-secondary); }
.icard-name-input { background: transparent; border: none; outline: none;
  font-size: 18px; font-weight: 600; letter-spacing: -0.2px; color: var(--p-color-text); width: 300px; padding: 0; }
.icard-name-input::placeholder { color: var(--p-color-text-disabled); }
.icard-badges { display: flex; gap: var(--p-space-1); flex-wrap: wrap; }
.badge { font-size: 11px; font-weight: 550; padding: 2px 8px; border-radius: var(--p-border-radius-full);
  background: var(--p-color-bg-fill-disabled); color: var(--p-color-text-secondary); border: 1px solid var(--p-color-border); }
.badge.success { background: var(--p-color-success-bg); color: var(--p-color-success); border-color: transparent; }
.divider { height: 1px; background: var(--p-color-border); }
.empty-state { text-align: center; padding: var(--p-space-8) var(--p-space-4); color: var(--p-color-text-secondary);
  display: flex; flex-direction: column; align-items: center; gap: var(--p-space-2); }
.empty-state p { font-size: 14px; font-weight: 500; }
.empty-sub { font-size: 12px; color: var(--p-color-text-disabled); }
.cards-list { display: flex; flex-direction: column; gap: 2px; }

/* ── Card row ── */
.card-row { display: flex; align-items: center; gap: var(--p-space-2);
  padding: var(--p-space-1) var(--p-space-2); border-radius: var(--p-border-radius-1);
  transition: background 0.1s; border-left: 2px solid transparent; }
.card-row:hover { background: var(--p-color-bg-surface-hover); }
.card-row.owned { border-left-color: var(--p-color-success); background: rgba(0,128,96,0.04); }
.thumb-btn { background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1);
  cursor: pointer; padding: 0; overflow: hidden; width: 44px; height: 62px; flex-shrink: 0;
  transition: border-color 0.12s, box-shadow 0.12s; display: flex; align-items: center; justify-content: center; }
.thumb-btn:hover { border-color: var(--p-color-interactive); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-ph { color: var(--p-color-text-disabled); font-size: 16px; }
.select-input { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 13px; font-weight: 500;
  padding: 5px 6px; cursor: pointer; width: 54px; flex-shrink: 0; appearance: none; transition: border-color 0.12s; }
.select-input:focus { outline: none; border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.select-input option { background: var(--p-color-bg-surface); }
.text-input { flex: 1; background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 13px; padding: 5px 9px;
  outline: none; min-width: 0; transition: border-color 0.12s, box-shadow 0.12s; }
.text-input:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.text-input::placeholder { color: var(--p-color-text-disabled); }
.icon-btn { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon);
  border-radius: var(--p-border-radius-1); padding: 5px 7px; line-height: 0;
  transition: all 0.12s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.icon-btn:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border-hover); color: var(--p-color-text); }
.icon-btn.danger:hover { background: var(--p-color-critical-bg); border-color: var(--p-color-critical); color: var(--p-color-critical); }
.price-cell { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.price-input { width: 60px; background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 13px; padding: 5px 7px;
  outline: none; text-align: right; transition: border-color 0.12s, box-shadow 0.12s; font-variant-numeric: tabular-nums; }
.price-input:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.price-input::-webkit-inner-spin-button { display: none; }
input[type=number] { -moz-appearance: textfield; }
.curr-label { font-size: 12px; color: var(--p-color-text-secondary); font-weight: 500; min-width: 16px; }
.cm-link { color: var(--p-color-text-interactive); font-size: 12px; text-decoration: none; transition: color 0.12s; }
.cm-link:hover { color: var(--p-color-interactive-hov); text-decoration: underline; }
.own-btn { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon);
  border-radius: var(--p-border-radius-1); padding: 5px 7px; line-height: 0; flex-shrink: 0;
  transition: all 0.12s; display: flex; align-items: center; }
.own-btn:hover, .own-btn.active { border-color: var(--p-color-success); color: var(--p-color-success); background: var(--p-color-success-bg); }
.add-card-btn { align-self: flex-start; background: transparent; border: 1px dashed var(--p-color-border);
  color: var(--p-color-text-secondary); font-size: 13px; font-weight: 450; padding: 5px 12px;
  border-radius: var(--p-border-radius-1); transition: all 0.12s; display: inline-flex; align-items: center; gap: 6px; }
.add-card-btn:hover { border-color: var(--p-color-interactive); color: var(--p-color-interactive); background: var(--p-color-interactive-bg); }
.icard-foot { display: flex; justify-content: space-between; align-items: flex-end; }
.total-val { font-size: 20px; font-weight: 650; color: var(--p-color-text); font-variant-numeric: tabular-nums; }
.stars { display: flex; gap: 2px; margin-top: 4px; }
.star { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--p-color-border-hover); transition: color 0.1s, transform 0.12s; padding: 0 1px; line-height: 1; }
.star.on { color: #f1a30b; }
.star:hover { transform: scale(1.2); }

.add-wrap { margin-top: var(--p-space-5); display: flex; justify-content: center; }

@keyframes spin { to { transform: rotate(360deg); } }
.spinning { display: inline-block; animation: spin 0.9s linear infinite; }

/* ── Modal ── */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  backdrop-filter: blur(4px); }
.modal { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-3); width: 100%; max-width: 700px; max-height: 90vh;
  display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--p-shadow-modal); }
.modal-head { display: flex; align-items: center; justify-content: space-between;
  padding: var(--p-space-4) var(--p-space-5); border-bottom: 1px solid var(--p-color-border); flex-shrink: 0; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-close { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon);
  border-radius: var(--p-border-radius-1); padding: 6px; line-height: 0; transition: all 0.12s; display: flex; align-items: center; }
.modal-close:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border-hover); }
.modal-bar { display: flex; gap: var(--p-space-2); padding: var(--p-space-3) var(--p-space-5); border-bottom: 1px solid var(--p-color-border); flex-shrink: 0; }
.modal-input { flex: 1; background: var(--p-color-bg); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 14px; padding: 8px 12px;
  outline: none; transition: border-color 0.12s, box-shadow 0.12s; }
.modal-input:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.modal-input::placeholder { color: var(--p-color-text-disabled); }
.modal-status { padding: 8px var(--p-space-5); flex-shrink: 0; }
.status-row { font-size: 12px; color: var(--p-color-text-secondary); display: flex; align-items: center; gap: 6px; }
.status-row.muted { color: var(--p-color-text-disabled); }
.modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--p-space-2); padding: var(--p-space-3) var(--p-space-5) var(--p-space-5); overflow-y: auto; flex: 1; }
.res-card { background: var(--p-color-bg); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); cursor: pointer; padding: var(--p-space-2);
  display: flex; flex-direction: column; gap: var(--p-space-2); transition: border-color 0.12s, box-shadow 0.12s; text-align: left; }
.res-card:hover { border-color: var(--p-color-interactive); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.res-img { width: 100%; border-radius: var(--p-border-radius-1); display: block; aspect-ratio: 5/7; object-fit: cover; }
.res-meta { display: flex; flex-direction: column; gap: 2px; }
.res-name { font-size: 11px; font-weight: 550; color: var(--p-color-text); line-height: 1.3; }
.res-set { font-size: 10px; color: var(--p-color-text-secondary); }
.res-artist { font-size: 10px; color: var(--p-color-text-secondary); }
.res-price { font-size: 11px; font-weight: 600; color: var(--p-color-success); margin-top: 2px; font-variant-numeric: tabular-nums; }

@media (max-width: 540px) {
  .app { padding: var(--p-space-4) var(--p-space-3) var(--p-space-8); }
  .grid { grid-template-columns: 1fr; }
  .toolbar { flex-direction: column; align-items: flex-start; }
  .toolbar-right { width: 100%; justify-content: space-between; }
  .search-results-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
}
`;
