import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Role = "ceo" | "sales_manager" | "account_exec" | "digital_intake";
export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  sees_digital: boolean;
};

export async function requireProfile() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, sees_digital")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login?error=noprofile");
  const p = profile as Profile;
  return {
    supabase,
    profile: p,
    isAdmin: p.role === "ceo" || p.role === "sales_manager",
    isCeo: p.role === "ceo",
  };
}
