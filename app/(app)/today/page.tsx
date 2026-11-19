import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { STAGES, dateGr } from "@/lib/format";

type Row = {
  id: string; company_name: string; status: string; next_step: string; next_step_due: string;
  is_overdue: boolean; is_today: boolean; last_contact_at: string | null;
};

export default async function Today() {
  const { supabase, profile, isAdmin, isCeo } = await requireProfile();
  const { data } = await supabase.from("my_today").select("*").order("next_step_due");
  const rows = (data ?? []) as Row[];
  const late = rows.filter((r) => r.is_overdue);
  const now = rows.filter((r) => r.is_today);
  const tomorrow = rows.filter((r) => !r.is_overdue && !r.is_today);

  let toAssign = 0, toApprove = 0, toMerge = 0;
  if (isAdmin) {
    const a = await supabase.from("leads").select("id", { count: "exact", head: true }).is("owner_id", null).not("status", "in", "(won,lost)");
    toAssign = a.count ?? 0;
    const m = await supabase.from("merge_candidates").select("id", { count: "exact", head: true }).eq("decision", "pending");
    toMerge = m.count ?? 0;
  }
  if (isCeo) {
    const c = await supabase.from("base_claims").select("id", { count: "exact", head: true }).eq("status", "pending");
    toApprove = c.count ?? 0;
  }

  const List = ({ items, cls }: { items: Row[]; cls?: string }) => (
    <div className="list">
      {items.map((r) => (
        <Link key={r.id} href={`/leads/${r.id}`} className={`item ${cls ?? ""}`}>
          <div className="grow">
            <div className="title">{r.company_name}</div>
            <div className="muted">{r.next_step} · {STAGES[r.status]}</div>
          </div>
          <span className={`badge ${cls ?? ""}`}>{dateGr(r.next_step_due)}</span>
        </Link>
      ))}
    </div>
  );

  return (
    <main className="wrap">
      <div>
        <h1>{greeting()}, {profile.full_name.split(" ")[0]}</h1>
        <p className="muted">
          {rows.length === 0 ? "Τίποτα για σήμερα. Ώρα να ψάξεις στη βάση πελατών." : `${late.length + now.length} βήματα για σήμερα, ${late.length} καθυστερημένα.`}
        </p>
      </div>

      {isAdmin && (toAssign > 0 || toApprove > 0 || toMerge > 0) && (
        <div className="card alert row">
          {toAssign > 0 && <Link href="/leads?filter=unassigned" className="badge late">{toAssign === 1 ? "1 lead για ανάθεση" : `${toAssign} leads για ανάθεση`}</Link>}
          {toApprove > 0 && <Link href="/base" className="badge late">{toApprove === 1 ? "1 αίτημα από τη βάση" : `${toApprove} αιτήματα από τη βάση`}</Link>}
          {toMerge > 0 && <Link href="/merges" className="badge gray">{toMerge === 1 ? "1 ομάδα πελατών για έλεγχο" : `${toMerge} ομάδες πελατών για έλεγχο`}</Link>}
        </div>
      )}

      {late.length > 0 && (<><div className="section-label late">ΚΑΘΥΣΤΕΡΗΜΕΝΑ</div><List items={late} cls="late" /></>)}
      {now.length > 0 && (<><div className="section-label">ΣΗΜΕΡΑ</div><List items={now} /></>)}
      {tomorrow.length > 0 && (<><div className="section-label muted">ΑΥΡΙΟ</div><List items={tomorrow} /></>)}
    </main>
  );
}

// Χαιρετισμός με βάση την ώρα Ελλάδας (ο server της Vercel τρέχει σε ώρα UTC)
function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Athens" }).format(new Date()));
  if (h >= 5 && h < 12) return "Καλημέρα";
  if (h >= 12 && h < 18) return "Καλό απόγευμα";
  return "Καλησπέρα";
}
