"use client";

import { useMemo, useState } from "react";
import { PLAN_DAYS, secPrice, type Grid, type PriceCol, type Slot } from "@/lib/pricing";
import { savePlanItem } from "@/app/(app)/proposal-actions";
import { SubmitButton } from "@/components/SubmitButton";

const eur = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (n: number, d = 4) => n.toLocaleString("el-GR", { maximumFractionDigits: d });
const DOW = ["Κ", "Δ", "ΤΡ", "ΤΕ", "Π", "ΠΑ", "Σ"];
const MAX = 3; // μέγιστα σποτ ανά break ανά ημέρα με το κλικ

type Save = { leadId: string; itemId?: string; version?: number };
type Props = {
  cols: Record<string, PriceCol[]>; // σταθμός → στήλες τιμής που φαίνονται
  slots: Slot[];
  defaultStart: string;
  lockStation?: string;             // μέσα σε πρόταση: ο σταθμός είναι δεδομένος
  initial?: { grid: Grid; sec: number; start: string | null; title: string };
  save?: Save;                      // μέσα σε πρόταση: κουμπί «Αποθήκευση στην πρόταση»
};

export function PlanCalculator({ cols, slots, defaultStart, lockStation, initial, save }: Props) {
  const stations = Object.keys(cols);
  const [station, setStation] = useState(lockStation ?? stations[0] ?? "ΣΟΚ FM");
  const [sec, setSec] = useState(String(initial?.sec ?? 30));
  const [start, setStart] = useState(initial?.start ?? defaultStart);
  const [product, setProduct] = useState(initial?.title ?? "");
  const [grids, setGrids] = useState<Record<string, Grid>>(initial ? { [station]: initial.grid } : {});

  // Το πλάνο ξεκινάει την ημερομηνία έναρξης και κρατάει ακριβώς 30 ημέρες
  const [y, m, d0] = start.split("-").map(Number);
  const today = new Date();
  const first = y && m && d0 ? new Date(y, m - 1, d0) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const nDays = PLAN_DAYS;
  const dates = Array.from({ length: nDays }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const days = dates.map((x) => x.getDay());
  const last = dates[nDays - 1];
  const fmtD = (x: Date) => `${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear()}`;

  const priceCols = cols[station] ?? [];
  const rows = slots.filter((s) => s.station === station).sort((a, b) => a.sort - b.sort);
  const grid = grids[station] ?? {};
  const seconds = Math.max(1, Math.min(120, parseInt(sec, 10) || 30));
  const cell = (slot: string, d: number) => grid[slot]?.[d] ?? 0;

  const update = (fn: (g: Grid) => Grid) => setGrids((all) => ({ ...all, [station]: fn({ ...(all[station] ?? {}) }) }));
  const row = (g: Grid, slot: string) => Array.from({ length: nDays }, (_, d) => g[slot]?.[d] ?? 0);

  // Κλικ σε κελί: 0 → 1 → 2 → 3 → 0
  const bump = (slot: string, d: number) =>
    update((g) => { const r = row(g, slot); r[d] = (r[d] + 1) % (MAX + 1); g[slot] = r; return g; });
  // Κλικ στην ώρα: γεμίζει όλη τη γραμμή με 1 (ή την αδειάζει αν είναι γεμάτη)
  const fillRow = (slot: string) =>
    update((g) => { const r = row(g, slot); const full = r.every((v) => v > 0); g[slot] = r.map(() => (full ? 0 : 1)); return g; });
  // Κλικ στην ημέρα: γεμίζει/αδειάζει τη στήλη στις ώρες που ήδη έχουν σποτ (αλλιώς σε όλες)
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
    update((g) => { for (const r of rows) { const a = row(g, r.slot); if (a.some((v) => v > 0)) g[r.slot] = a.map((v, d) => (days[d] !== 0 && days[d] !== 6 ? Math.max(v, 1) : 0)); } return g; });

  const t = useMemo(() => {
    let spots = 0;
    const totals = priceCols.map(() => 0);
    const perDay = Array(nDays).fill(0);
    const perRow: Record<string, { n: number; cost: number[] }> = {};
    for (const r of rows) {
      let n = 0;
      for (let d = 0; d < nDays; d++) { const v = grid[r.slot]?.[d] ?? 0; n += v; perDay[d] += v; }
      const cost = priceCols.map((c) => n * secPrice(c, r.listeners_k) * seconds);
      perRow[r.slot] = { n, cost };
      spots += n;
      cost.forEach((c, i) => { totals[i] += c; });
    }
    return { spots, totals, perDay, perRow };
  }, [rows, grid, nDays, priceCols, seconds]);

  const totalSec = t.spots * seconds;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const S = { cell: { width: 19, minWidth: 19, padding: 0, textAlign: "center" as const, borderLeft: "1px solid #eee", cursor: "pointer", userSelect: "none" as const, fontSize: 11 } };

  return (
    <div className="stack">
      <div className="card grid2">
        <label>{save ? "Όνομα πλάνου / σποτ" : "Προϊόν / πελάτης"}<input value={product} onChange={(e) => setProduct(e.target.value)} placeholder={save ? "π.χ. Σποτ προσφορών 20''" : "π.χ. JUMBO – Χριστούγεννα"} /></label>
        {lockStation ? (
          <label>Σταθμός<input value={station} readOnly disabled /></label>
        ) : (
          <label>Σταθμός
            <select value={station} onChange={(e) => setStation(e.target.value)}>{stations.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
        )}
        <label>Διάρκεια σποτ (sec)<input inputMode="numeric" value={sec} onChange={(e) => setSec(e.target.value)} /></label>
        <label>Ημερομηνία έναρξης<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", padding: "10px 12px", borderBottom: "1px solid #eee", alignItems: "center" }}>
          <strong>{station} · {fmtD(first)} – {fmtD(last)} (30 ημέρες){product ? ` · ${product}` : ""}</strong>
          <span className="muted" style={{ fontSize: 12 }}>Κλικ σε κελί: 0→1→2→3 · κλικ στην ώρα: όλη η γραμμή · κλικ στην ημέρα: όλη η στήλη</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={weekdaysOnly}>Μόνο Δευ–Παρ</button>
          <button type="button" className="secondary" onClick={() => update(() => ({}))}>Καθάρισμα</button>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table className="plan-grid" style={{ fontSize: 11.5, borderCollapse: "separate", borderSpacing: 0, width: "max-content" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff" }}>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3 }}>ΩΡΑ</th>
                <th title="Ακροατές σε χιλιάδες">ΑΚΡ.</th>
                {priceCols.map((c) => <th key={c.label} title={`Τιμή ${c.label} ανά δευτερόλεπτο`}>{priceCols.length > 1 ? c.label.slice(0, 3) : "€"}/s</th>)}
                <th title="Αριθμός μεταδόσεων">ΣΠΟΤ</th>
                {days.map((w, d) => (
                  <th key={d} onClick={() => fillCol(d)} title={fmtD(dates[d])}
                    style={{ ...S.cell, background: w === 0 || w === 6 ? "#f6f3f8" : "#fff", lineHeight: 1.1, borderLeft: d > 0 && dates[d].getDate() === 1 ? "2px solid #B0128F" : S.cell.borderLeft }}>
                    {dates[d].getDate()}<br /><span className="muted" style={{ fontWeight: 500 }}>{DOW[w]}</span>
                  </th>
                ))}
                {priceCols.map((c) => <th key={c.label} style={{ textAlign: "right" }}>{c.label} €</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pr = t.perRow[r.slot];
                return (
                  <tr key={r.slot} style={pr?.n ? { background: "var(--brand-bg)" } : undefined}>
                    <td onClick={() => fillRow(r.slot)} style={{ position: "sticky", left: 0, background: pr?.n ? "#fbe7f8" : "#fff", fontWeight: 700, cursor: "pointer", zIndex: 1 }}>{r.slot}</td>
                    <td style={{ textAlign: "right" }}>{num(r.listeners_k, 2)}</td>
                    {priceCols.map((c) => <td key={c.label} style={{ textAlign: "right" }}>{num(secPrice(c, r.listeners_k))}</td>)}
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{pr?.n || ""}</td>
                    {days.map((w, d) => {
                      const v = cell(r.slot, d);
                      return (
                        <td key={d} onClick={() => bump(r.slot, d)}
                          style={{ ...S.cell, height: 20, fontWeight: 700, background: v ? "var(--brand-grad)" : w === 0 || w === 6 ? "#faf8fb" : undefined, color: v ? "#0b0a0d" : undefined }}>
                          {v || ""}
                        </td>
                      );
                    })}
                    {priceCols.map((c, i) => <td key={c.label} style={{ textAlign: "right" }}>{pr?.n ? eur(pr.cost[i]) : ""}</td>)}
                  </tr>
                );
              })}
            </tbody>
            <tfoot style={{ position: "sticky", bottom: 0, background: "#fff", fontWeight: 800, zIndex: 2 }}>
              <tr>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3, borderTop: "2px solid #ddd" }}>TOTAL</td>
                <td />{priceCols.map((c) => <td key={c.label} />)}
                <td style={{ textAlign: "right" }}>{t.spots || ""}</td>
                {t.perDay.map((v, d) => <td key={d} style={{ ...S.cell, cursor: "default" }}>{v || ""}</td>)}
                {t.totals.map((v, i) => <td key={i} style={{ textAlign: "right" }}>{eur(v)} €</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {save ? (
        <form action={savePlanItem} className="card row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="lead_id" value={save.leadId} />
          {save.itemId && <><input type="hidden" name="item_id" value={save.itemId} /><input type="hidden" name="version" value={save.version ?? 1} /></>}
          <input type="hidden" name="station" value={station} />
          <input type="hidden" name="sec" value={seconds} />
          <input type="hidden" name="start" value={start} />
          <input type="hidden" name="title" value={product} />
          <input type="hidden" name="grid" value={JSON.stringify(grid)} />
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Κόστος μήνα (30 ημέρες), χωρίς ΦΠΑ</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{eur(t.totals[0] ?? 0)} €</div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {t.spots} σποτ × {seconds}&apos;&apos; · μέση τιμή σποτ {t.spots ? eur((t.totals[0] ?? 0) / t.spots) : "—"} € · ανά sec {totalSec ? num((t.totals[0] ?? 0) / totalSec) : "—"} €
          </div>
          <span style={{ flex: 1 }} />
          <a href={`/leads/${save.leadId}/proposal`} className="btn secondary">Άκυρο</a>
          <SubmitButton pending="Αποθήκευση…">Αποθήκευση στην πρόταση</SubmitButton>
        </form>
      ) : (
        <div className="grid2">
          {priceCols.map((c, i) => {
            const month1 = t.totals[i] ?? 0;
            return (
              <div key={c.label} className="card">
                <h3 style={{ marginTop: 0 }}>{c.label === "LOCAL" ? "Τοπικός πελάτης" : c.label === "DIRECT" ? "Direct μεγάλος πελάτης" : c.label}</h3>
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
      )}
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Τιμές χωρίς ΦΠΑ και χωρίς εκπτώσεις. Κάθε «μήνας» είναι 30 ημέρες και επαναλαμβάνει το πλάνο που βλέπεις. Η μωβ γραμμή δείχνει πού αλλάζει ο μήνας. Συνολικά δευτερόλεπτα 30 ημερών: {totalSec.toLocaleString("el-GR")}.
      </p>
    </div>
  );
}
