import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, LOST_KINDS, STAGES, dateGr, eur, periodGr, today } from "@/lib/format";
import { addActivity, updateLead, webLookup } from "../../actions";
import { Flash } from "@/components/Flash";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";
import { StagePath } from "@/components/MoveDialog";
import { PERSON_SELECT, PeopleCard, type Person } from "@/components/People";
import { toggleInterest } from "../../proposal-actions";
import { CLIENT_LABEL, itemTotal, type ClientType, type Item } from "@/lib/pricing";

const SOURCES: Record<string, string> = {
  phone: "Τηλέφωνο", site: "Site", facebook: "Facebook", seller: "Account Executive", base: "Βάση πελατών",
  competition_watch: "Competition Watch", email: "Email",
};
const ICON: Record<string, string> = { call: "📞", meeting: "🤝", viber: "💬", email: "✉️", note: "📝" };
const dateTime = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

// Χρόνος για το ψάξιμο της AI στο ίντερνετ
export const maxDuration = 120;

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
  const { data: contactData } = await supabase.from("contacts").select(PERSON_SELECT).eq("lead_id", id);
  const persons = (contactData ?? []) as Person[];
  const { data: prop } = await supabase.from("proposals").select("client_type, proposal_items(station, monthly_amount, long_months, long_amount, months)").eq("lead_id", id).maybeSingle();
  const propItems = ((prop?.proposal_items ?? []) as Pick<Item, "station" | "monthly_amount" | "long_months" | "long_amount" | "months">[]);
  const propTotal = propItems.reduce((a, i) => a + itemTotal(i).total, 0);
  const interests = ((lead.interests as string[] | null) ?? [lead.product_line]) as string[];

  // Αν το lead αφορά υπάρχοντα πελάτη: το ιστορικό του από την τιμολόγηση
  const [{ data: cust }, { data: lines }] = lead.customer_id
    ? await Promise.all([
        supabase.from("customers").select("id, display_name, lifetime_revenue, first_period, last_period, stations, revenue_by_year, agency, profiles!customers_owner_id_fkey(full_name)").eq("id", lead.customer_id).maybeSingle(),
        supabase.from("history_lines").select("record_id, period, station, amount, amount_type, package_raw").eq("customer_id", lead.customer_id).eq("source_scope", "monthly_billing").order("period", { ascending: false }).limit(12),
      ])
    : [{ data: null }, { data: null }];
  const custYears = Object.entries(((cust?.revenue_by_year ?? {}) as Record<string, number>)).sort(([a], [b]) => a.localeCompare(b));
  const custMax = Math.max(1, ...custYears.map(([, v]) => v));
  const activities = (acts ?? []) as unknown as { id: string; type: string; summary: string; occurred_at: string; profiles: { full_name: string } | null }[];
  const openTasks = (taskData ?? []) as unknown as TaskRow[];
  const lastContact = activities.find((a) => a.type !== "note");
  const t = today();
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const closed = lead.status === "won" || lead.status === "lost";
  const justCreated = Date.now() - Date.parse(lead.created_at) < 3 * 60 * 1000;
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
          <div><span>Κατηγορία</span><strong>{lead.category ?? "—"}</strong></div>
          <div><span>Υπεύθυνος επικοινωνίας</span><strong>{lead.contact_name ?? "—"}</strong></div>
          <div><span>Τηλέφωνο</span><strong>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : "—"}</strong></div>
          <div><span>Εκτιμώμενη αξία</span><strong>{lead.expected_value ? eur(Number(lead.expected_value)) : "—"}</strong></div>
          <div><span>Account Executive</span><strong>{lead.owner?.full_name ?? "Χωρίς ανάθεση"}</strong></div>
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
        <div className="sf-left">
        <div className="card sf-main">
          <div className="sf-tabs">
            <Link href={`/leads/${lead.id}`} className={tab === "activity" ? "on" : ""}>Δραστηριότητα</Link>
            <Link href={`/leads/${lead.id}?tab=details`} className={tab === "details" ? "on" : ""}>Στοιχεία</Link>
          </div>

          {tab === "activity" ? (
            <>
              <form action={addActivity} className="stack sf-composer" id="log">
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
                  <label>Account Executive
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

        {cust && (
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 className="grow" style={{ margin: 0 }}>Ιστορικό πελάτη</h2>
              <Link href={`/customers/${cust.id}`} style={{ fontWeight: 700, fontSize: 13 }}>Καρτέλα πελάτη ›</Link>
            </div>
            <div className="sf-highlights" style={{ borderTop: 0, paddingTop: 0 }}>
              <div><span>Συνολικός τζίρος</span><strong>{eur(cust.lifetime_revenue)}</strong></div>
              <div><span>Πελάτης από</span><strong>{periodGr(cust.first_period)}</strong></div>
              <div><span>Τελευταία καμπάνια</span><strong>{periodGr(cust.last_period)}</strong></div>
              <div><span>Σταθμοί</span><strong>{(cust.stations ?? []).join(", ") || "—"}</strong></div>
              {cust.agency && <div><span>Media shop</span><strong>{cust.agency}</strong></div>}
            </div>
            {custYears.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="bars">{custYears.map(([y, v]) => <div key={y} title={`${y}: ${eur(v)}`} style={{ height: `${(v / custMax) * 100}%` }} />)}</div>
                <div className="bars-labels">{custYears.map(([y]) => <span key={y}>{y.slice(2)}</span>)}</div>
              </div>
            )}
            {(lines ?? []).length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Μήνας</th><th>Σταθμός</th><th className="num">Ποσό</th><th className="hide-m">Πακέτο</th></tr></thead>
                <tbody>
                  {(lines ?? []).map((h) => (
                    <tr key={h.record_id}>
                      <td>{periodGr(h.period)}</td><td>{h.station ?? "—"}</td>
                      <td className="num">{h.amount_type === "FREE" ? "Δώρο" : eur(h.amount)}</td>
                      <td className="muted hide-m">{h.package_raw ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(lines ?? []).length === 0 && <p className="muted" style={{ margin: 0 }}>Δεν υπάρχουν καμπάνιες στο αρχείο τιμολόγησης.</p>}
          </div>
        )}
        </div>

        {/* Δεξιά: σχετικά */}
        <aside className="sf-side">
          <div className="card">
            <h2>Εργασίες ({openTasks.length})</h2>
            <NewTaskForm back={`/leads/${lead.id}`} leadId={lead.id} />
          </div>
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>Πρόταση</h2>
              {prop?.client_type && <span className="badge gray">{CLIENT_LABEL[prop.client_type as ClientType]}</span>}
            </div>
            {propItems.length ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{eur(propTotal)}</div>
                <div className="muted" style={{ fontSize: 13 }}>{[...new Set(propItems.map((i) => i.station))].join(" · ")} · {propItems.length} {propItems.length === 1 ? "γραμμή" : "γραμμές"} · χωρίς ΦΠΑ</div>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Στήσε τα νούμερα: μέσο, πακέτο ή κοστολόγηση πλάνου, διάρκεια.</p>
            )}
            <div><Link href={`/leads/${lead.id}/proposal`} className="btn">{propItems.length ? "Άνοιγμα πρότασης" : "Νέα πρόταση"}</Link></div>
          </div>
          <PeopleCard people={persons} leadId={lead.id} back={`/leads/${lead.id}`} canEdit />
          <div className="card sf-fields">
            <h2>Πληροφορίες</h2>
            <div><span>Πηγή</span>{SOURCES[lead.source] ?? lead.source}</div>
            <div><span>Κλάδος επιχείρησης</span>{lead.category ?? "—"}</div>
            <div>
              <span>Ενδιαφέρεται για</span>
              <form action={toggleInterest} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="version" value={lead.version} />
                {([["radio", "Radio"], ["digital", "Digital"]] as const).map(([k, label]) => (
                  <button key={k} type="submit" name="which" value={k} className={interests.includes(k) ? "" : "secondary"} style={{ padding: "6px 14px" }} aria-pressed={interests.includes(k)}>
                    {interests.includes(k) ? "✓ " : ""}{label}
                  </button>
                ))}
              </form>
            </div>
            <div><span>Σταθμοί</span>{(lead.stations ?? []).join(", ") || "—"}</div>
            <div><span>Περιοχή</span>{lead.area ?? "—"}</div>
            <div><span>Email</span>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</div>
            {lead.notes && <div><span>Σημειώσεις</span><span style={{ whiteSpace: "pre-wrap" }}>{lead.notes}</span></div>}
          </div>
          <div className="card sf-fields">
            <div className="row"><h2 className="grow" style={{ margin: 0 }}>Από το ίντερνετ</h2>
              {lead.web_status === "found" && <span className="badge good">βρέθηκε</span>}
              {lead.web_status === "closed" && <span className="badge late">φαίνεται κλειστή</span>}
              {lead.web_status === "not_found" && <span className="badge gray">δεν βρέθηκε</span>}
            </div>
            {!lead.web_checked_at ? (
              <p className="muted" style={{ margin: 0 }}>{justCreated ? "Η AI ψάχνει τώρα την επιχείρηση… ανανέωσε τη σελίδα σε λίγα δευτερόλεπτα." : "Δεν έχει γίνει αναζήτηση ακόμα."}</p>
            ) : (
              <>
                {lead.category && <div><span>Κατηγορία</span>{lead.category}</div>}
                {lead.website && <div><span>Site</span><a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\//, "")}</a></div>}
                {lead.address && <div><span>Διεύθυνση</span>{lead.address}</div>}
                {lead.web_note && <div><span>Σημείωση AI</span>{lead.web_note}</div>}
                {(lead.web_sources ?? []).length > 0 && <div><span>Πηγές</span>{(lead.web_sources as string[]).slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.replace(/^https?:\/\/(www\.)?/, "")}</a>)}</div>}
                <p className="muted" style={{ margin: 0 }}>Η AI συμπληρώνει μόνο κενά πεδία· ό,τι έγραψες εσύ δεν αλλάζει. Έλεγξέ τα πριν τα χρησιμοποιήσεις.</p>
              </>
            )}
            {true && (
              <form action={webLookup}>
                <input type="hidden" name="kind" value="lead" />
                <input type="hidden" name="id" value={lead.id} />
                <SubmitButton className="secondary" pending="Ψάχνω…" hint="Η AI ψάχνει στο ίντερνετ, 10–30 δευτερόλεπτα">{lead.web_checked_at ? "Ξαναψάξε στο ίντερνετ" : "Ψάξε στο ίντερνετ"}</SubmitButton>
              </form>
            )}
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
