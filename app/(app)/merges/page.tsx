import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr } from "@/lib/format";
import { decideMerge } from "../actions";
import { Flash } from "@/components/Flash";

export default async function Merges({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/today");
  const { data, count } = await supabase
    .from("merge_candidates")
    .select("id, names, revenue_total, last_period", { count: "exact" })
    .eq("decision", "pending")
    .order("revenue_total", { ascending: false })
    .limit(15);

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <h1>Ίδιος πελάτης;</h1>
      <p className="muted">
        {count ?? 0} ομάδες ονομάτων από το αρχείο που ίσως είναι ο ίδιος πελάτης (π.χ. SMART HOME / SMART MARKET). Ξεκινάμε από τις μεγαλύτερες σε τζίρο.
      </p>
      <Flash sp={sp} />
      {(data ?? []).map((g) => (
        <form key={g.id} action={decideMerge} className="card stack">
          <input type="hidden" name="id" value={g.id} />
          <div className="row">
            <strong className="grow">{g.names.length} ονόματα · {eur(g.revenue_total)}</strong>
            <span className="muted">τελευταία {periodGr(g.last_period)}</span>
          </div>
          <div className="row">{g.names.map((n: string) => <span key={n} className="badge gray">{n}</span>)}</div>
          <label>Όνομα που κρατάμε (αν είναι ίδιοι)<input name="keep_name" defaultValue={g.names[0]} /></label>
          <div className="row">
            <button name="same" value="1" type="submit">Ίδιος πελάτης</button>
            <button name="same" value="0" type="submit" className="secondary">Διαφορετικοί</button>
          </div>
        </form>
      ))}
    </main>
  );
}
