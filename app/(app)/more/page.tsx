import Link from "next/link";
import { requireProfile } from "@/lib/auth";

// Κινητό: ό,τι δεν χωράει στο κάτω μενού.
export default async function More() {
  const { supabase, isAdmin, profile } = await requireProfile();
  const [{ count: review }, { count: notes }] = await Promise.all([
    supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("status", "review"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null),
  ]);
  const links: [string, string, number?][] = [
    ["/search", "Αναζήτηση"],
    ["/leads", "Leads"],
    ["/agencies", "Media Shops"],
    ...(isAdmin ? ([["/dashboard", "Dashboard"]] as [string, string][]) : []),
    ...(review ? ([["/inbox", "Προς έλεγχο", review]] as [string, string, number][]) : []),
    ...(isAdmin ? ([["/merges", "Merge"], ["/web-check", "Έλεγχος online"]] as [string, string][]) : []),
    ["/notifications", "Notifications", notes ?? 0],
    ["/settings", "Ρυθμίσεις & Outlook"],
  ];
  return (
    <main className="wrap" style={{ maxWidth: 560 }}>
      <h1>Περισσότερα</h1>
      <div className="list">
        {links.map(([href, label, n]) => (
          <Link key={href} href={href} className="item">
            <span className="grow title">{label}</span>
            {!!n && <span className="badge">{n}</span>}
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
