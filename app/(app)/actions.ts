"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
  const { supabase, profile, isAdmin } = await requireProfile();
  const company = s(f, "company_name");
  if (!company) back("/leads/new", { error: "Γράψε όνομα επιχείρησης" });

  // Έλεγχος διπλοεγγραφής πριν την καταχώριση (εκτός αν ο χρήστης απάντησε ήδη)
  const dupAction = s(f, "dup_action"); // "same" = ίδιος πελάτης, "different" = άλλη επιχείρηση
  if (!dupAction) {
    const { data: dups } = await supabase.rpc("find_duplicate", { p_name: company, p_phone: s(f, "phone") });
    if (dups && dups.length) {
      const d = dups[0] as { kind: string; ref_id: string; display_name: string; owner_name: string };
      const params: Record<string, string> = { dup_kind: d.kind, dup_id: d.ref_id, dup_name: d.display_name, dup_owner: d.owner_name };
      for (const k of ["company_name", "contact_name", "phone", "email", "area", "source", "product_line", "market", "owner_id", "next_step", "next_step_due", "expected_value", "notes"]) {
        const v = s(f, k);
        if (v) params[k] = v;
      }
      const st = f.getAll("stations").map(String);
      if (st.length) params.stations = st.join(",");
      back("/leads/new", params);
    }
  }

  // «Είναι ο ίδιος πελάτης»: το lead συνδέεται με την υπάρχουσα καρτέλα πελάτη
  let customerId: string | null = null;
  if (dupAction === "same" && s(f, "dup_kind") === "customer") {
    const { data: c } = await supabase.from("customers").select("id, owner_id, status").eq("id", s(f, "dup_id")!).maybeSingle();
    if (c) {
      customerId = c.id;
      if (!c.owner_id) {
        if (isAdmin) {
          // Ο Νίκος/Γιάννα: ο πελάτης της βάσης περνά στον πωλητή του lead (ή σε σένα)
          await supabase.from("customers").update({ owner_id: s(f, "owner_id") ?? profile.id }).eq("id", c.id);
        } else {
          // Πωλητής: αίτημα για τον πελάτη της βάσης (το εγκρίνει ο Νίκος)
          await supabase.from("base_claims").insert({ customer_id: c.id, for_user: profile.id, note: "Από νέο lead" });
        }
      }
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
      customer_id: customerId,
    })
    .select("id")
    .single();
  if (error || !data) back("/leads/new", { error: friendly(error?.message) });
  revalidatePath("/today");
  // Η AI ψάχνει την επιχείρηση στο ίντερνετ μετά την καταχώριση (δεν περιμένεις εσύ)
  const newId = data!.id;
  after(async () => {
    try {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { enrichLead } = await import("@/lib/enrich");
      await enrichLead(supabaseAdmin(), newId);
    } catch { /* αν αποτύχει, μένει το κουμπί «Ψάξε στο ίντερνετ» */ }
  });
  redirect(`/leads/${newId}?ok=created`);
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
  revalidatePath("/customers");
  const ret = s(f, "back")?.startsWith("/customers") ? s(f, "back")!.split("?")[0] : "/customers";
  const keep = Object.fromEntries(new URLSearchParams(s(f, "back")?.split("?")[1] ?? "status=base"));
  if (error) back(ret, { ...keep, error: friendly(error.message) });
  back(ret, { ...keep, ok: isAdmin ? "assigned" : "requested" });
}

export async function decideClaim(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const approve = s(f, "decision") === "approve";
  const { error } = await supabase.from("base_claims").update({ status: approve ? "approved" : "rejected" }).eq("id", id);
  revalidatePath("/customers");
  if (error) back("/customers", { status: "base", error: friendly(error.message) });
  back("/customers", { status: "base", ok: approve ? "approved" : "rejected" });
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

// Ένωση πελατών με το χέρι (από τη λίστα πελατών)
export async function mergeCustomers(f: FormData) {
  const { supabase } = await requireProfile();
  const ids = f.getAll("ids").map(String);
  const { data, error } = await supabase.rpc("merge_customers_manual", { p_ids: ids, p_keep: s(f, "keep_id"), p_name: s(f, "keep_name") });
  revalidatePath("/customers");
  if (error) back("/customers/merge", { ids: ids.join(","), error: friendly(error.message) });
  redirect(`/customers/${data}?ok=merged`);
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
  const newId = lead!.id;
  after(async () => {
    try {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { enrichLead } = await import("@/lib/enrich");
      await enrichLead(supabaseAdmin(), newId);
    } catch { /* μένει το κουμπί «Ψάξε στο ίντερνετ» */ }
  });
  redirect(`/leads/${newId}?ok=created`);
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

// ---------- Στοιχεία από το ίντερνετ ----------

export async function webLookup(f: FormData) {
  const { supabase, isAdmin } = await requireProfile();
  const kind = s(f, "kind");
  const id = s(f, "id")!;
  const path = kind === "lead" ? `/leads/${id}` : `/customers/${id}`;
  // Ελέγχουμε ότι ο χρήστης βλέπει την εγγραφή (δικαιώματα βάσης)
  const { data: seen } = await supabase.from(kind === "lead" ? "leads" : "customers").select("id").eq("id", id).maybeSingle();
  if (!seen) back(path, { error: "Δεν βρέθηκε" });
  if (kind !== "lead" && !isAdmin) back(path, { error: "Μόνο ο Νίκος ή η Γιάννα" });
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { enrichLead, enrichCustomer } = await import("@/lib/enrich");
  const db = supabaseAdmin();
  try {
    if (kind === "lead") await enrichLead(db, id);
    else {
      const { data: c } = await db.from("customers").select("id, display_name, phone, email, category, agency, stations, last_period").eq("id", id).single();
      await enrichCustomer(db, c!);
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    back(path, { error: /credit|balance|billing/i.test(m) ? "Τελείωσε η πίστωση της AI (Anthropic Console → Billing)." : /not enabled|permission|web_search/i.test(m) ? "Η αναζήτηση στο ίντερνετ δεν είναι ενεργή στο Anthropic Console (Settings → Privacy/Tools)." : `Η αναζήτηση απέτυχε: ${m.slice(0, 160)}` });
  }
  revalidatePath(path);
  back(path, { ok: "web" });
}

export async function decideWeb(f: FormData) {
  const { supabase } = await requireProfile();
  const to = s(f, "back")?.startsWith("/customers/") ? s(f, "back")! : "/customers";
  const { error } = await supabase.rpc("decide_web_review", { p_id: s(f, "id"), p_closed: s(f, "closed") === "1" });
  revalidatePath(to);
  if (error) back(to, { error: friendly(error.message) });
  back(to, { ok: s(f, "closed") === "1" ? "webclosed" : "webkept" });
}

// Κωδικός για είσοδο από κινητό (χωρίς σύνδεσμο στο email)
export async function setPassword(f: FormData) {
  const { supabase } = await requireProfile();
  const p1 = String(f.get("password") ?? "");
  const p2 = String(f.get("password2") ?? "");
  if (p1.length < 10) back("/settings", { error: "Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες" });
  if (p1 !== p2) back("/settings", { error: "Οι δύο κωδικοί δεν είναι ίδιοι" });
  const { error } = await supabase.auth.updateUser({ password: p1 });
  if (error) back("/settings", { error: /reauth|recent/i.test(error.message) ? "Για ασφάλεια, βγες και ξαναμπές με email και ξαναδοκίμασε" : /same|different/i.test(error.message) ? "Είναι ίδιος με τον προηγούμενο" : /weak|pwned|leaked/i.test(error.message) ? "Πολύ εύκολος κωδικός· βάλε πιο δύσκολο" : friendly(error.message) });
  back("/settings", { ok: "password" });
}

// ---------- Πρόσωπα επιχείρησης ----------

export async function saveContact(f: FormData) {
  const { supabase, profile } = await requireProfile();
  const to = s(f, "back")?.startsWith("/") ? s(f, "back")! : "/customers";
  const email = s(f, "email")?.toLowerCase() ?? null;
  const row = {
    name: s(f, "name"),
    title: s(f, "title"),
    email,
    phone: s(f, "phone"),
    mobile: s(f, "mobile"),
    birthday: s(f, "birthday"),
    notes: s(f, "notes"),
    roles: f.getAll("roles").map(String),
    is_primary: s(f, "is_primary") === "1",
    do_not_contact: s(f, "do_not_contact") === "1",
  };
  if (!row.name && !row.email && !row.phone && !row.mobile) back(to, { error: "Γράψε τουλάχιστον όνομα, τηλέφωνο ή email" });
  const id = s(f, "id");
  let error;
  if (id) {
    const res = await supabase.from("contacts").update(row).eq("id", id).eq("version", Number(s(f, "version"))).select("id");
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) back(to, { conflict: "1" });
  } else {
    ({ error } = await supabase.from("contacts").insert({ ...row, customer_id: s(f, "customer_id"), lead_id: s(f, "lead_id"), created_by: profile.id }));
  }
  revalidatePath(to);
  if (error) back(to, { error: /contacts_email_unique|duplicate/i.test(error.message) ? "Αυτό το email υπάρχει ήδη σε άλλο πρόσωπο (ίσως σε άλλον πελάτη ή lead)" : friendly(error.message) });
  back(to, { ok: "person" });
}

export async function deleteContact(f: FormData) {
  const { supabase } = await requireProfile();
  const to = s(f, "back")?.startsWith("/") ? s(f, "back")! : "/customers";
  const { error } = await supabase.from("contacts").delete().eq("id", s(f, "id")!);
  revalidatePath(to);
  if (error) back(to, { error: friendly(error.message) });
  back(to, { ok: "persondel" });
}

// Στοιχεία επιχείρησης (με έλεγχο ταυτόχρονης αλλαγής)
export async function updateCustomerInfo(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const to = `/customers/${id}`;
  const { data, error } = await supabase.from("customers").update({
    legal_name: s(f, "legal_name"),
    afm: s(f, "afm"),
    doy: s(f, "doy"),
    category: s(f, "category"),
    phone: s(f, "phone"),
    email: s(f, "email")?.toLowerCase() ?? null,
    website: s(f, "website"),
    address: s(f, "address"),
    facebook: s(f, "facebook"),
    instagram: s(f, "instagram"),
    notes: s(f, "notes"),
  }).eq("id", id).eq("version", Number(s(f, "version"))).select("id");
  revalidatePath(to);
  if (error) back(to, { error: friendly(error.message) });
  if (!data || data.length === 0) back(to, { conflict: "1" });
  back(to, { ok: "saved" });
}

// ---------- Groups (εταιρεία-ομπρέλα με brands) ----------

export async function setGroupAction(f: FormData) {
  const { supabase } = await requireProfile();
  const ids = f.getAll("ids").map(String).flatMap((x) => x.split(",")).filter(Boolean);
  const to = s(f, "back")?.startsWith("/") ? s(f, "back")! : "/customers";
  const { data, error } = await supabase.rpc("set_group", { p_ids: ids, p_group: s(f, "group_id"), p_new_name: s(f, "new_name") });
  revalidatePath("/customers");
  if (error) back(to, { error: friendly(error.message) });
  redirect(`/customers/${data}?ok=grouped`);
}

export async function leaveGroupAction(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const { error } = await supabase.rpc("leave_group", { p_id: id });
  revalidatePath(`/customers/${id}`);
  if (error) back(`/customers/${id}`, { error: friendly(error.message) });
  back(`/customers/${id}`, { ok: "ungrouped" });
}

export async function makeGroupAction(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const { error } = await supabase.rpc("make_group", { p_id: id });
  revalidatePath(`/customers/${id}`);
  if (error) back(`/customers/${id}`, { error: friendly(error.message) });
  back(`/customers/${id}`, { ok: "isgroup" });
}

// ---------- Τιμοκατάλογος (πακέτα ανά σταθμό) ----------

function packageRow(f: FormData) {
  const int = (k: string) => {
    const v = s(f, k);
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    station: s(f, "station"),
    kind: s(f, "kind"),
    client_type: s(f, "client_type") ?? "local",
    name: s(f, "name"),
    description: s(f, "description"),
    spots_per_day: int("spots_per_day"),
    bonus_spots: int("bonus_spots") ?? 0,
    max_sec: int("max_sec"),
    price: money(s(f, "price")),
    unit: s(f, "kind") === "mention" ? "mention" : "month",
    long_months: int("long_months"),
    long_bonus_spots: int("long_bonus_spots"),
    long_price: money(s(f, "long_price")),
    notes: s(f, "notes"),
    needs_check: f.get("needs_check") === "1",
    active: f.get("active") !== "0",
  };
}

export async function savePackage(f: FormData) {
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) back("/pricing", { error: "Τις τιμές αλλάζουν μόνο ο Νίκος και η Γιάννα" });
  const row = packageRow(f);
  if (!row.name || row.price == null) back("/pricing", { error: "Χρειάζεται όνομα και τιμή" });
  if (row.long_months != null && row.long_months < 2) back("/pricing", { error: "Το bonus θέλει τουλάχιστον 2 μήνες" });
  const id = s(f, "id");
  if (id) {
    const { data, error } = await supabase.from("price_packages").update(row).eq("id", id).eq("version", Number(s(f, "version"))).select("id");
    revalidatePath("/pricing");
    if (error) back("/pricing", { error: friendly(error.message) });
    if (!data || data.length === 0) back("/pricing", { conflict: "1" });
    back("/pricing", { ok: "pkgsaved" });
  }
  const { error } = await supabase.from("price_packages").insert({ ...row, sort: 50 });
  revalidatePath("/pricing");
  if (error) back("/pricing", { error: friendly(error.message) });
  back("/pricing", { ok: "pkgadded" });
}
