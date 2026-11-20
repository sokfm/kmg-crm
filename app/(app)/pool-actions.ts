"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";

const s = (f: FormData, k: string) => { const v = f.get(k); return v == null || String(v).trim() === "" ? null : String(v).trim(); };
const go = (path: string, params: Record<string, string>) => redirect(`${path}?${new URLSearchParams(params).toString()}`);
const greek = (m?: string) => (m && /[Α-Ωα-ω]/.test(m) ? m : "Δεν έγινε. Δοκίμασε ξανά.");

// «Το αφήνω»: το χαμένο lead φεύγει από το όνομά μου και γίνεται διαθέσιμο
export async function releaseLost(f: FormData) {
  const { supabase } = await requireProfile();
  const id = s(f, "id")!;
  const { error } = await supabase.rpc("release_lost_lead", { p_id: id });
  if (error) go(`/leads/${id}`, { error: greek(error.message) });
  revalidatePath("/leads"); revalidatePath("/leads/pool"); revalidatePath("/today");
  go("/leads/pool", { ok: "released" });
}

// Account Executive: ζητάει ένα διαθέσιμο χαμένο lead
export async function requestLost(f: FormData) {
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("request_lost_lead", { p_lead: s(f, "lead_id")!, p_note: s(f, "note") });
  if (error) go("/leads/pool", { error: greek(error.message) });
  revalidatePath("/leads/pool");
  go("/leads/pool", { ok: "poolasked" });
}

// Νίκος ή Γιάννα: ΟΚ ή όχι
export async function decideClaim(f: FormData) {
  const { supabase } = await requireProfile();
  const ok = s(f, "approve") === "1";
  const { error } = await supabase.rpc("decide_lead_claim", { p_id: s(f, "id")!, p_approve: ok });
  if (error) go("/leads/pool", { error: greek(error.message) });
  revalidatePath("/leads/pool"); revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/today");
  go("/leads/pool", { ok: ok ? "poolyes" : "poolno" });
}
