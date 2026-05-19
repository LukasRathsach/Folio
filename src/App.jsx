import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { loadFromSupabase, saveToSupabase, supabase } from "./supabase.js";

const DKK_RATE = 7.46;
const LS_KEY = "tcg-wantlist-v1";
const SAVE_DEBOUNCE_MS = 1500;

// ─── API helpers ─────────────────────────────────────────────────────────────

const SPECIAL_RARITIES = [
  "Special Illustration Rare",
  "Illustration Rare",
  "Secret Rare",
  "Hyper Rare",
  "Rainbow Rare",
  "Amazing Rare",
  "Radiant Rare",
  "ACE SPEC Rare",
  "Ultra Rare",
  "Double Rare",
  "Shiny Rare",
  "Shiny Ultra Rare",
].map((r) => `rarity:"${r}"`).join(" OR ");

function rarityFilter(type) {
  if (type === "SIR") return 'rarity:"Special Illustration Rare"';
  if (type === "IR")  return 'rarity:"Illustration Rare"';
  return `(${SPECIAL_RARITIES})`;
}

async function fetchCards(q) {
  const res = await fetch(
    `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&select=id,name,images,set,artist,cardmarket,rarity&orderBy=-set.releaseDate&pageSize=50`
  );
  if (!res.ok) throw new Error("TCG API fejlede");
  return (await res.json()).data || [];
}

async function semanticSearch(query, mode, type) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const primary = [...words].sort((a, b) => b.length - a.length)[0];
  const rf = rarityFilter(type);
  const field = mode === "artist" ? "artist" : "name";
  const cards = await fetchCards(`${field}:${primary}* ${rf}`);
  if (words.length === 1) return cards;
  return cards.filter((c) => {
    const h = (mode === "artist" ? (c.artist || "") : c.name).toLowerCase();
    return words.every((w) => h.includes(w));
  });
}

async function searchTCGCards(query, type) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const primary = [...words].sort((a, b) => b.length - a.length)[0];
  const cards = await fetchCards(`name:${primary}* ${rarityFilter(type)}`);
  if (words.length === 1) return cards;
  return cards.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
}

async function fetchArtistCards(artistName) {
  const words = artistName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const primary = [...words].sort((a, b) => b.length - a.length)[0];
  const cards = await fetchCards(`artist:${primary}* (${SPECIAL_RARITIES})`);
  return cards
    .filter((c) => {
      const a = (c.artist || "").toLowerCase();
      return words.every((w) => a.includes(w.toLowerCase()));
    })
    .sort(raritySort);
}

function extractPrice(tcgCard) {
  return {
    price: tcgCard.cardmarket?.prices?.trendPrice ?? null,
    url:   tcgCard.cardmarket?.url ?? null,
  };
}

const RARITY_ORDER = {
  "Special Illustration Rare": 0,
  "Illustration Rare": 1,
  "Hyper Rare": 2,
  "Secret Rare": 3,
  "Rainbow Rare": 4,
  "Amazing Rare": 5,
  "Radiant Rare": 6,
  "ACE SPEC Rare": 7,
  "Ultra Rare": 8,
  "Double Rare": 9,
  "Shiny Ultra Rare": 10,
  "Shiny Rare": 11,
};
function raritySort(a, b) {
  return (RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99);
}

function cardTypeFromRarity(rarity) {
  const map = {
    "Special Illustration Rare": "SIR",
    "Illustration Rare": "IR",
    "Hyper Rare": "HR",
    "Secret Rare": "SR",
    "Rainbow Rare": "RR",
    "Amazing Rare": "AR",
    "Radiant Rare": "RAD",
    "ACE SPEC Rare": "ACE",
    "Ultra Rare": "UR",
    "Double Rare": "RR",
    "Shiny Ultra Rare": "SUR",
    "Shiny Rare": "SHY",
  };
  return map[rarity] ?? "SR";
}

function rarityBadgeClass(rarity) {
  if (rarity === "Special Illustration Rare") return "sir";
  if (rarity === "Illustration Rare") return "ir";
  if (rarity === "Hyper Rare" || rarity === "Rainbow Rare" || rarity === "Shiny Ultra Rare") return "hr";
  if (rarity === "Secret Rare" || rarity === "Ultra Rare") return "sr";
  return "other";
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
  const rows = [["Illustrator","Interesse","Pris-vurdering","Type","Kortnavn","Sæt","Pris EUR","Pris DKK","Ejet","Cardmarket"]];
  sets.forEach((s) => s.cards.forEach((c) => rows.push([
    s.illustrator, s.want, s.priceRating ?? 0, c.type, c.name, c.tcgSetName || "",
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

// ─── Star Rating ─────────────────────────────────────────────────────────────

function StarRating({ value, onChange, color = "#f1a30b" }) {
  const [hov, setHov] = useState(null);
  return (
    <div className="stars" onMouseLeave={() => setHov(null)}>
      {[1,2,3,4,5].map((s) => (
        <button key={s}
          className={"star" + (s <= (hov ?? value) ? " on" : "")}
          style={s <= (hov ?? value) ? { color } : {}}
          onMouseEnter={() => setHov(s)} onClick={() => onChange(s)}
          aria-label={`${s} stjerne${s !== 1 ? "r" : ""}`}>★</button>
      ))}
    </div>
  );
}

// ─── Global Search ────────────────────────────────────────────────────────────

function GlobalSearch({ sets, onAddCard }) {
  const [q, setQ]       = useState("");
  const [mode, setMode] = useState("card");
  const [type, setType] = useState("all");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  const addedIds = useMemo(
    () => new Set(sets.flatMap((s) => s.cards.map((c) => c.tcgId).filter(Boolean))),
    [sets]
  );

  const doSearch = useCallback(async (query = q) => {
    if (!query.trim()) return;
    setLoading(true); setSearched(false);
    try { setResults(await semanticSearch(query, mode, type)); }
    catch { setResults([]); }
    setLoading(false); setSearched(true);
  }, [q, mode, type]);

  useEffect(() => { if (q.trim()) doSearch(); }, [mode, type]);

  const clear = () => { setQ(""); setResults([]); setSearched(false); inputRef.current?.focus(); };

  return (
    <div className="search-panel">
      <div className="search-bar-row">
        <div className="search-input-wrap">
          <span className="search-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input ref={inputRef} className="search-input"
            placeholder={mode === "artist" ? "Søg efter illustrator… fx Mitsuhiro Arita" : "Søg efter kort… fx Charizard ex, Pikachu"}
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()} aria-label="Søg" />
          {q && <button className="search-clear" onClick={clear} aria-label="Ryd">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>}
        </div>
        <button className="btn-primary" onClick={() => doSearch()}>Søg</button>
      </div>
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
        {searched && !loading && <span className="search-count">{results.length} resultater</span>}
      </div>
      {loading && <div className="search-loading"><span className="spinning">⟳</span> Søger pokemontcg.io…</div>}
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
                  <span className={`result-type-badge ${rarityBadgeClass(card.rarity)}`}>
                    {cardTypeFromRarity(card.rarity)}
                  </span>
                </div>
                <div className="result-info">
                  <p className="result-name">{card.name}</p>
                  <p className="result-set">{card.set.name}</p>
                  {card.artist && <p className="result-artist">{card.artist}</p>}
                  {price != null && <p className="result-price">{price.toFixed(2)} €</p>}
                </div>
                <button className={"result-add-btn" + (already ? " added" : "")}
                  onClick={() => !already && onAddCard(card)} disabled={already}
                  aria-label={already ? "Allerede tilføjet" : `Tilføj ${card.name}`}>
                  {already
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Inline Search Modal ──────────────────────────────────────────────────────

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
            placeholder="Fx Charizard ex…" aria-label="Søg kort" />
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

// ─── Card Lightbox ────────────────────────────────────────────────────────────

function CardLightbox({ image, name, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Kortbillede">
      <img src={image} alt={name} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" onClick={onClose} aria-label="Luk">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

// ─── Card Row — vertical layout ───────────────────────────────────────────────

function CardRow({ card, onUpdate, onDelete, onArtistDetected }) {
  const [showModal, setShowModal] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [localCur, setLocalCur] = useState("EUR");

  const handleSelect = (tcgCard) => {
    setShowModal(false);
    const { price, url } = extractPrice(tcgCard);
    onUpdate({ id: card.id, type: card.type, name: tcgCard.name, tcgId: tcgCard.id,
      image: tcgCard.images?.large || tcgCard.images?.small || null,
      tcgSetName: tcgCard.set.name, price, url, loadingPrice: false, owned: card.owned });
    if (tcgCard.artist) onArtistDetected?.(tcgCard.artist);
  };

  const eurVal = card.price ?? null;
  const dkkVal = card.price != null ? +(card.price * DKK_RATE).toFixed(2) : null;
  const displayVal = localCur === "DKK" ? dkkVal : eurVal;

  const handlePriceChange = (raw) => {
    const num = parseFloat(raw) || null;
    const eur = localCur === "DKK" && num ? +(num / DKK_RATE).toFixed(4) : num;
    onUpdate({ ...card, price: eur });
  };

  return (
    <>
      <div className={"card-row" + (card.owned ? " owned" : "")}>
        {/* Left: card image — click to enlarge */}
        <button className="thumb-btn-lg" onClick={() => card.image && setShowLightbox(true)}
          aria-label={card.image ? "Se kortet stort" : "Ingen billede"}
          title={card.image ? "Klik for at forstørre" : undefined}
          style={!card.image ? { cursor: "default" } : {}}>
          {card.image
            ? <img className="thumb-lg" src={card.image} alt={card.name} />
            : <div className="thumb-ph-lg">?</div>}
        </button>

        {/* Right: stacked details */}
        <div className="card-details">
          {/* Row 1: name + search + delete */}
          <div className="card-detail-row">
            <input className="name-in-full" placeholder="Kortnavn…" value={card.name}
              onChange={(e) => onUpdate({ ...card, name: e.target.value })} aria-label="Kortnavn" />
            <button className="icon-btn-sm" onClick={() => setShowModal(true)} aria-label="Søg">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
            <button className="icon-btn-sm danger" onClick={onDelete} aria-label="Slet">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>

          {/* Row 2: price + currency toggle + CM link + owned */}
          <div className="card-detail-row">
            <input className="price-in-sm" type="number" placeholder="—"
              value={displayVal ?? ""}
              onChange={(e) => handlePriceChange(e.target.value)}
              aria-label={`Pris i ${localCur}`} />
            <button className="cur-toggle" onClick={() => setLocalCur((c) => c === "EUR" ? "DKK" : "EUR")}
              title={`Skift til ${localCur === "EUR" ? "DKK" : "EUR"}`}>
              {localCur === "EUR" ? "€" : "kr"}
            </button>
            {card.url
              ? <a href={card.url} target="_blank" rel="noopener noreferrer" className="cm-link" title="Åbn på Cardmarket">↗</a>
              : <span className="cm-placeholder" />}
            {eurVal != null && localCur === "EUR" && (
              <span className="price-secondary">{dkkVal?.toLocaleString("da-DK")} kr</span>
            )}
            {eurVal != null && localCur === "DKK" && (
              <span className="price-secondary">{eurVal?.toFixed(2)} €</span>
            )}
            <button className={"own-btn-sm" + (card.owned ? " active" : "")}
              onClick={() => onUpdate({ ...card, owned: !card.owned })}
              aria-pressed={card.owned} title={card.owned ? "Ejet" : "Markér som ejet"}>
              {card.owned
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>}
            </button>
          </div>

          {/* Set name + type badge */}
          {card.tcgSetName && (
            <div className="card-set-name">
              <span className={`card-type-inline ${rarityBadgeClass(card.type)}`}>{card.type}</span>
              {card.tcgSetName}
            </div>
          )}
        </div>
      </div>

      {showModal && <SearchModal cardName={card.name} cardType={card.type}
        onSelect={handleSelect} onClose={() => setShowModal(false)} />}
      {showLightbox && card.image && <CardLightbox image={card.image} name={card.name} onClose={() => setShowLightbox(false)} />}
    </>
  );
}

// ─── Artist Recommendations ───────────────────────────────────────────────────

function ArtistRecs({ illustrator, existingTcgIds, onAdd }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!illustrator || illustrator.trim().length < 2) { setRecs([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const cards = await fetchArtistCards(illustrator);
        setRecs(cards);
      } catch { /* keep existing recs on error */ }
      setLoading(false);
    }, 900);
    return () => clearTimeout(timerRef.current);
  }, [illustrator]); // only re-fetch when artist name changes

  if (!illustrator || illustrator.trim().length < 2) return null;
  if (!loading && recs.length === 0) return null;

  return (
    <div className="artist-recs">
      <div className="artist-recs-header">
        <span className="field-label">Alle kort af {illustrator}</span>
        {loading && <span className="spinning" style={{ fontSize: 12, color: "var(--p-color-text-disabled)" }}>⟳</span>}
      </div>
      {recs.length > 0 && (
        <div className="recs-scroll" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.2s" }}>
          {recs.map((card) => {
            const already = existingTcgIds.has(card.id);
            const { price } = extractPrice(card);
            return (
              <div key={card.id} className={"rec-card" + (already ? " rec-added" : "")}>
                <div className="rec-img-wrap">
                  <img src={card.images.small} alt={card.name} className="rec-img" loading="lazy" />
                  <span className={`rec-type-badge ${rarityBadgeClass(card.rarity)}`}>
                    {cardTypeFromRarity(card.rarity)}
                  </span>
                </div>
                <div className="rec-info">
                  <p className="rec-name">{card.name}</p>
                  <p className="rec-set">{card.set.name}</p>
                  {price != null && <p className="rec-price">{price.toFixed(2)} €</p>}
                </div>
                <button className={"rec-add-btn" + (already ? " added" : "")}
                  onClick={() => !already && onAdd(card)} disabled={already}
                  aria-label={already ? "Allerede tilføjet" : `Tilføj ${card.name}`}>
                  {already
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Illustrator Card ─────────────────────────────────────────────────────────

function IllusCard({ set, onUpdate, onDelete, onAddCard }) {
  const total = set.cards.reduce((s, c) => s + (c.price || 0), 0);
  const ownedCount = set.cards.filter((c) => c.owned).length;
  const ownedTcgIds = useMemo(
    () => new Set(set.cards.map((c) => c.tcgId).filter(Boolean)),
    [set.cards]
  );

  const updCard = (idx, next) =>
    onUpdate({ ...set, cards: set.cards.map((c, i) => (i === idx ? next : c)) });
  const delCard = (idx) =>
    onUpdate({ ...set, cards: set.cards.filter((_, i) => i !== idx) });
  const addCard = () =>
    onUpdate({ ...set, cards: [...set.cards,
      { id: Date.now(), name: "", type: "SIR", price: null, image: null, url: null, tcgId: null, loadingPrice: false, owned: false }] });

  const handleRecAdd = (tcgCard) => {
    const { price, url } = extractPrice(tcgCard);
    onUpdate({
      ...set,
      cards: [...set.cards, {
        id: Date.now(), tcgId: tcgCard.id, name: tcgCard.name,
        type: cardTypeFromRarity(tcgCard.rarity), price, url,
        image: tcgCard.images?.large || tcgCard.images?.small || null,
        tcgSetName: tcgCard.set.name, loadingPrice: false, owned: false,
      }],
    });
  };

  return (
    <div className="icard">
      {/* Header */}
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

      {/* Cards */}
      {set.cards.length === 0 ? (
        <div className="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.3}}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <p>Ingen kort endnu</p>
          <p className="empty-sub">Søg og tilføj kort ovenfor</p>
        </div>
      ) : (
        <div className="cards-list">
          {set.cards.map((c, i) => (
            <CardRow key={c.id} card={c}
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
        Tilføj manuelt
      </button>

      {/* Artist recommendations */}
      <ArtistRecs
        illustrator={set.illustrator}
        existingTcgIds={ownedTcgIds}
        onAdd={handleRecAdd}
      />

      <div className="divider" />

      {/* Footer: interesse + pris-vurdering + total */}
      <div className="icard-foot">
        <div className="ratings-row">
          <div className="rating-block">
            <div className="field-label">Interesse</div>
            <StarRating value={set.want} onChange={(v) => onUpdate({ ...set, want: v })} color="#f1a30b" />
          </div>
          <div className="rating-block">
            <div className="field-label">Pris-vurdering</div>
            <StarRating value={set.priceRating ?? 0} onChange={(v) => onUpdate({ ...set, priceRating: v })} color="#005bd3" />
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="field-label">Total</div>
          <div className="total-eur">{total.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
          <div className="total-dkk">{(total * DKK_RATE).toLocaleString("da-DK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kr</div>
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

// ─── Profile Panel ────────────────────────────────────────────────────────────

function ProfilePanel({ user, sets, onClose, onSignOut }) {
  const totalCards  = sets.reduce((n, s) => n + s.cards.length, 0);
  const ownedCards  = sets.reduce((n, s) => n + s.cards.filter((c) => c.owned).length, 0);
  const totalEur    = sets.reduce((n, s) => n + s.cards.reduce((a, c) => a + (c.price || 0), 0), 0);
  const sirCount    = sets.reduce((n, s) => n + s.cards.filter((c) => c.type === "SIR").length, 0);
  const irCount     = sets.reduce((n, s) => n + s.cards.filter((c) => c.type === "IR").length, 0);

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Profil</span>
          <button className="modal-close" onClick={onClose} aria-label="Luk">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ padding: "var(--p-space-5)" }}>
          <p style={{ fontSize: 13, color: "var(--p-color-text-secondary)", marginBottom: "var(--p-space-4)" }}>{user.email}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--p-space-3)", marginBottom: "var(--p-space-5)" }}>
            {[
              ["Illustratorer",   sets.length],
              ["Kort i alt",      totalCards],
              ["Ejet",            ownedCards],
              ["SIR",             sirCount],
              ["IR",              irCount],
              ["Ønsket samlet",   `${totalEur.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`],
            ].map(([label, val]) => (
              <div key={label} style={{ background: "var(--p-color-bg)", border: "1px solid var(--p-color-border)", borderRadius: "var(--p-border-radius-2)", padding: "var(--p-space-3)" }}>
                <div style={{ fontSize: 11, fontWeight: 550, color: "var(--p-color-text-secondary)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 650, color: "var(--p-color-text)" }}>{val}</div>
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "10px", background: "var(--p-color-critical)" }}
            onClick={() => { onSignOut(); onClose(); }}>Log ud</button>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSignedUp(true);
      }
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  const inp = { background: "var(--p-color-bg)", border: "1px solid var(--p-color-border)", borderRadius: "var(--p-border-radius-1)", color: "var(--p-color-text)", fontSize: 14, padding: "8px 12px", outline: "none", width: "100%" };

  if (signedUp) return (
    <div className="auth-center">
      <div className="auth-box">
        <p style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>✉</p>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Tjek din e-mail</h2>
        <p style={{ color: "var(--p-color-text-secondary)", fontSize: 13 }}>
          Vi har sendt et bekræftelseslink til <strong>{email}</strong>. Klik på linket for at aktivere din konto.
        </p>
      </div>
    </div>
  );

  return (
    <div className="auth-center">
      <div className="auth-box">
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>TCG Wantlist</h1>
        <p style={{ fontSize: 13, color: "var(--p-color-text-secondary)", marginBottom: "var(--p-space-5)" }}>
          {mode === "login" ? "Log ind for at se din samling" : "Opret en gratis konto"}
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--p-space-3)" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 550, marginBottom: 4, color: "var(--p-color-text-secondary)" }}>E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inp} placeholder="din@email.dk" autoFocus />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 550, marginBottom: 4, color: "var(--p-color-text-secondary)" }}>Adgangskode</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} style={inp} placeholder={mode === "signup" ? "Mindst 6 tegn" : "Din adgangskode"} />
          </div>
          {error && (
            <div style={{ background: "var(--p-color-critical-bg)", color: "var(--p-color-critical)", border: "1px solid var(--p-color-critical)", borderRadius: "var(--p-border-radius-1)", padding: "8px 12px", fontSize: 13 }}>{error}</div>
          )}
          <button type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: "10px" }} disabled={loading}>
            {loading ? <span className="spinning">⟳</span> : mode === "login" ? "Log ind" : "Opret konto"}
          </button>
        </form>
        <div style={{ marginTop: "var(--p-space-4)", textAlign: "center", fontSize: 13 }}>
          <span style={{ color: "var(--p-color-text-secondary)" }}>
            {mode === "login" ? "Har du ikke en konto? " : "Har du allerede en konto? "}
          </span>
          <button onClick={() => { setMode(m => m === "login" ? "signup" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: "var(--p-color-interactive)", cursor: "pointer", fontSize: 13, fontWeight: 550, padding: 0 }}>
            {mode === "login" ? "Opret konto" : "Log ind"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const INIT = [{ id: 1, illustrator: "", cards: [], want: 3, priceRating: 0 }];

export default function App() {
  const [user, setUser]             = useState(null);
  const [authChecked, setAuthChecked] = useState(!supabase);
  const [showProfile, setShowProfile] = useState(false);
  const [sets, setSets]             = useState(() => loadLocalState() ?? INIT);
  const [sort, setSort]             = useState("want");
  const [dir, setDir]               = useState("desc");
  const [filter, setFilter]         = useState("all");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [loading, setLoading]       = useState(false);
  const saveTimer   = useRef(null);
  const skipSaveRef = useRef(false); // true right after a Supabase load — skip that save cycle

  // ── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load data when user signs in; reset when they sign out ─────────────────
  useEffect(() => {
    clearTimeout(saveTimer.current);
    if (!user) {
      setSets(loadLocalState() ?? INIT); // reset to local cache / blank on sign-out
      return;
    }
    setLoading(true);
    loadFromSupabase(user.id).then((data) => {
      skipSaveRef.current = true; // don't immediately save what we just loaded
      if (data && data.length > 0) setSets(data);
      else setSets(loadLocalState() ?? INIT);
      setLoading(false);
    });
  }, [user?.id]);
  // ── Persist on change ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    try { localStorage.setItem(LS_KEY, JSON.stringify(sets)); } catch {}
    if (!supabase || !user) return;
    setSyncStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveToSupabase(user.id, sets);
        setSyncStatus("saved");
        setTimeout(() => setSyncStatus("idle"), 2000);
      } catch { setSyncStatus("error"); }
    }, SAVE_DEBOUNCE_MS);
  }, [sets, loading]);
  const upd = (id, next) => setSets((s) => s.map((x) => (x.id === id ? next : x)));
  const del = (id) => setSets((s) => s.filter((x) => x.id !== id));
  const add = () => setSets((s) => [...s, { id: Date.now(), illustrator: "", cards: [], want: 3, priceRating: 0 }]);

  const addCardToWantlist = useCallback((tcgCard) => {
    const { price, url } = extractPrice(tcgCard);
    const newCard = {
      id: Date.now(), tcgId: tcgCard.id, name: tcgCard.name,
      type: cardTypeFromRarity(tcgCard.rarity), price, url,
      image: tcgCard.images?.large || tcgCard.images?.small || null,
      tcgSetName: tcgCard.set.name, loadingPrice: false, owned: false,
    };
    const artist = tcgCard.artist || "Ukendt";
    setSets((prev) => {
      const idx = prev.findIndex((s) => s.illustrator.toLowerCase() === artist.toLowerCase());
      if (idx >= 0) return prev.map((s, i) => i === idx ? { ...s, cards: [...s.cards, newCard] } : s);
      return [...prev, { id: Date.now() + 1, illustrator: artist, cards: [newCard], want: 3, priceRating: 0 }];
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

  if (!authChecked) return (
    <>
      <style>{CSS}</style>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f1f1f1" }}>
        <span className="spinning" style={{ fontSize:28, color:"#005bd3" }}>⟳</span>
      </div>
    </>
  );

  if (supabase && !user) return <><style>{CSS}</style><AuthScreen /></>;

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
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <SyncBadge status={syncStatus} />
              {user && (
                <button className="profile-btn" onClick={() => setShowProfile(true)} title="Åbn profil">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                  <span className="profile-email">{user.email}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <GlobalSearch sets={sets} onAddCard={addCardToWantlist} />

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
            </div>
            <div className="toolbar-right">
              <button className="btn-plain" onClick={() => exportCSV(sets)}>CSV</button>
              <button className="btn-plain" onClick={() => exportJSON(sets)}>JSON</button>
              <div className="total-chip">
                <span className="total-chip-label">Total</span>
                <span className="total-chip-val">
                  {grand.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  <span className="total-dkk-small"> · {(grand * DKK_RATE).toLocaleString("da-DK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kr</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          {sorted.map((s) => (
            <IllusCard key={s.id} set={s}
              onUpdate={(next) => upd(s.id, next)}
              onDelete={() => del(s.id)}
              onAddCard={addCardToWantlist} />
          ))}
        </div>

        <div className="add-wrap">
          <button className="btn-primary large" onClick={add}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tilføj illustrator manuelt
          </button>
        </div>
      </div>
      {showProfile && user && (
        <ProfilePanel user={user} sets={sets}
          onClose={() => setShowProfile(false)}
          onSignOut={() => supabase?.auth.signOut()} />
      )}
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
  --p-space-8: 32px;
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

.app { max-width: 1040px; margin: 0 auto; padding: var(--p-space-6) var(--p-space-5) var(--p-space-8); }

/* ── Page header ── */
.page-header { margin-bottom: var(--p-space-4); }
.page-header-inner { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--p-space-4); }
.page-title { font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
.page-sub { font-size: 13px; color: var(--p-color-text-secondary); margin-top: 2px; }
.sync-badge { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; white-space: nowrap; padding-top: 4px; }
.sync-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; transition: background 0.4s; }

/* ── Search panel ── */
.search-panel { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-2); padding: var(--p-space-4);
  margin-bottom: var(--p-space-5); box-shadow: var(--p-shadow-card);
  display: flex; flex-direction: column; gap: var(--p-space-3); }
.search-bar-row { display: flex; gap: var(--p-space-2); }
.search-input-wrap { flex: 1; display: flex; align-items: center; gap: var(--p-space-2);
  background: var(--p-color-bg); border: 1px solid var(--p-color-border);
  border-radius: var(--p-border-radius-1); padding: 0 var(--p-space-2);
  transition: border-color 0.12s, box-shadow 0.12s; }
.search-input-wrap:focus-within { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.search-icon { color: var(--p-color-text-disabled); flex-shrink: 0; line-height: 0; }
.search-input { flex: 1; background: transparent; border: none; outline: none; color: var(--p-color-text); padding: 8px 0; font-size: 14px; }
.search-input::placeholder { color: var(--p-color-text-disabled); }
.search-clear { background: none; border: none; color: var(--p-color-text-disabled); line-height: 0; padding: 4px; border-radius: 3px; transition: color 0.12s; flex-shrink: 0; }
.search-clear:hover { color: var(--p-color-text); }
.search-filters { display: flex; align-items: center; gap: var(--p-space-3); flex-wrap: wrap; }
.search-count { font-size: 12px; color: var(--p-color-text-secondary); margin-left: auto; }
.search-loading { font-size: 13px; color: var(--p-color-text-secondary); display: flex; align-items: center; gap: 8px; padding: var(--p-space-2) 0; }
.search-empty { padding: var(--p-space-5) 0; text-align: center; color: var(--p-color-text-secondary); }
.search-empty p { font-size: 14px; }
.search-empty-sub { font-size: 12px; color: var(--p-color-text-disabled); margin-top: 4px; }
.search-results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--p-space-2); max-height: 480px; overflow-y: auto; padding-right: 4px; }
.result-card { background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-2); overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.12s, box-shadow 0.12s; }
.result-card:hover { border-color: #bababa; box-shadow: var(--p-shadow-card-hover); }
.result-card.already-added { opacity: 0.55; }
.result-img-wrap { position: relative; aspect-ratio: 5/7; overflow: hidden; }
.result-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.result-type-badge { position: absolute; top: 6px; left: 6px; font-size: 9px; font-weight: 650; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 3px; }
.result-type-badge.sir, .rec-type-badge.sir { background: #1a1a2e; color: #a78bfa; }
.result-type-badge.ir,  .rec-type-badge.ir  { background: #1a2a1a; color: #6ee7b7; }
.result-type-badge.hr,  .rec-type-badge.hr  { background: #2a1a00; color: #fbbf24; }
.result-type-badge.sr,  .rec-type-badge.sr  { background: #1a0a0a; color: #f87171; }
.result-type-badge.other, .rec-type-badge.other { background: #1a1a1a; color: #9ca3af; }
.result-info { padding: 8px; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.result-name { font-size: 11px; font-weight: 600; color: var(--p-color-text); line-height: 1.3; }
.result-set, .result-artist { font-size: 10px; color: var(--p-color-text-secondary); }
.result-price { font-size: 11px; font-weight: 600; color: var(--p-color-success); margin-top: 2px; font-variant-numeric: tabular-nums; }
.result-add-btn { margin: 0 8px 8px; padding: 6px; border-radius: var(--p-border-radius-1); border: 1px solid var(--p-color-border); background: var(--p-color-bg-surface); color: var(--p-color-icon); line-height: 0; transition: all 0.12s; display: flex; align-items: center; justify-content: center; }
.result-add-btn:not(:disabled):hover { background: var(--p-color-interactive); border-color: var(--p-color-interactive); color: #fff; }
.result-add-btn.added { background: var(--p-color-success-bg); border-color: transparent; color: var(--p-color-success); cursor: default; }

/* ── Section / toolbar ── */
.section-heading { margin-bottom: var(--p-space-3); }
.section-title { font-size: 16px; font-weight: 600; margin-bottom: var(--p-space-2); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--p-space-3); background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-2); padding: var(--p-space-2) var(--p-space-3); flex-wrap: wrap; }
.toolbar-left { display: flex; align-items: center; gap: var(--p-space-3); flex-wrap: wrap; }
.toolbar-right { display: flex; align-items: center; gap: var(--p-space-2); }
.toolbar-label { font-size: 12px; font-weight: 550; color: var(--p-color-text-secondary); white-space: nowrap; }
.btn-group { display: flex; align-items: center; gap: var(--p-space-1); }
.btn-seg { background: transparent; border: 1px solid transparent; color: var(--p-color-text-secondary); font-size: 13px; font-weight: 450; padding: 4px 10px; border-radius: var(--p-border-radius-1); transition: background 0.12s, border-color 0.12s, color 0.12s; }
.btn-seg:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border); color: var(--p-color-text); }
.btn-seg.active { background: var(--p-color-interactive-bg); border-color: var(--p-color-interactive); color: var(--p-color-interactive); font-weight: 550; }
.btn-primary { background: #404040; color: #fff; border: none; font-size: 13px; font-weight: 550; padding: 6px 14px; border-radius: var(--p-border-radius-1); transition: background 0.12s; display: inline-flex; align-items: center; gap: var(--p-space-1); }
.btn-primary:hover { background: #303030; }
.btn-primary.large { padding: 10px 20px; font-size: 14px; }
.btn-plain { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-text-secondary); font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: var(--p-border-radius-1); transition: all 0.12s; }
.btn-plain:hover { border-color: var(--p-color-border-hover); color: var(--p-color-text); background: var(--p-color-bg-surface-hover); }
.total-chip { background: var(--p-color-bg-fill-disabled); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); padding: 4px 12px; display: flex; align-items: baseline; gap: 6px; }
.total-chip-label { font-size: 11px; font-weight: 550; color: var(--p-color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.total-chip-val { font-size: 14px; font-weight: 600; color: var(--p-color-text); font-variant-numeric: tabular-nums; }
.total-dkk-small { font-size: 12px; font-weight: 400; color: var(--p-color-text-secondary); }

/* ── Grid ── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(460px, 1fr)); gap: var(--p-space-3); }

/* ── Illustrator card ── */
.icard { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-2); padding: var(--p-space-4); display: flex; flex-direction: column; gap: var(--p-space-4); box-shadow: var(--p-shadow-card); transition: box-shadow 0.15s, border-color 0.15s; }
.icard:hover { box-shadow: var(--p-shadow-card-hover); border-color: #d4d4d4; }
.icard-head { display: flex; justify-content: space-between; align-items: flex-start; }
.icard-head-left { display: flex; flex-direction: column; gap: var(--p-space-1); }
.field-label { font-size: 12px; font-weight: 550; color: var(--p-color-text-secondary); }
.icard-name-input { background: transparent; border: none; outline: none; font-size: 18px; font-weight: 600; letter-spacing: -0.2px; color: var(--p-color-text); width: 300px; padding: 0; }
.icard-name-input::placeholder { color: var(--p-color-text-disabled); }
.icard-badges { display: flex; gap: var(--p-space-1); flex-wrap: wrap; }
.badge { font-size: 11px; font-weight: 550; padding: 2px 8px; border-radius: var(--p-border-radius-full); background: var(--p-color-bg-fill-disabled); color: var(--p-color-text-secondary); border: 1px solid var(--p-color-border); }
.badge.success { background: var(--p-color-success-bg); color: var(--p-color-success); border-color: transparent; }
.icon-btn { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon); border-radius: var(--p-border-radius-1); padding: 5px 7px; line-height: 0; transition: all 0.12s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.icon-btn:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border-hover); }
.icon-btn.danger:hover { background: var(--p-color-critical-bg); border-color: var(--p-color-critical); color: var(--p-color-critical); }
.divider { height: 1px; background: var(--p-color-border); }
.empty-state { text-align: center; padding: var(--p-space-8) var(--p-space-4); color: var(--p-color-text-secondary); display: flex; flex-direction: column; align-items: center; gap: var(--p-space-2); }
.empty-state p { font-size: 14px; font-weight: 500; }
.empty-sub { font-size: 12px; color: var(--p-color-text-disabled); }
.cards-list { display: flex; flex-direction: column; gap: var(--p-space-2); }

/* ── Card row — vertical layout ── */
.card-row { display: flex; align-items: stretch; gap: var(--p-space-3); padding: var(--p-space-2); border-radius: var(--p-border-radius-1); transition: background 0.1s; border-left: 3px solid transparent; }
.card-row:hover { background: var(--p-color-bg-surface-hover); }
.card-row.owned { border-left-color: var(--p-color-success); background: rgba(0,128,96,0.04); }

/* Large thumbnail */
.thumb-btn-lg { background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); cursor: zoom-in; padding: 0; overflow: hidden; width: 100px; flex-shrink: 0; transition: border-color 0.12s, box-shadow 0.12s; display: flex; align-items: center; justify-content: center; align-self: stretch; }
.thumb-btn-lg:hover { border-color: var(--p-color-interactive); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.thumb-lg { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-ph-lg { color: var(--p-color-text-disabled); font-size: 22px; padding: 24px 0; }

/* Card details stack */
.card-details { flex: 1; display: flex; flex-direction: column; gap: 6px; justify-content: center; min-width: 0; }
.card-detail-row { display: flex; align-items: center; gap: 6px; }

.type-sel-sm { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 12px; font-weight: 550; padding: 4px 5px; cursor: pointer; width: 50px; flex-shrink: 0; appearance: none; }
.type-sel-sm:focus { outline: none; border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.type-sel-sm option { background: var(--p-color-bg-surface); }

.name-in-full { flex: 1; background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 13px; padding: 4px 8px; outline: none; min-width: 0; transition: border-color 0.12s, box-shadow 0.12s; }
.name-in-full:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.name-in-full::placeholder { color: var(--p-color-text-disabled); }

.icon-btn-sm { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon); border-radius: var(--p-border-radius-1); padding: 4px 6px; line-height: 0; transition: all 0.12s; display: flex; align-items: center; flex-shrink: 0; }
.icon-btn-sm:hover { background: var(--p-color-bg-surface-hover); border-color: var(--p-color-border-hover); }
.icon-btn-sm.danger:hover { background: var(--p-color-critical-bg); border-color: var(--p-color-critical); color: var(--p-color-critical); }

.price-in-sm { width: 64px; background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 13px; padding: 4px 6px; outline: none; text-align: right; transition: border-color 0.12s; font-variant-numeric: tabular-nums; }
.price-in-sm:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.price-in-sm::-webkit-inner-spin-button { display: none; }
input[type=number] { -moz-appearance: textfield; }

.cur-toggle { background: var(--p-color-bg-fill-disabled); border: 1px solid var(--p-color-border); color: var(--p-color-text-secondary); border-radius: var(--p-border-radius-1); padding: 4px 7px; font-size: 12px; font-weight: 550; transition: all 0.12s; flex-shrink: 0; min-width: 34px; }
.cur-toggle:hover { background: var(--p-color-interactive-bg); border-color: var(--p-color-interactive); color: var(--p-color-interactive); }

.cm-link { color: var(--p-color-text-interactive); font-size: 12px; text-decoration: none; transition: color 0.12s; flex-shrink: 0; }
.cm-link:hover { color: var(--p-color-interactive-hov); text-decoration: underline; }
.cm-placeholder { width: 14px; flex-shrink: 0; }

.price-secondary { font-size: 11px; color: var(--p-color-text-disabled); font-variant-numeric: tabular-nums; white-space: nowrap; }

.own-btn-sm { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon); border-radius: var(--p-border-radius-1); padding: 4px 6px; line-height: 0; flex-shrink: 0; transition: all 0.12s; display: flex; align-items: center; margin-left: auto; }
.own-btn-sm:hover, .own-btn-sm.active { border-color: var(--p-color-success); color: var(--p-color-success); background: var(--p-color-success-bg); }

.card-set-name { font-size: 10px; color: var(--p-color-text-disabled); padding-left: 2px; display: flex; align-items: center; gap: 5px; }
.card-type-inline { font-size: 9px; font-weight: 650; letter-spacing: 0.5px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
.card-type-inline.sir { background: #1a1a2e; color: #a78bfa; }
.card-type-inline.ir  { background: #1a2a1a; color: #6ee7b7; }
.card-type-inline.hr  { background: #2a1a00; color: #fbbf24; }
.card-type-inline.sr  { background: #1a0a0a; color: #f87171; }
.card-type-inline.other { background: #1a1a1a; color: #9ca3af; }

/* ── Add card ── */
.add-card-btn { align-self: flex-start; background: transparent; border: 1px dashed var(--p-color-border); color: var(--p-color-text-secondary); font-size: 12px; font-weight: 450; padding: 5px 12px; border-radius: var(--p-border-radius-1); transition: all 0.12s; display: inline-flex; align-items: center; gap: 6px; }
.add-card-btn:hover { border-color: var(--p-color-interactive); color: var(--p-color-interactive); background: var(--p-color-interactive-bg); }

/* ── Artist recs ── */
.artist-recs { display: flex; flex-direction: column; gap: var(--p-space-2); }
.artist-recs-header { display: flex; align-items: center; gap: 8px; }
.recs-scroll { display: flex; gap: var(--p-space-2); overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
.recs-scroll::-webkit-scrollbar { height: 4px; }
.recs-scroll::-webkit-scrollbar-thumb { background: var(--p-color-border); border-radius: 2px; }
.rec-card { flex-shrink: 0; width: 100px; background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-2); overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.12s; }
.rec-card:hover { border-color: #bababa; }
.rec-img-wrap { position: relative; aspect-ratio: 5/7; overflow: hidden; }
.rec-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rec-type-badge { position: absolute; top: 4px; left: 4px; font-size: 8px; font-weight: 650; padding: 1px 5px; border-radius: 2px; }
.rec-card.rec-added { opacity: 0.55; }
.rec-card.rec-added .rec-add-btn { background: var(--p-color-success-bg); border-color: transparent; color: var(--p-color-success); cursor: default; }
.rec-info { padding: 6px; display: flex; flex-direction: column; gap: 1px; flex: 1; }
.rec-name { font-size: 10px; font-weight: 600; color: var(--p-color-text); line-height: 1.3; }
.rec-set { font-size: 9px; color: var(--p-color-text-secondary); }
.rec-price { font-size: 10px; font-weight: 600; color: var(--p-color-success); margin-top: 2px; font-variant-numeric: tabular-nums; }
.rec-add-btn { margin: 0 6px 6px; padding: 5px; border-radius: var(--p-border-radius-1); border: 1px solid var(--p-color-border); background: var(--p-color-bg-surface); color: var(--p-color-icon); line-height: 0; transition: all 0.12s; display: flex; align-items: center; justify-content: center; }
.rec-add-btn:hover { background: var(--p-color-interactive); border-color: var(--p-color-interactive); color: #fff; }

/* ── Card footer ── */
.icard-foot { display: flex; justify-content: space-between; align-items: flex-end; }
.ratings-row { display: flex; gap: var(--p-space-5); }
.rating-block { display: flex; flex-direction: column; gap: 4px; }
.total-eur { font-size: 20px; font-weight: 650; color: var(--p-color-text); font-variant-numeric: tabular-nums; line-height: 1.2; }
.total-dkk { font-size: 13px; color: var(--p-color-text-secondary); font-variant-numeric: tabular-nums; }

/* ── Stars ── */
.stars { display: flex; gap: 2px; }
.star { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--p-color-border-hover); transition: color 0.1s, transform 0.12s; padding: 0 1px; line-height: 1; }
.star:hover { transform: scale(1.2); }

.add-wrap { margin-top: var(--p-space-5); display: flex; justify-content: center; }

@keyframes spin { to { transform: rotate(360deg); } }
.spinning { display: inline-block; animation: spin 0.9s linear infinite; }

/* ── Modal ── */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
.modal { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-3); width: 100%; max-width: 700px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--p-shadow-modal); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: var(--p-space-4) var(--p-space-5); border-bottom: 1px solid var(--p-color-border); flex-shrink: 0; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-close { background: transparent; border: 1px solid var(--p-color-border); color: var(--p-color-icon); border-radius: var(--p-border-radius-1); padding: 6px; line-height: 0; transition: all 0.12s; display: flex; align-items: center; }
.modal-close:hover { background: var(--p-color-bg-surface-hover); }
.modal-bar { display: flex; gap: var(--p-space-2); padding: var(--p-space-3) var(--p-space-5); border-bottom: 1px solid var(--p-color-border); flex-shrink: 0; }
.modal-input { flex: 1; background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-1); color: var(--p-color-text); font-size: 14px; padding: 8px 12px; outline: none; transition: border-color 0.12s, box-shadow 0.12s; }
.modal-input:focus { border-color: var(--p-color-border-focus); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.modal-input::placeholder { color: var(--p-color-text-disabled); }
.modal-status { padding: 8px var(--p-space-5); flex-shrink: 0; }
.status-row { font-size: 12px; color: var(--p-color-text-secondary); display: flex; align-items: center; gap: 6px; }
.status-row.muted { color: var(--p-color-text-disabled); }
.modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--p-space-2); padding: var(--p-space-3) var(--p-space-5) var(--p-space-5); overflow-y: auto; flex: 1; }
.res-card { background: var(--p-color-bg); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-2); cursor: pointer; padding: var(--p-space-2); display: flex; flex-direction: column; gap: var(--p-space-2); transition: border-color 0.12s, box-shadow 0.12s; text-align: left; }
.res-card:hover { border-color: var(--p-color-interactive); box-shadow: 0 0 0 2px var(--p-color-interactive-bg); }
.res-img { width: 100%; border-radius: var(--p-border-radius-1); display: block; aspect-ratio: 5/7; object-fit: cover; }
.res-meta { display: flex; flex-direction: column; gap: 2px; }
.res-name { font-size: 11px; font-weight: 550; color: var(--p-color-text); line-height: 1.3; }
.res-set, .res-artist { font-size: 10px; color: var(--p-color-text-secondary); }
.res-price { font-size: 11px; font-weight: 600; color: var(--p-color-success); margin-top: 2px; font-variant-numeric: tabular-nums; }

/* ── Profile button ── */
.profile-btn { display: flex; align-items: center; gap: 6px; background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-full); padding: 5px 12px 5px 8px; cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s; color: var(--p-color-text-secondary); }
.profile-btn:hover { border-color: var(--p-color-border-hover); color: var(--p-color-text); }
.profile-email { font-size: 12px; font-weight: 500; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Lightbox ── */
.lightbox-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; cursor: zoom-out; backdrop-filter: blur(6px); }
.lightbox-img { max-width: min(90vw, 480px); max-height: 90vh; border-radius: 12px; box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 24px 80px rgba(0,0,0,0.6); object-fit: contain; cursor: default; }
.lightbox-close { position: fixed; top: 20px; right: 20px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 50%; width: 40px; height: 40px; line-height: 0; display: flex; align-items: center; justify-content: center; transition: background 0.12s; }
.lightbox-close:hover { background: rgba(255,255,255,0.25); }

/* ── Auth ── */
.auth-center { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--p-color-bg); padding: 20px; }
.auth-box { background: var(--p-color-bg-surface); border: 1px solid var(--p-color-border); border-radius: var(--p-border-radius-3); padding: var(--p-space-6); width: 100%; max-width: 380px; box-shadow: var(--p-shadow-modal); }

@media (max-width: 540px) {
  .app { padding: var(--p-space-4) var(--p-space-3) var(--p-space-8); }
  .grid { grid-template-columns: 1fr; }
  .toolbar { flex-direction: column; align-items: flex-start; }
  .toolbar-right { width: 100%; justify-content: space-between; }
  .search-results-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  .ratings-row { gap: var(--p-space-3); }
}
`;
