import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POKEMONTCG_API_KEY = process.env.POKEMONTCG_API_KEY;

const PAGE_SIZE = 250;
const UPSERT_BATCH_SIZE = 500;

const SPECIAL_RARITIES = [
  "Special Illustration Rare",
  "Illustration Rare",
  "Special Art Rare",
  "Art Rare",
  "Hyper Rare",
  "Secret Rare",
  "Shiny Ultra Rare",
  "Ultra Rare",
  "Rainbow Rare",
  "Rare Secret",
  "Rare Rainbow",
  "Rare Ultra",
];

function loadDotEnv() {
  if (!existsSync(".env")) return;

  const lines = readFileSync(".env", "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...valueParts] = trimmed.split("=");
    if (process.env[key]) continue;

    process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function rarityQuery() {
  return SPECIAL_RARITIES.map((rarity) => `rarity:"${rarity}"`).join(" OR ");
}

function toRow(card) {
  return {
    id: card.id,
    name: card.name,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    set_id: card.set?.id ?? null,
    set_name: card.set?.name ?? null,
    set_release_date: card.set?.releaseDate ?? null,
    image_small: card.images?.small ?? null,
    image_large: card.images?.large ?? null,
    cm_price: card.cardmarket?.prices?.trendPrice ?? null,
    cm_url: card.cardmarket?.url ?? null,
    synced_at: new Date().toISOString(),
  };
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    q: `(${rarityQuery()})`,
    select: "id,name,images,set,artist,cardmarket,rarity",
    orderBy: "-set.releaseDate",
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });

  const response = await fetch(`https://api.pokemontcg.io/v2/cards?${params}`, {
    headers: POKEMONTCG_API_KEY ? { "X-Api-Key": POKEMONTCG_API_KEY } : {},
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`pokemontcg.io ${response.status}: ${body}`);
  }

  return response.json();
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("cards").upsert(batch, { onConflict: "id" });

    if (error) throw error;
    console.log(`Upserted ${Math.min(i + batch.length, rows.length)} / ${rows.length}`);
  }
}

async function main() {
  let page = 1;
  let total = null;
  const rows = [];

  while (total === null || rows.length < total) {
    const payload = await fetchPage(page);
    const cards = payload.data ?? [];

    total = payload.totalCount ?? rows.length + cards.length;
    rows.push(...cards.map(toRow));

    console.log(`Fetched page ${page}: ${rows.length} / ${total}`);

    if (cards.length === 0) break;
    page += 1;
  }

  await upsertRows(rows);
  console.log(`Done. Seeded ${rows.length} cards.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
