import { notFound } from "next/navigation";
import type { Viewport } from "next";
import { requireProfile } from "@/lib/auth";
import { OfferDoc } from "@/components/OfferDoc";
import { PrintBar } from "@/components/PrintBar";
import type { Snapshot } from "@/lib/offer";

// Η προσφορά είναι σχεδιασμένη σε πλάτος 1280: στο κινητό φαίνεται ολόκληρη, μικρότερη
export const viewport: Viewport = { width: 1280 };

export default async function OfferPage({ params, searchParams }: { params: Promise<{ oid: string }>; searchParams: Promise<Record<string, string>> }) {
  const { oid } = await params;
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const { data: o } = await supabase.from("proposal_offers").select("id, proposal_id, lead_id, snapshot").eq("id", oid).maybeSingle();
  if (!o) notFound();
  const { data: lead } = await supabase.from("leads").select("customer_id").eq("id", o.lead_id).maybeSingle();
  const { data: lg } = lead?.customer_id
    ? await supabase.from("logos").select("data").eq("customer_id", lead.customer_id).maybeSingle()
    : await supabase.from("logos").select("data").eq("lead_id", o.lead_id).maybeSingle();
  return (
    <div className="offer-wrap" style={{ background: "#e9e9ee", minHeight: "100vh" }}>
      <PrintBar back={`/leads/${o.lead_id}/proposal/${o.proposal_id}/offer`} auto={sp.print === "1"} />
      <div className="offer-wrap" style={{ padding: "16px 0" }}><OfferDoc s={o.snapshot as Snapshot} logo={(lg?.data as string | undefined) ?? null} /></div>
    </div>
  );
}
