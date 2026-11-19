import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncAll } from "@/lib/mail/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Τρέχει αυτόματα κάθε 5 λεπτά (vercel.json). Η Vercel στέλνει το CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await syncAll(supabaseAdmin());
  return NextResponse.json({ results });
}
