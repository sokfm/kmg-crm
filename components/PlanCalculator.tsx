"use client";

import { useMemo, useState } from "react";

type Rate = { station: string; local_per_k: number; direct_per_k: number };
type Slot = { station: string; slot: string; listeners_k: number; sort: number };

const eur = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (n: number, d = 4) => n.toLocaleString("el-GR", { maximumFractionDigits: d });
const DOW = ["Κ", "Δ", "ΤΡ", "ΤΕ", "Π", "ΠΑ", "Σ"];
const MONTH = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
const MAX = 3; // μέγιστα σποτ ανά μισάωρο ανά ημέρα με το κλικ

type Grid = Record<string, number[]>; // μισάωρο → σποτ ανά ημέρα του μήνα

export function PlanCalculator({ rates, slots, defaultStart }: { rates: Rate[]; slots: Slot[]; defaultStart: string }) {
  const [station, setStation] = useState(rates[0]?.station ?? "ΣΟΚ FM");
  const [sec, setSec] = useState("30");
  const [start, setStart] = useState(defaultStart);
  const [product, setProduct] = useState("");
  const [grids, setGrids] = useState<Record<string, Grid>>({});

  const [y, m] = start.split("-").map(Number);
  const year = y || new Date().getFullYear();
  const month = (m || 1) - 1;
  const nDays = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: nDays }, (_, i) => new Date(year, month, i + 1).getDay());

  const rate = rates.find((r) => r.station === station) ?? { station, local_per_k: 0, direct_per_k: 0 };
  const rows = slots.filter((s) => s.station === station).sort((a, b) => a.sort - b.sort);
  const grid = grids[station] ?? {};
  const seconds = Math.max(1, Math.min(120, parseInt(sec, 10) || 30));
  const cell = (slot: string, d: number) => grid[slot]?.[d] ?? 0;

  const update = (fn: (g: Grid) => Grid) => setGrids((all) => ({ ...all, [station]: fn({ ...(all[station] ?? {}) }) }));
  const row = (g: Grid, slot: string) => Array.from({ length: 31 }, (_, d) => g[slot]?.[d] ?? 0);

  // Κλικ σε κελί: 0 → 1 → 2 → 3 → 0
  const bump = (slot: string, d: number) =>
    update((g) => { const r = row(g, slot); r[d] = (r[d] + 1) % (MAX + 1); g[slot] = r; return g; });
  // Κλικ στην ώρα: γεμίζει όλη τη γραμμή με 1 (ή την αδειάζει αν είναι γεμάτη)
  const fillRow = (slot: string) =>
    update((g) => { const r = row(g, slot); const full = r.slice(0, nDays).every((v) => v > 0); g[slot] = r.map((_, d) => (d < nDays ? (full ? 0 : 1) : 0)); return g; });
  // Κλικ στην ημέρα: γεμίζει/αδειάζει τη στήλη μόνο στις ώρες που ήδη έχουν σποτ (αλλιώς σε όλες)
  const fillCol = (d: number) =>
    update((g) => {
      const used = rows.filter((r) => row(g, r.slot).some((v) => v > 0));
      const target = used.length ? used : rows;
      const full = target.every((r) => (g[r.slot]?.[d] ?? 0) > 0);
      for (const r of target) { const a = row(g, r.slot); a[d] = full ? 0 : Math.max(1, a[d]); g[r.slot] = a; }
      return g;
    });
  // Μόνο Δευτέρα–Παρασκευή στις ώρες που έχουν σποτ
  const weekdaysOnly = () =>
    update((g) => { for (const r of rows) { const a = row(g, r.slot); if (a.some((v) => v > 0)) g[r.slot] = a.map((v, d) => (d < nDays && days[d] !== 0 && days[d] !== 6 ? Math.max(v, 1) : 0)); } return g; });

  const t = useMemo(() => {
    let spots = 0, local = 0, direct = 0;
    const perDay = Array(nDays).fill(0);
    const perRow: Record<string, { n: number; local: number; direct: number }> = {};
    for (const r of rows) {
      let n = 0;
      for (let d = 0; d < nDays; d++) { const v = grid[r.slot]?.[d] ?? 0; n += v; perDay[d] += v; }
      const l = n * r.listeners_k * rate.local_per_k * seconds;
      const dr = n * r.listeners_k * rate.direct_per_k * seconds;
      perRow[r.slot] = { n, local: l, direct: dr };
      spots += n; local += l; direct += dr;
    }
    return { spots, local, direct, perDay, perRow };
  }, [rows, grid, nDays, rate, seconds]);

  const totalSec = t.spots * seconds;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const S = { cell: { width: 26, minWidth: 26, padding: 0, textAlign: "center" as const, borderLeft: "1px solid #eee", cursor: "pointer", userSelect: "none" as const, fontSize: 12 } };

  return (
    <div className="stack">
      <div className="card grid2">
        <label>Προϊόν / πελάτης<input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="π.χ. JUMBO – Χριστούγεννα" /></label>
        <label>Σταθμός
          <select value={station} onChange={(e) => setStation(e.target.value)}>{rates.map((r) => <option key={r.station}>{r.station}</option>)}</select>
        </label>
        <label>Διάρκεια σποτ (sec)<input inputMode="numeric" value={sec} onChange={(e) => setSec(e.target.value)} /></label>
        <label>Μήνας<input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", padding: "10px 12px", borderBottom: "1px solid #eee", alignItems: "center" }}>
          <strong>{station} · {MONTH[month]} {year}{product ? ` · ${product}` : ""}</strong>
          <span className="muted" style={{ fontSize: 12 }}>Κλικ σε κελί: 0→1→2→3 · κλικ στην ώρα: όλη η γραμμή · κλικ στην ημέρα: όλη η στήλη</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={weekdaysOnly}>Μόνο Δευ–Παρ</button>
          <button type="button" className="secondary" onClick={() => update(() => ({}))}>Καθάρισμα</button>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ fontSize: 12, borderCollapse: "separate", borderSpacing: 0, width: "max-content" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff" }}>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3, minWidth: 54 }}>ΩΡΑ</th>
                <th title="Ακροατές σε χιλιάδες">ΑΚΡ. 000</th>
                <th>LOCAL €/sec</th>
                <th>DIRECT €/sec</th>
                <th>ΑΡΙΘ. ΜΕΤΑΔ.</th>
                {days.map((w, d) => (
                  <th key={d} onClick={() => fillCol(d)} style={{ ...S.cell, background: w === 0 || w === 6 ? "#f6f3f8" : "#fff", lineHeight: 1.1 }}>
                    {d + 1}<br /><span className="muted" style={{ fontWeight: 500 }}>{DOW[w]}</span>
                  </th>
                ))}
                <th style={{ textAlign: "right" }}>LOCAL €</th>
                <th style={{ textAlign: "right" }}>DIRECT €</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pr = t.perRow[r.slot];
                return (
                  <tr key={r.slot} style={pr?.n ? { background: "var(--brand-bg)" } : undefined}>
                    <td onClick={() => fillRow(r.slot)} style={{ position: "sticky", left: 0, background: pr?.n ? "#fbe7f8" : "#fff", fontWeight: 700, cursor: "pointer", zIndex: 1 }}>{r.slot}</td>
                    <td style={{ textAlign: "right" }}>{num(r.listeners_k, 2)}</td>
                    <td style={{ textAlign: "right" }}>{num(r.listeners_k * rate.local_per_k)}</td>
                    <td style={{ textAlign: "right" }}>{num(r.listeners_k * rate.direct_per_k)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{pr?.n || ""}</td>
                    {days.map((w, d) => {
                      const v = cell(r.slot, d);
                      return (
                        <td key={d} onClick={() => bump(r.slot, d)}
                          style={{ ...S.cell, height: 22, fontWeight: 700, background: v ? "var(--brand-grad)" : w === 0 || w === 6 ? "#faf8fb" : undefined, color: v ? "#0b0a0d" : undefined }}>
                          {v || ""}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "right", paddingLeft: 10 }}>{pr?.n ? eur(pr.local) : ""}</td>
                    <td style={{ textAlign: "right", paddingLeft: 10 }}>{pr?.n ? eur(pr.direct) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot style={{ position: "sticky", bottom: 0, background: "#fff", fontWeight: 800, zIndex: 2 }}>
              <tr>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3, borderTop: "2px solid #ddd" }}>TOTAL</td>
                <td /><td /><td />
                <td style={{ textAlign: "right" }}>{t.spots || ""}</td>
                {t.perDay.map((v, d) => <td key={d} style={{ ...S.cell, cursor: "default" }}>{v || ""}</td>)}
                <td style={{ textAlign: "right", paddingLeft: 10 }}>{eur(t.local)} €</td>
                <td style={{ textAlign: "right", paddingLeft: 10 }}>{eur(t.direct)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid2">
        {(["LOCAL", "DIRECT"] as const).map((kind) => {
          const month1 = kind === "LOCAL" ? t.local : t.direct;
          return (
            <div key={kind} className="card">
              <h3 style={{ marginTop: 0 }}>{kind === "LOCAL" ? "Τοπικός πελάτης" : "Direct μεγάλος πελάτης"}</h3>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>ΜΗΝΕΣ</th><th style={{ textAlign: "right" }}>ΣΠΟΤ</th><th style={{ textAlign: "right" }}>ΤΙΜΗ €</th><th style={{ textAlign: "right" }}>AVG SPOT</th><th style={{ textAlign: "right" }}>AVG SEC</th></tr></thead>
                <tbody>
                  {months.map((n) => (
                    <tr key={n}>
                      <td>{n}</td>
                      <td style={{ textAlign: "right" }}>{(t.spots * n).toLocaleString("el-GR")}</td>
                      <td style={{ textAlign: "right" }}>{eur(month1 * n)}</td>
                      <td style={{ textAlign: "right" }}>{t.spots ? eur(month1 / t.spots) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{totalSec ? num(month1 / totalSec) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Τιμές χωρίς ΦΠΑ και χωρίς εκπτώσεις. Οι μήνες επαναλαμβάνουν το πλάνο του μήνα που βλέπεις, όπως στο Excel. Συνολικά δευτερόλεπτα μήνα: {totalSec.toLocaleString("el-GR")}.
      </p>
    </div>
  );
}
