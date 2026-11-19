import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { CHANNEL, eur, periodGr } from "@/lib/format";
import { claimCustomer, decideClaim } from "../actions";
import { Flash } from "@/components/Flash";

const PAGE = 100;
const SORTS: Record<string, [string, boolean]> = {
  last: ["last_period", false],
  name: ["display_name", true],
  total: ["lifetime_revenue", false],
};

type Row = {
  id: string; display_name: string; status: string; channel: string; agency: string | null; agency_id: string | null;
  last_period: string | null; lifetime_revenue: number; revenue_by_year: Record<string, number> | null; stations: string[] | null;
  owner_id: string | null; profiles: { full_name: string } | null;
};

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, isCeo, profile } = await requireProfile();
  const status = ["all", "active", "base", "mine"].includes(sp.status) ? sp.status : isAdmin ? "all" : "mine";
  const year = sp.year ?? "";
  const sort = SORTS[sp.sort] ? sp.sort : "last";
  const page = Math.max(0, Number(sp.page) || 0);
  const nowY = new Date().getFullYear();

  let q = supabase
    .from("customers")
    .select("id, display_name, status, channel, agency, agency_id, last_period, lifetime_revenue, revenue_by_year, stations, owner_id, profiles!customers_owner_id_fkey(full_name)", { count: "exact" })
    .order(SORTS[sort][0], { ascending: SORTS[sort][1], nullsFirst: false })
    .order("lifetime_revenue", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (status === "active") q = q.eq("status", "active");
  if (status === "base") q = q.eq("status", "base");
  if (status === "mine") q = q.eq("owner_id", profile.id);
  if (year === "never") q = q.is("last_period", null);
  else if (/^\d{4}$/.test(year)) q = q.gte("last_period", `${year}-01`).lte("last_period", `${year}-12`);
  else if (/^\d{4}-$/.test(year)) q = q.lte("last_period", `${year.slice(0, 4)}-12`); // «έως και»
  if (sp.owner && isAdmin) q = sp.owner === "none" ? q.is("owner_id", null) : q.eq("owner_id", sp.owner);
  if (sp.agency) q = q.eq("agency_id", sp.agency);
  if (sp.q) q = q.ilike("display_name", `%${sp.q.replace(/[%,]/g, "")}%`);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as Row[];

  const [{ data: people }, { data: agencies }, { data: pend }] = await Promise.all([
    isAdmin
      ? supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    supabase.from("agencies").select("id, name").order("name"),
    isCeo
      ? supabase.from("base_claims").select("id, note, customers(display_name), profiles!base_claims_for_user_fkey(full_name)").eq("status", "pending").order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const pending = (pend ?? []) as unknown as { id: string; note: string | null; customers: { display_name: string } | null; profiles: { full_name: string } | null }[];

  const params = { status, year, sort, ...(sp.q ? { q: sp.q } : {}), ...(sp.owner ? { owner: sp.owner } : {}), ...(sp.agency ? { agency: sp.agency } : {}) };
  const href = (p: Record<string, string>) => `/customers?${new URLSearchParams({ ...params, page: "0", ...p }).toString()}`;
  const here = href({ page: String(page) });
  const chip = (k: string, label: string) => <Link key={k} href={href({ status: k })} className={`badge ${status === k ? "" : "gray"}`}>{label}</Link>;
  const Th = ({ k, children, cls }: { k: string; children: React.ReactNode; cls?: string }) => (
    <th className={cls}><Link href={href({ sort: k })} className={sort === k ? "on" : ""}>{children}{sort === k ? " ▾" : ""}</Link></th>
  );
  const years = Array.from({ length: nowY - 2014 }, (_, i) => String(nowY - i));
  const total = count ?? 0;

  return (
    <main className="wrap wide sf">
      <div className="card sf-head">
        <div className="row">
          <div className="sf-icon" style={{ background: "var(--night)", color: "#fff" }}>Π</div>
          <div className="grow">
            <div className="muted">Πελάτες</div>
            <h1 style={{ margin: 0 }}>{total} πελάτες</h1>
          </div>
          {isAdmin && (
            <form id="merge" action="/customers/merge" className="row">
              <SubmitButton className="secondary">🔗 Ένωση επιλεγμένων</SubmitButton>
            </form>
          )}
        </div>
        <div className="row">
          {isAdmin && chip("all", "Όλοι")}
          {chip("active", "Ενεργοί")}
          {chip("base", "Βάση (χωρίς υπεύθυνο)")}
          {chip("mine", "Οι δικοί μου")}
        </div>
        <form className="row">
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="sort" value={sort} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Αναζήτηση πελάτη…" className="grow" style={{ minWidth: 180 }} />
          <label className="row" style={{ flexDirection: "row", gap: 6 }}>Τελευταία φορά έπαιξε
            <select name="year" defaultValue={year}>
              <option value="">όποτε</option>
              {years.map((y) => <option key={y} value={y}>το {y}</option>)}
              {years.slice(1).map((y) => <option key={y + "-"} value={y + "-"}>το {y} ή νωρίτερα</option>)}
              <option value="never">ποτέ (χωρίς τιμολόγηση)</option>
            </select>
          </label>
          <select name="agency" defaultValue={sp.agency ?? ""}>
            <option value="">Όλοι (με ή χωρίς media shop)</option>
            {(agencies ?? []).map((a) => <option key={a.id} value={a.id}>Media shop: {a.name}</option>)}
          </select>
          {isAdmin && (
            <select name="owner" defaultValue={sp.owner ?? ""}>
              <option value="">Όλοι οι πωλητές</option>
              <option value="none">Χωρίς υπεύθυνο</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          )}
          <SubmitButton className="secondary">Εμφάνιση</SubmitButton>
        </form>
        {status === "base" && (
          <p className="muted" style={{ margin: 0 }}>
            Πελάτες χωρίς υπεύθυνο. Ζήτα όποιον θέλεις: μόλις ο Νίκος εγκρίνει, έχεις 10 μέρες για πραγματική επαφή, αλλιώς γυρίζει πίσω.
          </p>
        )}
      </div>
      <Flash sp={sp} />

      {pending.length > 0 && (
        <div className="card alert">
          <h2>Αιτήματα από τη βάση για έγκριση</h2>
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

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="sf-table">
          <thead>
            <tr>
              {isAdmin && <th style={{ width: 28 }} title="Τσέκαρε 2+ για ένωση">🔗</th>}
              <Th k="name">Πελάτης</Th>
              <th>Κατάσταση</th>
              <Th k="last">Τελευταία καμπάνια</Th>
              <th className="num hide-m">Τζίρος τελ. χρονιάς</th>
              <Th k="total" cls="num">Συνολικός τζίρος</Th>
              <th className="hide-m">Σταθμοί</th>
              <th className="hide-m">Πωλητής</th>
              <th className="hide-m">Media shop</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="muted" style={{ padding: 16 }}>Κανένας πελάτης με αυτά τα φίλτρα.</td></tr>}
            {rows.map((c) => {
              const ly = c.last_period?.slice(0, 4);
              return (
                <tr key={c.id}>
                  {isAdmin && <td><input type="checkbox" name="ids" value={c.id} form="merge" style={{ width: 17, height: 17 }} /></td>}
                  <td><Link href={`/customers/${c.id}`} style={{ fontWeight: 600 }}>{c.display_name}</Link></td>
                  <td><span className={`badge ${c.status === "active" ? "good" : "gray"}`}>{c.status === "active" ? "Ενεργός" : "Βάση"}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{periodGr(c.last_period)}</td>
                  <td className="num hide-m">{ly ? eur(c.revenue_by_year?.[ly] ?? 0) : "—"}</td>
                  <td className="num"><strong>{eur(c.lifetime_revenue)}</strong></td>
                  <td className="hide-m muted">{(c.stations ?? []).join(", ")}</td>
                  <td className="hide-m">{c.profiles?.full_name?.split(" ")[0] ?? <span className="muted">—</span>}</td>
                  <td className="hide-m">{c.agency_id ? <Link href={`/agencies/${c.agency_id}`}>{c.agency}</Link> : <span className="muted">{CHANNEL[c.channel] === "Media Shop" ? c.agency ?? "" : ""}</span>}</td>
                  <td>
                    {c.status === "base" && !c.owner_id && (
                      <form action={claimCustomer} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <input type="hidden" name="customer_id" value={c.id} />
                        <input type="hidden" name="back" value={here} />
                        {isAdmin ? (
                          <>
                            <select name="for_user" required defaultValue="" style={{ padding: "4px 6px" }}>
                              <option value="" disabled>Ανάθεση…</option>
                              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                            <SubmitButton className="secondary">OK</SubmitButton>
                          </>
                        ) : (
                          <SubmitButton className="secondary">Ζήτα τον</SubmitButton>
                        )}
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="row" style={{ justifyContent: "center" }}>
          {page > 0 && <Link className="btn secondary" href={href({ page: String(page - 1) })}>‹ Προηγούμενοι</Link>}
          <span className="muted">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} από {total}</span>
          {(page + 1) * PAGE < total && <Link className="btn secondary" href={href({ page: String(page + 1) })}>Επόμενοι ›</Link>}
        </div>
      )}
    </main>
  );
}
