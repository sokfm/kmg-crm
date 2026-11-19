import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchRevenue, type RevRow } from "@/lib/revenue";
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
    supabase.from("profiles").select("id, full_name"),
    supabase.from("agencies").select("id, name"),
    supabase.from("leads").select("status, expected_value").not("status", "in", "(won,lost)"),
  ]);

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
        <Table title={`Ανά πωλητή · ${ytdLabel}`} data={breakdown((r) => (r.owner_id ? names.get(r.owner_id) ?? "—" : "Χωρίς υπεύθυνο"))} />
        <Table title={`Ανά δρόμο πώλησης · ${ytdLabel}`} data={breakdown((r) => CHANNEL[r.channel] ?? r.channel)} />
        <Table
          title={`Media shops · ${ytdLabel}`}
          data={breakdown((r) => (r.agency_id ? agencyNames.get(r.agency_id) ?? "—" : "")).filter(([k]) => k)}
          link={(k) => (agencyId.get(k) ? `/agencies/${agencyId.get(k)}` : null)}
        />
      </div>

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
