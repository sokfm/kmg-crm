import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { PlanCalculator } from "@/components/PlanCalculator";
import { CLIENT_LABEL, SLOT_SELECT, STATIONS, priceCol, toSlots, type ClientType, type Grid, type Rate } from "@/lib/pricing";

export default async function ProposalPlan({
  params, searchParams,
}: { params: Promise<{ id: string; pid: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id, pid } = await params;
  const base = `/leads/${id}/proposal/${pid}`;
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("id, company_name").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data: p } = await supabase.from("proposals").select("id, client_type, title").eq("id", pid).eq("lead_id", id).maybeSingle();
  if (!p?.client_type) redirect(`/leads/${id}/proposal`);
  const type = p.client_type as ClientType;

  // Άνοιγμα αποθηκευμένου πλάνου για αλλαγή, ή νέο πλάνο για τον σταθμό
  const { data: item } = sp.item
    ? await supabase.from("proposal_items").select("id, station, title, sec, start_date, plan, version").eq("id", sp.item).eq("proposal_id", p.id).eq("kind", "plan").maybeSingle()
    : { data: null };
  const station = item?.station ?? sp.station;
  if (!station || !(STATIONS as readonly string[]).includes(station)) redirect(base);

  const [{ data: rate }, { data: slots }] = await Promise.all([
    supabase.from("station_rates").select("station, media_shop_sec, government_sec, local_per_k, direct_per_k").eq("station", station).maybeSingle(),
    supabase.from("station_slots").select(SLOT_SELECT).eq("station", station).order("sort"),
  ]);
  if (!rate) notFound();
  const defaultStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());

  return (
    <main className="wrap" style={{ maxWidth: 1500 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Κοστολόγηση πλάνου · {station}</h1>
        <Link href={base} className="muted">← {p.title}: {lead.company_name}</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted" style={{ marginTop: 0 }}>
        {lead.company_name} · <strong>{CLIENT_LABEL[type]}</strong>. Στήσε το πλάνο ενός μήνα (30 ημέρες) και πάτα «Αποθήκευση στην πρόταση». Τη διάρκεια σε μήνες τη διαλέγεις μετά, μέσα στην πρόταση.
      </p>
      <PlanCalculator
        cols={{ [station]: [priceCol(rate as Rate, type)] }}
        slots={toSlots(slots)}
        defaultStart={defaultStart}
        lockStation={station}
        initial={item ? { grid: (item.plan ?? {}) as Grid, sec: item.sec ?? 30, start: item.start_date, title: item.title.replace(/^Πλάνο: /, "").replace(/^Πλάνο κοστολόγησης$/, "") } : undefined}
        save={{ leadId: id, proposalId: pid, itemId: item?.id, version: item?.version }}
      />
    </main>
  );
}
