import { unzipSync, strFromU8 } from "fflate";

// Μικρός αναγνώστης .xlsx: μόνο ό,τι χρειάζεται το αρχείο τιμολόγησης (τιμές κελιών, όχι μορφοποίηση).
// Οι τύποι (formulas) διαβάζονται από την αποθηκευμένη τιμή τους· οι ημερομηνίες αναγνωρίζονται από τη μορφή του κελιού.
export type Cell = string | number | Date | null;
export type Sheet = { name: string; rows: Cell[][] };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unesc = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])
   .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const attr = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
// Κείμενο από <si> ή <is>: όλα τα <t>, χωρίς τα φωνητικά (<rPh>)
const textOf = (xml: string) =>
  [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
  return n - 1;
};

export function readWorkbook(buf: Uint8Array): Sheet[] {
  const zip = unzipSync(buf, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) });
  const file = (n: string) => (zip[n] ? strFromU8(zip[n]) : "");
  const wb = file("xl/workbook.xml");
  if (!wb) throw new Error("Δεν είναι αρχείο Excel (.xlsx)");
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(wb);

  const shared = [...file("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textOf(m[1] ?? ""));

  // Ποιες μορφές κελιών είναι ημερομηνίες
  const styles = file("xl/styles.xml");
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), unesc(attr(m[0], "formatCode") ?? ""));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const isDateStyle = [...xfs.matchAll(/<xf\s[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE.has(id)) return true;
    const code = (custom.get(id) ?? "").replace(/\[[^\]]*\]|"[^"]*"|\\./g, "");
    return /[dmyh]/i.test(code) && !/^[#0,.\s%E+-]*$/.test(code);
  });

  const rels = new Map<string, string>();
  for (const m of file("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)) rels.set(attr(m[0], "Id") ?? "", attr(m[0], "Target") ?? "");

  const out: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*>/g)) {
    const name = unesc(attr(m[0], "name") ?? "");
    const target = rels.get(attr(m[0], "r:id") ?? "") ?? "";
    const xml = file("xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    const rows: Cell[][] = [];
    for (const r of xml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(attr(r[1], "r") ?? rows.length + 1);
      const row: Cell[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r");
        const t = attr(c[1], "t");
        const inner = c[2] ?? "";
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val: Cell = null;
        if (t === "inlineStr") val = textOf(inner);
        else if (v === undefined || v === "") val = null;
        else if (t === "s") val = shared[Number(v)] ?? "";
        else if (t === "str") val = unesc(v);
        else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
        else if (t === "e") val = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n)) val = unesc(v);
          else if (isDateStyle[Number(attr(c[1], "s") ?? -1)] && n > 0 && n < 200000) {
            val = new Date(Date.UTC(1899, 11, 30) + Math.round((n + (date1904 ? 1462 : 0)) * 86400000));
          } else val = n;
        }
        if (typeof val === "string" && val === "") val = null;
        const ci = ref ? colIndex(ref) : row.length;
        while (row.length < ci) row.push(null);
        row[ci] = val;
      }
      while (rows.length < rowNo - 1) rows.push([]);
      rows[rowNo - 1] = row;
    }
    out.push({ name, rows });
  }
  return out;
}
