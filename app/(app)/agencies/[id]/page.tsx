import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, dateGr, eur, periodGr, customerState } from "@/lib/format";
import { addActivity, updateAgencyDomains } from "../../actions";
import { Flash } from "@/components/Flash";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";

export default async function AgencyPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data: a } = await supabase.from("agencies").select("id, name, domains").eq("id", id).maybeSingle();
  if (!a) notFound();

  const [{ data: acts }, { data: custs }, { data: taskData }] = await Promise.all([
    supabase.from("activities").select("id, type, summary, occurred_at").eq("agency_id", id).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("customers").select("id, display_name, status, last_period, lifetime_revenue").eq("agency_id", id).order("lifetime_revenue", { ascending: false }),
    supabase.from("tasks").select(TASK_SELECT).eq("agency_id", id).eq("status", "open").order("due_date"),
  ]);
  const tasks = (taskData ?? []) as unknown as TaskRow[];
  const total = (custs ?? []).reduce((t, c) => t + Number(c.lifetime_revenue ?? 0), 0);

  return (
    <main className="wrap">
      <div>
        <Link href="/agencies" className="muted">← Media Shops</Link>
        <h1>🏢 {a.name}</h1>
        <div className="muted">{(custs ?? []).length} πελάτες μέσω του πρακτορείου · συνολικός τζίρος {eur(total)}</div>
      </div>
      <Flash sp={sp} />

      <div className="card">
        <h2>Διευθύνσεις email</h2>
        <p className="muted">Ό,τι έρχεται ή στέλνεις σε αυτές μπαίνει αυτόματα εδώ.</p>
        {isAdmin ? (
          <form action={updateAgencyDomains} className="row">
            <input type="hidden" name="id" value={a.id} />
            <input name="domains" className="grow" defaultValue={(a.domains ?? []).join(", ")} placeholder="π.χ. umedia.gr" />
            <SubmitButton>Αποθήκευση</SubmitButton>
          </form>
        ) : (
          <div>{(a.domains ?? []).join(", ") || "—"}</div>
        )}
      </div>

      <div className="card">
        <h2>Εργασίες</h2>
        <TaskList tasks={tasks} back={`/agencies/${a.id}`} showTarget={false} showOwner />
        <div style={{ marginTop: 10 }}><NewTaskForm back={`/agencies/${a.id}`} agencyId={a.id} /></div>
      </div>

      <div className="card">
        <h2>Επικοινωνία</h2>
        <form action={addActivity} className="row">
          <input type="hidden" name="agency_id" value={a.id} />
          <select name="type" defaultValue="call">
            {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="summary" className="grow" placeholder="Τι ειπώθηκε; (γράψε και για ποιον πελάτη)" required />
          <SubmitButton>Καταγραφή</SubmitButton>
        </form>
        {acts && acts.length > 0 ? (
          <table style={{ marginTop: 10 }}>
            <tbody>
              {acts.map((x) => (
                <tr key={x.id}><td>{dateGr(x.occurred_at)}</td><td><span className="badge gray">{ACTIVITY[x.type]}</span></td><td>{x.summary}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ marginTop: 10 }}>Καμία επικοινωνία ακόμα.</p>}
      </div>

      <div className="card">
        <h2>Πελάτες μέσω {a.name}</h2>
        <div className="list">
          {(custs ?? []).map((c) => (
            <Link key={c.id} href={`/customers/${c.id}`} className="item">
              <div className="grow">{c.display_name}<div className="muted">{customerState(c).label} · τελευταία: {periodGr(c.last_period)}</div></div>
              <span className="badge gray">{eur(c.lifetime_revenue)}</span>
            </Link>
          ))}
          {(custs ?? []).length === 0 && <p className="muted">Κανένας ακόμα.</p>}
        </div>
      </div>
    </main>
  );
}
