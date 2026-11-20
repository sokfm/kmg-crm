import Link from "next/link";
import { itemTotal } from "@/lib/pricing";
import { SubmitButton } from "@/components/SubmitButton";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { AccessLock, type MyAccess } from "@/components/AccessLock";
import { ACTIVITY, CHANNEL, STAGES, dateGr, eur, periodGr, customerState, aeLabel } from "@/lib/format";
import { addActivity, decideWeb, leaveGroupAction, makeGroupAction, renameCustomer, setGroupAction, updateCustomerInfo, webLookup } from "../../actions";
import { PERSON_SELECT, PeopleCard, type Person } from "@/components/People";
import { Flash } from "@/components/Flash";
import { assignees } from "@/lib/assignees";
import { NewTaskForm, TASK_SELECT, TaskList, type TaskRow } from "@/components/Tasks";

// Χρόνος για το ψάξιμο της AI στο ίντερνετ
export const maxDuration = 120;

export default async function CustomerPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = ["activity", "history"].includes(sp.tab) ? sp.tab : "info";
  const { supabase, isAdmin, profile } = await requireProfile();
  // Από τον κατάλογο: ο πελάτης υπάρχει για όλους, αλλά στοιχεία και τζίρος έρχονται μόνο αν επιτρέπεται
  const { data: cx } = await supabase.from("customers_x").select("*").eq("id", id).maybeSingle();
  if (!cx) notFound();
  const c = { ...cx, profiles: cx.owner_name ? { full_name: cx.owner_name as string } : null, parent: cx.parent_id ? { id: cx.parent_id as string, display_name: cx.parent_name as string } : null };
  const { data: myAcc } = isAdmin ? { data: null } : await supabase.from("customer_access")
    .select("status, reason, decided_note, expires_at, requested_at").eq("customer_id", id).eq("user_id", profile.id).order("requested_at", { ascending: false }).limit(1).maybeSingle();
  const mine = (myAcc ?? null) as MyAccess;
  const openUntil = mine?.status === "approved" && mine.expires_at && Date.parse(mine.expires_at) > Date.now() ? mine.expires_at : null;

  // Πελάτης άλλου Account Executive χωρίς έγκριση: μόνο ότι υπάρχει και σε ποιον ανήκει
  if (!c.detail_ok) {
    return (
      <main className="wrap" style={{ maxWidth: 760 }}>
        <div>
          <Link href="/customers" className="muted">← Πελάτες</Link>
          <h1 style={{ margin: 0 }}>{c.display_name}</h1>
          <div className="muted">{CHANNEL[c.channel]}{c.agency ? ` · ${c.agency}` : ""} · {customerState(c).label} · Account Executive: {aeLabel(c) ?? c.served_by ?? "κανείς"}</div>
        </div>
        <Flash sp={sp} />
        <div className="grid2">
          <div className="card"><div className="muted">Πελάτης από</div><div className="kpi">{periodGr(c.first_period)}</div></div>
          <div className="card"><div className="muted">Τελευταία καμπάνια</div><div className="kpi">{periodGr(c.last_period)}</div></div>
          <div className="card"><div className="muted">Σταθμοί</div><div className="kpi" style={{ fontSize: 16 }}>{(c.stations ?? []).join(", ") || "—"}</div></div>
          <div className="card"><div className="muted">Τζίρος</div><div className="kpi">🔒</div></div>
        </div>
        <AccessLock customerId={c.id} what="Η καρτέλα αυτού του πελάτη είναι κλειδωμένη για σένα" mine={mine} />
      </main>
    );
  }

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
  // Όλες οι προτάσεις και τα πλάνα του πελάτη (από όλα τα leads του)
  const leadIds = (leads ?? []).map((l) => l.id);
  const { data: propData } = leadIds.length
    ? await supabase.from("proposals").select("id, code, sent_at, lead_id, title, created_at, proposal_items(station, monthly_amount, long_months, long_amount, months)").in("lead_id", leadIds).order("created_at", { ascending: false })
    : { data: [] };
  const { data: totData } = leadIds.length ? await supabase.from("proposal_totals").select("proposal_id, final_total").in("lead_id", leadIds) : { data: [] };
  const finals = new Map((totData ?? []).map((r) => [r.proposal_id as string, Number(r.final_total)]));
  const custProps = ((propData ?? []) as { id: string; code: string; sent_at: string | null; lead_id: string; title: string; created_at: string; proposal_items: { station: string; monthly_amount: number; long_months: number | null; long_amount: number | null; months: number }[] }[])
    .map((p) => ({ ...p, total: finals.get(p.id) ?? p.proposal_items.reduce((x, i) => x + itemTotal(i).total, 0), stations: [...new Set(p.proposal_items.map((i) => i.station))] }));


  // Οι αυθεντικές εγγραφές του Excel (όνομα / Account Executive / Agent), ομαδοποιημένες
  const { data: rawLines } = await supabase.from("history_lines")
    .select("customer_name_raw, account_executive_raw, agent_raw, period, amount")
    .eq("customer_id", c.id).eq("source_scope", "monthly_billing").limit(3000);
  const rawMap = new Map<string, { key: string; name: string; acc: string | null; agent: string | null; first: string; last: string; n: number; sum: number }>();
  for (const h of rawLines ?? []) {
    const key = `${h.customer_name_raw}|${h.account_executive_raw ?? ""}|${h.agent_raw ?? ""}`;
    const e = rawMap.get(key) ?? { key, name: h.customer_name_raw ?? "—", acc: h.account_executive_raw, agent: h.agent_raw, first: h.period, last: h.period, n: 0, sum: 0 };
    e.n++; e.sum += Number(h.amount ?? 0);
    if (h.period < e.first) e.first = h.period;
    if (h.period > e.last) e.last = h.period;
    rawMap.set(key, e);
  }
  const raw = [...rawMap.values()].sort((a, b) => b.last.localeCompare(a.last));
  const { data: peopleData } = await supabase.from("contacts").select(PERSON_SELECT).eq("customer_id", c.id);
  const people = (peopleData ?? []) as Person[];
  const { data: { user } } = await supabase.auth.getUser();
  const canEdit = isAdmin || c.owner_id === user?.id;
  // Group: brands από κάτω και συνολικά νούμερα· Brand: τα πρόσωπα του Group
  type Brand = { id: string; display_name: string; lifetime_revenue: number; last_period: string | null; revenue_by_year: Record<string, number> | null; served_by: string | null; status: string; closed_at: string | null; profiles: { full_name: string } | null };
  const { data: brandData } = c.is_group
    ? await supabase.from("customers_x").select("id, display_name, lifetime_revenue, last_period, revenue_by_year, served_by, status, closed_at, owner_name, rev_ok").eq("parent_id", c.id).order("lifetime_revenue", { ascending: false, nullsFirst: false })
    : { data: [] };
  const brands = ((brandData ?? []) as unknown as (Brand & { owner_name: string | null; rev_ok: boolean })[]).map((b) => ({ ...b, profiles: b.owner_name ? { full_name: b.owner_name } : null }));
  const revOk = !!c.rev_ok && brands.every((b) => b.rev_ok);
  const parent = c.parent as { id: string; display_name: string } | null;
  const { data: groupPeopleData } = parent ? await supabase.from("contacts").select(PERSON_SELECT).eq("customer_id", parent.id) : { data: [] };
  const groupPeople = (groupPeopleData ?? []) as Person[];
  const yearsAll: Record<string, number> = { ...((c.revenue_by_year ?? {}) as Record<string, number>) };
  for (const b of brands) for (const [y, v] of Object.entries(b.revenue_by_year ?? {})) yearsAll[y] = (yearsAll[y] ?? 0) + Number(v);
  const totalRevenue = Number(c.lifetime_revenue) + brands.reduce((t, b) => t + Number(b.lifetime_revenue), 0);
  const lastAll = [c.last_period, ...brands.map((b) => b.last_period)].filter(Boolean).sort().pop() ?? null;
  const { data: groups } = isAdmin && !c.is_group ? await supabase.from("customers").select("id, display_name").eq("is_group", true).order("display_name") : { data: [] };
  const href = (t: string) => `/customers/${c.id}${t === "info" ? "" : `?tab=${t}`}`;
  const byYear = Object.entries(yearsAll).sort(([a], [b]) => a.localeCompare(b));
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
        {c.is_group && <div style={{ margin: "4px 0" }}><span className="badge onair">Group</span> <span className="muted">{brands.length === 1 ? "1 brand" : `${brands.length} brands`}</span></div>}
        {parent && <div style={{ margin: "4px 0" }}><span className="muted">Brand του Group </span><Link href={`/customers/${parent.id}`} style={{ fontWeight: 700 }}>{parent.display_name} ›</Link></div>}
        <div className="muted">
          {CHANNEL[c.channel]}{c.agency_id ? <> · <Link href={`/agencies/${c.agency_id}`}>🏢 {c.agency}</Link></> : c.agency ? ` · ${c.agency}` : ""} · {customerState(c).label} · Account Executive: {aeLabel(c) ?? "κανείς (βάση)"}{c.served_by && c.served_by !== aeLabel(c) ? ` · τον εξυπηρετούσε: ${c.served_by}${c.served_by_period ? ` (ως ${periodGr(c.served_by_period)})` : ""}` : ""}
        </div>
      </div>
      <Flash sp={sp} />
      {!revOk && <AccessLock customerId={c.id} what="Ο τζίρος και το ιστορικό τιμολόγησης αυτού του πελάτη είναι κλειδωμένα" mine={mine} />}
      {openUntil && <div className="msg" style={{ background: "var(--orange-bg)" }}>🔓 Έχεις πρόσβαση σε αυτόν τον πελάτη έως {dateGr(openUntil)}. Μετά ξανακλειδώνει.</div>}
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
        <div className="card"><div className="muted">{c.is_group ? "Συνολικός τζίρος Group" : "Συνολικός τζίρος"}</div><div className="kpi">{revOk ? eur(totalRevenue) : "🔒"}</div></div>
        <div className="card"><div className="muted">Πελάτης από</div><div className="kpi">{periodGr(c.first_period)}</div></div>
        <div className="card"><div className="muted">Τελευταία καμπάνια</div><div className="kpi">{periodGr(lastAll)}</div></div>
        <div className="card"><div className="muted">Σταθμοί</div><div className="kpi" style={{ fontSize: 16 }}>{(c.stations ?? []).join(", ") || "—"}</div></div>
        <div className="card"><div className="muted">Τελευταία επαφή</div><div className="kpi">{lastActivity ? dateGr(lastActivity.occurred_at) : "—"}</div></div>
      </div>

      <div className="sf-tabs" style={{ margin: "4px 0 0" }}>
        <Link href={href("info")} className={tab === "info" ? "on" : ""}>Στοιχεία & Πρόσωπα</Link>
        <Link href={href("activity")} className={tab === "activity" ? "on" : ""}>Δραστηριότητα</Link>
        <Link href={href("history")} className={tab === "history" ? "on" : ""}>Ιστορικό</Link>
      </div>

      {tab === "info" && (
        <>
      {c.is_group && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="day-head"><h2 className="grow" style={{ margin: 0 }}>Brands του Group</h2><span className="badge gray">{eur(totalRevenue)}</span></div>
          {brands.length === 0 && <p className="muted" style={{ padding: 18, margin: 0 }}>Κανένα brand ακόμα. Από το Clients τσέκαρε πελάτες και πάτα «Σε Group».</p>}
          {Number(c.lifetime_revenue) > 0 && (
            <div className="day-row"><span className="grow"><strong>{c.display_name}</strong> <span className="muted">(το ίδιο το Group)</span></span><span className="muted">{periodGr(c.last_period)}</span><strong>{eur(c.lifetime_revenue)}</strong></div>
          )}
          {brands.map((b) => {
            const st = customerState(b);
            return (
              <Link key={b.id} href={`/customers/${b.id}`} className="day-row" style={{ color: "inherit" }}>
                <span className="grow"><strong>{b.display_name}</strong><div className="muted">AE: {b.profiles?.full_name ?? (b.served_by?.startsWith("Media shop") ? b.served_by : "βάση")}</div></span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
                <span className="muted hide-s">{periodGr(b.last_period)}</span>
                {b.rev_ok ? <strong>{eur(Number(b.lifetime_revenue ?? 0))}</strong> : <span className="muted">🔒</span>}
              </Link>
            );
          })}
        </div>
      )}
      <div className="cust-cols">
        <div className="card sf-fields">
          <h2 style={{ margin: 0 }}>Στοιχεία επιχείρησης</h2>
          {c.legal_name && <div><span>Επωνυμία</span>{c.legal_name}</div>}
          {(c.afm || c.doy) && <div><span>ΑΦΜ / ΔΟΥ</span>{[c.afm, c.doy].filter(Boolean).join(" · ")}</div>}
          {c.category && <div><span>Κατηγορία</span>{c.category}</div>}
          <div><span>Τηλέφωνο</span>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</div>
          <div><span>Email</span>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</div>
          {c.website && <div><span>Site</span><a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a></div>}
          {c.address && <div><span>Διεύθυνση</span><a href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer">{c.address}</a></div>}
          {(c.facebook || c.instagram) && <div><span>Social</span>{c.facebook && <a href={c.facebook.startsWith("http") ? c.facebook : `https://facebook.com/${c.facebook}`} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>Facebook</a>}{c.instagram && <a href={c.instagram.startsWith("http") ? c.instagram : `https://instagram.com/${c.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Instagram</a>}</div>}
          {c.notes && <div><span>Σημειώσεις</span><span style={{ whiteSpace: "pre-wrap" }}>{c.notes}</span></div>}
          {canEdit && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>✏️ Επεξεργασία στοιχείων</summary>
              <form action={updateCustomerInfo} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="version" value={c.version} />
                <div className="grid2">
                  <label>Επωνυμία (τιμολόγηση)<input name="legal_name" defaultValue={c.legal_name ?? ""} /></label>
                  <label>Κατηγορία<input name="category" defaultValue={c.category ?? ""} placeholder="π.χ. Εστίαση – καφέ" /></label>
                  <label>ΑΦΜ<input name="afm" inputMode="numeric" defaultValue={c.afm ?? ""} /></label>
                  <label>ΔΟΥ<input name="doy" defaultValue={c.doy ?? ""} /></label>
                  <label>Τηλέφωνο<input name="phone" type="tel" defaultValue={c.phone ?? ""} /></label>
                  <label>Email (γενικό)<input name="email" type="email" defaultValue={c.email ?? ""} /></label>
                  <label>Site<input name="website" defaultValue={c.website ?? ""} /></label>
                  <label>Διεύθυνση<input name="address" defaultValue={c.address ?? ""} /></label>
                  <label>Facebook<input name="facebook" defaultValue={c.facebook ?? ""} /></label>
                  <label>Instagram<input name="instagram" defaultValue={c.instagram ?? ""} placeholder="@onoma" /></label>
                </div>
                <label>Σημειώσεις<textarea name="notes" defaultValue={c.notes ?? ""} /></label>
                <div><SubmitButton>Αποθήκευση</SubmitButton></div>
              </form>
            </details>
          )}
        </div>
        <PeopleCard people={people} customerId={c.id} back={`/customers/${c.id}`} canEdit={canEdit} />
      </div>

      {parent && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}><h2 className="grow" style={{ margin: 0 }}>Πρόσωπα του Group {parent.display_name}</h2><Link href={`/customers/${parent.id}`} style={{ fontSize: 13, fontWeight: 700 }}>Άνοιγμα Group ›</Link></div>
          {groupPeople.length === 0 && <p className="muted" style={{ margin: 0 }}>Δεν έχουν μπει πρόσωπα στο Group. Λογιστήριο, marketing κ.λπ. που ισχύουν για όλα τα brands, βάλ' τα εκεί.</p>}
          <div className="people">
            {groupPeople.map((p) => (
              <div key={p.id} className="person">
                <strong>{p.name ?? p.email}</strong> <span className="muted">{p.title ?? ""}</span>
                <div className="person-links">
                  {p.mobile && <a href={`tel:${p.mobile}`}>📱 {p.mobile}</a>}
                  {p.phone && <a href={`tel:${p.phone}`}>☎ {p.phone}</a>}
                  {p.email && <a href={`mailto:${p.email}`}>✉ {p.email}</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {isAdmin && !c.is_group && (
        <div className="card">
          <h2>Group</h2>
          {parent ? (
            <form action={leaveGroupAction} className="row">
              <input type="hidden" name="id" value={c.id} />
              <span className="grow">Brand του Group <strong>{parent.display_name}</strong>.</span>
              <SubmitButton className="secondary">Βγάλ' το από το Group</SubmitButton>
            </form>
          ) : (
            <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p className="muted" style={{ margin: 0 }}>Αν η επιχείρηση ανήκει σε μεγαλύτερη εταιρεία ή ο ιδιοκτήτης έχει κι άλλα μαγαζιά, βάλ' την σε Group.</p>
              <form action={setGroupAction} className="row">
                <input type="hidden" name="ids" value={c.id} />
                <input type="hidden" name="back" value={`/customers/${c.id}`} />
                <select name="group_id" defaultValue="" className="grow">
                  <option value="">Νέο Group…</option>
                  {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.display_name}</option>)}
                </select>
                <input name="new_name" placeholder="Όνομα νέου Group" />
                <SubmitButton className="secondary">Μέσα στο Group</SubmitButton>
              </form>
              <form action={makeGroupAction}>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton className="secondary">Αυτός ο πελάτης είναι Group (έχει brands από κάτω)</SubmitButton>
              </form>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {tab === "activity" && (
        <>
      <div className="card">
        <h2>Εργασίες</h2>
        <TaskList tasks={openTasks} back={`/customers/${c.id}`} showTarget={false} showOwner />
        <div style={{ marginTop: 10 }}><NewTaskForm back={`/customers/${c.id}`} customerId={c.id} people={await assignees(supabase, isAdmin, profile.id)} /></div>
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

      {custProps.length > 0 && (
        <div className="card">
          <h2>Προτάσεις ({custProps.length})</h2>
          <div className="list">
            {custProps.map((p) => (
              <Link key={p.id} href={`/leads/${p.lead_id}/proposal/${p.id}`} className="item">
                <div className="grow"><strong>{p.title}</strong> {p.sent_at && <span className="badge gray">🔒 Στάλθηκε</span>} <span className="muted">· {p.code} · {dateGr(p.created_at)}{p.stations.length ? ` · ${p.stations.join(" · ")}` : ""}</span></div>
                <span className="badge">{eur(p.total)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

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

        </>
      )}

      {tab === "history" && (
        <>
      {!revOk && <p className="muted">🔒 Το ιστορικό τιμολόγησης ανοίγει με έγκριση. Η «Τελευταία καμπάνια» επάνω δείχνει πότε έπαιξε τελευταία φορά.</p>}
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
        <div className="row">
          <h2 className="grow">Τιμολόγηση (αρχείο)</h2>
          {!sp.all && <Link href={`/customers/${id}?tab=history&all=1`}>Όλο το ιστορικό</Link>}
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
      {raw.length > 0 && (
        <div className="card">
          <h2>Όπως είναι γραμμένος στην τιμολόγηση</h2>
          <p className="muted" style={{ marginTop: -4 }}>Οι εγγραφές του Excel που έχουν ενωθεί σε αυτόν τον πελάτη. Αν κάτι δεν ταιριάζει, διόρθωσε το όνομα (✏️) ή χώρισέ το από το Merge.</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Όνομα στο Excel</th><th>Account Executive</th><th>Agent</th><th>Περίοδος</th><th className="num">Γραμμές</th><th className="num">Ποσό</th></tr></thead>
              <tbody>
                {raw.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.name}</strong></td><td>{r.acc ?? "—"}</td><td>{r.agent ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{periodGr(r.first)}{r.first !== r.last ? ` – ${periodGr(r.last)}` : ""}</td>
                    <td className="num">{r.n}</td><td className="num">{eur(r.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

        </>
      )}
    </main>
  );
}
