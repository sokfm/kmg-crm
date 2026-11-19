import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { STAGES, dateGr, today } from "@/lib/format";
import { assignLead } from "../actions";
import { Flash } from "@/components/Flash";

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  let q = supabase
    .from("leads")
    .select("id, company_name, status, next_step, next_step_due, owner_id, product_line, profiles!leads_owner_id_fkey(full_name)")
    .order("next_step_due", { ascending: true, nullsFirst: false })
    .limit(300);
  const filter = sp.filter ?? "open";
  if (filter === "open") q = q.not("status", "in", "(won,lost)");
  if (filter === "unassigned") q = q.is("owner_id", null).not("status", "in", "(won,lost)");
  if (filter === "closed") q = q.in("status", ["won", "lost"]);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; company_name: string; status: string; next_step: string | null; next_step_due: string | null;
    owner_id: string | null; product_line: string; profiles: { full_name: string } | null;
  }[];
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };
  const t = today();

  const tab = (k: string, label: string) => (
    <Link href={`/leads?filter=${k}`} className={`badge ${filter === k ? "" : "gray"}`}>{label}</Link>
  );

  return (
    <main className="wrap">
      <div className="row">
        <h1 className="grow">Leads</h1>
        <Link href="/leads/new" className="btn">+ Νέο lead</Link>
      </div>
      <Flash sp={sp} />
      <div className="row">
        {tab("open", "Ανοιχτά")}
        {isAdmin && tab("unassigned", "Χωρίς ανάθεση")}
        {tab("closed", "Κλειστά")}
      </div>
      <div className="list">
        {rows.length === 0 && <p className="muted">Κανένα lead εδώ.</p>}
        {rows.map((r) => {
          const late = r.next_step_due && r.next_step_due < t && !["won", "lost"].includes(r.status);
          return (
            <div key={r.id} className={`item ${late ? "late" : ""}`}>
              <Link href={`/leads/${r.id}`} className="grow" style={{ color: "inherit" }}>
                <div className="title">{r.company_name} {r.product_line === "digital" && <span className="badge gray">digital</span>}</div>
                <div className="muted">{STAGES[r.status]} · {r.next_step ?? "—"} · {r.profiles?.full_name ?? "Χωρίς ανάθεση"}</div>
              </Link>
              {isAdmin && !r.owner_id ? (
                <form action={assignLead} className="row">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="owner_id" required defaultValue="">
                    <option value="" disabled>Ανάθεση σε…</option>
                    {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <SubmitButton>OK</SubmitButton>
                </form>
              ) : (
                <span className={`badge ${late ? "late" : r.status === "won" ? "good" : ""}`}>{dateGr(r.next_step_due)}</span>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
