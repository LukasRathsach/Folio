import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

// Pass userId explicitly — avoids a network round-trip on every save
export async function loadFromSupabase(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("wantlist_state")
    .select("sets")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return data.sets;
}

export async function saveToSupabase(userId, sets) {
  if (!supabase || !userId) return;
  await supabase
    .from("wantlist_state")
    .upsert({ id: userId, sets, updated_at: new Date().toISOString() });
}
