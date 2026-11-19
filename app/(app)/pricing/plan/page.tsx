import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { PlanCalculator } from "@/components/PlanCalculator";
import { SLOT_SELECT, priceCol, toSlots, type PriceCol, type Rate } from "@/lib/pricing";

export default async function PlanPage() {
  const { supabase } = await requireProfile();
  const [{ data: rates }, { data: slots }] = await Promise.all([
    supabase.from("station_rates").select("station, media_shop_sec, government_sec, local_per_k, direct_per_k").order("sort"),
    supabase.from("station_slots").select(SLOT_SELECT).order("sort"),
  ]);
  const cols: Record<string, PriceCol[]> = {};
  for (const r of (rates ?? []) as Rate[]) cols[r.station] = [priceCol(r, "local"), priceCol(r, "direct")];
  const defaultStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
  return (
    <main className="wrap" style={{ maxWidth: 1500 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Κοστολόγηση πλάνου</h1>
        <Link href="/pricing" className="muted">← Τιμοκατάλογος</Link>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Πρόχειρος υπολογισμός: δεν αποθηκεύεται. Για να μείνει το πλάνο σε έναν πελάτη, άνοιξε το lead και πάτα «Πρόταση».
        Κάθε break έχει τη δική του τιμή ανά δευτερόλεπτο.
      </p>
      <PlanCalculator cols={cols} slots={toSlots(slots)} defaultStart={defaultStart} />
    </main>
  );
}
