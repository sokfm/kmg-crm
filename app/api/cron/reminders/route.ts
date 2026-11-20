import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flushNotifications } from "@/lib/push";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Κάθε 5 λεπτά (vercel.json): βγάζει τις υπενθυμίσεις που ήρθε η ώρα τους και στέλνει τις νέες ειδοποιήσεις στα κινητά.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const { data: made, error } = await admin.rpc("make_reminders");
  const { data: waiting } = await admin.rpc("make_inbox_reminders");
  const sent = await flushNotifications(admin);
  return NextResponse.json({ reminders: made ?? 0, inbox: waiting ?? 0, error: error?.message ?? null, ...sent });
}
