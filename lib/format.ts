export const eur = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 }).format(v) + " €";

export const dateGr = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short" }).format(new Date(d)) : "—";

export const periodGr = (p: string | null | undefined) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  const months = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιούν", "Ιούλ", "Αύγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
  return `${months[Number(m) - 1] ?? m} ${y}`;
};

export const STAGES: Record<string, string> = {
  new: "1. Νέο lead",
  contacted: "2. Έγινε επαφή",
  meeting: "3. Ραντεβού",
  proposal: "4. Πρόταση",
  negotiation: "5. Διαπραγμάτευση",
  won: "Κέρδος",
  lost: "Χαμένο",
};

export const LOST_KINDS: Record<string, string> = {
  not_now: "Όχι τώρα",
  no_budget: "Όχι budget",
  competitor: "Πήγε σε άλλον σταθμό",
  never: "Όχι ποτέ",
};

export const ACTIVITY: Record<string, string> = {
  call: "Κλήση",
  meeting: "Ραντεβού",
  viber: "Viber",
  email: "Email",
  note: "Σημείωση",
};

export const CHANNEL: Record<string, string> = {
  kmg: "KMG",
  stamoulakis: "Σταμουλάκης",
  media_shop: "Media Shop",
};

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Κατάσταση πελάτη όπως τη λέμε στην πράξη:
// «Παίζει» = έχει καμπάνια αυτόν τον μήνα ή αργότερα· «Για ανανέωση» = έχει πωλητή αλλά η καμπάνια τελείωσε·
// «Βάση» = χωρίς πωλητή· «Κλειστή» = η επιχείρηση έκλεισε.
export function customerState(c: { status: string; last_period: string | null; closed_at?: string | null }): { label: string; cls: string } {
  if (c.closed_at) return { label: "Κλειστή", cls: "gray" };
  const cur = new Date().toISOString().slice(0, 7);
  if (c.last_period && c.last_period >= cur) return { label: "Παίζει", cls: "good" };
  if (c.status === "active") return { label: "Για ανανέωση", cls: "late" };
  return { label: "Βάση", cls: "gray" };
}
