import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { exchangeCode, graph } from "@/lib/mail/microsoft";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Η Microsoft γυρίζει εδώ μετά τη σύνδεση. Κρατάμε το κλειδί ανανέωσης μόνο στη βάση,
// σε πίνακα που δεν τον διαβάζει κανείς από την εφαρμογή.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, url.origin));
  const { profile } = await requireProfile();

  const jar = await cookies();
  const expected = jar.get("ms_state")?.value;
  if (!expected || expected !== url.searchParams.get("state")) return back("error=state");
  if (url.searchParams.get("error")) return back("error=" + encodeURIComponent(url.searchParams.get("error_description") ?? "denied"));

  try {
    const tok = await exchangeCode(url.searchParams.get("code") ?? "", `${url.origin}/api/outlook/callback`);
    if (!tok.refresh_token) return back("error=norefresh");
    const me = await graph<{ mail?: string; userPrincipalName?: string }>(tok.access_token, "/me?$select=mail,userPrincipalName");
    const msEmail = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
    const db = supabaseAdmin();
    const { error } = await db.from("mail_accounts").upsert({
      user_id: profile.id,
      ms_email: msEmail,
      refresh_token: tok.refresh_token,
      connected_at: new Date().toISOString(),
      last_error: null,
    });
    if (error) return back("error=" + encodeURIComponent(error.message));
    const res = back("ok=outlook");
    res.cookies.delete("ms_state");
    return res;
  } catch (e) {
    return back("error=" + encodeURIComponent(e instanceof Error ? e.message : "unknown"));
  }
}
