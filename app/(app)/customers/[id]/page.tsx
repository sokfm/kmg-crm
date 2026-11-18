import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, CHANNEL, STAGES, dateGr, eur, periodGr } from "@/lib/format";
import { addActivity } from "../../actions";
import { Flash } from "@/components/Flash";

export default async function CustomerPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const { data: c } = await supabase
    .from("customers")
    .select("*, profiles!customers_owner_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: leads }, { data: acts }, { data: lines }] = await Promise.all([
    supabase.from("leads").select("id, status, next_step, next_step_due").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("id, type, summary, occurred_at").eq("customer_id", id).order("occurred_at", { ascending: false }).limit(30),
    supabase
      .from("history_lines")
      .select("record_id, period, station, amount, amount_type, package_raw, customer_name_raw")
      .eq("customer_id", id)
      .eq("source_scope", "monthly_billing")
      .order("period", { ascending: false })
      .limit(sp.all ? 2000 : 24),
  ]);

  const byYear = Object.entries((c.revenue_by_year ?? {}) as Record<string, number>).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...byYear.map(([, v]) => v));
  const lastActivity = acts?.find((a) => a.type !== "note");

  return (
    <main className="wrap">
      <div>
        <Link href="/customers" className="muted">← Πελάτες</Link>
        <h1>{c.display_name}</h1>
        <div className="muted">
          {CHANNEL[c.channel]}{c.agency ? ` · ${c.agency}` : ""} · {c.status === "base" ? "Στη βάση" : "Ενεργός"} · Υπεύθυνος: {c.profiles?.full_name ?? "κανείς"}
        </div>
      </div>
      <Flash sp={sp} />

      <div className="grid2">
        <div className="card"><div className="muted">Συνολικός τζίρος</div><div className="kpi">{eur(c.lifetime_revenue)}</div></div>
        <div className="card"><div className="muted">Πελάτης από</div><div className="kpi">{periodGr(c.first_period)}</div></div>
        <div className="card"><div className="muted">Τελευταία καμπάνια</div><div className="kpi">{periodGr(c.last_period)}</div></div>
        <div className="card"><div className="muted">Σταθμοί</div><div className="kpi" style={{ fontSize: 16 }}>{(c.stations ?? []).join(", ") || "—"}</div></div>
        <div className="card"><div className="muted">Τελευταία επαφή</div><div className="kpi">{lastActivity ? dateGr(lastActivity.occurred_at) : "—"}</div></div>
      </div>

      {byYear.length > 0 && (
        <div className="card">
          <h2>Τζίρος ανά έτος</h2>
          <div className="bars">
            {byYear.map(([y, v]) => <div key={y} title={`${y}: ${eur(v)}`} style={{ height: `${(v / max) * 100}%` }} />)}
          </div>
          <div className="bars-labels">{byYear.map(([y]) => <span key={y}>{y.slice(2)}</span>)}</div>
        </div>
      )}

      <div className="card">
        <h2>Κατέγραψε επαφή</h2>
        <form action={addActivity} className="row">
          <input type="hidden" name="customer_id" value={c.id} />
          <select name="type" defaultValue="call">
            {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="summary" className="grow" placeholder="Τι ειπώθηκε;" required />
          <button type="submit">Καταγραφή</button>
        </form>
        {acts && acts.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <tbody>
              {acts.map((a) => (
                <tr key={a.id}><td>{dateGr(a.occurred_at)}</td><td><span className="badge gray">{ACTIVITY[a.type]}</span></td><td>{a.summary}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {leads && leads.length > 0 && (
        <div className="card">
          <h2>Leads / ευκαιρίες</h2>
          <div className="list">
            {leads.map((l) => (
              <Link key={l.id} href={`/leads/${l.id}`} className="item">
                <div className="grow">{STAGES[l.status]} · {l.next_step ?? "—"}</div>
                <span className="badge">{dateGr(l.next_step_due)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row">
          <h2 className="grow">Τιμολόγηση (αρχείο)</h2>
          {!sp.all && <Link href={`/customers/${id}?all=1`}>Όλο το ιστορικό</Link>}
        </div>
        <table>
          <thead><tr><th>Μήνας</th><th>Σταθμός</th><th>Ποσό</th><th>Πακέτο</th></tr></thead>
          <tbody>
            {(lines ?? []).map((h) => (
              <tr key={h.record_id}>
                <td>{periodGr(h.period)}</td>
                <td>{h.station ?? "—"}</td>
                <td>{h.amount_type === "FREE" ? "Δώρο" : eur(h.amount)}</td>
                <td className="muted">{h.package_raw ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
