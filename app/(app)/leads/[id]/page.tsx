import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, LOST_KINDS, STAGES, dateGr, eur, today } from "@/lib/format";
import { addActivity, updateLead } from "../../actions";
import { Flash } from "@/components/Flash";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";
import { StagePath } from "@/components/MoveDialog";

const SOURCES: Record<string, string> = {
  phone: "Τηλέφωνο", site: "Site", facebook: "Facebook", seller: "Πωλητής", base: "Βάση πελατών",
  competition_watch: "Competition Watch", email: "Email",
};
const ICON: Record<string, string> = { call: "📞", meeting: "🤝", viber: "💬", email: "✉️", note: "📝" };
const dateTime = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

export default async function LeadPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "details" ? "details" : "activity";
  const { supabase, isAdmin } = await requireProfile();
  const { data: lead } = await supabase
    .from("leads")
    .select("*, owner:profiles!leads_owner_id_fkey(full_name), creator:profiles!leads_created_by_fkey(full_name), customers(display_name)")
    .eq("id", id)
    .maybeSingle();
  if (!lead) notFound();

  const [{ data: acts }, { data: taskData }, { data: peopleData }] = await Promise.all([
    supabase.from("activities").select("id, type, summary, occurred_at, profiles!activities_user_id_fkey(full_name)").eq("lead_id", id).order("occurred_at", { ascending: false }),
    supabase.from("tasks").select(TASK_SELECT).eq("lead_id", id).eq("status", "open").order("due_date"),
    isAdmin
      ? supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const people = (peopleData ?? []) as { id: string; full_name: string }[];
  const activities = (acts ?? []) as unknown as { id: string; type: string; summary: string; occurred_at: string; profiles: { full_name: string } | null }[];
  const openTasks = (taskData ?? []) as unknown as TaskRow[];
  const lastContact = activities.find((a) => a.type !== "note");
  const t = today();
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const closed = lead.status === "won" || lead.status === "lost";
  const late = !closed && lead.next_step_due && lead.next_step_due < t;
  const card = { id: lead.id, version: lead.version, company_name: lead.company_name, next_step: lead.next_step, next_step_due: lead.next_step_due, expected_value: lead.expected_value };

  // Χρονολόγιο ανά μήνα, όπως στο Salesforce
  const byMonth = new Map<string, typeof activities>();
  for (const a of activities) {
    const k = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" }).format(new Date(a.occurred_at));
    byMonth.set(k, [...(byMonth.get(k) ?? []), a]);
  }

  return (
    <main className="wrap wide sf">
      {/* Κεφαλίδα εγγραφής */}
      <div className="sf-head card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="sf-icon">L</div>
          <div className="grow">
            <div className="muted"><Link href="/leads">Leads</Link> › Lead</div>
            <h1 style={{ margin: 0 }}>{lead.company_name}</h1>
          </div>
          <div className="row">
            {lead.phone && <a className="btn secondary" href={`tel:${lead.phone}`}>📞 Κλήση</a>}
            {lead.email && <a className="btn secondary" href={`mailto:${lead.email}`}>✉️ Email</a>}
            <Link className="btn secondary" href={`/leads/${lead.id}?tab=details`}>Επεξεργασία</Link>
          </div>
        </div>
        <div className="sf-highlights">
          <div><span>Στάδιο</span><strong>{STAGES[lead.status]}</strong></div>
          <div><span>Υπεύθυνος επικοινωνίας</span><strong>{lead.contact_name ?? "—"}</strong></div>
          <div><span>Τηλέφωνο</span><strong>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : "—"}</strong></div>
          <div><span>Εκτιμώμενη αξία</span><strong>{lead.expected_value ? eur(Number(lead.expected_value)) : "—"}</strong></div>
          <div><span>Πωλητής</span><strong>{lead.owner?.full_name ?? "Χωρίς ανάθεση"}</strong></div>
          <div><span>Τελευταία επαφή</span><strong>{lastContact ? dateGr(lastContact.occurred_at) : "καμία"}</strong></div>
        </div>
      </div>

      {/* Μπάρα σταδίων */}
      <div className="card" style={{ padding: 10 }}>
        <StagePath card={card} status={lead.status} today={t} />
        <div className="row muted" style={{ marginTop: 8, justifyContent: "space-between" }}>
          <span>
            {lead.status === "lost" ? `Χάθηκε · ${LOST_KINDS[lead.lost_kind ?? ""] ?? ""}${lead.lost_reason ? " — " + lead.lost_reason : ""}` :
             lead.status === "won" ? "Κλείσαμε το deal 🎉" : "Πάτα ένα στάδιο για να μετακινήσεις το lead."}
          </span>
          {lead.customer_id && <Link href={`/customers/${lead.customer_id}`}>Καρτέλα πελάτη: {lead.customers?.display_name ?? "άνοιγμα"} ›</Link>}
        </div>
      </div>
      <Flash sp={sp} />

      <div className="sf-cols">
        {/* Αριστερά: Δραστηριότητα / Στοιχεία */}
        <div className="card sf-main">
          <div className="sf-tabs">
            <Link href={`/leads/${lead.id}`} className={tab === "activity" ? "on" : ""}>Δραστηριότητα</Link>
            <Link href={`/leads/${lead.id}?tab=details`} className={tab === "details" ? "on" : ""}>Στοιχεία</Link>
          </div>

          {tab === "activity" ? (
            <>
              <form action={addActivity} className="stack sf-composer">
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="seg">
                  {Object.entries(ACTIVITY).map(([k, v], i) => (
                    <label key={k}><input type="radio" name="type" value={k} defaultChecked={i === 0} /><span>{ICON[k]} {v}</span></label>
                  ))}
                </div>
                <input name="summary" placeholder="Τι ειπώθηκε;" required />
                {!closed && (
                  <div className="grid2">
                    <label>Επόμενο βήμα<input name="next_step" placeholder={lead.next_step ?? "π.χ. Στέλνω πρόταση"} /></label>
                    <label>Πότε<input name="next_step_due" type="date" defaultValue={in3} /></label>
                  </div>
                )}
                <div className="row">
                  <SubmitButton>Καταγραφή</SubmitButton>
                  <span className="muted">Η «Σημείωση» δεν μετράει ως επαφή.</span>
                </div>
              </form>

              <div className="sf-section">Επόμενα και καθυστερημένα</div>
              <div className="timeline">
                {!closed && (
                  <div className={`tl ${late ? "late" : ""}`}>
                    <span className="dot">➜</span>
                    <div className="grow">
                      <strong>{lead.next_step ?? "Χωρίς επόμενο βήμα"}</strong>
                      <div className="muted">Επόμενο βήμα{late ? " · καθυστερεί" : ""}</div>
                    </div>
                    <span className={`badge ${late ? "late" : ""}`}>{dateGr(lead.next_step_due)}</span>
                  </div>
                )}
                <TaskList tasks={openTasks} back={`/leads/${lead.id}`} showTarget={false} showOwner />
              </div>

              {[...byMonth.entries()].map(([month, list]) => (
                <div key={month}>
                  <div className="sf-section">{month}</div>
                  <div className="timeline">
                    {list.map((a) => (
                      <div key={a.id} className={`tl t-${a.type}`}>
                        <span className="dot">{ICON[a.type]}</span>
                        <div className="grow">
                          <strong>{ACTIVITY[a.type]}</strong> <span className="muted">· {a.profiles?.full_name ?? ""}</span>
                          <div>{a.summary}</div>
                        </div>
                        <span className="muted" style={{ whiteSpace: "nowrap" }}>{dateGr(a.occurred_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {activities.length === 0 && <p className="muted">Καμία επαφή ακόμα. Η πρώτη κλήση ξεκινά το χρονολόγιο.</p>}
            </>
          ) : (
            <form action={updateLead} className="stack">
              <input type="hidden" name="id" value={lead.id} />
              <input type="hidden" name="version" value={lead.version} />
              <div className="sf-section">Βασικά στοιχεία</div>
              <div className="grid2">
                <label>Υπεύθυνος επικοινωνίας<input name="contact_name" defaultValue={lead.contact_name ?? ""} /></label>
                <label>Τηλέφωνο<input name="phone" defaultValue={lead.phone ?? ""} /></label>
                <label>Email<input name="email" defaultValue={lead.email ?? ""} /></label>
                <label>Εκτιμώμενη αξία (€)<input name="expected_value" inputMode="decimal" defaultValue={lead.expected_value ?? ""} placeholder="π.χ. 1.500" /></label>
                {isAdmin && (
                  <label>Πωλητής
                    <select name="owner_id" defaultValue={lead.owner_id ?? ""}>
                      <option value="">Χωρίς ανάθεση</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="sf-section">Στάδιο και επόμενο βήμα</div>
              <div className="grid2">
                <label>Στάδιο
                  <select name="status" defaultValue={lead.status}>
                    {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Αν χάθηκε: τι «όχι» ήταν
                  <select name="lost_kind" defaultValue={lead.lost_kind ?? ""}>
                    <option value="">—</option>
                    {Object.entries(LOST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Επόμενο βήμα<input name="next_step" defaultValue={lead.next_step ?? ""} /></label>
                <label>Πότε<input name="next_step_due" type="date" defaultValue={lead.next_step_due ?? ""} /></label>
              </div>
              <label>Γιατί χάθηκε (με δικά σου λόγια)<input name="lost_reason" defaultValue={lead.lost_reason ?? ""} /></label>
              <label>Σημειώσεις<textarea name="notes" defaultValue={lead.notes ?? ""} /></label>
              <p className="muted">Ακόμα και ένα «όχι τώρα» κρατάει επόμενο βήμα: πότε ξαναχτυπάμε την πόρτα.</p>
              <SubmitButton>Αποθήκευση</SubmitButton>
            </form>
          )}
        </div>

        {/* Δεξιά: σχετικά */}
        <aside className="sf-side">
          <div className="card">
            <h2>Εργασίες ({openTasks.length})</h2>
            <NewTaskForm back={`/leads/${lead.id}`} leadId={lead.id} />
          </div>
          <div className="card sf-fields">
            <h2>Πληροφορίες</h2>
            <div><span>Πηγή</span>{SOURCES[lead.source] ?? lead.source}</div>
            <div><span>Είδος</span>{lead.product_line === "digital" ? "Digital" : "Ράδιο"}</div>
            <div><span>Σταθμοί</span>{(lead.stations ?? []).join(", ") || "—"}</div>
            <div><span>Περιοχή</span>{lead.area ?? "—"}</div>
            <div><span>Email</span>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</div>
            {lead.notes && <div><span>Σημειώσεις</span><span style={{ whiteSpace: "pre-wrap" }}>{lead.notes}</span></div>}
          </div>
          <div className="card sf-fields">
            <h2>Ιστορικό εγγραφής</h2>
            <div><span>Δημιουργήθηκε</span>{dateTime(lead.created_at)}{lead.creator?.full_name ? ` · ${lead.creator.full_name}` : ""}</div>
            <div><span>Τελευταία αλλαγή</span>{dateTime(lead.updated_at)}</div>
            {lead.closed_at && <div><span>Έκλεισε</span>{dateTime(lead.closed_at)}</div>}
          </div>
        </aside>
      </div>
    </main>
  );
}
