import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { decideAccess } from "../access-actions";

const when = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }).format(new Date(d));
type Req = { id: string; customer_id: string; reason: string; status: string; requested_at: string; expires_at: string | null; decided_note: string | null;
  customers: { display_name: string } | null; who: { full_name: string } | null };

// Αιτήματα πρόσβασης σε τζίρο/καρτέλα πελάτη. Αποφασίζει μόνο ο Νίκος· η Γιάννα τα βλέπει.
export default async function Access({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, isCeo } = await requireProfile();
  const { data } = await supabase.from("customer_access")
    .select("id, customer_id, reason, status, requested_at, expires_at, decided_note, user_id")
    .order("requested_at", { ascending: false }).limit(80);
  const raw = (data ?? []) as { id: string; customer_id: string; user_id: string; reason: string; status: string; requested_at: string; expires_at: string | null; decided_note: string | null }[];
  const cids = [...new Set(raw.map((r) => r.customer_id))], uids = [...new Set(raw.map((r) => r.user_id))];
  const [{ data: cn }, { data: pn }] = await Promise.all([
    cids.length ? supabase.from("customers_x").select("id, display_name").in("id", cids) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    uids.length ? supabase.from("profiles").select("id, full_name").in("id", uids) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const cName = new Map((cn ?? []).map((x) => [x.id as string, x.display_name as string])), pName = new Map((pn ?? []).map((x) => [x.id as string, x.full_name as string]));
  const rows: Req[] = raw.map((r) => ({ ...r, customers: cName.has(r.customer_id) ? { display_name: cName.get(r.customer_id)! } : null, who: pName.has(r.user_id) ? { full_name: pName.get(r.user_id)! } : null }));
  const pending = rows.filter((r) => r.status === "pending");
  const now = Date.now();
  const active = rows.filter((r) => r.status === "approved" && r.expires_at && Date.parse(r.expires_at) > now);
  const past = rows.filter((r) => !pending.includes(r) && !active.includes(r)).slice(0, 20);
  const name = (r: Req) => <Link href={`/customers/${r.customer_id}`} style={{ fontWeight: 700 }}>{r.customers?.display_name ?? "Πελάτης"}</Link>;

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <h1>Αιτήματα πρόσβασης</h1>
      <p className="muted" style={{ marginTop: 0 }}>Ένας Account Executive βλέπει τζίρο και ιστορικό μόνο σε πελάτες που έχει τρέξει ο ίδιος. Για τους υπόλοιπους ζητάει πρόσβαση εδώ. Η έγκριση κρατάει 7 ημέρες και μετά ξανακλειδώνει.</p>
      <Flash sp={sp} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{isAdmin ? "Περιμένουν απάντηση" : "Τα αιτήματά μου σε αναμονή"} ({pending.length})</h2>
        {pending.length === 0 && <span className="muted">Κανένα.</span>}
        {pending.map((r) => (
          <div key={r.id} style={{ borderTop: "1px solid #ebe8ef", paddingTop: 10 }} className="stack">
            <div><strong>{r.who?.full_name ?? "Account Executive"}</strong> → {name(r)} <span className="muted">· {when(r.requested_at)}</span></div>
            <div>«{r.reason}»</div>
            {isCeo && (
              <form action={decideAccess} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={r.id} />
                <input name="note" placeholder="Σχόλιο (προαιρετικά)" className="grow" style={{ minWidth: 160 }} maxLength={300} />
                <button type="submit" name="approve" value="1">✓ Δώσε για 7 ημέρες</button>
                <button type="submit" name="approve" value="0" className="secondary">Όχι</button>
              </form>
            )}
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Ανοιχτές προσβάσεις τώρα ({active.length})</h2>
        {active.length === 0 && <span className="muted">Καμία.</span>}
        {active.map((r) => <div key={r.id}><strong>{r.who?.full_name}</strong> → {name(r)} <span className="muted">· λήγει {when(r.expires_at!)}</span></div>)}
      </div>

      {past.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Παλιότερα</h2>
          {past.map((r) => <div key={r.id} className="muted"><strong>{r.who?.full_name}</strong> → {r.customers?.display_name} · {r.status === "rejected" ? "δεν εγκρίθηκε" : "έληξε"}{r.decided_note ? ` · «${r.decided_note}»` : ""} · {when(r.requested_at)}</div>)}
        </div>
      )}
    </main>
  );
}
