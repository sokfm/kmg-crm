import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { today } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";

export default async function Tasks({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, profile, isAdmin } = await requireProfile();
  const view = sp.view ?? "mine";
  let q = supabase.from("tasks").select(TASK_SELECT).order("due_date", { ascending: true, nullsFirst: false }).limit(300);
  if (view === "done") q = q.eq("status", "done").order("done_at", { ascending: false }).limit(50);
  else q = q.eq("status", "open");
  if (view !== "all") q = q.eq("owner_id", profile.id);
  const { data } = await q;
  const rows = (data ?? []) as unknown as TaskRow[];
  const t = today();
  const late = rows.filter((r) => r.status === "open" && r.due_date && r.due_date < t);
  const rest = rows.filter((r) => !late.includes(r));
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true).neq("id", profile.id)
    : { data: [] as { id: string; full_name: string }[] };

  const tab = (k: string, label: string) => (
    <Link href={`/tasks?view=${k}`} className={`badge ${view === k ? "" : "gray"}`}>{label}</Link>
  );
  const back = `/tasks?view=${view}`;

  return (
    <main className="wrap">
      <h1>Εργασίες</h1>
      <p className="muted">Μόνο για πωλήσεις. Programming, social και τα υπόλοιπα μένουν στο Asana.</p>
      <Flash sp={sp} />
      <div className="card"><NewTaskForm back={back} people={people ?? []} /></div>
      <div className="row">
        {tab("mine", "Δικές μου")}
        {isAdmin && tab("all", "Όλης της ομάδας")}
        {tab("done", "Ολοκληρωμένες")}
      </div>
      {late.length > 0 && (<><div className="section-label late">ΚΑΘΥΣΤΕΡΗΜΕΝΕΣ</div><TaskList tasks={late} back={back} showOwner={view === "all"} /></>)}
      {view !== "done" && <div className="section-label muted">ΕΠΟΜΕΝΕΣ</div>}
      <TaskList tasks={rest} back={back} showOwner={view === "all"} />
    </main>
  );
}
