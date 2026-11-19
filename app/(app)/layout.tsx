import Link from "next/link";
import { requireProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, isAdmin } = await requireProfile();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .is("read_at", null);
  const bell = count ? `Notifications (${count})` : "Notifications";
  const { count: reviewCount } = await supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("status", "review");
  const { count: taskCount } = await supabase
    .from("tasks").select("id", { count: "exact", head: true })
    .eq("owner_id", profile.id).eq("status", "open").lte("due_date", new Date().toISOString().slice(0, 10));

  return (
    <>
      <nav className="top">
        <div className="inner">
          <Link href="/today" className="logo">KMG CRM</Link>
          <span className="links row">
            <Link href="/today">Today</Link>
            {isAdmin && <Link href="/dashboard">Dashboard</Link>}
            <Link href="/pipeline">Pipeline</Link>
            <Link href="/leads">Leads</Link>
            <Link href="/tasks">{taskCount ? `Tasks (${taskCount})` : "Tasks"}</Link>
            <Link href="/customers">Clients</Link>
            <Link href="/agencies">Media Shops</Link>
            {isAdmin && <Link href="/merges">Merge</Link>}
            {!!reviewCount && <Link href="/inbox">Προς έλεγχο ({reviewCount})</Link>}
            <Link href="/notifications">{bell}</Link>
            <Link href="/settings">⚙︎</Link>
          </span>
          <span className="grow" />
          <Link href="/leads/new" className="btn" style={{ color: "#fff", padding: "7px 12px" }}>+ Νέο lead</Link>
          <span className="muted">{profile.full_name.split(" ")[0]}</span>
        </div>
      </nav>
      {children}
      <nav className="bottom">
        <Link href="/today">Today</Link>
        <Link href="/pipeline">Pipeline</Link>
        {isAdmin && <Link href="/dashboard">Dashboard</Link>}
        <Link href="/tasks">{taskCount ? `Tasks ${taskCount}` : "Tasks"}</Link>
        <Link href="/customers">Clients</Link>
        <Link href="/agencies">Shops</Link>
        {!!reviewCount && <Link href="/inbox">Έλεγχος {reviewCount}</Link>}
        <Link href="/notifications">{count ? `🔔 ${count}` : "🔔"}</Link>
      </nav>
    </>
  );
}
