import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { STAGES, eur, periodGr } from "@/lib/format";

// Αναζήτηση παντού (Ctrl K): πελάτες, leads, media shops.
export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const q = (sp.q ?? "").trim().replace(/[%,()]/g, "");
  const [c, l, a] = q
    ? await Promise.all([
        supabase.from("customers").select("id, display_name, status, last_period, lifetime_revenue").ilike("display_name", `%${q}%`).order("lifetime_revenue", { ascending: false }).limit(15),
        supabase.from("leads").select("id, company_name, status, contact_name").or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`).limit(15),
        supabase.from("agencies").select("id, name").ilike("name", `%${q}%`).limit(5),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const customers = c.data ?? [], leads = l.data ?? [], agencies = a.data ?? [];
  const none = q && !customers.length && !leads.length && !agencies.length;

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <h1>Αναζήτηση</h1>
      <form className="row">
        <input name="q" defaultValue={q} placeholder="Όνομα πελάτη, lead, τηλέφωνο, email…" className="grow" autoFocus />
        <button type="submit">Αναζήτηση</button>
      </form>
      {none && <p className="muted">Δεν βρέθηκε τίποτα για «{q}».</p>}
      {leads.length > 0 && <div className="section-label">LEADS</div>}
      <div className="list">
        {leads.map((x) => (
          <Link key={x.id} href={`/leads/${x.id}`} className="item">
            <span className="grow"><span className="title">{x.company_name}</span><div className="muted">{x.contact_name ?? ""}</div></span>
            <span className="badge">{STAGES[x.status]?.replace(/^\d\.\s*/, "")}</span>
          </Link>
        ))}
      </div>
      {customers.length > 0 && <div className="section-label">CLIENTS</div>}
      <div className="list">
        {customers.map((x) => (
          <Link key={x.id} href={`/customers/${x.id}`} className="item">
            <span className="grow"><span className="title">{x.display_name}</span><div className="muted">{x.status === "active" ? "Ενεργός" : "Βάση"} · τελευταία {periodGr(x.last_period)}</div></span>
            <span className="badge gray">{eur(x.lifetime_revenue)}</span>
          </Link>
        ))}
      </div>
      {agencies.length > 0 && <div className="section-label">MEDIA SHOPS</div>}
      <div className="list">
        {agencies.map((x) => (
          <Link key={x.id} href={`/agencies/${x.id}`} className="item"><span className="grow title">{x.name}</span></Link>
        ))}
      </div>
    </main>
  );
}
