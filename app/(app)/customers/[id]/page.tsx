import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, CHANNEL, STAGES, dateGr, eur, periodGr, customerState } from "@/lib/format";
import { addActivity, decideWeb, renameCustomer, webLookup } from "../../actions";
import { Flash } from "@/components/Flash";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";

// Χρόνος για το ψάξιμο της AI στο ίντερνετ
export const maxDuration = 120;

export default async function CustomerPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
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

  const { data: taskData } = await supabase.from("tasks").select(TASK_SELECT).eq("customer_id", c.id).eq("status", "open").order("due_date");
  const openTasks = (taskData ?? []) as unknown as TaskRow[];

  return (
    <main className="wrap">
      <div>
        <Link href="/customers" className="muted">← Πελάτες</Link>
        <div className="row">
          <h1 className="grow" style={{ margin: 0 }}>{c.display_name}</h1>
          {isAdmin && (
            <form action={webLookup}>
              <input type="hidden" name="kind" value="customer" />
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton className="secondary" pending="Ψάχνω online…" hint="Η AI ψάχνει στο ίντερνετ, 10–30 δευτερόλεπτα">{c.web_checked_at ? "Ξανά έλεγχος online" : "Έλεγχος online"}</SubmitButton>
            </form>
          )}
        </div>
        <div className="muted">
          {CHANNEL[c.channel]}{c.agency_id ? <> · <Link href={`/agencies/${c.agency_id}`}>🏢 {c.agency}</Link></> : c.agency ? ` · ${c.agency}` : ""} · {customerState(c).label} · Account Executive: {c.profiles?.full_name ?? "κανείς (βάση)"}{c.served_by && c.served_by !== c.profiles?.full_name ? ` · τον εξυπηρετούσε: ${c.served_by}${c.served_by_period ? ` (ως ${periodGr(c.served_by_period)})` : ""}` : ""}
        </div>
      </div>
      <Flash sp={sp} />
      {isAdmin && (
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>✏️ Αλλαγή ονόματος</summary>
          <form action={renameCustomer} className="row" style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="version" value={c.version} />
            <input name="name" defaultValue={c.display_name} className="grow" required />
            <SubmitButton>Αποθήκευση</SubmitButton>
          </form>
        </details>
      )}

      <div className="grid2">
        <div className="card"><div className="muted">Συνολικός τζίρος</div><div className="kpi">{eur(c.lifetime_revenue)}</div></div>
        <div className="card"><div className="muted">Πελάτης από</div><div className="kpi">{periodGr(c.first_period)}</div></div>
        <div className="card"><div className="muted">Τελευταία καμπάνια</div><div className="kpi">{periodGr(c.last_period)}</div></div>
        <div className="card"><div className="muted">Σταθμοί</div><div className="kpi" style={{ fontSize: 16 }}>{(c.stations ?? []).join(", ") || "—"}</div></div>
        <div className="card"><div className="muted">Τελευταία επαφή</div><div className="kpi">{lastActivity ? dateGr(lastActivity.occurred_at) : "—"}</div></div>
      </div>

      {c.web_checked_at && (
          <div className="card sf-fields">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>Από το ίντερνετ</h2>
          {c.web_status === "found" && <span className="badge good">βρέθηκε</span>}
          {c.web_status === "closed" && <span className="badge late">φαίνεται κλειστή</span>}
          {c.web_status === "not_found" && <span className="badge gray">δεν βρέθηκε</span>}
        </div>
        {!c.web_checked_at ? (
          <p className="muted" style={{ margin: 0 }}>{false ? "Η AI ψάχνει τώρα την επιχείρηση… ανανέωσε τη σελίδα σε λίγα δευτερόλεπτα." : "Δεν έχει γίνει αναζήτηση ακόμα."}</p>
        ) : (
          <>
            {c.category && <div><span>Κατηγορία</span>{c.category}</div>}
            {c.website && <div><span>Site</span><a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a></div>}
            {c.address && <div><span>Διεύθυνση</span>{c.address}</div>}
            {c.web_note && <div><span>Σημείωση AI</span>{c.web_note}</div>}
            {(c.web_sources ?? []).length > 0 && <div><span>Πηγές</span>{(c.web_sources as string[]).slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.replace(/^https?:\/\/(www\.)?/, "")}</a>)}</div>}
            <p className="muted" style={{ margin: 0 }}>Η AI συμπληρώνει μόνο κενά πεδία· ό,τι έγραψες εσύ δεν αλλάζει. Έλεγξέ τα πριν τα χρησιμοποιήσεις.</p>
          </>
        )}
        {isAdmin && (c.web_status === "not_found" || c.web_status === "closed") && (
          <div className="row">
            <span className="muted grow">{c.closed_at ? "Σημειωμένη ως κλειστή επιχείρηση." : "Υπάρχει ακόμα η επιχείρηση;"}</span>
            <a className="btn secondary" href={`https://www.google.com/search?q=${encodeURIComponent(c.display_name + " Χαλκίδα")}`} target="_blank" rel="noreferrer">Google ↗</a>
            <form action={decideWeb}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="closed" value="0" /><input type="hidden" name="back" value={`/customers/${c.id}`} /><SubmitButton className="secondary">Υπάρχει</SubmitButton></form>
            {!c.closed_at && <form action={decideWeb}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="closed" value="1" /><input type="hidden" name="back" value={`/customers/${c.id}`} /><SubmitButton className="dark">Έκλεισε</SubmitButton></form>}
          </div>
        )}
      </div>
      )}

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
        <h2>Εργασίες</h2>
        <TaskList tasks={openTasks} back={`/customers/${c.id}`} showTarget={false} showOwner />
        <div style={{ marginTop: 10 }}><NewTaskForm back={`/customers/${c.id}`} customerId={c.id} /></div>
      </div>

      <div className="card">
        <h2>Κατέγραψε επαφή</h2>
        <form action={addActivity} className="row">
          <input type="hidden" name="customer_id" value={c.id} />
          <select name="type" defaultValue="call">
            {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="summary" className="grow" placeholder="Τι ειπώθηκε;" required />
          <SubmitButton>Καταγραφή</SubmitButton>
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
