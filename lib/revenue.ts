import type { SupabaseClient } from "@supabase/supabase-js";

export type RevRow = { year: number; month: number; station: string; owner_id: string | null; channel: string; agency_id: string | null; amount: number };

// Μηνιαίος τζίρος (μόνο Νίκος/Γιάννα τον βλέπουν). Το Supabase δίνει 1.000 γραμμές τη φορά: σε σελίδες.
export async function fetchRevenue(db: SupabaseClient, years: number[]) {
  const out: RevRow[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await db
      .from("revenue_monthly")
      .select("year, month, station, owner_id, channel, agency_id, amount")
      .in("year", years)
      .range(from, from + 999);
    out.push(...((data ?? []) as RevRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const sumRev = (rows: RevRow[], f: (r: RevRow) => boolean) => rows.reduce((s, r) => (f(r) ? s + Number(r.amount) : s), 0);
