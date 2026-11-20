import type { SupabaseClient } from "@supabase/supabase-js";
import { STATIONS, type ClientType } from "@/lib/pricing";
import { VALID_DAYS, autoSubtitle, buildRows, type OfferItem, type Snapshot } from "@/lib/offer";

// Χτίζει την προσφορά από την πρόταση όπως είναι τώρα. Χρησιμοποιείται και στην προεπισκόπηση και στην έκδοση.
export async function buildSnapshot(supabase: SupabaseClient, leadId: string, pid: string, fallbackUser: string): Promise<{ snapshot: Snapshot; pending: boolean; sent: boolean } | { error: string }> {
  const [{ data: p }, { data: tot }, { data: lead }] = await Promise.all([
    supabase.from("proposals").select("id, code, client_type, offer_subtitle, req_status, sent_at, proposal_items(*)").eq("id", pid).eq("lead_id", leadId).maybeSingle(),
    supabase.from("proposal_totals").select("list_total, combo_pct, prepay_pct, final_total").eq("proposal_id", pid).maybeSingle(),
    supabase.from("leads").select("company_name, owner_id").eq("id", leadId).maybeSingle(),
  ]);
  if (!p || !tot || !lead || !p.client_type) return { error: "Η πρόταση δεν βρέθηκε" };
  const items = (p.proposal_items ?? []) as OfferItem[];
  if (!items.length) return { error: "Η πρόταση είναι άδεια" };
  const order = [...STATIONS] as string[];
  items.sort((a, b) => order.indexOf(a.station) - order.indexOf(b.station));
  const { rows, totalSpots } = buildRows(items, p.client_type as ClientType);
  const { data: ae } = await supabase.from("profiles").select("full_name, offer_name, offer_phone, email").eq("id", lead.owner_id ?? fallbackUser).maybeSingle();
  const reasons: string[] = [];
  if (Number(tot.combo_pct) > 0) reasons.push(`έκπτωση combo ${tot.combo_pct}%`);
  if (Number(tot.prepay_pct) > 0) reasons.push(`έκπτωση προπληρωμής ${tot.prepay_pct}%`);
  if (p.req_status === "approved") reasons.push("ειδική τιμή");
  const now = new Date();
  return {
    pending: p.req_status === "pending",
    sent: !!p.sent_at,
    snapshot: {
      code: p.code as string,
      company: lead.company_name as string,
      subtitle: (p.offer_subtitle as string | null) ?? autoSubtitle(items),
      local: p.client_type === "local",
      rows, totalSpots,
      list: Number(tot.list_total), final: Number(tot.final_total), reasons,
      issued: now.toISOString(), validUntil: new Date(now.getTime() + VALID_DAYS * 86400000).toISOString(),
      ae: { name: ae?.offer_name ?? ae?.full_name ?? "Kartelias Media Group", phone: ae?.offer_phone ?? null, email: ae?.email ?? null },
    },
  };
}
