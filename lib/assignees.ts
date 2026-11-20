import type { SupabaseClient } from "@supabase/supabase-js";

// Σε ποιους μπορεί να αναθέσει εργασία ο χρήστης: μόνο ο Νίκος και η Γιάννα αναθέτουν σε άλλους
// (ο κανόνας ισχύει και στη βάση, policy tasks_insert). Οι υπόλοιποι βάζουν εργασίες μόνο στον εαυτό τους.
export async function assignees(supabase: SupabaseClient, isAdmin: boolean, selfId: string): Promise<{ id: string; full_name: string }[]> {
  if (!isAdmin) return [];
  const { data } = await supabase.from("profiles").select("id, full_name").eq("active", true).neq("id", selfId).order("full_name");
  return (data ?? []) as { id: string; full_name: string }[];
}
