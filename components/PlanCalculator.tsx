"use client";

import { useMemo, useState } from "react";

type Rate = { station: string; local_per_k: number; direct_per_k: number };
type Slot = { station: string; slot: string; listeners_k: number; sort: number };
type Counts = { wd: number; sat: number; sun: number };

const eur = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
const MONTH = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];

// Πόσες καθημερινές, Σάββατα, Κυριακές έχει ένας μήνας
function daysOf(year: number, month: number) {
  const n = new Date(year, month + 1, 0).getDate();
  let wd = 0, sat = 0, sun = 0;
  for (let d = 1; d <= n; d++) {
    const w = new Date(year, month, d).getDay();
    if (w === 6) sat++; else if (w === 0) sun++; else wd++;
  }
  return { wd, sat, sun };
}

const toInt = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 0;
};

export function PlanCalculator({ rates, slots, defaultStart }: { rates: Rate[]; slots: Slot[]; defaultStart: string }) {
  const [station, setStation] = useState(rates[0]?.station ?? "ΣΟΚ FM");
  const [type, setType] = useState<"local" | "direct">("local");
  const [sec, setSec] = useState("30");
  const [start, setStart] = useState(defaultStart);
  const [months, setMonths] = useState("1");
  const [plan, setPlan] = useState<Record<string, Record<string, Counts>>>({});

  const rate = rates.find((r) => r.station === station);
  const perK = rate ? (type === "local" ? rate.local_per_k : rate.direct_per_k) : 0;
  const rows = slots.filter((s) => s.station === station).sort((a, b) => a.sort - b.sort);
  const cur = plan[station] ?? {};
  const seconds = Math.max(1, Math.min(120, parseInt(sec, 10) || 30));
  const nMonths = Math.max(1, Math.min(24, parseInt(months, 10) || 1));

  const set = (slot: string, k: keyof Counts, v: string) =>
    setPlan((p) => ({ ...p, [station]: { ...(p[station] ?? {}), [slot]: { ...{ wd: 0, sat: 0, sun: 0 }, ...(p[station]?.[slot] ?? {}), [k]: toInt(v) } } }));

  // Γρήγορο γέμισμα: ίδιος αριθμός σποτ σε όλες τις ημέρες ενός μισάωρου
  const fillEvery = (slot: string, n: number) =>
    setPlan((p) => ({ ...p, [station]: { ...(p[station] ?? {}), [slot]: { wd: n, sat: n, sun: n } } }));

  const result = useMemo(() => {
    const [y, m] = start.split("-").map(Number);
    const perMonth: { label: string; spots: number; cost: number }[] = [];
    for (let i = 0; i < nMonths; i++) {
      const d = new Date(y || new Date().getFullYear(), (m || 1) - 1 + i, 1);
      const days = daysOf(d.getFullYear(), d.getMonth());
      let spots = 0, cost = 0;
      for (const r of rows) {
        const c = cur[r.slot];
        if (!c) continue;
        const n = c.wd * days.wd + c.sat * days.sat + c.sun * days.sun;
        spots += n;
        cost += n * r.listeners_k * perK * seconds;
      }
      perMonth.push({ label: `${MONTH[d.getMonth()]} ${d.getFullYear()}`, spots, cost });
    }
    const spots = perMonth.reduce((a, x) => a + x.spots, 0);
    const cost = perMonth.reduce((a, x) => a + x.cost, 0);
    return { perMonth, spots, cost, totalSec: spots * seconds };
  }, [start, nMonths, rows, cur, perK, seconds]);

  const spotPrice = (k: number) => k * perK * seconds;

  return (
    <div className="stack">
      <div className="card grid2">
        <label>Σταθμός
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            {rates.map((r) => <option key={r.station}>{r.station}</option>)}
          </select>
        </label>
        <label>Τιμή
          <select value={type} onChange={(e) => setType(e.target.value as "local" | "direct")}>
            <option value="local">Τοπικός πελάτης</option>
            <option value="direct">Direct μεγάλος πελάτης</option>
          </select>
        </label>
        <label>Διάρκεια σποτ (δευτερόλεπτα)<input inputMode="numeric" value={sec} onChange={(e) => setSec(e.target.value)} /></label>
        <label>Έναρξη<input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Μήνες<input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></label>
        <div className="muted" style={{ alignSelf: "end", fontSize: 13 }}>
          Τιμή σποτ = ακροατές (χιλ.) × {perK.toLocaleString("el-GR")} € × {seconds}&apos;&apos;. Χωρίς ΦΠΑ, χωρίς εκπτώσεις.
        </div>
      </div>

      <div className="card" style={{ position: "sticky", top: 0, zIndex: 2 }}>
        <div className="row" style={{ gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Σύνολο</div><div style={{ fontSize: 24, fontWeight: 800 }}>{eur(result.cost)}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Σποτ</div><div style={{ fontSize: 18, fontWeight: 700 }}>{result.spots.toLocaleString("el-GR")}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Μέση τιμή σποτ</div><div style={{ fontSize: 18, fontWeight: 700 }}>{result.spots ? eur(result.cost / result.spots) : "—"}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Μέση τιμή / sec</div><div style={{ fontSize: 18, fontWeight: 700 }}>{result.totalSec ? (result.cost / result.totalSec).toLocaleString("el-GR", { maximumFractionDigits: 4 }) + " €" : "—"}</div></div>
          <button type="button" className="secondary" onClick={() => setPlan((p) => ({ ...p, [station]: {} }))}>Καθάρισμα</button>
        </div>
        {nMonths > 1 && result.spots > 0 && (
          <table className="table" style={{ marginTop: 8, fontSize: 13 }}>
            <tbody>
              {result.perMonth.map((x) => (
                <tr key={x.label}><td>{x.label}</td><td style={{ textAlign: "right" }}>{x.spots} σποτ</td><td style={{ textAlign: "right" }}>{eur(x.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <p className="muted" style={{ marginTop: 0 }}>Γράψε πόσα σποτ την ημέρα θέλεις σε κάθε μισάωρο. Τα κουμπιά 1 / 2 βάζουν τον ίδιο αριθμό σε όλες τις ημέρες.</p>
        <table className="table">
          <thead>
            <tr><th>Ώρα</th><th style={{ textAlign: "right" }}>Ακροατές</th><th style={{ textAlign: "right" }}>Τιμή σποτ</th><th>Δευ–Παρ</th><th>Σάββατο</th><th>Κυριακή</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = cur[r.slot] ?? { wd: 0, sat: 0, sun: 0 };
              const on = c.wd + c.sat + c.sun > 0;
              return (
                <tr key={r.slot} style={on ? { background: "var(--brand-bg)" } : undefined}>
                  <td><strong>{r.slot}</strong></td>
                  <td style={{ textAlign: "right" }}>{r.listeners_k.toLocaleString("el-GR")}.000</td>
                  <td style={{ textAlign: "right" }}>{eur(spotPrice(r.listeners_k))}</td>
                  {(["wd", "sat", "sun"] as const).map((k) => (
                    <td key={k}>
                      <input aria-label={`${r.slot} ${k}`} inputMode="numeric" style={{ width: 56 }} value={c[k] || ""} placeholder="0" onChange={(e) => set(r.slot, k, e.target.value)} />
                    </td>
                  ))}
                  <td className="row" style={{ gap: 4 }}>
                    <button type="button" className="secondary" onClick={() => fillEvery(r.slot, 1)}>1</button>
                    <button type="button" className="secondary" onClick={() => fillEvery(r.slot, 2)}>2</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
