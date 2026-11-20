"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { PLAN_DAYS, SLOT_SELECT, STATIONS, planCost, priceCol, toSlots, type ClientType, type Grid, type Rate } from "@/lib/pricing";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
const go = (path: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  redirect(q ? `${path}?${q}` : path);
};
const TYPES: ClientType[] = ["local", "media", "direct", "government"];
const list = (leadId: string) => `/leads/${leadId}/proposal`;
const pp = (leadId: string, pid: string) => `/leads/${leadId}/proposal/${pid}`;
const FAIL = "Δεν αποθηκεύτηκε. Δοκίμασε ξανά.";

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

// Νέα πρόταση: όνομα + είδος πελάτη (ορίζεται μία φορά για όλη την πρόταση)
export async function createProposal(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const type = s(f, "client_type") as ClientType | null;
  if (!type || !TYPES.includes(type)) go(list(leadId), { error: "Διάλεξε είδος πελάτη" });
  const { data, error } = await supabase.from("proposals").insert({ lead_id: leadId, client_type: type, title: (s(f, "title") ?? "Πρόταση").slice(0, 80) }).select("id").single();
  if (error || !data) go(list(leadId), { error: FAIL });
  revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, data!.id));
}

// Αλλαγή είδους πελάτη: μόνο όσο η πρόταση είναι άδεια
export async function setClientType(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const type = s(f, "client_type") as ClientType | null;
  if (!type || !TYPES.includes(type)) go(pp(leadId, pid), { error: "Διάλεξε είδος πελάτη" });
  const { count } = await supabase.from("proposal_items").select("id", { count: "exact", head: true }).eq("proposal_id", pid);
  if (count) go(pp(leadId, pid), { error: "Για να αλλάξεις είδος πελάτη, αφαίρεσε πρώτα τις γραμμές της πρότασης" });
  const { error } = await supabase.from("proposals").update({ client_type: type }).eq("id", pid).eq("lead_id", leadId);
  if (error) go(pp(leadId, pid), { error: FAIL });
  go(pp(leadId, pid));
}

export async function renameProposal(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const title = s(f, "title");
  if (!title) go(pp(leadId, pid), { error: "Γράψε όνομα" });
  const { data, error } = await supabase.from("proposals").update({ title: title!.slice(0, 80) }).eq("id", pid).eq("version", Number(s(f, "version"))).select("id");
  if (error) go(pp(leadId, pid), { error: FAIL });
  if (!data || data.length === 0) go(pp(leadId, pid), { conflict: "1" });
  revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, pid), { ok: "saved" });
}

// Η «κύρια» πρόταση γράφει το σύνολό της ως Εκτιμώμενη αξία του lead
export async function setMainProposal(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { error } = await supabase.rpc("set_main_proposal", { p_id: pid });
  if (error) go(pp(leadId, pid), { error: FAIL });
  revalidatePath(`/leads/${leadId}`); revalidatePath("/pipeline");
  go(pp(leadId, pid), { ok: "saved" });
}

// Αντίγραφο πρότασης με όλα τα πλάνα της (π.χ. για ανανέωση ή εναλλακτική)
export async function copyProposal(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { data: src } = await supabase.from("proposals").select("client_type, title, proposal_items(*)").eq("id", pid).eq("lead_id", leadId).maybeSingle();
  if (!src) go(list(leadId), { error: "Η πρόταση δεν βρέθηκε" });
  const { data: neu, error } = await supabase.from("proposals").insert({ lead_id: leadId, client_type: src!.client_type, title: `${src!.title} (αντίγραφο)`.slice(0, 80) }).select("id").single();
  if (error || !neu) go(pp(leadId, pid), { error: FAIL });
  const rows = ((src!.proposal_items ?? []) as Record<string, unknown>[]).map((r) => {
    const { id: _id, proposal_id: _p, created_at: _c, updated_at: _u, updated_by: _b, version: _v, ...rest } = r;
    return { ...rest, proposal_id: neu!.id };
  });
  if (rows.length) {
    const { error: e2 } = await supabase.from("proposal_items").insert(rows);
    if (e2) go(pp(leadId, neu!.id), { error: "Το αντίγραφο έγινε, αλλά οι γραμμές δεν αντιγράφηκαν. Δοκίμασε ξανά." });
  }
  revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, neu!.id), { ok: "copied" });
}

// Διαγραφή μόνο άδειας πρότασης
export async function deleteProposal(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { count } = await supabase.from("proposal_items").select("id", { count: "exact", head: true }).eq("proposal_id", pid);
  if (count) go(pp(leadId, pid), { error: "Αφαίρεσε πρώτα τις γραμμές της πρότασης" });
  const { error } = await supabase.from("proposals").delete().eq("id", pid).eq("lead_id", leadId);
  if (error) go(pp(leadId, pid), { error: "Δεν διαγράφηκε. Δοκίμασε ξανά." });
  revalidatePath(`/leads/${leadId}`);
  go(list(leadId), { ok: "itemdeleted" });
}

async function loadProposal(leadId: string, pid: string) {
  const ctx = await requireProfile();
  const { data: p } = await ctx.supabase.from("proposals").select("id, client_type").eq("id", pid).eq("lead_id", leadId).maybeSingle();
  if (!p || !p.client_type) go(list(leadId), { error: "Η πρόταση δεν βρέθηκε" });
  return { ...ctx, proposal: p as { id: string; client_type: ClientType } };
}

// Προσθήκη πακέτου / χορηγίας / αναφορών από τον τιμοκατάλογο (η τιμή «παγώνει» στην πρόταση)
export async function addPackageItem(f: FormData) {
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { supabase, proposal } = await loadProposal(leadId, pid);
  const { data: pk } = await supabase.from("price_packages").select("*").eq("id", s(f, "package_id")).eq("active", true).maybeSingle();
  if (!pk) go(pp(leadId, pid), { error: "Το πακέτο δεν βρέθηκε" });
  const want = proposal.client_type === "local" ? "local" : "media";
  if (pk!.client_type !== "all" && pk!.client_type !== want) go(pp(leadId, pid), { error: "Αυτό το πακέτο δεν είναι για αυτό το είδος πελάτη" });
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
  if (error) go(pp(leadId, pid), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, pid), { ok: "itemadded" });
}

// Αποθήκευση πλάνου κοστολόγησης. Το ποσό υπολογίζεται ΕΔΩ από τις τιμές της βάσης, όχι από την οθόνη.
export async function savePlanItem(f: FormData) {
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { supabase, proposal } = await loadProposal(leadId, pid);
  const station = s(f, "station")!;
  const planUrl = `${pp(leadId, pid)}/plan`;
  if (!(STATIONS as readonly string[]).includes(station)) go(pp(leadId, pid), { error: "Άγνωστος σταθμός" });
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
    supabase.from("station_slots").select(SLOT_SELECT).eq("station", station),
  ]);
  if (!rate) go(pp(leadId, pid), { error: "Λείπουν οι τιμές του σταθμού" });
  const col = priceCol(rate as Rate, proposal.client_type);
  const { spots, cost } = planCost(grid, toSlots(slots), col, sec);
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
    if (error) go(pp(leadId, pid), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
    if (!data || data.length === 0) go(pp(leadId, pid), { conflict: "1" });
  } else {
    const { error } = await supabase.from("proposal_items").insert({ ...row, proposal_id: proposal.id });
    if (error) go(pp(leadId, pid), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  }
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, pid), { ok: "plansaved" });
}

// Διάρκεια (μήνες) για μία γραμμή της πρότασης
export async function setItemMonths(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const months = Math.max(1, Math.min(24, parseInt(s(f, "months") ?? "1", 10) || 1));
  const { data, error } = await supabase.from("proposal_items").update({ months }).eq("id", s(f, "id")).eq("version", Number(s(f, "version"))).select("id");
  if (error) go(pp(leadId, pid), { error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." });
  if (!data || data.length === 0) go(pp(leadId, pid), { conflict: "1" });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, pid));
}

export async function deleteItem(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { error } = await supabase.from("proposal_items").delete().eq("id", s(f, "id")).eq("proposal_id", pid);
  if (error) go(pp(leadId, pid), { error: "Δεν αφαιρέθηκε. Δοκίμασε ξανά." });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`);
  go(pp(leadId, pid), { ok: "itemdeleted" });
}

// ---------- Εκπτώσεις ----------
const msg = (e: { message?: string } | null) => {
  const m = e?.message ?? "";
  return /[Α-Ωα-ω]/.test(m) ? m : FAIL; // τα μηνύματα της βάσης είναι ήδη στα ελληνικά
};
const euro = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Προπληρωμή: 10% by the book
export async function togglePrepay(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const { data, error } = await supabase.from("proposals").update({ prepay: s(f, "prepay") === "1" }).eq("id", pid).eq("version", Number(s(f, "version"))).select("id");
  if (error) go(pp(leadId, pid), { error: msg(error) });
  if (!data || data.length === 0) go(pp(leadId, pid), { conflict: "1" });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`); revalidatePath("/pipeline");
  go(pp(leadId, pid), { ok: "saved" });
}

// Ο Account Executive ζητάει ειδική τιμή με αιτιολογία
export async function requestDiscount(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const amount = euro(s(f, "amount"));
  if (!amount) go(pp(leadId, pid), { error: "Γράψε την τιμή που ζητάει ο πελάτης (π.χ. 1000)" });
  const { data, error } = await supabase.rpc("request_discount", { p_id: pid, p_amount: amount, p_reason: s(f, "reason") ?? "" });
  if (error) go(pp(leadId, pid), { error: msg(error) });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`); revalidatePath("/pipeline");
  go(pp(leadId, pid), { ok: data === "approved" ? "discapproved" : "discasked" });
}

// Ο Νίκος ή η Γιάννα εγκρίνει ή απορρίπτει
export async function decideDiscount(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const pid = s(f, "proposal_id")!;
  const ok = s(f, "decision") === "approve";
  const { error } = await supabase.rpc("decide_discount", { p_id: pid, p_ok: ok, p_note: s(f, "note") });
  if (error) go(pp(leadId, pid), { error: msg(error) });
  revalidatePath(pp(leadId, pid)); revalidatePath(`/leads/${leadId}`); revalidatePath("/pipeline");
  go(pp(leadId, pid), { ok: ok ? "discapproved" : "discrejected" });
}
