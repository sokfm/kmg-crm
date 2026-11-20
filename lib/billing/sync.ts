import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBilling } from "./parse";

// Η τιμολόγηση ακολουθεί το Excel του Dropbox. Οι σύνδεσμοι («Κοινή χρήση» → αντιγραφή συνδέσμου, ένας ανά αρχείο/έτος)
// μένουν στον πίνακα app_secrets (μόνο server). Το έτος και ο μήνας βγαίνουν από το όνομα κάθε φύλλου.
export const LINKS_KEY = "billing_links";
const MAX_BYTES = 20 * 1024 * 1024;

// Δεχόμαστε μόνο https σύνδεσμο του Dropbox, και τον γυρνάμε σε «κατέβασμα» (dl=1)
export function cleanLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || !/(^|\.)dropbox\.com$/i.test(u.hostname)) return null;
    u.searchParams.set("dl", "1");
    return u.toString();
  } catch { return null; }
}

export async function billingLinks(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", LINKS_KEY).maybeSingle();
  try { return (JSON.parse(data?.value ?? "[]") as string[]).filter((x) => cleanLink(x)); } catch { return []; }
}

async function download(link: string): Promise<Uint8Array> {
  const res = await fetch(link, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`το Dropbox απάντησε ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("το αρχείο είναι πολύ μεγάλο");
  // Ένα .xlsx αρχίζει πάντα με «PK». Αν ήρθε σελίδα σύνδεσης, ο σύνδεσμος δεν είναι «όποιος έχει τον σύνδεσμο».
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("ο σύνδεσμος δεν δίνει το αρχείο Excel (θέλει «όποιος έχει τον σύνδεσμο μπορεί να δει»)");
  return buf;
}

export type SyncSummary = {
  files: number; months: number; same: number; changed: number; added: number; removed: number;
  names: number; leads: number; skipped: number; touched: string[]; problems: string[];
};

export async function runBillingSync(admin: SupabaseClient): Promise<{ ran: boolean; ok: boolean; summary: SyncSummary }> {
  const sum: SyncSummary = { files: 0, months: 0, same: 0, changed: 0, added: 0, removed: 0, names: 0, leads: 0, skipped: 0, touched: [], problems: [] };
  const links = await billingLinks(admin);
  if (!links.length) return { ran: false, ok: false, summary: sum };

  const seen = new Set<string>();
  for (const [i, link] of links.entries()) {
    let parsed;
    try { parsed = parseBilling(await download(cleanLink(link)!)); }
    catch (e) { sum.problems.push(`Αρχείο ${i + 1}: ${e instanceof Error ? e.message : "δεν διαβάστηκε"}`); continue; }
    sum.files++;
    sum.problems.push(...parsed.problems);
    for (const m of parsed.months) {
      const per = `${m.year}-${String(m.month).padStart(2, "0")}`;
      if (seen.has(per)) { sum.problems.push(`Ο μήνας ${per} υπάρχει σε δύο φύλλα («${m.sheet}»): κρατήθηκε το πρώτο`); continue; }
      seen.add(per);
      const { data, error } = await admin.rpc("apply_billing_month", { p_year: m.year, p_month: m.month, p_lines: m.lines, p_dry: false });
      if (error) { sum.problems.push(`${per}: ${error.message}`); continue; }
      const r = data as Record<string, number | boolean | string>;
      sum.months++;
      if (r.skipped) { sum.skipped++; sum.problems.push(`${per}: το φύλλο έχει ${r.file} γραμμές ενώ το CRM ${r.crm}. Δεν άλλαξα τίποτα σε αυτόν τον μήνα.`); continue; }
      sum.same += Number(r.same); sum.changed += Number(r.changed); sum.added += Number(r.added); sum.removed += Number(r.removed);
      sum.names += Number(r.names); sum.leads += Number(r.leads);
      if (Number(r.changed) + Number(r.added) + Number(r.removed) > 0) sum.touched.push(per);
    }
  }
  // «Δεν διαβάστηκε» = κάποιο αρχείο ή φύλλο δεν μπήκε. Οι μήνες που κόπηκαν από τη δικλείδα μετράνε χωριστά (skipped).
  const hard = sum.problems.filter((p) => !/Δεν άλλαξα τίποτα/.test(p));
  await admin.rpc("finish_billing_sync", { p_summary: sum, p_error: hard.length ? hard.join(" · ").slice(0, 900) : null });
  return { ran: true, ok: hard.length === 0, summary: sum };
}
