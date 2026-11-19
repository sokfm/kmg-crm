import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { dateGr } from "@/lib/format";
import { markAllRead } from "../actions";

export default async function Notifications() {
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, link, read_at, created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <div className="row">
        <h1 className="grow">Ειδοποιήσεις</h1>
        {rows.some((r) => !r.read_at) && (
          <form action={markAllRead}><SubmitButton className="secondary">Τα διάβασα όλα</SubmitButton></form>
        )}
      </div>
      {rows.length === 0 && <p className="muted">Καμία ειδοποίηση.</p>}
      <div className="list">
        {rows.map((n) => (
          <Link key={n.id} href={n.link ?? "#"} className="item" style={{ fontWeight: n.read_at ? 400 : 600 }}>
            <div className="grow">{n.title}</div>
            <span className="muted">{dateGr(n.created_at)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
