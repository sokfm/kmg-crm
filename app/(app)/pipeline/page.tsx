import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { eur, today } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { PipelineBoard, type Card } from "@/components/PipelineBoard";

export default async function Pipeline({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, profile } = await requireProfile();
  const who = sp.who ?? "all";
  const line = sp.line ?? "all";

  let q = supabase
    .from("leads")
    .select("id, version, company_name, status, next_step, next_step_due, expected_value, product_line, interests, stations, owner_id, profiles!leads_owner_id_fkey(full_name, color)")
    .not("status", "in", "(won,lost)")
    .order("next_step_due", { ascending: true })
    .limit(500);
  if (who === "me") q = q.eq("owner_id", profile.id);
  else if (who === "none") q = q.is("owner_id", null);
  else if (who !== "all") q = q.eq("owner_id", who);
  if (line !== "all") q = q.eq("product_line", line);
  const { data } = await q;
  const rows = (data ?? []) as unknown as (Omit<Card, "owner" | "last_contact" | "color"> & { owner_id: string | null; profiles: { full_name: string; color: string | null } | null })[];

  // Τελευταία πραγματική επαφή ανά deal (όχι σημειώσεις)
  const ids = rows.map((r) => r.id);
  const last = new Map<string, string>();
  if (ids.length) {
    const { data: acts } = await supabase.from("activities").select("lead_id, occurred_at").in("lead_id", ids).eq("counts_as_contact", true).order("occurred_at", { ascending: false });
    for (const a of acts ?? []) if (a.lead_id && !last.has(a.lead_id)) last.set(a.lead_id, a.occurred_at.slice(0, 10));
  }
  const cards: Card[] = rows.map((r) => ({ ...r, stations: r.stations ?? [], owner: r.profiles?.full_name ?? null, color: r.profiles?.color ?? null, interests: r.interests ?? [r.product_line], last_contact: last.get(r.id) ?? null }));

  // Κλεισίματα του μήνα
  const monthStart = today().slice(0, 8) + "01";
  const { data: closed } = await supabase.from("leads").select("status, expected_value").in("status", ["won", "lost"]).gte("closed_at", monthStart);
  const won = (closed ?? []).filter((c) => c.status === "won");
  const wonMonth = { n: won.length, v: won.reduce((t, c) => t + Number(c.expected_value ?? 0), 0) };
  const lostMonth = (closed ?? []).filter((c) => c.status === "lost").length;

  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };

  const legend = [...new Map(cards.map((c) => [c.owner ?? "Χωρίς ανάθεση", c.color ?? "#9aa0ac"] as const)).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const total = cards.reduce((t, c) => t + Number(c.expected_value ?? 0), 0);
  const late = cards.filter((c) => c.next_step_due && c.next_step_due < today()).length;
  const link = (k: string, v: string) => `/pipeline?${new URLSearchParams({ who, line, [k]: v }).toString()}`;
  const chip = (k: string, v: string, label: string, on: boolean) => (
    <Link key={k + v} href={link(k, v)} className={`badge ${on ? "" : "gray"}`}>{label}</Link>
  );

  return (
    <main className="wrap wide">
      <div className="row">
        <h1 className="grow" style={{ margin: 0 }}>Pipeline</h1>
        <div className="seg-toggle" role="group" aria-label="Προβολή">
          <span className="on">Κάρτες</span>
          <Link href="/leads">Λίστα</Link>
        </div>
        <Link href="/leads/new" className="btn">+ Νέο deal</Link>
      </div>
      <div className="row">
        <span className="badge gray">{cards.length} ανοιχτά deals</span>
        <span className="badge gray">εκτιμώμενη αξία {eur(total)}</span>
        {late > 0 && <span className="badge late">{late} καθυστερούν</span>}
      </div>
      <Flash sp={sp} />
      {legend.length > 1 && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap", fontSize: 12.5 }} aria-label="Χρώμα ανά Account Executive">
          {legend.map(([name, color]) => (
            <span key={name} className="row" style={{ gap: 5, alignItems: "center" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: "inline-block" }} />{name}
            </span>
          ))}
        </div>
      )}
      <div className="row">
        {chip("who", "all", isAdmin ? "Όλοι" : "Όλα όσα βλέπω", who === "all")}
        {chip("who", "me", "Τα δικά μου", who === "me")}
        {isAdmin && chip("who", "none", "Χωρίς ανάθεση", who === "none")}
        {isAdmin && (people ?? []).filter((p) => p.id !== profile.id).map((p) => chip("who", p.id, p.full_name.split(" ")[0], who === p.id))}
        <span className="muted">|</span>
        {chip("line", "all", "Ράδιο + digital", line === "all")}
        {chip("line", "radio", "Ράδιο", line === "radio")}
        {chip("line", "digital", "Digital", line === "digital")}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Σύρε μια κάρτα σε άλλη στήλη (ή πάτα «Μετακίνηση» στο κινητό). Κάθε μετακίνηση ζητά επόμενο βήμα· ένα χαμένο deal ζητά τι «όχι» ήταν.
      </p>
      <PipelineBoard cards={cards} today={today()} wonMonth={wonMonth} lostMonth={lostMonth} />
    </main>
  );
}
