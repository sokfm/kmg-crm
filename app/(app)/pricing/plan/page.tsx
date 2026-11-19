import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { PlanCalculator } from "@/components/PlanCalculator";

export default async function PlanPage() {
  const { supabase } = await requireProfile();
  const [{ data: rates }, { data: slots }] = await Promise.all([
    supabase.from("station_rates").select("station, local_per_k, direct_per_k").order("sort"),
    supabase.from("station_slots").select("station, slot, listeners_k, sort").order("sort"),
  ]);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const defaultStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  return (
    <main className="wrap" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Κοστολόγηση πλάνου</h1>
        <Link href="/pricing" className="muted">← Τιμοκατάλογος</Link>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Για σποτ μεγαλύτερα ή μικρότερα από 30&apos;&apos;, καμπάνιες με διαφορετικά σποτ ή μεγάλους πελάτες direct.
        Η τιμή βγαίνει από τους ακροατές κάθε μισάωρου (Χαλκίδα - Εύβοια, παλιά έρευνα — δεν υπάρχει νεότερη). Οι εκπτώσεις δεν μπαίνουν ακόμα.
      </p>
      <PlanCalculator
        rates={(rates ?? []).map((r) => ({ station: r.station, local_per_k: Number(r.local_per_k), direct_per_k: Number(r.direct_per_k) }))}
        slots={(slots ?? []).map((s) => ({ ...s, listeners_k: Number(s.listeners_k) }))}
        defaultStart={defaultStart}
      />
    </main>
  );
}
