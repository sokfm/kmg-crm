// Η προσφορά προς τον πελάτη: τι γράφει κάθε γραμμή και τα σύνολα. Χτίζεται στον server από την πρόταση
// και αποθηκεύεται ως «στιγμιότυπο», ώστε να ξέρουμε τι ακριβώς είδε ο πελάτης.
import { itemTotal, type ClientType } from "@/lib/pricing";

export const SITE = "https://karteliasmediagroup.gr/wp-content/uploads/2023/08";
// Προσωρινά από το site του ομίλου· θα αντικατασταθούν με τα τελικά αρχεία
export const STATION_LOGO: Record<string, string> = {
  "ΣΟΚ FM": `${SITE}/sokfm.png`, DALKAS: `${SITE}/dalkas.png`, "ΜΠΛΕ": `${SITE}/mple.png`, NRG: `${SITE}/nrg.png`,
};
export const STATION_NAME: Record<string, string> = { "ΣΟΚ FM": "ΣΟΚ FM 104.8", DALKAS: "DALKAS 88.2", "ΜΠΛΕ": "ΜΠΛΕ 99", NRG: "NRG 95" };
export const VALID_DAYS = 15;

export type OfferItem = {
  id: string; station: string; kind: "package" | "plan"; title: string; detail: string | null; long_detail: string | null;
  monthly_amount: number; long_months: number | null; long_amount: number | null; months: number; qty: number;
  spots: number | null; sec: number | null; spots_day: number | null; long_spots_day: number | null; offer_text: string | null;
};
export type OfferRow = { station: string; period: string; title: string; sub: string | null; c1: string; c2: string; price: number };
export type Snapshot = {
  code?: string; company: string; subtitle: string; local: boolean; rows: OfferRow[];
  list: number; final: number; reasons: string[]; totalSpots: number;
  issued: string; validUntil: string; ae: { name: string; phone: string | null; email: string | null };
};

const n = (v: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 1 }).format(v);
export const months = (m: number) => (m === 1 ? "1 μήνας" : `${m} μήνες`);

// Το κείμενο που προτείνει το CRM για μια γραμμή (ο Account Executive μπορεί να το αλλάξει)
export function defaultText(i: OfferItem): { title: string; sub: string | null } {
  const t = itemTotal(i);
  if (i.kind === "plan") {
    const total = (i.spots ?? 0) * i.months;
    return { title: `${n(total)} σποτ των ${i.sec ?? 30}''`, sub: i.title.replace(/^Πλάνο: ?/, "").replace(/^Πλάνο κοστολόγησης$/, "") || null };
  }
  const d = (t.bonus && i.long_detail ? i.long_detail : i.detail) ?? "";
  const m = /(\d+)\+(\d+) δώρο/.exec(d);
  if (m) return { title: `Πακέτο ${m[1]}+${m[2]}`, sub: `${m[1]} σποτ + ${m[2]} δώρο την ημέρα · έως 30''` };
  return { title: i.title, sub: d || null };
}

export function buildRows(items: OfferItem[], type: ClientType): { rows: OfferRow[]; totalSpots: number } {
  const local = type === "local";
  let totalSpots = 0;
  const rows = items.map((i) => {
    const t = itemTotal(i);
    const def = defaultText(i);
    const perDay = i.kind === "plan" ? (i.spots != null ? i.spots / 30 : null) : (t.bonus && i.long_spots_day != null ? i.long_spots_day : i.spots_day);
    const spots = i.kind === "plan" ? (i.spots ?? 0) * i.months : perDay != null ? perDay * 30 * i.months : 0;
    totalSpots += spots;
    const secs = spots * (i.sec ?? 0);
    return {
      station: i.station,
      period: months(i.months),
      title: i.offer_text?.trim() || def.title,
      sub: i.offer_text?.trim() ? null : def.sub,
      c1: local ? (perDay != null ? n(perDay) : "—") : i.sec ? `${i.sec}''` : "—",
      c2: local ? (spots ? n(spots) : "—") : secs ? new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(t.total / secs) + " €" : "—",
      price: t.total,
    };
  });
  return { rows, totalSpots };
}

export const autoSubtitle = (items: { station: string }[]) => {
  const st = [...new Set(items.map((i) => i.station))].map((s) => STATION_NAME[s] ?? s);
  return st.length ? `Καμπάνια ${st.join(" + ")}` : "";
};
export const dateLong = (iso: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" }).format(new Date(iso));
