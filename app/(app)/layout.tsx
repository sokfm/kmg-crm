import Link from "next/link";
import { requireProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, isAdmin } = await requireProfile();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .is("read_at", null);
  const bell = count ? `Ειδοποιήσεις (${count})` : "Ειδοποιήσεις";

  return (
    <>
      <nav className="top">
        <div className="inner">
          <Link href="/today" className="logo">KMG CRM</Link>
          <span className="links row">
            <Link href="/today">Σήμερα</Link>
            <Link href="/leads">Leads</Link>
            <Link href="/customers">Πελάτες</Link>
            <Link href="/base">Βάση</Link>
            {isAdmin && <Link href="/merges">Ενώσεις</Link>}
            <Link href="/notifications">{bell}</Link>
          </span>
          <span className="grow" />
          <Link href="/leads/new" className="btn" style={{ color: "#fff", padding: "7px 12px" }}>+ Νέο lead</Link>
          <span className="muted">{profile.full_name.split(" ")[0]}</span>
        </div>
      </nav>
      {children}
      <nav className="bottom">
        <Link href="/today">Σήμερα</Link>
        <Link href="/leads">Leads</Link>
        <Link href="/customers">Πελάτες</Link>
        <Link href="/base">Βάση</Link>
        <Link href="/notifications">{count ? `🔔 ${count}` : "🔔"}</Link>
      </nav>
    </>
  );
}
