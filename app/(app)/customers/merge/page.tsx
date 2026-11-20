import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr, customerState } from "@/lib/format";
import { mergeCustomers } from "../../actions";
import { Flash } from "@/components/Flash";

// Επιβεβαίωση πριν την ένωση: η ένωση δεν αναιρείται, οπότε δείχνουμε τι ακριβώς θα γίνει.
export default async function MergeCustomers({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/customers");
  const raw = sp.ids ?? [];
  const ids = (Array.isArray(raw) ? raw : raw.split(",")).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const { data } = await supabase
    .from("customers_x")
    .select("id, display_name, status, last_period, first_period, lifetime_revenue, stations, agency, owner_name")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .order("lifetime_revenue", { ascending: false });
  const rows = (data ?? []) as unknown as {
    id: string; display_name: string; status: string; last_period: string | null; first_period: string | null;
    lifetime_revenue: number; stations: string[] | null; agency: string | null; owner_name: string | null;
  }[];
  const flash = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <Link href="/customers" className="muted">← Πελάτες</Link>
      <h1>Ένωση πελατών</h1>
      <Flash sp={flash} />
      {rows.length < 2 ? (
        <div className="card alert">Τσέκαρε τουλάχιστον 2 πελάτες στη λίστα και πάτα «Ένωση επιλεγμένων». <Link href="/customers">Πίσω στη λίστα</Link></div>
      ) : (
        <form action={mergeCustomers} className="card stack">
          {rows.map((c) => <input key={c.id} type="hidden" name="ids" value={c.id} />)}
          <p style={{ margin: 0 }}>
            Αυτοί οι {rows.length} πελάτες θα γίνουν <strong>ένας</strong>. Όλο το ιστορικό τιμολόγησης, οι επαφές, τα leads, οι εργασίες και τα email
            μεταφέρονται στον ενωμένο πελάτη. <strong>Η ένωση δεν αναιρείται</strong>, οπότε έλεγξε ότι είναι πράγματι ο ίδιος.
          </p>
          <div className="list">
            {rows.map((c, i) => (
              <label key={c.id} className="item" style={{ flexDirection: "row", fontWeight: 400, cursor: "pointer" }}>
                <input type="radio" name="keep_id" value={c.id} defaultChecked={i === 0} style={{ width: 18, height: 18 }} />
                <span className="grow">
                  <strong>{c.display_name}</strong>
                  <div className="muted">
                    {customerState(c).label} · {periodGr(c.first_period)} – {periodGr(c.last_period)} · {(c.stations ?? []).join(", ")}
                    {c.agency ? ` · ${c.agency}` : ""} · {c.owner_name ?? "χωρίς Account Executive"}
                  </div>
                </span>
                <span className="badge gray">{eur(c.lifetime_revenue)}</span>
              </label>
            ))}
          </div>
          <p className="muted" style={{ margin: 0 }}>Το τσεκαρισμένο είναι το όνομα που κρατάμε. Ή γράψε άλλο:</p>
          <input name="keep_name" placeholder="Άλλο όνομα (προαιρετικά)" />
          <p className="muted" style={{ margin: 0 }}>
            Ο ενωμένος πελάτης κρατά τον υπεύθυνο του μεγαλύτερου σε τζίρο (ή όποιου έχει υπεύθυνο) και μένει «Ενεργός» αν έστω ένας ήταν ενεργός.
          </p>
          <div className="row">
            <SubmitButton pending="Ένωση…">Ένωσέ τους σε έναν</SubmitButton>
            <Link href="/customers" className="btn secondary">Άκυρο</Link>
          </div>
        </form>
      )}
    </main>
  );
}
