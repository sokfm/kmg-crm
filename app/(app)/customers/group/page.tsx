import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr } from "@/lib/format";
import { setGroupAction } from "../../actions";
import { Flash } from "@/components/Flash";

// Οι τσεκαρισμένοι πελάτες μπαίνουν ως brands σε Group (υπάρχον ή νέο).
export default async function GroupCustomers({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/customers");
  const backTo = typeof sp.back === "string" && sp.back.startsWith("/customers") ? sp.back : "/customers";
  const raw = sp.ids ?? [];
  const ids = (Array.isArray(raw) ? raw : raw.split(",")).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const [{ data }, { data: groups }] = await Promise.all([
    supabase.from("customers_x").select("id, display_name, is_group, last_period, lifetime_revenue, parent_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).order("lifetime_revenue", { ascending: false }),
    supabase.from("customers").select("id, display_name").eq("is_group", true).order("display_name"),
  ]);
  const rows = (data ?? []) as unknown as { id: string; display_name: string; is_group: boolean; last_period: string | null; lifetime_revenue: number; parent_name: string | null }[];
  const brands = rows.filter((r) => !r.is_group);
  const pickedGroup = rows.find((r) => r.is_group);
  const flash = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const back = `/customers/group?ids=${ids.join(",")}`;

  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <Link href={backTo} className="muted">← Clients</Link>
      <h1>Σε Group</h1>
      <Flash sp={flash} />
      {brands.length === 0 ? (
        <div className="card alert">Τσέκαρε στη λίστα τους πελάτες (brands) που ανήκουν στην ίδια εταιρεία και πάτα «Σε Group». <Link href="/customers">Πίσω</Link></div>
      ) : (
        <form action={setGroupAction} className="card stack">
          {brands.map((b) => <input key={b.id} type="hidden" name="ids" value={b.id} />)}
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="list" value={backTo} />
          <p style={{ margin: 0 }}>Αυτά θα γίνουν <strong>brands</strong> του ίδιου Group. Κρατούν το δικό τους ιστορικό και Account Executive· στο Group βλέπεις το σύνολο.</p>
          <div className="list">
            {brands.map((b) => (
              <div key={b.id} className="item">
                <span className="grow"><strong>{b.display_name}</strong><div className="muted">τελευταία {periodGr(b.last_period)}{b.parent_name ? ` · τώρα στο Group ${b.parent_name}` : ""}</div></span>
                <span className="badge gray">{eur(b.lifetime_revenue)}</span>
              </div>
            ))}
          </div>
          <label>Group
            <select name="group_id" defaultValue={pickedGroup?.id ?? ""}>
              <option value="">Νέο Group (γράψε όνομα από κάτω)</option>
              {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.display_name}</option>)}
            </select>
          </label>
          <label>Όνομα νέου Group<input name="new_name" placeholder="π.χ. ΚΡΙΜΑΤΟΓΛΟΥ" /></label>
          <div className="row">
            <SubmitButton>Μέσα στο Group</SubmitButton>
            <Link href={backTo} className="btn secondary">Άκυρο</Link>
          </div>
        </form>
      )}
    </main>
  );
}
