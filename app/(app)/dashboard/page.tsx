import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchRevenue, type RevRow } from "@/lib/revenue";
import { proposalByMonth, ymLabel, type FItem } from "@/lib/forecast";
import { requireProfile } from "@/lib/auth";
import { CHANNEL, eur, today } from "@/lib/format";

type Row = RevRow;

const MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιούν", "Ιούλ", "Αύγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const MONTHS_FULL = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="muted">πέρσι: —</span>;
  const d = ((cur - prev) / prev) * 100;
  return (
    <span className={`delta ${d >= 0 ? "up" : "down"}`}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}% <span className="muted" style={{ fontWeight: 400 }}>πέρσι {eur(prev)}</span>
    </span>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  // Μόνο Νίκος και Γιάννα (ceo / sales manager)
  if (!isAdmin) redirect("/today");
  const t = today();
  const nowY = Number(t.slice(0, 4));
  const nowM = Number(t.slice(5, 7));
  const Y = Number(sp.y) || nowY;
  // Για προηγούμενο έτος, «μέχρι τώρα» = ολόκληρο το έτος
  const upTo = Y === nowY ? nowM : 12;

  const [rows, { data: yearly }, { data: people }, { data: agencies }, { data: open }] = await Promise.all([
    fetchRevenue(supabase, [Y, Y - 1]),
    supabase.from("revenue_yearly").select("year, amount").order("year"),
    supabase.from("profiles").select("id, full_name, role"),
    supabase.from("agencies").select("id, name"),
    supabase.from("leads").select("status, expected_value").not("status", "in", "(won,lost)"),
  ]);

  // Πρόβλεψη τζίρου από τις κύριες προτάσεις: κλεισμένα (κερδισμένα leads) και ανοιχτά (ακόμα στο pipeline), ξεχωριστά
  const [{ data: mainProps }, { data: propTotals }] = await Promise.all([
    supabase.from("proposals").select("id, lead_id, leads!inner(status), proposal_items(monthly_amount, long_months, long_amount, months, start_date, confirmed_start)").eq("is_main", true),
    supabase.from("proposal_totals").select("proposal_id, final_total"),
  ]);
  // Τιμολόγηση από το Excel: πότε διαβάστηκε τελευταία, τι περιμένει απάντηση, και ποια κερδισμένα leads υπάρχουν ήδη στο Excel
  const [{ data: billLog }, { count: billNames }, { data: billHints }, { data: billed }] = await Promise.all([
    supabase.from("billing_sync_log").select("ran_at, ok").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("billing_names").select("name_key", { count: "exact", head: true }).is("customer_id", null),
    supabase.from("history_lines").select("customer_id, lead_hint").not("lead_hint", "is", null).is("origin", null).eq("source_scope", "monthly_billing"),
    supabase.from("history_lines").select("lead_id").not("lead_id", "is", null).eq("source_scope", "monthly_billing"),
  ]);
  const billedLeads = new Set((billed ?? []).map((x) => x.lead_id as string));
  const billQuestions = (billNames ?? 0) + new Set((billHints ?? []).map((x) => `${x.customer_id}|${x.lead_hint}`)).size;
  const finalOf = new Map((propTotals ?? []).map((x) => [x.proposal_id as string, Number(x.final_total)]));
  const fMonths = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(nowY, nowM - 1 + i, 1)); return d.toISOString().slice(0, 7); });
  const fc = new Map(fMonths.map((ym) => [ym, { won: 0, open: 0 }]));
  const fcUndated = { won: 0, open: 0 }, fcLater = { won: 0, open: 0 };
  let wonUnconfirmed = 0;
  for (const p of (mainProps ?? []) as unknown as { id: string; lead_id: string; leads: { status: string }; proposal_items: FItem[] }[]) {
    const st = p.leads?.status;
    if (st === "lost" || !p.proposal_items?.length) continue;
    // Κερδισμένο που έχει ήδη γραμμές στο Excel: μετράει ο πραγματικός τζίρος, όχι η πρόβλεψη (αλλιώς τα ίδια λεφτά δύο φορές)
    if (st === "won" && billedLeads.has(p.lead_id)) continue;
    const k = st === "won" ? "won" : "open";
    const r = proposalByMonth(p.proposal_items, finalOf.get(p.id) ?? 0, { open: k === "open", today: t });
    fcUndated[k] += r.undated;
    if (k === "won") wonUnconfirmed += r.unconfirmed;
    for (const m of r.months) { const e = fc.get(m.ym); if (e) e[k] += m.amount; else if (m.ym > fMonths[5]) fcLater[k] += m.amount; }
  }
  const hasForecast = [...fc.values()].some((v) => v.won || v.open) || fcUndated.won + fcUndated.open + fcLater.won + fcLater.open > 0;

  const sum = (f: (r: Row) => boolean) => rows.reduce((s, r) => (f(r) ? s + Number(r.amount) : s), 0);
  const month = (y: number, m: number) => sum((r) => r.year === y && r.month === m);
  const ytd = (y: number) => sum((r) => r.year === y && r.month <= upTo);
  const booked = Y === nowY ? sum((r) => r.year === Y && r.month > nowM) : 0;
  const pipeValue = (open ?? []).reduce((s, l) => s + Number(l.expected_value ?? 0), 0);

  const chart = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, cur: month(Y, i + 1), prev: month(Y - 1, i + 1) }));
  const max = Math.max(1, ...chart.flatMap((c) => [c.cur, c.prev]));

  // Πίνακες «από αρχή έτους μέχρι τώρα» σε σύγκριση με το ίδιο διάστημα πέρσι
  function breakdown(key: (r: Row) => string) {
    const m = new Map<string, { cur: number; prev: number }>();
    for (const r of rows) {
      if (r.month > upTo) continue;
      const k = key(r);
      const e = m.get(k) ?? { cur: 0, prev: 0 };
      if (r.year === Y) e.cur += Number(r.amount); else e.prev += Number(r.amount);
      m.set(k, e);
    }
    return [...m.entries()].filter(([, v]) => v.cur || v.prev).sort((a, b) => b[1].cur - a[1].cur);
  }
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  // Γιατί χάνουμε: χαμένα leads της χρονιάς ανά είδος «όχι» και ανά Account Executive
  const { data: lostRows } = await supabase.from("leads").select("lost_kind, owner_id, expected_value, reknock_on").eq("status", "lost").gte("closed_at", `${Y}-01-01`).lt("closed_at", `${Y + 1}-01-01`);
  const lost = (lostRows ?? []) as { lost_kind: string | null; owner_id: string | null; expected_value: number | null; reknock_on: string | null }[];
  const LOSTK: [string, string][] = [["not_now", "Όχι τώρα"], ["no_budget", "Όχι budget"], ["competitor", "Πήγε σε άλλον σταθμό"], ["never", "Όχι ποτέ"]];
  const lostOwners = [...new Set(lost.map((l) => l.owner_id ?? ""))].sort((a, b) => (names.get(a) ?? "ω").localeCompare(names.get(b) ?? "ω"));
  const lostVal = (f: (l: (typeof lost)[number]) => boolean) => lost.filter(f).reduce((s, l) => s + Number(l.expected_value ?? 0), 0);
  // Πελάτες χωρίς υπεύθυνο (π.χ. της βάσης, παλιών πωλητών) μετράνε στον Νίκο
  const ceoId = (people ?? []).find((p) => p.role === "ceo")?.id;
  const agencyNames = new Map((agencies ?? []).map((a) => [a.id, a.name]));
  const totalCur = ytd(Y);

  const Table = ({ title, data, link }: { title: string; data: [string, { cur: number; prev: number }][]; link?: (k: string) => string | null }) => (
    <div className="card">
      <h2>{title}</h2>
      <table>
        <thead><tr><th></th><th className="num">{Y}</th><th className="num">{Y - 1}</th><th className="num">Διαφορά</th></tr></thead>
        <tbody>
          {data.map(([k, v]) => {
            const d = v.prev ? ((v.cur - v.prev) / v.prev) * 100 : null;
            const href = link?.(k);
            return (
              <tr key={k}>
                <td>
                  {href ? <Link href={href}>{k}</Link> : k}
                  <div className="share"><span style={{ width: `${totalCur ? Math.max(0, (v.cur / totalCur) * 100) : 0}%` }} /></div>
                </td>
                <td className="num"><strong>{eur(v.cur)}</strong></td>
                <td className="num muted">{eur(v.prev)}</td>
                <td className={`num delta ${d == null ? "" : d >= 0 ? "up" : "down"}`}>{d == null ? "νέο" : `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const years = (yearly ?? []).map((y) => Number(y.year)).filter((y) => y <= nowY);
  const yMax = Math.max(1, ...(yearly ?? []).map((y) => Number(y.amount)));
  const ytdLabel = upTo === 12 ? `Όλο το ${Y}` : `Ιαν – ${MONTHS[upTo - 1]} ${Y}`;
  const agencyId = new Map((agencies ?? []).map((a) => [a.name, a.id]));

  return (
    <main className="wrap wide">
      <div className="row">
        <h1 className="grow">Dashboard</h1>
        {years.slice(-6).map((y) => (
          <Link key={y} href={`/dashboard?y=${y}`} className={`badge ${y === Y ? "" : "gray"}`}>{y}</Link>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Τζίρος από το αρχείο τιμολόγησης (ποσά όπως είναι στο αρχείο).
      </p>

      <div className="kpis">
        {Y === nowY && (
          <div className="card">
            <div className="muted">{MONTHS_FULL[nowM - 1]} {Y}</div>
            <div className="kpi">{eur(month(Y, nowM))}</div>
            <Delta cur={month(Y, nowM)} prev={month(Y - 1, nowM)} />
          </div>
        )}
        <div className="card">
          <div className="muted">{ytdLabel}</div>
          <div className="kpi">{eur(ytd(Y))}</div>
          <Delta cur={ytd(Y)} prev={ytd(Y - 1)} />
        </div>
        {Y === nowY && (
          <div className="card">
            <div className="muted">Κλεισμένα για τους επόμενους μήνες</div>
            <div className="kpi">{eur(booked)}</div>
            <span className="muted">καμπάνιες ήδη στο αρχείο μετά τον {MONTHS[nowM - 1]}</span>
          </div>
        )}
        <div className="card">
          <div className="muted">Pipeline (ανοιχτά deals)</div>
          <div className="kpi">{(open ?? []).length}</div>
          <Link href="/pipeline" className="muted">εκτιμώμενη αξία {eur(pipeValue)} ›</Link>
        </div>
      </div>

      {Y === nowY && (
        <div className="card">
          <div className="row">
            <div className="grow">
              <div className="muted">{MONTHS_FULL[nowM - 1]}: από πού ήρθε ο τζίρος</div>
              <div><strong>{eur(sum((r) => r.year === Y && r.month === nowM && r.from_lead))}</strong> από leads του CRM · <strong>{eur(sum((r) => r.year === Y && r.month === nowM && !r.from_lead))}</strong> εκτός CRM</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Εκτός CRM = εντολές πρακτορείων, ανανεώσεις και ό,τι μπήκε στο Excel χωρίς lead.
                {" "}Excel: {billLog ? `τελευταία ενημέρωση ${new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(new Date(billLog.ran_at))}` : "δεν έχει διαβαστεί ακόμα από το Dropbox"}
                {billLog && !billLog.ok && <span className="late-txt"> · κάτι δεν διαβάστηκε</span>}
              </div>
            </div>
            <Link href="/billing" className={`badge ${billQuestions ? "late" : "gray"}`}>{billQuestions ? `${billQuestions} ερωτήσεις ›` : "Τιμολόγηση ›"}</Link>
          </div>
        </div>
      )}

      {Y === nowY && hasForecast && (
        <div className="card">
          <h2>Προβλεπόμενος τζίρος από προτάσεις</h2>
          <p className="muted" style={{ marginTop: 0 }}>Από την κύρια πρόταση κάθε lead. Το ποσό σπάει στις ημέρες που παίζει κάθε μήνα. Τα ανοιχτά δεν είναι λεφτά ακόμα, γι' αυτό μένουν χωριστά.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Μήνας</th><th className="num">Κλεισμένα</th><th className="num">Ανοιχτά (pipeline)</th></tr></thead>
              <tbody>
                {fMonths.map((ym) => (
                  <tr key={ym}><td>{ymLabel(ym)}</td><td className="num"><strong>{eur(fc.get(ym)!.won)}</strong></td><td className="num muted">{eur(fc.get(ym)!.open)}</td></tr>
                ))}
                {fcLater.won + fcLater.open > 0 && <tr><td className="muted">Αργότερα</td><td className="num">{eur(fcLater.won)}</td><td className="num muted">{eur(fcLater.open)}</td></tr>}
                {fcUndated.won + fcUndated.open > 0 && <tr><td className="late-txt">Χωρίς ημερομηνία έναρξης</td><td className="num">{eur(fcUndated.won)}</td><td className="num muted">{eur(fcUndated.open)}</td></tr>}
              </tbody>
            </table>
          </div>
          {wonUnconfirmed > 0 && <p className="late-txt" style={{ marginBottom: 0 }}>{eur(wonUnconfirmed)} από τα κλεισμένα μετράνε με την έναρξη της προσφοράς, γιατί δεν έχει μπει ακόμα επιβεβαιωμένη έναρξη.</p>}
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>Ανοιχτά με έναρξη που έχει ήδη περάσει μετράνε από σήμερα.</p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <h2 className="grow">Τζίρος ανά μήνα</h2>
          <span className="legend">
            <span><i style={{ background: "var(--blue)" }} />{Y}</span>
            <span><i style={{ background: "#d9d4de" }} />{Y - 1}</span>
            {Y === nowY && <span><i style={{ background: "#f3a6e8" }} />κλεισμένα (μελλοντικοί μήνες)</span>}
          </span>
        </div>
        <div className="chart">
          {chart.map((c) => (
            <div key={c.m} className="m" title={`${MONTHS[c.m - 1]}: ${eur(c.cur)} (πέρσι ${eur(c.prev)})`}>
              <div className="pair">
                <div className="prev" style={{ height: `${(c.prev / max) * 100}%` }} />
                <div className={`cur ${Y === nowY && c.m > nowM ? "future" : ""}`} style={{ height: `${(c.cur / max) * 100}%` }} />
              </div>
              <span className="lbl">{MONTHS[c.m - 1]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <Table title={`Ανά σταθμό · ${ytdLabel}`} data={breakdown((r) => r.station)} />
        <Table title={`Ανά Account Executive · ${ytdLabel}`} data={breakdown((r) => r.ae ?? names.get(r.owner_id ?? ceoId ?? "") ?? "—")} />
        <Table title={`Ανά δρόμο πώλησης · ${ytdLabel}`} data={breakdown((r) => CHANNEL[r.channel] ?? r.channel)} />
        <Table
          title={`Media shops · ${ytdLabel}`}
          data={breakdown((r) => (r.agency_id ? agencyNames.get(r.agency_id) ?? "—" : "")).filter(([k]) => k)}
          link={(k) => (agencyId.get(k) ? `/agencies/${agencyId.get(k)}` : null)}
        />
      </div>

      {lost.length > 0 && (
        <div className="card">
          <h2>Γιατί χάνουμε · {Y}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{lost.length === 1 ? "1 χαμένο lead" : `${lost.length} χαμένα leads`} · αξία που χάθηκε {eur(lostVal(() => true))} · {lost.filter((l) => l.reknock_on).length} έχουν ημερομηνία για να ξαναχτυπήσουμε την πόρτα.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Τι «όχι» ήταν</th><th className="num">Leads</th><th className="num">Αξία</th>{lostOwners.map((o) => <th key={o} className="num">{o ? (names.get(o) ?? "—").split(" ")[0] : "Χωρίς AE"}</th>)}</tr></thead>
              <tbody>
                {LOSTK.map(([k, label]) => {
                  const n = lost.filter((l) => l.lost_kind === k).length;
                  return (
                    <tr key={k}>
                      <td>{label}</td>
                      <td className="num"><strong>{n}</strong> <span className="muted">{lost.length ? `${Math.round((n / lost.length) * 100)}%` : ""}</span></td>
                      <td className="num">{eur(lostVal((l) => l.lost_kind === k))}</td>
                      {lostOwners.map((o) => <td key={o} className="num muted">{lost.filter((l) => l.lost_kind === k && (l.owner_id ?? "") === o).length || ""}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Τζίρος ανά έτος</h2>
        <div className="chart" style={{ height: 140 }}>
          {(yearly ?? []).filter((y) => Number(y.year) <= nowY).map((y) => (
            <div key={y.year} className="m" title={`${y.year}: ${eur(Number(y.amount))}`}>
              <div className="pair"><div className={`cur ${Number(y.year) === nowY ? "future" : ""}`} style={{ height: `${(Number(y.amount) / yMax) * 100}%` }} /></div>
              <span className="lbl">{String(y.year).slice(2)}</span>
            </div>
          ))}
        </div>
        <p className="muted">Το {nowY} περιλαμβάνει και ό,τι έχει ήδη κλειστεί για τους επόμενους μήνες.</p>
      </div>
    </main>
  );
}
