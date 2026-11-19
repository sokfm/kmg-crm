import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Σύνδεσμος από το προεπιλεγμένο email του Supabase (?code=...).
// Δουλεύει όταν ανοίγει στον ίδιο browser όπου ζητήθηκε ο σύνδεσμος.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/today", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
