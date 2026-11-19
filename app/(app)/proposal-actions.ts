"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { PLAN_DAYS, STATIONS, planCost, priceCol, type ClientType, type Grid, type Rate, type Slot } from "@/lib/pricing";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
const go = (path: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  redirect(q ? `${path}?${q}` : path);
};
const TYPES: ClientType[] = ["local", "media", "direct", "government"];
const pp = (leadId: string) => `/leads/${leadId}/proposal`;

// «Ενδιαφέρεται για»: ραδιόφωνο, digital ή και τα δύο (τουλάχιστον ένα)
export async function toggleInterest(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const which = s(f, "which") === "digital" ? "digital" : "radio";
  const { data: lead } = await supabase.from("leads").select("interests, version").eq("id", id).maybeSingle();
  if (!lead) go("/leads", { error: "Το lead δεν βρέθηκε" });
  const cur = new Set<string>((lead!.interests as string[]) ?? ["radio"]);
  if (cur.has(which)) cur.delete(which); else cur.add(which);
  if (cur.size === 0) go(`/leads/${id}`, { error: "Πρέπει να μείνει τουλάχιστον ένα: ραδιόφωνο ή digital" });
  const interests = ["radio", "digital"].filter((x) => cur.has(x));
  const { data, error } = await supabase
    .from("leads")
    .update({ interests, product_line: interests.length === 1 && interests[0] === "digital" ? "digital" : "radio" })
    .eq("id", id).eq("version", Number(s(f, "version"))).select("id");
  if (error) go(`/leads/${id}`, { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  if (!data || data.length === 0) go(`/leads/${id}`, { conflict: "1" });
  revalidatePath(`/leads/${id}`);
  go(`/leads/${id}`, { ok: "saved" });
}

// Είδος πελάτη: ορίζεται μία φορά για όλη την πρόταση. Αλλάζει μόνο όσο η πρόταση είναι άδεια.
export async function setClientType(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const type = s(f, "client_type") as ClientType | null;
  if (!type || !TYPES.includes(type)) go(pp(leadId), { error: "Διάλεξε είδος πελάτη" });
  const { data: p } = await supabase.from("proposals").select("id, proposal_items(id)").eq("lead_id", leadId).maybeSingle();
  if (p && (p.proposal_items as { id: string }[]).length > 0) go(pp(leadId), { error: "Για να αλλάξεις είδος πελάτη, αφαίρεσε πρώτα τις γραμμές της πρότασης" });
  const { error } = p
    ? await supabase.from("proposals").update({ client_type: type }).eq("id", p.id)
    : await supabase.from("proposals").insert({ lead_id: leadId, client_type: type });
  if (error) go(pp(leadId), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  revalidatePath(pp(leadId));
  go(pp(leadId));
}

async function loadProposal(leadId: string) {
  const ctx = await requireProfile();
  const { data: p } = await ctx.supabase.from("proposals").select("id, client_type").eq("lead_id", leadId).maybeSingle();
  if (!p || !p.client_type) go(pp(leadId), { error: "Διάλεξε πρώτα είδος πελάτη" });
  return { ...ctx, proposal: p as { id: string; client_type: ClientType } };
}

// Προσθήκη πακέτου / χορηγίας / αναφορών από τον τιμοκατάλογο (η τιμή «παγώνει» στην πρόταση)
export async function addPackageItem(f: FormData) {
  const leadId = s(f, "lead_id")!;
  const { supabase, proposal } = await loadProposal(leadId);
  const { data: pk } = await supabase.from("price_packages").select("*").eq("id", s(f, "package_id")).eq("active", true).maybeSingle();
  if (!pk) go(pp(leadId), { error: "Το πακέτο δεν βρέθηκε" });
  const want = proposal.client_type === "local" ? "local" : "media";
  if (pk!.client_type !== "all" && pk!.client_type !== want) go(pp(leadId), { error: "Αυτό το πακέτο δεν είναι για αυτό το είδος πελάτη" });
  const mention = pk!.kind === "mention";
  const qty = mention ? Math.max(1, Math.min(2000, parseInt(s(f, "qty") ?? "1", 10) || 1)) : 1;
  const spots = (n: number | null, b: number | null) => (n == null ? null : b ? `${n}+${b} δώρο σποτ/ημέρα` : `${n} σποτ/ημέρα`);
  const { error } = await supabase.from("proposal_items").insert({
    proposal_id: proposal.id,
    station: pk!.station,
    kind: "package",
    package_id: pk!.id,
    title: mention ? `${pk!.name} × ${qty} τον μήνα` : pk!.name,
    detail: [pk!.description, spots(pk!.spots_per_day, pk!.bonus_spots)].filter(Boolean).join(" · ") || null,
    monthly_amount: Number(pk!.price) * qty,
    long_months: mention ? null : pk!.long_months,
    long_amount: mention ? null : pk!.long_price,
    long_detail: mention || pk!.long_months == null ? null : spots(pk!.spots_per_day, pk!.long_bonus_spots),
    qty,
  });
  if (error) go(pp(leadId), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  revalidatePath(pp(leadId));
  go(pp(leadId), { ok: "itemadded" });
}

// Αποθήκευση πλάνου κοστολόγησης. Το ποσό υπολογίζεται ΕΔΩ από τις τιμές της βάσης, όχι από την οθόνη.
export async function savePlanItem(f: FormData) {
  const leadId = s(f, "lead_id")!;
  const { supabase, proposal } = await loadProposal(leadId);
  const station = s(f, "station")!;
  const planUrl = `${pp(leadId)}/plan`;
  if (!(STATIONS as readonly string[]).includes(station)) go(pp(leadId), { error: "Άγνωστος σταθμός" });
  const sec = Math.max(1, Math.min(120, parseInt(s(f, "sec") ?? "30", 10) || 30));
  let grid: Grid = {};
  try {
    const raw = JSON.parse(String(f.get("grid") ?? "{}")) as Record<string, unknown>;
    for (const [slot, row] of Object.entries(raw)) {
      if (!Array.isArray(row)) continue;
      const clean = Array.from({ length: PLAN_DAYS }, (_, d) => Math.max(0, Math.min(20, Math.floor(Number(row[d]) || 0))));
      if (clean.some((v) => v > 0)) grid[slot] = clean;
    }
  } catch { grid = {}; }
  const [{ data: rate }, { data: slots }] = await Promise.all([
    supabase.from("station_rates").select("station, media_shop_sec, government_sec, local_per_k, direct_per_k").eq("station", station).maybeSingle(),
    supabase.from("station_slots").select("station, slot, listeners_k, sort").eq("station", station),
  ]);
  if (!rate) go(pp(leadId), { error: "Λείπουν οι τιμές του σταθμού" });
  const col = priceCol(rate as Rate, proposal.client_type);
  const { spots, cost } = planCost(grid, (slots ?? []) as Slot[], col, sec);
  if (spots === 0) go(planUrl, { station, error: "Το πλάνο είναι άδειο: βάλε τουλάχιστον ένα σποτ" });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(s(f, "start") ?? "") ? s(f, "start") : null;
  const name = s(f, "title");
  const row = {
    station,
    kind: "plan",
    title: name ? `Πλάνο: ${name}` : "Πλάνο κοστολόγησης",
    detail: `${spots} σποτ × ${sec}'' τον μήνα · τιμές ${col.label}`,
    monthly_amount: cost,
    spots, sec, start_date: start, plan: grid,
  };
  const itemId = s(f, "item_id");
  if (itemId) {
    const { data, error } = await supabase.from("proposal_items").update(row).eq("id", itemId).eq("proposal_id", proposal.id).eq("version", Number(s(f, "version"))).select("id");
    if (error) go(pp(leadId), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
    if (!data || data.length === 0) go(pp(leadId), { conflict: "1" });
  } else {
    const { error } = await supabase.from("proposal_items").insert({ ...row, proposal_id: proposal.id });
    if (error) go(pp(leadId), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  }
  revalidatePath(pp(leadId));
  go(pp(leadId), { ok: "plansaved" });
}

// Διάρκεια (μήνες) για μία γραμμή της πρότασης
export async function setItemMonths(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const months = Math.max(1, Math.min(24, parseInt(s(f, "months") ?? "1", 10) || 1));
  const { data, error } = await supabase.from("proposal_items").update({ months }).eq("id", s(f, "id")).eq("version", Number(s(f, "version"))).select("id");
  if (error) go(pp(leadId), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  if (!data || data.length === 0) go(pp(leadId), { conflict: "1" });
  revalidatePath(pp(leadId));
  go(pp(leadId));
}

export async function deleteItem(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const { error } = await supabase.from("proposal_items").delete().eq("id", s(f, "id"));
  if (error) go(pp(leadId), { error: "Δεν αφαιρέθηκε. Δοκίμασε ξανά." });
  revalidatePath(pp(leadId));
  go(pp(leadId), { ok: "itemdeleted" });
}
