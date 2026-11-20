"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { understandNewLead, understandNote, type VoiceResult } from "@/lib/voice";

const OPEN = ["new", "contacted", "meeting", "proposal", "negotiation"];
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};

// Βήμα 1: η AI διαβάζει αυτό που ειπώθηκε και ΠΡΟΤΕΙΝΕΙ. Δεν γράφει τίποτα στο CRM.
export async function interpretVoice(leadId: string, text: string): Promise<{ ok: true; result: VoiceResult } | { ok: false; error: string }> {
  const { supabase } = await requireProfile();
  const clean = text.trim();
  if (clean.length < 8) return { ok: false, error: "Πες ή γράψε λίγα παραπάνω: τι έγινε και τι ακολουθεί." };
  const { data: lead } = await supabase.from("leads").select("company_name, status, next_step, next_step_due").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, error: "Το lead δεν βρέθηκε." };
  if (!OPEN.includes(lead.status)) return { ok: false, error: "Το lead είναι κλειστό." };
  try {
    const result = await understandNote({ text: clean, company: lead.company_name, stage: lead.status, nextStep: lead.next_step, nextDue: lead.next_step_due });
    if (!result.summary) return { ok: false, error: "Δεν κατάλαβα τι έγινε. Δοκίμασε ξανά με άλλα λόγια." };
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: `Η AI δεν απάντησε τώρα. Δοκίμασε ξανά σε λίγο ή γράψ' το με το χέρι από κάτω. (${e instanceof Error ? e.message.slice(0, 60) : "σφάλμα"})` };
  }
}

// Βήμα 2: ο Account Executive είδε, διόρθωσε και πάτησε «Καταχώριση»
export async function applyVoice(f: FormData) {
  const { supabase } = await requireProfile();
  const leadId = s(f, "lead_id")!;
  const path = `/leads/${leadId}`;
  const fail = (m: string) => redirect(`${path}?${new URLSearchParams({ error: m }).toString()}`);
  const summary = s(f, "summary");
  if (!summary) fail("Γράψε τι έγινε");
  const type = s(f, "type") ?? "note";
  const nextStep = s(f, "next_step");
  const nextDue = s(f, "next_step_due");
  if (!nextStep || !isDate(nextDue)) fail("Κάθε ανοιχτό lead θέλει επόμενο βήμα και ημερομηνία");

  // Πρώτα το lead (με έλεγχο έκδοσης), μετά η επαφή: αν κάποιος άλλος το άλλαξε στο μεταξύ, δεν γράφεται τίποτα
  const tm = String(f.get("next_step_time") ?? "").trim();
  const patch: Record<string, unknown> = { next_step: nextStep, next_step_due: nextDue, next_step_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(tm) ? tm : null };
  const stage = s(f, "stage");
  if (stage && OPEN.includes(stage)) patch.status = stage;
  const { data, error } = await supabase.from("leads").update(patch).eq("id", leadId).eq("version", Number(s(f, "version"))).select("id");
  if (error) fail("Δεν αποθηκεύτηκε. Δοκίμασε ξανά.");
  if (!data || data.length === 0) redirect(`${path}?conflict=1`);

  const { error: e2 } = await supabase.from("activities").insert({ lead_id: leadId, type: ["call", "meeting", "viber", "email", "note"].includes(type) ? type : "note", summary: `🎤 ${summary}`.slice(0, 700) });
  if (e2) fail("Το επόμενο βήμα αποθηκεύτηκε, αλλά η επαφή όχι. Γράψ' την από τη φόρμα.");

  const titles = f.getAll("task_title").map(String);
  const dues = f.getAll("task_due").map(String);
  const keep = new Set(f.getAll("task_keep").map(String));
  const tasks = titles.map((t, i) => ({ title: t.trim(), due_date: isDate(dues[i]) ? dues[i] : null, i })).filter((t) => t.title && keep.has(String(t.i)));
  if (tasks.length) await supabase.from("tasks").insert(tasks.map((t) => ({ title: t.title.slice(0, 160), due_date: t.due_date, lead_id: leadId })));

  revalidatePath(path); revalidatePath("/today"); revalidatePath("/pipeline");
  redirect(`${path}?ok=voice`);
}

// Νέο lead με τη φωνή: η AI γεμίζει τη φόρμα. Η καταχώριση γίνεται από τη φόρμα, με τους ίδιους ελέγχους (διπλοεγγραφή, ανάθεση).
export async function interpretNewLead(text: string): Promise<{ ok: true; query: string; missing: string[] } | { ok: false; error: string }> {
  await requireProfile();
  const clean = text.trim();
  if (clean.length < 8) return { ok: false, error: "Πες ή γράψε λίγα παραπάνω: ποια επιχείρηση, τι θέλει, τι ακολουθεί." };
  try {
    const v = await understandNewLead(clean);
    if (!v.company_name) return { ok: false, error: "Δεν κατάλαβα ποια επιχείρηση είναι. Πες το όνομά της ή γράψ' το στη φόρμα." };
    const q = new URLSearchParams({ voice: "1" });
    const put = (k: string, x: string | null) => { if (x) q.set(k, x); };
    put("company_name", v.company_name); put("contact_name", v.contact_name); put("phone", v.phone); put("email", v.email); put("area", v.area);
    put("source", v.source); put("product_line", v.interest); put("next_step", v.next_step); put("next_step_due", v.next_step_due); put("next_step_time", v.next_step_time); put("notes", v.notes);
    if (v.stations.length) q.set("stations", v.stations.join(","));
    const missing = [!v.phone && "τηλέφωνο", !v.next_step && "επόμενο βήμα", !v.next_step_due && "ημερομηνία επόμενου βήματος"].filter(Boolean) as string[];
    if (missing.length) q.set("missing", missing.join(", "));
    return { ok: true, query: q.toString(), missing };
  } catch (e) {
    return { ok: false, error: `Η AI δεν απάντησε τώρα. Δοκίμασε ξανά σε λίγο ή συμπλήρωσε τη φόρμα με το χέρι. (${e instanceof Error ? e.message.slice(0, 60) : "σφάλμα"})` };
  }
}
