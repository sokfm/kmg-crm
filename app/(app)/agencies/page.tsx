import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { eur } from "@/lib/format";

export default async function Agencies() {
  const { supabase } = await requireProfile();
  const [{ data: agencies }, { data: custs }] = await Promise.all([
    supabase.from("agencies").select("id, name, domains").order("name"),
    supabase.from("customers_x").select("agency_id, lifetime_revenue, status").not("agency_id", "is", null),
  ]);
  const stats = new Map<string, { n: number; active: number; rev: number }>();
  for (const c of custs ?? []) {
    const s = stats.get(c.agency_id!) ?? { n: 0, active: 0, rev: 0 };
    s.n++; if (c.status === "active") s.active++; s.rev += Number(c.lifetime_revenue ?? 0);
    stats.set(c.agency_id!, s);
  }
  const rows = (agencies ?? []).sort((a, b) => (stats.get(b.id)?.rev ?? 0) - (stats.get(a.id)?.rev ?? 0));

  return (
    <main className="wrap">
      <h1>Media Shops</h1>
      <p className="muted">
        Μία καρτέλα για κάθε media shop. Τα email τους μπαίνουν εδώ αυτόματα, όχι στον πελάτη για τον οποίο γράφουν· τις αναγνωρίζουμε από τη διεύθυνση (π.χ. @umedia.gr).
      </p>
      <div className="list">
        {rows.map((a) => {
          const s = stats.get(a.id);
          return (
            <Link key={a.id} href={`/agencies/${a.id}`} className="item">
              <div className="grow">
                <div className="title">🏢 {a.name}</div>
                <div className="muted">
                  {s ? `${s.n} πελάτες (${s.active} ενεργοί)` : "Κανένας πελάτης"} · {a.domains?.length ? a.domains.join(", ") : "χωρίς διεύθυνση email ακόμα"}
                </div>
              </div>
              <span className="badge gray">{eur(s?.rev ?? 0)}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
