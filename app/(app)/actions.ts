"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
const back = (path: string, params: Record<string, string>) =>
  redirect(`${path}?${new URLSearchParams(params).toString()}`);

// ---------- Leads ----------

export async function createLead(f: FormData) {
  const { supabase } = await requireProfile();
  const company = s(f, "company_name");
  if (!company) back("/leads/new", { error: "Γράψε όνομα επιχείρησης" });

  // Έλεγχος διπλοεγγραφής πριν την καταχώριση (εκτός αν ο χρήστης επιβεβαίωσε)
  if (!s(f, "confirm_duplicate")) {
    const { data: dups } = await supabase.rpc("find_duplicate", { p_name: company, p_phone: s(f, "phone") });
    if (dups && dups.length) {
      const d = dups[0] as { kind: string; display_name: string; owner_name: string };
      const params: Record<string, string> = {
        dup: `${d.display_name} — ${d.kind === "customer" ? "πελάτης" : "lead"} του/της ${d.owner_name}`,
      };
      for (const k of ["company_name", "contact_name", "phone", "email", "area", "source", "product_line", "next_step", "next_step_due", "notes"]) {
        const v = s(f, k);
        if (v) params[k] = v;
      }
      back("/leads/new", params);
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      company_name: company,
      contact_name: s(f, "contact_name"),
      phone: s(f, "phone"),
      email: s(f, "email"),
      area: s(f, "area"),
      market: s(f, "market") ?? "chalkida",
      source: s(f, "source") ?? "phone",
      product_line: s(f, "product_line") ?? "radio",
      stations: f.getAll("stations").map(String),
      next_step: s(f, "next_step"),
      next_step_due: s(f, "next_step_due"),
      notes: s(f, "notes"),
      owner_id: s(f, "owner_id"),
    })
    .select("id")
    .single();
  if (error || !data) back("/leads/new", { error: friendly(error?.message) });
  revalidatePath("/today");
  redirect(`/leads/${data!.id}?ok=created`);
}

// Αποθήκευση με έλεγχο έκδοσης: αν κάποιος άλλος άλλαξε το lead στο μεταξύ,
// δεν γράφουμε από πάνω του· δείχνουμε προειδοποίηση.
export async function updateLead(f: FormData) {
  const { supabase, isAdmin } = await requireProfile();
  const id = s(f, "id")!;
  const version = Number(s(f, "version"));
  const status = s(f, "status")!;
  const patch: Record<string, unknown> = {
    status,
    next_step: s(f, "next_step"),
    next_step_due: s(f, "next_step_due"),
    contact_name: s(f, "contact_name"),
    phone: s(f, "phone"),
    email: s(f, "email"),
    notes: s(f, "notes"),
    lost_kind: status === "lost" ? s(f, "lost_kind") : null,
    lost_reason: status === "lost" ? s(f, "lost_reason") : null,
  };
  if (status === "won" || status === "lost") {
    patch.next_step = s(f, "next_step");
  }
  if (isAdmin && f.has("owner_id")) patch.owner_id = s(f, "owner_id");

  const { data, error } = await supabase.from("leads").update(patch).eq("id", id).eq("version", version).select("id");
  if (error) back(`/leads/${id}`, { error: friendly(error.message) });
  if (!data || data.length === 0) back(`/leads/${id}`, { conflict: "1" });
  revalidatePath("/today");
  back(`/leads/${id}`, { ok: "saved" });
}

export async function assignLead(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const { error } = await supabase.from("leads").update({ owner_id: s(f, "owner_id") }).eq("id", id);
  revalidatePath("/leads");
  if (error) back("/leads", { error: friendly(error.message) });
  back("/leads", { ok: "assigned" });
}

// ---------- Δραστηριότητες ----------

export async function addActivity(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id");
  const customerId = s(f, "customer_id");
  const path = leadId ? `/leads/${leadId}` : `/customers/${customerId}`;
  const summary = s(f, "summary");
  if (!summary) back(path, { error: "Γράψε τι έγινε" });
  const { error } = await supabase.from("activities").insert({
    lead_id: leadId,
    customer_id: customerId,
    type: s(f, "type") ?? "call",
    summary,
  });
  if (error) back(path, { error: friendly(error.message) });

  // Μετά από κάθε επαφή, ορίζεται αμέσως το επόμενο βήμα του lead
  if (leadId && s(f, "next_step") && s(f, "next_step_due")) {
    await supabase.from("leads").update({ next_step: s(f, "next_step"), next_step_due: s(f, "next_step_due") }).eq("id", leadId);
  }
  revalidatePath(path);
  back(path, { ok: "activity" });
}

// ---------- Βάση πελατών ----------

export async function claimCustomer(f: FormData) {
  const { supabase, profile, isAdmin } = await requireProfile();
  const customerId = s(f, "customer_id")!;
  const forUser = isAdmin ? s(f, "for_user") ?? profile.id : profile.id;
  const { error } = await supabase.from("base_claims").insert({ customer_id: customerId, for_user: forUser, note: s(f, "note") });
  revalidatePath("/base");
  if (error) back("/base", { error: friendly(error.message), q: s(f, "q") ?? "" });
  back("/base", { ok: isAdmin ? "assigned" : "requested", q: s(f, "q") ?? "" });
}

export async function decideClaim(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const approve = s(f, "decision") === "approve";
  const { error } = await supabase.from("base_claims").update({ status: approve ? "approved" : "rejected" }).eq("id", id);
  revalidatePath("/base");
  if (error) back("/base", { error: friendly(error.message) });
  back("/base", { ok: approve ? "approved" : "rejected" });
}

// ---------- Ενώσεις πελατών ----------

export async function decideMerge(f: FormData) {
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("decide_merge", {
    p_group: s(f, "id"),
    p_same: s(f, "same") === "1",
    p_keep_name: s(f, "keep_name"),
  });
  revalidatePath("/merges");
  if (error) back("/merges", { error: friendly(error.message) });
  back("/merges", { ok: "1" });
}

// ---------- Ειδοποιήσεις ----------

export async function markAllRead() {
  const { supabase, profile } = await requireProfile();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).is("read_at", null);
  revalidatePath("/notifications");
  redirect("/notifications");
}

// Μηνύματα της βάσης σε γλώσσα που καταλαβαίνει ο πωλητής
function friendly(msg?: string) {
  if (!msg) return "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
  if (msg.includes("open_lead_needs_next_step")) return "Κάθε ανοιχτό lead θέλει επόμενο βήμα και ημερομηνία.";
  if (msg.includes("lost_needs_kind")) return "Διάλεξε τι είδους «όχι» ήταν.";
  if (msg.includes("one_open_claim_per_customer")) return "Υπάρχει ήδη ανοιχτό αίτημα για αυτόν τον πελάτη.";
  if (msg.includes("row-level security")) return "Δεν έχεις δικαίωμα για αυτή την αλλαγή.";
  return msg;
}
