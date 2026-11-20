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

// Κλειδί αναζήτησης: ίδια λογική με τη gr_key της βάσης (0035). Ελληνικά, greeklish, τόνοι, διπλά γράμματα → ένα κλειδί.
const KEY_GR: [string, string][] = [["ου", "u"], ["αι", "e"], ["ει", "i"], ["οι", "i"], ["υι", "i"], ["μπ", "v"], ["ντ", "d"], ["γκ", "g"], ["γγ", "g"], ["αυ", "av"], ["ευ", "ev"], ["ψ", "ps"]];
const KEY_LA: [string, string][] = [["ch", "x"], ["th", "t"], ["ph", "v"], ["ks", "x"], ["ou", "u"], ["ai", "e"], ["ei", "i"], ["oi", "i"], ["mp", "v"], ["nt", "d"], ["gk", "g"]];
const tr = (s: string, from: string, to: string) => [...s].map((c) => { const i = from.indexOf(c); return i < 0 ? c : to[i]; }).join("");
export function searchKey(t: string) {
  // όπως η gr_norm: πεζά, μόνο οι ελληνικοί τόνοι/διαλυτικά φεύγουν, ς → σ
  let s = tr(t.toLowerCase(), "άέήίόύώϊϋΐΰς", "αεηιουωιυιυσ");
  for (const [a, b] of KEY_GR) s = s.split(a).join(b);
  s = tr(s, "αβγδεζηθικλμνξοπρστυφχω", "avgdezitiklmnxoprstivxo");
  for (const [a, b] of KEY_LA) s = s.split(a).join(b);
  s = tr(s, "bcqwyhf", "vkkoixv");
  return s.replace(/[^a-z0-9 ]/g, "").replace(/(.)\1+/g, "$1").trim();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Κατάσταση πελάτη με βάση πότε έπαιξε τελευταία:
// On Air = καμπάνια αυτόν τον μήνα ή κλεισμένη για αργότερα · Recent = έπαιξε τους τελευταίους 12 μήνες (στόχος ανανέωσης)
// Inactive = 1–3 χρόνια πριν · Dormant = πάνω από 3 χρόνια · Κλειστή = η επιχείρηση έκλεισε.
export const monthsAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
export function customerState(c: { last_period: string | null; closed_at?: string | null }): { key: string; label: string; cls: string } {
  if (c.closed_at) return { key: "closed", label: "Κλειστή", cls: "gray" };
  const p = c.last_period;
  if (p && p >= monthsAgo(0)) return { key: "onair", label: "On Air", cls: "onair" };
  if (p && p >= monthsAgo(12)) return { key: "recent", label: "Recent", cls: "late" };
  if (p && p >= monthsAgo(36)) return { key: "inactive", label: "Inactive", cls: "gray" };
  return { key: "dormant", label: p ? "Dormant" : "Χωρίς καμπάνια", cls: "faint" };
}

// Account Executive όπως το λέμε: χρήστης του CRM, ή το media shop για πελάτες πρακτορείου.
export function aeLabel(c: { status: string; served_by: string | null; profiles?: { full_name: string } | null }, short = false) {
  if (c.profiles?.full_name) return short ? c.profiles.full_name.split(" ")[0] : c.profiles.full_name;
  if (c.status === "active" && c.served_by?.startsWith("Media shop")) return c.served_by;
  return null;
}
