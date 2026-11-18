import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { CHANNEL, eur, periodGr } from "@/lib/format";

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin, profile } = await requireProfile();
  let q = supabase
    .from("customers")
    .select("id, display_name, channel, agency, last_period, revenue_by_year, profiles!customers_owner_id_fkey(full_name)")
    .eq("status", "active")
    .order("display_name")
    .limit(400);
  if (sp.q) q = q.ilike("display_name", `%${sp.q}%`);
  if (!isAdmin) q = q.eq("owner_id", profile.id);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; display_name: string; channel: string; agency: string | null; last_period: string | null;
    revenue_by_year: Record<string, number>; profiles: { full_name: string } | null;
  }[];
  const y = String(new Date().getFullYear());

  return (
    <main className="wrap">
      <h1>Ενεργοί πελάτες</h1>
      <p className="muted">{rows.length} πελάτες που έπαιξαν από το 2025 και μετά. Οι παλαιότεροι είναι στη <Link href="/base">βάση</Link>.</p>
      <form className="row">
        <input name="q" defaultValue={sp.q} placeholder="Αναζήτηση…" className="grow" />
        <button type="submit" className="secondary">Αναζήτηση</button>
      </form>
      <div className="list">
        {rows.map((c) => (
          <Link key={c.id} href={`/customers/${c.id}`} className="item">
            <div className="grow">
              <div className="title">{c.display_name}</div>
              <div className="muted">
                {CHANNEL[c.channel]}{c.agency ? ` · ${c.agency}` : ""} · {c.profiles?.full_name ?? "Χωρίς υπεύθυνο"} · τελευταία: {periodGr(c.last_period)}
              </div>
            </div>
            <span className="badge gray">{y}: {eur(c.revenue_by_year?.[y] ?? 0)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
