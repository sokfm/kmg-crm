import { readWorkbook, type Cell } from "./xlsx";

// Διαβάζει το Excel τιμολόγησης («ΤΙΜΟΛΟΓΗΣΗ 2026.xlsx»): ένα φύλλο ανά μήνα, μία γραμμή ανά σταθμό και πελάτη.
// Οι στήλες βρίσκονται από τον τίτλο τους, όχι από τη θέση: αν μετακινηθεί μια στήλη, συνεχίζει να δουλεύει·
// αν λείπει τίτλος που χρειάζεται, το φύλλο ΔΕΝ διαβάζεται και το λέει (ποτέ σιωπηλά λάθος).
export type BillingLine = {
  name: string; station: string | null; bico: string | null;
  amount: number | null; amount_type: "numeric" | "FREE" | "missing";
  start: string | null; end: string | null;
  ae: string | null; agent: string | null; kef: string | null; status: string | null;
  sponsorship: string | null; notes: string | null; package: string | null; cost_sec: string | null;
};
export type BillingMonth = { year: number; month: number; sheet: string; lines: BillingLine[]; total: number };
export type BillingFile = { months: BillingMonth[]; problems: string[] };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const MONTHS = ["ΙΑΝ", "ΦΕΒ", "ΜΑΡ", "ΑΠΡ", "ΜΑΙ", "ΙΟΥΝ", "ΙΟΥΛ", "ΑΥΓ", "ΣΕΠ", "ΟΚΤ", "ΝΟΕ", "ΔΕΚ"];

// «ΜΑΪΟΣ 2026», «ΜΑΙΟΣ 2027», «ΜΑΡΤΙΟΣ 2027 » → { year, month }
export function sheetMonth(name: string): { year: number; month: number } | null {
  const p = plain(name);
  const y = /(20\d\d)/.exec(p);
  const m = MONTHS.findIndex((x) => p.startsWith(x));
  return y && m >= 0 ? { year: Number(y[1]), month: m + 1 } : null;
}

const STATIONS: [string, string][] = [["ΣΟΚ", "ΣΟΚ"], ["SOK", "ΣΟΚ"], ["DALKAS", "DALKAS"], ["NRG", "NRG"], ["ΜΠΛΕ", "ΜΠΛΕ"], ["MPLE", "ΜΠΛΕ"]];
const station = (v: string) => { const p = plain(v); return STATIONS.find(([k]) => p.startsWith(k))?.[1] ?? null; };

// τίτλος στήλης → πεδίο (ο τίτλος «Sponshorship» είναι γραμμένος έτσι στο αρχείο)
const HEAD: [RegExp, string][] = [
  [/^RADIO$/, "station"], [/^KEF$/, "kef"], [/^BICO$/, "bico"], [/^ΠΕΛΑΤ/, "name"],
  [/^ΗΜ\.? ?ΕΝΑΡΞ/, "start"], [/^ΗΜ\.? ?ΛΗΞ/, "end"], [/^ACCOUNT EXEC/, "ae"], [/^AGENT$/, "agent"],
  [/^NET EARNINGS$/, "amount"], [/^SPONS/, "sponsorship"], [/^NOTES$/, "notes"], [/^STATUS$/, "status"],
  [/^COST ?\/ ?SEC$/, "cost_sec"], [/^ΠΑΚΕΤΟ$/, "package"],
];
const NEED = ["station", "name", "amount", "start", "end", "ae"];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const text = (v: Cell): string | null => {
  if (v === null) return null;
  if (v instanceof Date) return `${isoDate(v)}T00:00:00`;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};
const date = (v: Cell): string | null => (v instanceof Date ? isoDate(v) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);

export function parseBilling(buf: Uint8Array): BillingFile {
  const months: BillingMonth[] = [];
  const problems: string[] = [];
  for (const sh of readWorkbook(buf)) {
    const ym = sheetMonth(sh.name);
    if (!ym) { if (sh.rows.some((r) => r.some((c) => c !== null))) problems.push(`Φύλλο «${sh.name.trim()}»: δεν κατάλαβα ποιος μήνας είναι, δεν διαβάστηκε`); continue; }
    // Γραμμή τίτλων: η πρώτη (μέσα στις 5 πρώτες) που έχει «Πελάτης» και «RADIO»
    let hi = -1;
    const col: Record<string, number> = {};
    for (let i = 0; i < Math.min(5, sh.rows.length) && hi < 0; i++) {
      const found: Record<string, number> = {};
      sh.rows[i].forEach((c, ci) => {
        if (typeof c !== "string") return;
        const h = HEAD.find(([re]) => re.test(plain(c)));
        if (h && found[h[1]] === undefined) found[h[1]] = ci;
      });
      if (found.name !== undefined && found.station !== undefined) { hi = i; Object.assign(col, found); }
    }
    const missing = NEED.filter((k) => col[k] === undefined);
    if (hi < 0 || missing.length) {
      if (sh.rows.length > 1) problems.push(`Φύλλο «${sh.name.trim()}»: δεν βρήκα τις στήλες που χρειάζομαι (${hi < 0 ? "Πελάτης, RADIO" : missing.join(", ")}), δεν διαβάστηκε`);
      continue;
    }
    const at = (row: Cell[], k: string): Cell => (col[k] === undefined ? null : row[col[k]] ?? null);
    const lines: BillingLine[] = [];
    for (const row of sh.rows.slice(hi + 1)) {
      const name = text(at(row, "name"));
      const st = text(at(row, "station"));
      // Οι γραμμές συνόλων στο κάτω μέρος δεν έχουν πελάτη και σταθμό στις στήλες τους
      if (!name || !st) continue;
      const a = at(row, "amount");
      let amount: number | null = null;
      let amount_type: BillingLine["amount_type"] = "missing";
      if (typeof a === "number") { amount = Math.round(a * 100) / 100; amount_type = "numeric"; }
      else if (typeof a === "string" && plain(a) === "FREE") amount_type = "FREE";
      lines.push({
        name, station: station(st) ?? st, bico: text(at(row, "bico")), amount, amount_type,
        start: date(at(row, "start")), end: date(at(row, "end")),
        ae: text(at(row, "ae")), agent: text(at(row, "agent")), kef: text(at(row, "kef")), status: text(at(row, "status")),
        sponsorship: text(at(row, "sponsorship")), notes: text(at(row, "notes")), package: text(at(row, "package")), cost_sec: text(at(row, "cost_sec")),
      });
    }
    months.push({ ...ym, sheet: sh.name.trim(), lines, total: Math.round(lines.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100 });
  }
  return { months, problems };
}
