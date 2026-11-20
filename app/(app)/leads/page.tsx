import Link from "next/link";
import { LiveSearch } from "@/components/LiveSearch";
import { searchKey } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { STAGES, dateGr, eur, today } from "@/lib/format";
import { assignLead } from "../actions";
import { Flash } from "@/components/Flash";

const VIEWS: Record<string, string> = {
  open: "Όλα τα ανοιχτά",
  mine: "Τα δικά μου ανοιχτά",
  late: "Καθυστερούν",
  unassigned: "Χωρίς ανάθεση",
  won: "Κλεισμένα",
  lost: "Χαμένα",
  all: "Όλα",
};
const SORTS: Record<string, [string, boolean]> = {
  due: ["next_step_due", true],
  company: ["company_name", true],
  status: ["status", true],
  value: ["expected_value", false],
  created: ["created_at", false],
};
const SOURCES: Record<string, string> = {
  phone: "Τηλέφωνο", site: "Site", facebook: "Facebook", seller: "Account Executive", base: "Βάση", competition_watch: "Competition Watch", email: "Email",
};

type Row = {
  id: string; company_name: string; contact_name: string | null; phone: string | null; status: string; next_step: string | null;
  next_step_due: string | null; expected_value: number | null; owner_id: string | null; product_line: string; source: string; created_at: string;
  profiles: { full_name: string } | null;
};

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, profile } = await requireProfile();
  const view = VIEWS[sp.view ?? sp.filter ?? ""] ? (sp.view ?? sp.filter)! : "open";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "due";
  const t = today();

  let q = supabase
    .from("leads")
    .select("id, company_name, contact_name, phone, status, next_step, next_step_due, expected_value, owner_id, product_line, source, created_at, profiles!leads_owner_id_fkey(full_name)")
    .order(SORTS[sort][0], { ascending: SORTS[sort][1], nullsFirst: false })
    .limit(500);
  if (["open", "mine", "late", "unassigned"].includes(view)) q = q.not("status", "in", "(won,lost)");
  if (view === "mine") q = q.eq("owner_id", profile.id);
  if (view === "late") q = q.lt("next_step_due", t);
  if (view === "unassigned") q = q.is("owner_id", null);
  if (view === "won" || view === "lost") q = q.eq("status", view);
  if (sp.q && searchKey(sp.q)) q = q.like("name_key", `%${searchKey(sp.q)}%`);
  const poolN = (await supabase.from("lost_pool").select("id", { count: "exact", head: true })).count ?? 0;
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };

  const href = (p: Record<string, string>) => `/leads?${new URLSearchParams({ view, sort, ...(sp.q ? { q: sp.q } : {}), ...p }).toString()}`;
  const Th = ({ k, children, cls }: { k: string; children: React.ReactNode; cls?: string }) => (
    <th className={cls}><Link href={href({ sort: k })} className={sort === k ? "on" : ""}>{children}{sort === k ? " ▾" : ""}</Link></th>
  );
  const total = rows.reduce((s, r) => s + Number(r.expected_value ?? 0), 0);

  return (
    <main className="wrap wide sf">
      <div className="card sf-head">
        <div className="row">
          <div className="sf-icon">L</div>
          <div className="grow">
            <div className="muted">Leads</div>
            <form className="row" style={{ gap: 6 }}>
              <input type="hidden" name="sort" value={sort} />
              <select name="view" defaultValue={view} className="sf-view">
                {Object.entries(VIEWS).filter(([k]) => isAdmin || k !== "unassigned").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <LiveSearch value={sp.q ?? ""} placeholder="Αναζήτηση σε αυτή τη λίστα…" style={{ minWidth: 200 }} />
              <SubmitButton className="secondary">Εμφάνιση</SubmitButton>
            </form>
          </div>
          <Link href="/leads/pool" className="btn secondary">🚪 Διαθέσιμα χαμένα{poolN ? ` (${poolN})` : ""}</Link>
          <Link href="/pipeline" className="btn secondary">Pipeline</Link>
          <Link href="/leads/new" className="btn">Νέο</Link>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          {rows.length} στοιχεία{total ? ` · εκτιμώμενη αξία ${eur(total)}` : ""} · ταξινόμηση: {{ due: "ημερομηνία βήματος", company: "επιχείρηση", status: "στάδιο", value: "αξία", created: "νεότερα" }[sort]}
        </div>
      </div>
      <Flash sp={sp} />

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <Th k="company">Επιχείρηση</Th>
              <th className="hide-m">Υπεύθυνος</th>
              <th className="hide-m">Τηλέφωνο</th>
              <Th k="status">Στάδιο</Th>
              <th className="hide-m">Επόμενο βήμα</th>
              <Th k="due">Πότε</Th>
              <Th k="value" cls="num hide-m">Αξία</Th>
              <th>Account Executive</th>
              <th className="hide-m">Πηγή</th>
              <Th k="created" cls="hide-m">Δημιουργία</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="muted" style={{ padding: 16 }}>Κανένα lead σε αυτή τη λίστα.</td></tr>}
            {rows.map((r, i) => {
              const open = !["won", "lost"].includes(r.status);
              const late = open && r.next_step_due && r.next_step_due < t;
              return (
                <tr key={r.id} className={late ? "late" : ""}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <Link href={`/leads/${r.id}`} style={{ fontWeight: 600 }}>{r.company_name}</Link>
                    {r.product_line === "digital" && <span className="badge gray" style={{ marginLeft: 6 }}>digital</span>}
                  </td>
                  <td className="hide-m">{r.contact_name ?? ""}</td>
                  <td className="hide-m">{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : ""}</td>
                  <td><span className={`badge ${r.status === "won" ? "good" : r.status === "lost" ? "gray" : ""}`}>{STAGES[r.status]?.replace(/^\d\.\s*/, "")}</span></td>
                  <td className="hide-m" style={{ maxWidth: 260 }}>{open ? r.next_step ?? "" : ""}</td>
                  <td className={late ? "late-txt" : ""} style={{ whiteSpace: "nowrap" }}>{open ? dateGr(r.next_step_due) : ""}</td>
                  <td className="num hide-m">{r.expected_value ? eur(Number(r.expected_value)) : ""}</td>
                  <td>
                    {isAdmin && !r.owner_id && open ? (
                      <form action={assignLead} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <select name="owner_id" required defaultValue="" style={{ padding: "4px 6px" }}>
                          <option value="" disabled>Ανάθεση…</option>
                          {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                        </select>
                        <SubmitButton className="secondary">OK</SubmitButton>
                      </form>
                    ) : (
                      r.profiles?.full_name?.split(" ")[0] ?? <span className="muted">—</span>
                    )}
                  </td>
                  <td className="hide-m muted">{SOURCES[r.source] ?? r.source}</td>
                  <td className="hide-m muted">{dateGr(r.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
