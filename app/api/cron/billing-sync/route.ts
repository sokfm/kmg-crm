import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runBillingSync } from "@/lib/billing/sync";
import { flushNotifications } from "@/lib/push";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Κάθε βράδυ (vercel.json): διαβάζει τα Excel τιμολόγησης από το Dropbox και φέρνει τον τζίρο του CRM στα ίδια με το αρχείο.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const r = await runBillingSync(admin);
  if (r.ran) await flushNotifications(admin);
  return NextResponse.json(r);
}
