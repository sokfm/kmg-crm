import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enrichBatch } from "@/lib/enrich";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Κάθε 10 λεπτά (vercel.json): αν ο Νίκος/Γιάννα έχει ανοίξει το «αυτόματο ψάξιμο»,
// ψάχνει τους επόμενους 15 πελάτες. Σταματά μόνο του όταν τελειώσουν ή αν τελειώσει η πίστωση.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: s } = await db.from("app_settings").select("value").eq("key", "web_auto").maybeSingle();
  if (!(s?.value as { on?: boolean } | null)?.on) return NextResponse.json({ skipped: "off" });
  const r = await enrichBatch(db, 15);
  if (r.stopped || r.done === 0) {
    await db.from("app_settings").upsert({ key: "web_auto", value: { on: false, error: r.stopped ?? null, finished: !r.stopped }, updated_at: new Date().toISOString() });
  }
  return NextResponse.json(r);
}
