"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
// «1.500», «1500,50», «1.500 €» → αριθμός
const money = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
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
      expected_value: money(s(f, "expected_value")),
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
    expected_value: money(s(f, "expected_value")),
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

// Μετακίνηση κάρτας στο pipeline. Κάθε μετακίνηση ζητά επόμενο βήμα (ανοιχτό deal)
// ή είδος «όχι» (χαμένο). Με έλεγχο έκδοσης: δεν γράφουμε πάνω σε αλλαγή άλλου.
export async function moveLead(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const status = s(f, "status")!;
  const to = s(f, "back")?.startsWith("/") ? s(f, "back")! : "/pipeline";
  const patch: Record<string, unknown> = { status };
  if (f.has("expected_value")) patch.expected_value = money(s(f, "expected_value"));
  if (status === "lost") {
    patch.lost_kind = s(f, "lost_kind");
    patch.lost_reason = s(f, "lost_reason");
    if (!patch.lost_kind) back(to, { error: "Διάλεξε τι «όχι» ήταν" });
  } else {
    patch.lost_kind = null;
    patch.lost_reason = null;
  }
  if (status !== "won" && status !== "lost") {
    patch.next_step = s(f, "next_step");
    patch.next_step_due = s(f, "next_step_due");
  } else if (s(f, "next_step")) {
    patch.next_step = s(f, "next_step");
    patch.next_step_due = s(f, "next_step_due");
  }
  const { data, error } = await supabase.from("leads").update(patch).eq("id", id).eq("version", Number(s(f, "version"))).select("id");
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/today");
  if (error) back(to, { error: friendly(error.message) });
  if (!data || data.length === 0) back(to, { conflict: "1" });
  back(to, { ok: status === "won" ? "won" : "moved" });
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
  const agencyId = s(f, "agency_id");
  const path = leadId ? `/leads/${leadId}` : agencyId ? `/agencies/${agencyId}` : `/customers/${customerId}`;
  const summary = s(f, "summary");
  if (!summary) back(path, { error: "Γράψε τι έγινε" });
  const { error } = await supabase.from("activities").insert({
    lead_id: leadId,
    customer_id: customerId,
    agency_id: agencyId,
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

export async function renameCustomer(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const { error } = await supabase.rpc("rename_customer", { p_id: id, p_name: s(f, "name"), p_version: Number(s(f, "version")) });
  revalidatePath(`/customers/${id}`);
  if (error) back(`/customers/${id}`, { error: friendly(error.message) });
  back(`/customers/${id}`, { ok: "saved" });
}

export async function mergeSelected(f: FormData) {
  const { supabase } = await requireProfile();
  const ids = f.getAll("ids").map(String);
  // Όνομα: ό,τι γράφτηκε, αλλιώς του πελάτη με το «όνομα» — μόνο αν είναι τσεκαρισμένος.
  let keepName = s(f, "keep_name");
  const keepId = s(f, "keep_id");
  if (!keepName && keepId && ids.includes(keepId)) {
    const { data: k } = await supabase.from("customers").select("display_name").eq("id", keepId).maybeSingle();
    keepName = k?.display_name ?? null;
  }
  const { error } = await supabase.rpc("merge_selected", {
    p_group: s(f, "id"),
    p_ids: s(f, "none") === "1" ? [] : ids,
    p_keep_name: keepName,
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

// ---------- Εργασίες ----------

export async function createTask(f: FormData) {
  const { supabase, profile, isAdmin } = await requireProfile();
  const backTo = s(f, "back") ?? "/tasks";
  const title = s(f, "title");
  if (!title) back(backTo, { error: "Γράψε τι πρέπει να γίνει" });
  const { error } = await supabase.from("tasks").insert({
    title,
    details: s(f, "details"),
    due_date: s(f, "due_date"),
    owner_id: isAdmin ? s(f, "owner_id") ?? profile.id : profile.id,
    customer_id: s(f, "customer_id"),
    lead_id: s(f, "lead_id"),
    agency_id: s(f, "agency_id"),
  });
  revalidatePath(backTo);
  if (error) back(backTo, { error: friendly(error.message) });
  back(backTo, { ok: "task" });
}

export async function completeTask(f: FormData) {
  const { supabase } = await requireProfile();
  const backTo = s(f, "back") ?? "/tasks";
  const done = s(f, "done") !== "0";
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "open", done_at: done ? new Date().toISOString() : null })
    .eq("id", s(f, "id")!);
  revalidatePath(backTo);
  revalidatePath("/today");
  if (error) back(backTo, { error: friendly(error.message) });
  back(backTo, { ok: done ? "taskdone" : "1" });
}

// ---------- Email «Προς έλεγχο» ----------

async function loadReviewEmail(id: string) {
  const ctx = await requireProfile();
  const { data: em } = await ctx.supabase.from("email_messages").select("*").eq("id", id).maybeSingle();
  if (!em) back("/inbox", { error: "Το email δεν βρέθηκε" });
  return { ...ctx, em: em! };
}

export async function reviewAsLead(f: FormData) {
  const { supabase, profile, isAdmin, em } = await loadReviewEmail(s(f, "id")!);
  const company = s(f, "company") ?? em.ai_company ?? em.counterpart_name ?? em.counterpart_email;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      company_name: company,
      contact_name: s(f, "contact_name") ?? em.ai_contact_name,
      phone: s(f, "phone") ?? em.ai_phone,
      email: em.counterpart_email,
      source: "email",
      next_step: s(f, "next_step") ?? "Πρώτη επαφή (lead από email)",
      next_step_due: s(f, "next_step_due") ?? tomorrow,
      notes: `Από email: «${em.subject}» — ${em.summary ?? ""}`,
      owner_id: isAdmin ? s(f, "owner_id") : null,
    })
    .select("id")
    .single();
  if (error || !lead) back("/inbox", { error: friendly(error?.message) });
  await supabase.from("contacts").insert({ email: em.counterpart_email, name: em.counterpart_name, lead_id: lead!.id, created_by: profile.id });
  await supabase.from("email_messages").update({ status: "lead_created", lead_id: lead!.id, decided_at: new Date().toISOString() }).eq("id", em.id);
  await supabase.from("activities").insert({
    lead_id: lead!.id,
    type: "email",
    summary: `${em.direction === "in" ? "📥" : "📤"} ${em.subject}${em.summary ? " — " + em.summary : ""}`,
    occurred_at: em.occurred_at,
    email_message_id: em.id,
  });
  revalidatePath("/inbox");
  redirect(`/leads/${lead!.id}?ok=created`);
}

export async function reviewAsCustomer(f: FormData) {
  const { supabase, profile, em } = await loadReviewEmail(s(f, "id")!);
  const customerId = s(f, "customer_id");
  if (!customerId) back("/inbox", { error: "Διάλεξε πελάτη" });
  // Μαθαίνει τη διεύθυνση, ώστε την επόμενη φορά να το συνδέσει μόνο του.
  // Τα πρακτορεία στέλνουν για πολλούς πελάτες: εκεί δεν τη «δένουμε» σε έναν.
  if (s(f, "remember") === "1") {
    await supabase.from("contacts").insert({ email: em.counterpart_email, name: em.counterpart_name, customer_id: customerId, created_by: profile.id });
  }
  await supabase.from("email_messages").update({ status: "logged", customer_id: customerId, decided_at: new Date().toISOString() }).eq("id", em.id);
  const { error } = await supabase.from("activities").insert({
    customer_id: customerId,
    type: "email",
    summary: `${em.direction === "in" ? "📥" : "📤"} ${em.subject}${em.summary ? " — " + em.summary : ""}`,
    occurred_at: em.occurred_at,
    email_message_id: em.id,
  });
  revalidatePath("/inbox");
  if (error) back("/inbox", { error: friendly(error.message) });
  back("/inbox", { ok: "linked" });
}

// Email πρακτορείου → στην καρτέλα του πρακτορείου. Προαιρετικά μαθαίνει το domain,
// ώστε όλα τα επόμενα από το ίδιο πρακτορείο να μπαίνουν εκεί αυτόματα.
export async function reviewAsAgency(f: FormData) {
  const { supabase, isAdmin, em } = await loadReviewEmail(s(f, "id")!);
  let agencyId = s(f, "agency_id");
  const newName = s(f, "new_name")?.toUpperCase();
  if (newName) {
    if (!isAdmin) back("/inbox", { error: "Νέο πρακτορείο προσθέτει μόνο ο Νίκος ή η Γιάννα" });
    const { data: a, error } = await supabase.from("agencies").upsert({ name: newName }, { onConflict: "name" }).select("id").single();
    if (error || !a) back("/inbox", { error: friendly(error?.message) });
    agencyId = a!.id;
  }
  if (!agencyId) back("/inbox", { error: "Διάλεξε πρακτορείο" });
  const domain = em.counterpart_email.slice(em.counterpart_email.indexOf("@")).toLowerCase();
  const generic = /@(gmail|yahoo|hotmail|outlook|live|otenet|windowslive|icloud)\./.test(domain);
  if (s(f, "remember") === "1" && isAdmin && !generic) {
    const { data: a } = await supabase.from("agencies").select("domains").eq("id", agencyId!).single();
    const domains = Array.from(new Set([...(a?.domains ?? []), domain]));
    await supabase.from("agencies").update({ domains }).eq("id", agencyId!);
  }
  await supabase.from("email_messages").update({ status: "logged", agency_id: agencyId, decided_at: new Date().toISOString() }).eq("id", em.id);
  const { error } = await supabase.from("activities").insert({
    agency_id: agencyId,
    type: "email",
    summary: `${em.direction === "in" ? "📥" : "📤"} ${em.subject}${em.summary ? " — " + em.summary : ""}`,
    occurred_at: em.occurred_at,
    email_message_id: em.id,
  });
  revalidatePath("/inbox");
  if (error) back("/inbox", { error: friendly(error.message) });
  back("/inbox", { ok: "agency" });
}

export async function updateAgencyDomains(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const domains = (s(f, "domains") ?? "")
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^.*@/, "").replace(/^www\./, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .map((d) => "@" + d);
  const { error } = await supabase.from("agencies").update({ domains: Array.from(new Set(domains)) }).eq("id", id);
  revalidatePath(`/agencies/${id}`);
  if (error) back(`/agencies/${id}`, { error: friendly(error.message) });
  back(`/agencies/${id}`, { ok: "saved" });
}

export async function reviewIgnore(f: FormData) {
  const { supabase, profile, em } = await loadReviewEmail(s(f, "id")!);
  const mode = s(f, "mode");
  if (mode === "sender" || mode === "domain") {
    const pattern = mode === "sender" ? em.counterpart_email : em.counterpart_email.slice(em.counterpart_email.indexOf("@"));
    await supabase.from("ignored_senders").upsert({ pattern: pattern.toLowerCase(), created_by: profile.id });
  }
  await supabase.from("email_messages").update({ status: "ignored", decided_at: new Date().toISOString() }).eq("id", em.id);
  revalidatePath("/inbox");
  back("/inbox", { ok: "ignored" });
}

// ---------- Outlook ----------

export async function syncMailNow() {
  const { profile } = await requireProfile();
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { syncAll } = await import("@/lib/mail/sync");
  const [r] = await syncAll(supabaseAdmin(), profile.id);
  if (!r) back("/settings", { error: "Δεν έχεις συνδέσει Outlook" });
  if (r.error) back("/settings", { error: r.error });
  back("/settings", { ok: "sync", n: `${r.logged}-${r.leads}-${r.review}-${r.tasks}` });
}

export async function disconnectOutlook() {
  const { profile } = await requireProfile();
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  await supabaseAdmin().from("mail_accounts").delete().eq("user_id", profile.id);
  back("/settings", { ok: "disconnected" });
}
