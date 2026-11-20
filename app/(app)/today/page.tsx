import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { STAGES, dateGr, eur, today } from "@/lib/format";
import { completeTask } from "../actions";
import { fetchRevenue, sumRev } from "@/lib/revenue";

type Lead = { id: string; company_name: string; status: string; next_step: string; next_step_due: string; phone: string | null; is_overdue: boolean; is_today: boolean };
type Task = { id: string; title: string; due_date: string | null; due_time: string | null; customer_id: string | null; lead_id: string | null; agency_id: string | null; customers: { display_name: string } | null; leads: { company_name: string; phone: string | null } | null; agencies: { name: string } | null };
type Item = { key: string; kind: "lead" | "task"; id: string; name: string; sub: string; chip: string; date: string | null; late: boolean; phone: string | null; href: string };

const MONTHS = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
const TINTS = [["#fde3f9", "#8a0d70"], ["#e3f1fd", "#1e4e8c"], ["#e6f6ec", "#1f6b3a"], ["#fdeadb", "#9a3412"], ["#eee8fb", "#5b3ba8"], ["#fdf3d6", "#7a5300"]];
const tint = (s: string) => TINTS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
const initials = (s: string) => s.replace(/[^A-Za-zΑ-Ωα-ωά-ώΆ-Ώ0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const Ico = ({ d }: { d: React.ReactNode }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const PHONE = <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />;
const CHECK = <path d="M5 12l5 5 9-10" />;

export default async function Today({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filter = ["late", "today"].includes(sp.f) ? sp.f : "all";
  const { supabase, profile, isAdmin, isCeo } = await requireProfile();
  const t = today();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const nowY = Number(t.slice(0, 4)), nowM = Number(t.slice(5, 7));

  const [{ data: myLeads }, { data: myTasks }, { data: openLeads }, { data: review }] = await Promise.all([
    supabase.from("my_today").select("id, company_name, status, next_step, next_step_due, phone, is_overdue, is_today").order("next_step_due"),
    supabase.from("tasks").select("id, title, due_date, due_time, customer_id, lead_id, agency_id, customers(display_name), leads(company_name, phone), agencies(name)")
      .eq("owner_id", profile.id).eq("status", "open").lte("due_date", tomorrow).order("due_date"),
    supabase.from("leads").select("id, status, owner_id, next_step_due").not("status", "in", "(won,lost)"),
    supabase.from("email_messages").select("id, subject, counterpart_name, counterpart_email, ai_kind").eq("status", "review").order("occurred_at", { ascending: false }).limit(2),
  ]);

  // Ώρες επόμενων βημάτων και αν ο χρήστης έχει ανάψει ειδοποιήσεις σε κάποια συσκευή
  const leadIds = ((myLeads ?? []) as Lead[]).map((l) => l.id);
  const [{ data: timeRows }, { count: devices }] = await Promise.all([
    leadIds.length ? supabase.from("leads").select("id, next_step_time").in("id", leadIds).not("next_step_time", "is", null) : Promise.resolve({ data: [] as { id: string; next_step_time: string }[] }),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
  ]);
  const times = new Map((timeRows ?? []).map((r) => [r.id as string, String(r.next_step_time).slice(0, 5)]));
  const at = (tm: string | null | undefined, text: string) => (tm ? `${tm.slice(0, 5)} · ${text}` : text);

  const items: Item[] = [
    ...((myLeads ?? []) as Lead[]).map((l) => ({
      key: "l" + l.id, kind: "lead" as const, id: l.id, name: l.company_name, sub: at(times.get(l.id), l.next_step), chip: STAGES[l.status]?.replace(/^\d\.\s*/, "") ?? "",
      date: l.next_step_due, late: l.is_overdue, phone: l.phone, href: `/leads/${l.id}`,
    })),
    ...((myTasks ?? []) as unknown as Task[]).map((k) => ({
      key: "t" + k.id, kind: "task" as const, id: k.id,
      name: k.customers?.display_name ?? k.leads?.company_name ?? (k.agencies ? `${k.agencies.name} (media shop)` : "Εργασία"),
      sub: at(k.due_time, k.title), chip: "Εργασία", date: k.due_date, late: !!k.due_date && k.due_date < t, phone: k.leads?.phone ?? null,
      href: k.customer_id ? `/customers/${k.customer_id}` : k.lead_id ? `/leads/${k.lead_id}` : k.agency_id ? `/agencies/${k.agency_id}` : "/tasks",
    })),
  ].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  const late = items.filter((i) => i.late);
  const todays = items.filter((i) => !i.late && i.date === t);
  const later = items.filter((i) => !i.late && i.date !== t);

  const open = openLeads ?? [];
  const stageCount = (s: string) => open.filter((l) => l.status === s).length;
  const stages = ["new", "contacted", "meeting", "proposal", "negotiation"].map((s) => ({ s, n: stageCount(s) }));
  const maxStage = Math.max(1, ...stages.map((x) => x.n));
  const mineOpen = open.filter((l) => l.owner_id === profile.id);

  // Μόνο για Νίκο / Γιάννα: τζίρος, εκκρεμότητες, ομάδα σήμερα
  let rev = { month: 0, monthPrev: 0, ytd: 0, ytdPrev: 0 };
  let team: { id: string; name: string; contacts: number; late: number }[] = [];
  let toAssign = 0, toApprove = 0, toMerge = 0;
  const toAccess = isAdmin ? (await supabase.from("customer_access").select("id", { count: "exact", head: true }).eq("status", "pending")).count ?? 0 : 0;
  if (isAdmin) {
    const [rows, a, m, c, acts, people] = await Promise.all([
      fetchRevenue(supabase, [nowY, nowY - 1]),
      supabase.from("leads").select("id", { count: "exact", head: true }).is("owner_id", null).not("status", "in", "(won,lost)"),
      supabase.from("merge_candidates").select("id", { count: "exact", head: true }).eq("decision", "pending"),
      isCeo ? supabase.from("base_claims").select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve({ count: 0 }),
      supabase.from("activities").select("user_id").eq("counts_as_contact", true).gte("occurred_at", t + "T00:00:00+02:00"),
      supabase.from("profiles").select("id, full_name").in("role", ["sales_manager", "account_exec"]).eq("active", true),
    ]);
    rev = {
      month: sumRev(rows, (r) => r.year === nowY && r.month === nowM),
      monthPrev: sumRev(rows, (r) => r.year === nowY - 1 && r.month === nowM),
      ytd: sumRev(rows, (r) => r.year === nowY && r.month <= nowM),
      ytdPrev: sumRev(rows, (r) => r.year === nowY - 1 && r.month <= nowM),
    };
    toAssign = a.count ?? 0; toMerge = m.count ?? 0; toApprove = c.count ?? 0;
    team = (people.data ?? []).map((p) => ({
      id: p.id, name: p.full_name.split(" ")[0],
      contacts: (acts.data ?? []).filter((x) => x.user_id === p.id).length,
      late: open.filter((l) => l.owner_id === p.id && l.next_step_due < t).length,
    }));
  }
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
  const Delta = ({ a, b }: { a: number; b: number }) => {
    const d = pct(a, b);
    return d == null ? <span className="muted">πέρσι: —</span> : <span className={`delta ${d >= 0 ? "up" : "down"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d)}% σε σχέση με πέρσι</span>;
  };

  const Row = ({ i }: { i: Item }) => {
    const [bg, fg] = tint(i.name);
    return (
      <div className={`day-row ${i.late ? "late" : ""}`}>
        <Link href={i.href} className="day-main">
          <span className="day-av" style={{ background: bg, color: fg }}>{initials(i.name) || "•"}</span>
          <span className="grow">
            <strong>{i.name}</strong>
            <span className="muted day-sub">{i.sub}</span>
          </span>
        </Link>
        <span className={`badge ${i.kind === "task" ? "gray" : ""} hide-s`}>{i.chip}</span>
        <span className={`day-date ${i.late ? "late-txt" : ""}`}>{i.date === t ? "Σήμερα" : i.date === tomorrow ? "Αύριο" : dateGr(i.date)}</span>
        {i.phone ? <a href={`tel:${i.phone}`} className="sq" aria-label={`Κλήση ${i.name}`}><Ico d={PHONE} /></a> : <span className="sq ghost" aria-hidden="true" />}
        {i.kind === "task" ? (
          <form action={completeTask}>
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="back" value="/today" />
            <input type="hidden" name="done" value="1" />
            <button type="submit" className="sq" aria-label="Ολοκληρώθηκε"><Ico d={CHECK} /></button>
          </form>
        ) : (
          <Link href={`${i.href}#log`} className="sq" aria-label="Κατέγραψε επαφή και επόμενο βήμα"><Ico d={CHECK} /></Link>
        )}
      </div>
    );
  };
  const shown = filter === "late" ? { late, todays: [], later: [] } : filter === "today" ? { late: [], todays, later: [] } : { late, todays, later };
  const longDate = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" }).format(new Date());

  return (
    <main className="wrap wide">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <div className="muted" style={{ textTransform: "capitalize" }}>{longDate}</div>
          <h1 style={{ margin: "2px 0 0" }}>{greeting()}, {vocative(profile.first_name ?? profile.full_name)}</h1>
        </div>
        <Link href="/pipeline" className="btn secondary">Pipeline</Link>
        <Link href="/leads/new" className="btn">+ Νέο lead</Link>
      </div>

      {(devices ?? 0) === 0 && (
        <Link href="/settings#push" className="msg" style={{ display: "block", background: "var(--orange-bg)", color: "inherit" }}>
          🔔 <strong>Άναψε τις υπενθυμίσεις στο κινητό σου</strong> για να μη χάνεις επόμενα βήματα και εργασίες. Ένα πάτημα →
        </Link>
      )}

      <div className="kpis">
        {isAdmin ? (
          <>
            <div className="card kpi-card"><span className="muted">{MONTHS[nowM - 1]}</span><span className="kpi">{eur(rev.month)}</span><Delta a={rev.month} b={rev.monthPrev} /></div>
            <div className="card kpi-card"><span className="muted">Ιαν – {MONTHS[nowM - 1].slice(0, 3)} {nowY}</span><span className="kpi">{eur(rev.ytd)}</span><Delta a={rev.ytd} b={rev.ytdPrev} /></div>
          </>
        ) : (
          <>
            <div className="card kpi-card"><span className="muted">Τα ανοιχτά σου deals</span><span className="kpi">{mineOpen.length}</span><span className="muted">{mineOpen.filter((l) => l.status === "proposal").length} σε πρόταση</span></div>
            <div className="card kpi-card"><span className="muted">Για σήμερα</span><span className="kpi">{todays.length}</span><span className="muted">βήματα και εργασίες</span></div>
          </>
        )}
        <Link href="/pipeline" className="card kpi-card" style={{ color: "inherit" }}>
          <span className="muted">Ανοιχτά deals</span><span className="kpi">{open.length}</span>
          <span className="muted">{stageCount("proposal")} περιμένουν απάντηση σε πρόταση</span>
        </Link>
        <Link href="/today?f=late" className={`card kpi-card ${late.length ? "hot" : ""}`} style={{ color: "inherit" }}>
          <span className="muted">Καθυστερούν</span><span className="kpi">{late.length}</span><span className="muted">με περασμένη ημερομηνία</span>
        </Link>
      </div>

      {isAdmin && (toAssign > 0 || toApprove > 0 || toMerge > 0 || toAccess > 0) && (
        <div className="row">
          {toAccess > 0 && <Link href="/access" className="badge late">🔑 {toAccess === 1 ? "1 αίτημα πρόσβασης σε πελάτη" : `${toAccess} αιτήματα πρόσβασης σε πελάτες`}</Link>}
          {toAssign > 0 && <Link href="/leads?view=unassigned" className="badge late">{toAssign === 1 ? "1 lead για ανάθεση" : `${toAssign} leads για ανάθεση`}</Link>}
          {toApprove > 0 && <Link href="/customers?status=base" className="badge late">{toApprove === 1 ? "1 αίτημα από τη βάση" : `${toApprove} αιτήματα από τη βάση`}</Link>}
          {toMerge > 0 && <Link href="/merges" className="badge gray">{toMerge} ομάδες πελατών για Merge</Link>}
        </div>
      )}

      <div className="today-cols">
        <section className="card day">
          <div className="day-head">
            <h2 className="grow" style={{ margin: 0 }}>Η μέρα σου</h2>
            <Link href="/today" className={`chip ${filter === "all" ? "on" : ""}`}>Όλα {items.length}</Link>
            <Link href="/today?f=late" className={`chip ${filter === "late" ? "on" : ""}`}>Καθυστερούν {late.length}</Link>
            <Link href="/today?f=today" className={`chip ${filter === "today" ? "on" : ""}`}>Σήμερα {todays.length}</Link>
          </div>
          {items.length === 0 && <p className="muted" style={{ padding: "18px" }}>Τίποτα για σήμερα και αύριο. Ώρα να ψάξεις στη <Link href="/customers?status=base">βάση πελατών</Link>.</p>}
          {shown.late.length > 0 && <div className="day-label late">ΚΑΘΥΣΤΕΡΟΥΝ</div>}
          {shown.late.map((i) => <Row key={i.key} i={i} />)}
          {shown.todays.length > 0 && <div className="day-label">ΣΗΜΕΡΑ</div>}
          {shown.todays.map((i) => <Row key={i.key} i={i} />)}
          {shown.later.length > 0 && <div className="day-label">ΑΥΡΙΟ</div>}
          {shown.later.map((i) => <Row key={i.key} i={i} />)}
        </section>

        <div className="today-side">
          <section className="card">
            <div className="row" style={{ marginBottom: 12 }}><h2 className="grow" style={{ margin: 0 }}>Pipeline</h2><Link href="/pipeline" style={{ fontWeight: 700, fontSize: 13 }}>Άνοιγμα</Link></div>
            <div className="stage-bars">
              {stages.map(({ s, n }) => (
                <Link key={s} href="/pipeline" className="stage-bar">
                  <span>{STAGES[s].replace(/^\d\.\s*/, "")}</span>
                  <span className="track"><span style={{ width: `${(n / maxStage) * 100}%` }} /></span>
                  <strong>{n}</strong>
                </Link>
              ))}
            </div>
          </section>

          {(review ?? []).length > 0 && (
            <section className="card">
              <div className="row" style={{ marginBottom: 10 }}><h2 className="grow" style={{ margin: 0 }}>Από το Outlook</h2><span className="badge">{(review ?? []).length}</span></div>
              <div className="list">
                {(review ?? []).map((e) => (
                  <Link key={e.id} href="/inbox" className="outlook-item">
                    <strong>{e.subject}</strong>
                    <span className="muted">{e.counterpart_name ?? e.counterpart_email} · περιμένει απόφαση</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {isAdmin && team.length > 0 && (
            <section className="card">
              <h2>Ομάδα σήμερα</h2>
              <div className="list" style={{ gap: 10 }}>
                {team.map((p) => {
                  const [bg, fg] = tint(p.name);
                  return (
                    <Link key={p.id} href={`/pipeline?who=${p.id}`} className="row" style={{ color: "inherit", flexWrap: "nowrap" }}>
                      <span className="day-av sm" style={{ background: bg, color: fg }}>{initials(p.name)}</span>
                      <span className="grow">{p.name}</span>
                      <span className="muted">{p.contacts === 1 ? "1 επαφή" : `${p.contacts} επαφές`}{p.late ? ` · ${p.late} καθυστερούν` : ""}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

// «Νίκος» → «Νίκο», «Κώστας» → «Κώστα» (κλητική)
function vocative(n: string) {
  const w = n.split(" ")[0];
  return /ος$/.test(w) ? w.replace(/ος$/, "ο") : /ας$|ης$/.test(w) ? w.slice(0, -1) : w;
}

// Χαιρετισμός με βάση την ώρα Ελλάδας (ο server της Vercel τρέχει σε ώρα UTC)
function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Athens" }).format(new Date()));
  if (h >= 5 && h < 12) return "Καλημέρα";
  if (h >= 12 && h < 18) return "Καλό απόγευμα";
  return "Καλησπέρα";
}
