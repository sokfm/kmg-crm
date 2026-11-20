"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const s = (f: FormData, k: string) => { const v = f.get(k); return v == null || String(v).trim() === "" ? null : String(v).trim(); };
const go = (path: string, params: Record<string, string>) => redirect(`${path}?${new URLSearchParams(params).toString()}`);
const greek = (m?: string) => (m && /[Α-Ωα-ω]/.test(m) ? m : "Δεν έγινε. Δοκίμασε ξανά.");

// Account Executive: ζητάει να δει την καρτέλα και τον τζίρο ενός πελάτη που δεν έχει τρέξει ο ίδιος
export async function requestAccess(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "customer_id")!;
  const { error } = await supabase.rpc("request_customer_access", { p_customer: id, p_reason: s(f, "reason") ?? "" });
  if (error) go(`/customers/${id}`, { error: greek(error.message) });
  revalidatePath(`/customers/${id}`); revalidatePath("/access");
  go(`/customers/${id}`, { ok: "accessasked" });
}

// Νίκος: εγκρίνει (7 ημέρες) ή απορρίπτει
export async function decideAccess(f: FormData) {
  const { supabase } = await requireProfile();
  const back = s(f, "back")?.startsWith("/") ? s(f, "back")! : "/access";
  const { error } = await supabase.rpc("decide_customer_access", { p_id: s(f, "id")!, p_approve: s(f, "approve") === "1", p_note: s(f, "note") });
  if (error) go(back, { error: greek(error.message) });
  revalidatePath("/access"); revalidatePath("/today");
  go(back, { ok: s(f, "approve") === "1" ? "accessyes" : "accessno" });
}
