import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr } from "@/lib/format";
import { claimCustomer, decideClaim } from "../actions";
import { Flash } from "@/components/Flash";

export default async function Base({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, isCeo } = await requireProfile();

  let q = supabase
    .from("customers")
    .select("id, display_name, last_period, lifetime_revenue, stations")
    .eq("status", "base")
    .order(sp.q ? "display_name" : "lifetime_revenue", { ascending: !!sp.q })
    .limit(sp.q ? 100 : 40);
  if (sp.q) q = q.ilike("display_name", `%${sp.q}%`);
  const { data } = await q;
  const rows = data ?? [];

  const { data: pend } = isCeo
    ? await supabase
        .from("base_claims")
        .select("id, note, created_at, customers(display_name), profiles!base_claims_for_user_fkey(full_name)")
        .eq("status", "pending")
        .order("created_at")
    : { data: [] };
  const pending = (pend ?? []) as unknown as { id: string; note: string | null; customers: { display_name: string } | null; profiles: { full_name: string } | null }[];

  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };

  return (
    <main className="wrap">
      <h1>Βάση πελατών</h1>
      <p className="muted">
        Παλιοί πελάτες χωρίς υπεύθυνο. Ζήτα όποιον θέλεις: μόλις ο Νίκος εγκρίνει, έχεις 10 μέρες για πραγματική επαφή, αλλιώς γυρίζει πίσω.
      </p>
      <Flash sp={sp} />

      {pending.length > 0 && (
        <div className="card alert">
          <h2>Αιτήματα για έγκριση</h2>
          <div className="list">
            {pending.map((p) => (
              <form key={p.id} action={decideClaim} className="row">
                <input type="hidden" name="id" value={p.id} />
                <div className="grow"><strong>{p.customers?.display_name}</strong> → {p.profiles?.full_name}{p.note ? ` · «${p.note}»` : ""}</div>
                <button name="decision" value="approve" type="submit">Έγκριση</button>
                <button name="decision" value="reject" type="submit" className="danger">Όχι</button>
              </form>
            ))}
          </div>
        </div>
      )}

      <form className="row">
        <input name="q" defaultValue={sp.q} placeholder="Ψάξε πελάτη ή κατηγορία…" className="grow" />
        <button type="submit" className="secondary">Αναζήτηση</button>
      </form>
      {!sp.q && <div className="section-label muted">ΟΙ ΜΕΓΑΛΥΤΕΡΟΙ ΣΕ ΤΖΙΡΟ</div>}

      <div className="list">
        {rows.map((c) => (
          <div key={c.id} className="item">
            <Link href={`/customers/${c.id}`} className="grow" style={{ color: "inherit" }}>
              <div className="title">{c.display_name}</div>
              <div className="muted">Τελευταία: {periodGr(c.last_period)} · συνολικά {eur(c.lifetime_revenue)} · {(c.stations ?? []).join(", ")}</div>
            </Link>
            <form action={claimCustomer} className="row">
              <input type="hidden" name="customer_id" value={c.id} />
              <input type="hidden" name="q" value={sp.q ?? ""} />
              {isAdmin ? (
                <>
                  <select name="for_user" required defaultValue="">
                    <option value="" disabled>Ανάθεση σε…</option>
                    {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <button type="submit">OK</button>
                </>
              ) : (
                <button type="submit" className="secondary">Ζήτα τον</button>
              )}
            </form>
          </div>
        ))}
      </div>
    </main>
  );
}
