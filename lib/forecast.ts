import { itemTotal } from "@/lib/pricing";

// Τζίρος ανά μήνα: το ποσό διαιρείται με τις ημέρες της καμπάνιας και κάθε μήνας παίρνει τις ημέρες που παίζει.
// Ίδιος τρόπος με το αρχείο τιμολόγησης του Νίκου. Κάθε «μήνας» πρότασης = 30 ημέρες.
export type FItem = { monthly_amount: number; long_months: number | null; long_amount: number | null; months: number; start_date: string | null };
export type MonthPart = { ym: string; days: number; amount: number };

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY));

export function splitByMonth(amount: number, start: string, days: number): MonthPart[] {
  const t0 = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t0) || days <= 0) return [];
  const count = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const ym = iso(new Date(t0 + i * DAY)).slice(0, 7);
    count.set(ym, (count.get(ym) ?? 0) + 1);
  }
  const parts = [...count.entries()].map(([ym, d]) => ({ ym, days: d, amount: Math.round((amount * d / days) * 100) / 100 }));
  // Τα λεπτά της στρογγύλευσης πάνε στον τελευταίο μήνα, ώστε το άθροισμα να είναι ακριβώς το ποσό
  const diff = Math.round((amount - parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
  if (parts.length && diff) parts[parts.length - 1].amount = Math.round((parts[parts.length - 1].amount + diff) * 100) / 100;
  return parts;
}

// Μια πρόταση: η τελική τιμή (μετά τις εκπτώσεις) μοιράζεται στις γραμμές αναλογικά και κάθε γραμμή σπάει στους μήνες της.
export function proposalByMonth(items: FItem[], finalTotal: number): { months: MonthPart[]; undated: number } {
  const list = items.reduce((s, i) => s + itemTotal(i).total, 0);
  const by = new Map<string, MonthPart>();
  let undated = 0;
  if (list <= 0) return { months: [], undated: 0 };
  for (const i of items) {
    const share = (itemTotal(i).total / list) * finalTotal;
    if (!i.start_date) { undated += share; continue; }
    for (const p of splitByMonth(share, i.start_date, i.months * 30)) {
      const e = by.get(p.ym) ?? { ym: p.ym, days: 0, amount: 0 };
      e.days = Math.max(e.days, p.days); e.amount += p.amount;
      by.set(p.ym, e);
    }
  }
  const months = [...by.values()].sort((a, b) => a.ym.localeCompare(b.ym)).map((m) => ({ ...m, amount: Math.round(m.amount * 100) / 100 }));
  return { months, undated: Math.round(undated * 100) / 100 };
}

const MON = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
export const ymLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
