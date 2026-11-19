// Κοινή λογική κοστολόγησης: είδος πελάτη, τιμή ανά break, σύνολα πρότασης.
export const STATIONS = ["ΣΟΚ FM", "DALKAS", "ΜΠΛΕ", "NRG"] as const;
export type ClientType = "local" | "media" | "direct" | "government";
export const CLIENT_LABEL: Record<ClientType, string> = {
  local: "Τοπικός πελάτης",
  media: "Media shop",
  direct: "Μεγάλος πελάτης (direct)",
  government: "Κρατική διαφήμιση",
};
export const CLIENT_HINT: Record<ClientType, string> = {
  local: "Πακέτα ή κοστολόγηση πλάνου με τοπικές τιμές",
  media: "Πρακτορείο: σταθερή τιμή ανά δευτερόλεπτο",
  direct: "Κοστολόγηση πλάνου με τιμές direct",
  government: "Σταθερή τιμή ανά δευτερόλεπτο για κρατικές",
};

export type Rate = { station: string; media_shop_sec: number; government_sec: number; local_per_k: number; direct_per_k: number };
export type Slot = { station: string; slot: string; listeners_k: number; sort: number };
// Στήλη τιμής στο πλάνο: είτε ανά 1.000 ακροατές (perK) είτε σταθερή ανά δευτερόλεπτο (flat)
export type PriceCol = { label: string; perK?: number; flat?: number };

export function priceCol(rate: Rate, type: ClientType): PriceCol {
  if (type === "local") return { label: "LOCAL", perK: Number(rate.local_per_k) };
  if (type === "direct") return { label: "DIRECT", perK: Number(rate.direct_per_k) };
  if (type === "media") return { label: "MEDIA SHOP", flat: Number(rate.media_shop_sec) };
  return { label: "ΚΡΑΤΙΚΗ", flat: Number(rate.government_sec) };
}
export const secPrice = (c: PriceCol, listenersK: number) => (c.flat != null ? c.flat : listenersK * (c.perK ?? 0));

export const PLAN_DAYS = 30;
export type Grid = Record<string, number[]>;

// Κόστος ενός μήνα (30 ημερών) για ένα πλάνο
export function planCost(grid: Grid, slots: Slot[], col: PriceCol, sec: number) {
  let spots = 0, cost = 0;
  for (const s of slots) {
    const row = grid[s.slot];
    if (!row) continue;
    let n = 0;
    for (let d = 0; d < PLAN_DAYS; d++) n += Math.max(0, Math.min(20, Math.floor(Number(row[d]) || 0)));
    spots += n;
    cost += n * secPrice(col, Number(s.listeners_k)) * sec;
  }
  return { spots, cost: Math.round(cost * 100) / 100 };
}

export type Item = {
  id: string; station: string; kind: "package" | "plan"; title: string; detail: string | null;
  monthly_amount: number; long_months: number | null; long_amount: number | null; long_detail: string | null;
  qty: number; months: number; spots: number | null; sec: number | null; start_date: string | null; version: number;
};
// Σύνολο γραμμής: μήνες × κόστος μήνα (με το bonus του πακέτου όταν οι μήνες το πιάνουν)
export function itemTotal(i: Pick<Item, "monthly_amount" | "long_months" | "long_amount" | "months">) {
  const bonus = i.long_months != null && i.long_amount != null && i.months >= i.long_months;
  const perMonth = Number(bonus ? i.long_amount : i.monthly_amount);
  return { perMonth, bonus, total: Math.round(perMonth * i.months * 100) / 100 };
}
