import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { searchKey, CHANNEL, aeLabel, customerState, eur, monthsAgo, periodGr } from "@/lib/format";
import { LiveSearch } from "@/components/LiveSearch";
import { MergeBar } from "@/components/MergeBar";
import { claimCustomer, decideClaim } from "../actions";
import { Flash } from "@/components/Flash";

const PAGE = 100;
const SORTS: Record<string, [string, boolean]> = {
  last: ["last_period", false],
  name: ["display_name", true],
  total: ["lifetime_revenue", false],
};

type Row = {
  id: string; display_name: string; category: string | null; status: string; closed_at: string | null; served_by: string | null; is_group: boolean; parent_name: string | null; rev_ok: boolean; detail_ok: boolean; channel: string; agency: string | null; agency_id: string | null;
  last_period: string | null; lifetime_revenue: number | null; revenue_by_year: Record<string, number> | null; stations: string[] | null;
  owner_id: string | null; owner_name: string | null; profiles?: { full_name: string } | null;
};

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, isCeo, profile } = await requireProfile();
  const status = ["all", "onair", "recent", "inactive", "dormant", "base", "mine", "closed"].includes(sp.status) ? sp.status : isAdmin ? "all" : "mine";
  const year = sp.year ?? "";
  const sort = SORTS[sp.sort] ? sp.sort : "last";
  const page = Math.max(0, Number(sp.page) || 0);
  const nowY = new Date().getFullYear();

  let q = supabase
    .from("customers_x")   // κατάλογος: όλοι οι πελάτες, ο τζίρος μόνο όπου επιτρέπεται
    .select("id, display_name, category, status, closed_at, served_by, is_group, parent_name, channel, agency, agency_id, last_period, lifetime_revenue, revenue_by_year, stations, owner_id, owner_name, rev_ok, detail_ok", { count: "exact" })
    .order(SORTS[sort][0], { ascending: SORTS[sort][1], nullsFirst: false })
    .order("lifetime_revenue", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (status === "closed") q = q.not("closed_at", "is", null);
  else q = q.is("closed_at", null);
  if (status === "onair") q = q.gte("last_period", monthsAgo(0));
  if (status === "recent") q = q.gte("last_period", monthsAgo(12)).lt("last_period", monthsAgo(0));
  if (status === "inactive") q = q.gte("last_period", monthsAgo(36)).lt("last_period", monthsAgo(12));
  if (status === "dormant") q = q.or(`last_period.lt.${monthsAgo(36)},last_period.is.null`);
  if (status === "base") q = q.eq("status", "base").eq("is_group", false);
  if (status === "mine") q = q.eq("owner_id", profile.id);
  if (year === "never") q = q.is("last_period", null);
  else if (/^\d{4}$/.test(year)) q = q.gte("last_period", `${year}-01`).lte("last_period", `${year}-12`);
  else if (/^\d{4}-$/.test(year)) q = q.lte("last_period", `${year.slice(0, 4)}-12`); // «έως και»
  if (sp.owner && isAdmin) q = sp.owner === "none" ? q.is("owner_id", null) : q.eq("owner_id", sp.owner);
  if (sp.agency) q = q.eq("agency_id", sp.agency);
  if (sp.q && searchKey(sp.q)) q = q.like("name_key", `%${searchKey(sp.q)}%`);
  const { data, count } = await q;
  const rawRows = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, profiles: r.owner_name ? { full_name: r.owner_name } : null, brands: 0 }));
  // Group: στη λίστα δείχνει το ΣΥΝΟΛΟ των brands του (τζίρος, τελευταία καμπάνια, σταθμοί), όχι μηδέν
  const groupIds = rawRows.filter((r) => r.is_group).map((r) => r.id);
  const { data: kids } = groupIds.length
    ? await supabase.from("customers_x").select("parent_id, lifetime_revenue, revenue_by_year, last_period, stations, rev_ok").in("parent_id", groupIds)
    : { data: [] };
  type Kid = { parent_id: string; lifetime_revenue: number | null; revenue_by_year: Record<string, number> | null; last_period: string | null; stations: string[] | null; rev_ok: boolean };
  const rows = rawRows.map((r) => {
    const ks = ((kids ?? []) as Kid[]).filter((k) => k.parent_id === r.id);
    if (!r.is_group || ks.length === 0) return r;
    const byYear: Record<string, number> = { ...(r.revenue_by_year ?? {}) };
    for (const k of ks) for (const [y, v] of Object.entries(k.revenue_by_year ?? {})) byYear[y] = (byYear[y] ?? 0) + Number(v);
    return {
      ...r, brands: ks.length,
      rev_ok: r.rev_ok && ks.every((k) => k.rev_ok),
      lifetime_revenue: Number(r.lifetime_revenue ?? 0) + ks.reduce((t, k) => t + Number(k.lifetime_revenue ?? 0), 0),
      revenue_by_year: byYear,
      last_period: [r.last_period, ...ks.map((k) => k.last_period)].filter(Boolean).sort().pop() ?? null,
      stations: [...new Set([...(r.stations ?? []), ...ks.flatMap((k) => k.stations ?? [])])],
    };
  });

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
              <input type="hidden" name="back" value={here} />
              <SubmitButton className="secondary">🔗 Ένωση επιλεγμένων</SubmitButton>
              <button type="submit" formAction="/customers/group" className="secondary">Σε Group</button>
            </form>
          )}
        </div>
        <div className="row">
          {chip("all", "Όλοι")}
          {chip("onair", "On Air")}
          {chip("recent", "Recent · 12 μήνες")}
          {chip("inactive", "Inactive · 1–3 χρόνια")}
          {chip("dormant", "Dormant · 3+ χρόνια")}
          {chip("base", "Βάση (χωρίς AE)")}
          {chip("mine", "Οι δικοί μου")}
          {isAdmin && chip("closed", "Κλειστές επιχειρήσεις")}
        </div>
        {!isAdmin && <div className="muted" style={{ fontSize: 13 }}>🔒 Ο τζίρος φαίνεται μόνο σε πελάτες που έχεις τρέξει εσύ. Για άλλον πελάτη, άνοιξέ τον και ζήτα πρόσβαση. <Link href="/access">Τα αιτήματά μου ›</Link></div>}
        <form className="row">
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="sort" value={sort} />
          <LiveSearch value={sp.q ?? ""} placeholder="Αναζήτηση πελάτη… (ψάχνει όσο γράφεις)" className="grow" style={{ minWidth: 180 }} />
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
              <option value="">Όλοι οι Account Executives</option>
              <option value="none">Χωρίς Account Executive</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          )}
          <SubmitButton className="secondary">Εμφάνιση</SubmitButton>
        </form>
        {status === "base" && (
          <p className="muted" style={{ margin: 0 }}>
            Πελάτες χωρίς Account Executive (και όσοι δεν έχουν παίξει 12+ μήνες). Ζήτα όποιον θέλεις: μόλις ο Νίκος εγκρίνει, έχεις 10 μέρες για πραγματική επαφή, αλλιώς γυρίζει πίσω.
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
              <th className="hide-m">Κατηγορία</th>
              <th>Κατάσταση</th>
              <Th k="last">Τελευταία καμπάνια</Th>
              <th className="num hide-m">Τζίρος τελ. χρονιάς</th>
              <Th k="total" cls="num">Συνολικός τζίρος</Th>
              <th className="hide-m">Σταθμοί</th>
              <th className="hide-m">Account Executive</th>
              <th className="hide-m">Media shop</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="muted" style={{ padding: 16 }}>Κανένας πελάτης με αυτά τα φίλτρα.</td></tr>}
            {rows.map((c) => {
              const ly = c.last_period?.slice(0, 4);
              return (
                <tr key={c.id} id={`c-${c.id}`} style={sp.hl === c.id ? { background: "#fff6d6" } : undefined}>
                  {isAdmin && <td><input type="checkbox" name="ids" value={c.id} form="merge" data-name={c.display_name} data-rev={Number(c.lifetime_revenue ?? 0)} style={{ width: 17, height: 17 }} /></td>}
                  <td><Link href={`/customers/${c.id}`} style={{ fontWeight: 600 }}>{c.display_name}</Link>{c.is_group && <span className="badge onair" style={{ marginLeft: 6 }}>Group{c.brands ? ` · ${c.brands} ${c.brands === 1 ? "brand" : "brands"}` : ""}</span>}{c.parent_name && <div className="muted" style={{ fontSize: 12 }}>Group: {c.parent_name}</div>}<div className="muted show-m">{aeLabel(c, true) ? `AE: ${aeLabel(c, true)}` : `Βάση${c.served_by ? ` · πριν: ${c.served_by}` : ""}`}</div></td>
                  <td className="hide-m muted">{c.category ?? ""}</td>
                  <td>{(() => { const st = customerState(c); return <span className={`badge ${st.cls}`}>{st.label}</span>; })()}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{periodGr(c.last_period)}</td>
                  <td className="num hide-m">{!c.rev_ok ? <span className="muted" title="Κλειδωμένο">🔒</span> : ly ? eur(c.revenue_by_year?.[ly] ?? 0) : "—"}</td>
                  <td className="num">{c.rev_ok ? <strong>{eur(Number(c.lifetime_revenue ?? 0))}</strong> : <span className="muted" title="Ο τζίρος φαίνεται μόνο σε πελάτες που έχεις τρέξει εσύ. Άνοιξε τον πελάτη για να ζητήσεις πρόσβαση.">🔒</span>}</td>
                  <td className="hide-m muted">{(c.stations ?? []).join(", ")}</td>
                  <td className="hide-m">{aeLabel(c, true) ?? <span className="muted">—{c.served_by ? ` · πριν: ${c.served_by}` : ""}</span>}</td>
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
      {isAdmin && <MergeBar back={here} />}
      {isAdmin && <div style={{ height: 70 }} />}
    </main>
  );
}
