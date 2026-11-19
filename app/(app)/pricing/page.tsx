import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { PricingBody } from "@/components/PricingBody";

export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { isAdmin } = await requireProfile();
  return (
    <main className="wrap" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Τιμοκατάλογος</h1>
        <div className="row" style={{ gap: 8 }}>
          {isAdmin && <a href="/settings?tab=pricing" className="btn secondary">Αλλαγή τιμών</a>}
          <a href="/pricing/plan" className="btn">Κοστολόγηση πλάνου →</a>
        </div>
      </div>
      <Flash sp={sp} />
      <PricingBody sp={sp} edit={false} />
    </main>
  );
}
