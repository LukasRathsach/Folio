import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export async function loadFromSupabase() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("wantlist_state")
    .select("sets")
    .eq("id", "main")
    .single();
  if (error || !data) return null;
  return data.sets;
}

export async function saveToSupabase(sets) {
  if (!supabase) return;
  await supabase
    .from("wantlist_state")
    .upsert({ id: "main", sets, updated_at: new Date().toISOString() });
}
