import { requireProfile } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { today } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, isAdmin } = await requireProfile();
  const t = today();
  const [n, r, k, l] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null),
    supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("status", "review"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("owner_id", profile.id).eq("status", "open").lte("due_date", t),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("owner_id", profile.id).not("status", "in", "(won,lost)").lt("next_step_due", t),
  ]);
  return (
    <Shell
      name={profile.full_name}
      role={profile.role}
      isAdmin={isAdmin}
      counts={{ late: l.count ?? 0, tasks: k.count ?? 0, review: r.count ?? 0, notifications: n.count ?? 0 }}
    >
      {children}
    </Shell>
  );
}
