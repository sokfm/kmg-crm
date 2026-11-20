import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { completeTask, createTask } from "@/app/(app)/actions";
import { dateGr, today } from "@/lib/format";

export type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  source: string;
  customer_id: string | null;
  lead_id: string | null;
  agency_id?: string | null;
  agencies?: { name: string } | null;
  owner?: { full_name: string } | null;
  customers?: { display_name: string } | null;
  leads?: { company_name: string } | null;
};

export const TASK_SELECT =
  "id, title, due_date, status, source, customer_id, lead_id, owner:profiles!tasks_owner_id_fkey(full_name), customers(display_name), leads(company_name), agency_id, agencies(name)";

// Λίστα εργασιών με κουμπί ολοκλήρωσης. Χρησιμοποιείται στο Σήμερα, στις Εργασίες και στις καρτέλες.
export function TaskList({ tasks, back, showOwner = false, showTarget = true }: { tasks: TaskRow[]; back: string; showOwner?: boolean; showTarget?: boolean }) {
  const t = today();
  if (tasks.length === 0) return <p className="muted">Καμία ανοιχτή εργασία.</p>;
  return (
    <div className="list">
      {tasks.map((k) => {
        const late = k.status === "open" && k.due_date && k.due_date < t;
        const target = k.customer_id ? (
          <Link href={`/customers/${k.customer_id}`}>{k.customers?.display_name ?? "πελάτης"}</Link>
        ) : k.lead_id ? (
          <Link href={`/leads/${k.lead_id}`}>{k.leads?.company_name ?? "lead"}</Link>
        ) : k.agency_id ? (
          <Link href={`/agencies/${k.agency_id}`}>🏢 {k.agencies?.name ?? "πρακτορείο"}</Link>
        ) : null;
        return (
          <div key={k.id} className={`item ${late ? "late" : ""}`} style={k.status === "done" ? { opacity: 0.55 } : undefined}>
            <form action={completeTask}>
              <input type="hidden" name="id" value={k.id} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="done" value={k.status === "done" ? "0" : "1"} />
              <button type="submit" className="secondary" title={k.status === "done" ? "Άνοιγμα ξανά" : "Ολοκληρώθηκε"} style={{ padding: "4px 9px" }}>
                {k.status === "done" ? "↺" : "✓"}
              </button>
            </form>
            <div className="grow">
              <div className="title" style={k.status === "done" ? { textDecoration: "line-through" } : undefined}>{k.title}</div>
              <div className="muted">
                {showTarget && target}
                {showTarget && target && " · "}
                {showOwner && k.owner?.full_name ? `${k.owner.full_name} · ` : ""}
                {k.source === "email" ? "από email" : "χειροκίνητη"}
              </div>
            </div>
            <span className={`badge ${late ? "late" : "gray"}`}>{k.due_date ? dateGr(k.due_date) : "χωρίς ημ/νία"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function NewTaskForm({
  back, customerId, leadId, agencyId, people,
}: { back: string; customerId?: string; leadId?: string; agencyId?: string; people?: { id: string; full_name: string }[] }) {
  const in2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return (
    <form action={createTask} className="row">
      <input type="hidden" name="back" value={back} />
      {customerId && <input type="hidden" name="customer_id" value={customerId} />}
      {leadId && <input type="hidden" name="lead_id" value={leadId} />}
      {agencyId && <input type="hidden" name="agency_id" value={agencyId} />}
      <input name="title" className="grow" placeholder="Νέα εργασία, π.χ. Αποστολή πρότασης" required />
      <input name="due_date" type="date" defaultValue={in2} />
      {people && people.length > 0 && (
        <select name="owner_id" defaultValue="" aria-label="Ανάθεση σε">
          <option value="">Για μένα</option>
          {people.map((p) => <option key={p.id} value={p.id}>Για: {p.full_name}</option>)}
        </select>
      )}
      <SubmitButton>Προσθήκη</SubmitButton>
    </form>
  );
}
