"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const s = (f: FormData, k: string) => { const v = f.get(k); return v == null || String(v).trim() === "" ? null : String(v).trim(); };
const go = (path: string, params: Record<string, string>) => redirect(`${path}?${new URLSearchParams(params).toString()}`);
const greek = (m?: string) => (m && /[Α-Ωα-ω]/.test(m) ? m : "Δεν έγινε. Δοκίμασε ξανά.");
const fresh = () => { revalidatePath("/billing"); revalidatePath("/dashboard"); revalidatePath("/customers"); };

// «Ποιος πελάτης είναι;» — υπάρχων πελάτης ή νέος. Το CRM το θυμάται για το ίδιο όνομα.
export async function answerBillingName(f: FormData) {
  const { supabase } = await requireProfile();
  const pick = s(f, "pick");
  if (!pick) go("/billing", { error: "Διάλεξε πελάτη ή «Νέος πελάτης»" });
  const { error } = await supabase.rpc("answer_billing_name", { p_key: s(f, "key")!, p_customer: pick === "new" ? null : pick, p_new: pick === "new" });
  if (error) go("/billing", { error: greek(error.message) });
  fresh();
  go("/billing", { ok: pick === "new" ? "billnew" : "billsame" });
}

// «Ήρθε από αυτό το lead;» — μία απάντηση για όλες τις γραμμές της καμπάνιας
export async function answerBillingLead(f: FormData) {
  const { supabase } = await requireProfile();
  const yes = s(f, "yes") === "1";
  const { error } = await supabase.rpc("answer_billing_lead", { p_customer: s(f, "customer")!, p_lead: s(f, "lead")!, p_yes: yes });
  if (error) go("/billing", { error: greek(error.message) });
  fresh();
  go("/billing", { ok: yes ? "billlead" : "billdirect" });
}

// Διάβασμα τώρα, χωρίς να περιμένουμε το βράδυ. Μόνο Νίκος / Γιάννα.
export async function syncBillingNow() {
  const { isAdmin } = await requireProfile();
  if (!isAdmin) go("/today", { error: "Μόνο ο Νίκος ή η Γιάννα" });
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { runBillingSync } = await import("@/lib/billing/sync");
  const r = await runBillingSync(supabaseAdmin());
  fresh();
  if (!r.ran) go("/billing", { error: "Δεν έχουν μπει ακόμα οι σύνδεσμοι των αρχείων (Ρυθμίσεις → Τιμολόγηση από Dropbox)" });
  if (!r.ok) go("/billing", { error: r.summary.problems.join(" · ").slice(0, 400) });
  go("/billing", { ok: "billsync", n: `${r.summary.added}-${r.summary.changed}-${r.summary.removed}` });
}

// Οι σύνδεσμοι Dropbox των αρχείων τιμολόγησης. Μόνο ο Νίκος. Δεν ξαναδείχνονται στην οθόνη.
export async function saveBillingLinks(f: FormData) {
  const { isCeo } = await requireProfile();
  if (!isCeo) go("/settings", { error: "Μόνο ο Νίκος" });
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { cleanLink, LINKS_KEY } = await import("@/lib/billing/sync");
  const raw = String(f.get("links") ?? "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
  if (!raw.length) go("/settings", { error: "Κόλλησε τουλάχιστον έναν σύνδεσμο" });
  const bad = raw.filter((x) => !cleanLink(x));
  if (bad.length) go("/settings", { error: "Κάποιος σύνδεσμος δεν είναι του Dropbox (πρέπει να αρχίζει με https://www.dropbox.com/)" });
  const { error } = await supabaseAdmin().from("app_secrets").upsert({ key: LINKS_KEY, value: JSON.stringify(raw) }, { onConflict: "key" });
  if (error) go("/settings", { error: "Δεν αποθηκεύτηκαν οι σύνδεσμοι" });
  go("/settings", { ok: "billlinks" });
}
