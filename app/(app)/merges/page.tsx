import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr } from "@/lib/format";
import { mergeSelected } from "../actions";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";

type Cust = { id: string; display_name: string; lifetime_revenue: number; last_period: string | null; status: string };

export default async function Merges({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/today");
  const { data, count } = await supabase
    .from("merge_candidates")
    .select("id, source_customer_ids, revenue_total, last_period", { count: "exact" })
    .eq("decision", "pending")
    .order("revenue_total", { ascending: false })
    .limit(10);
  const groups = data ?? [];

  // Για κάθε ομάδα: οι πελάτες που την αποτελούν (μπορεί να έχουν ήδη ενωθεί κάποιοι)
  const members: Record<string, Cust[]> = {};
  for (const g of groups) {
    const { data: al } = await supabase.from("customer_aliases").select("customer_id").in("source_customer_id", g.source_customer_ids);
    const ids = [...new Set((al ?? []).map((a) => a.customer_id))];
    const { data: cs } = await supabase
      .from("customers")
      .select("id, display_name, lifetime_revenue, last_period, status")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("lifetime_revenue", { ascending: false });
    members[g.id] = (cs ?? []) as Cust[];
  }

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <h1>Ίδιος πελάτης;</h1>
      <p className="muted">
        {count ?? 0} ομάδες ονομάτων από το αρχείο που ίσως είναι ο ίδιος πελάτης. Τσέκαρε <strong>μόνο όσα είναι ο ίδιος</strong> και
        πάτα «Ένωσε τα τσεκαρισμένα». Όσα ξετσεκάρεις μένουν ξεχωριστοί πελάτες.
      </p>
      <Flash sp={sp} />
      {groups.map((g) => {
        const ms = members[g.id];
        return (
          <form key={g.id} action={mergeSelected} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="id" value={g.id} />
            <div className="row">
              <strong className="grow">{ms.length} ονόματα · {eur(g.revenue_total)}</strong>
              <span className="muted">τελευταία {periodGr(g.last_period)}</span>
            </div>
            <div className="list">
              {ms.map((c) => (
                <label key={c.id} className="item" style={{ flexDirection: "row", fontWeight: 400, cursor: "pointer" }}>
                  <input type="checkbox" name="ids" value={c.id} defaultChecked style={{ width: 18, height: 18 }} />
                  <span className="grow"><strong>{c.display_name}</strong></span>
                  <span className="muted">{eur(c.lifetime_revenue)} · {periodGr(c.last_period)}{c.status === "base" ? " · βάση" : ""}</span>
                </label>
              ))}
            </div>
            <label>Όνομα που κρατάμε για όσα ενώνονται<input name="keep_name" defaultValue={ms[0]?.display_name ?? ""} /></label>
            <div className="row">
              <SubmitButton pending="Ένωση…">Ένωσε τα τσεκαρισμένα</SubmitButton>
              <SubmitButton name="none" value="1" className="secondary" pending="…">Όλοι διαφορετικοί</SubmitButton>
            </div>
          </form>
        );
      })}
    </main>
  );
}
