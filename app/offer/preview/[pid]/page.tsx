import { notFound } from "next/navigation";
import type { Viewport } from "next";
import { requireProfile } from "@/lib/auth";
import { OfferDoc } from "@/components/OfferDoc";
import { buildSnapshot } from "@/lib/offer-server";

export const viewport: Viewport = { width: 1280 };

// Προεπισκόπηση: δείχνει πώς θα βγει η προσφορά, με υδατογράφημα «ΠΡΟΣΧΕΔΙΟ». Δεν κλειδώνει και δεν αποθηκεύεται.
export default async function OfferPreview({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const { supabase, profile } = await requireProfile();
  const { data: p } = await supabase.from("proposals").select("lead_id").eq("id", pid).maybeSingle();
  if (!p) notFound();
  const built = await buildSnapshot(supabase, p.lead_id, pid, profile.id);
  const back = `/leads/${p.lead_id}/proposal/${pid}/offer`;
  const { data: lead } = await supabase.from("leads").select("customer_id").eq("id", p.lead_id).maybeSingle();
  const { data: lg } = lead?.customer_id
    ? await supabase.from("logos").select("data").eq("customer_id", lead.customer_id).maybeSingle()
    : await supabase.from("logos").select("data").eq("lead_id", p.lead_id).maybeSingle();
  return (
    <div className="offer-wrap" style={{ background: "#e9e9ee", minHeight: "100vh" }}>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 6, background: "#0E0D11", color: "#fff", padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a href={back} style={{ color: "#fff" }}>← Πίσω</a>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13 }}>Προεπισκόπηση. Για να τη στείλεις, γύρνα πίσω και πάτα «Έκδοση για αποστολή».</span>
      </div>
      {"error" in built ? <p style={{ padding: 24 }}>{built.error}</p> : <div className="offer-wrap" style={{ padding: "16px 0" }}><OfferDoc s={built.snapshot} logo={(lg?.data as string | undefined) ?? null} draft /></div>}
    </div>
  );
}
