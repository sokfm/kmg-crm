"use server";
import { requireProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pushToUser } from "@/lib/push";

// Η συσκευή δηλώνει ότι δέχεται ειδοποιήσεις για τον χρήστη που είναι συνδεδεμένος
export async function savePush(sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, device: string): Promise<{ ok: boolean; error?: string }> {
  const { profile } = await requireProfile();
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "Η συσκευή δεν έδωσε στοιχεία ειδοποιήσεων." };
  try {
    const admin = supabaseAdmin();
    await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);   // ίδια συσκευή, άλλος χρήστης παλιότερα
    const { error } = await admin.from("push_subscriptions").insert({ user_id: profile.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device.slice(0, 120) });
    if (error) return { ok: false, error: "Δεν αποθηκεύτηκε. Δοκίμασε ξανά." };
    await pushToUser(admin, profile.id, { title: "Οι ειδοποιήσεις άναψαν ✓", body: "Εδώ θα έρχονται οι υπενθυμίσεις σου από το KMG CRM.", url: "/today", tag: "welcome" });
    return { ok: true };
  } catch { return { ok: false, error: "Κάτι πήγε στραβά στον server." }; }
}

export async function removePush(endpoint: string): Promise<{ ok: boolean }> {
  const { supabase } = await requireProfile();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

export async function testPush(): Promise<{ ok: boolean; sent: number }> {
  const { profile } = await requireProfile();
  try {
    const sent = await pushToUser(supabaseAdmin(), profile.id, { title: "Δοκιμή από το KMG CRM", body: "Αν το βλέπεις, οι υπενθυμίσεις δουλεύουν.", url: "/today", tag: "test" });
    return { ok: true, sent };
  } catch { return { ok: false, sent: 0 }; }
}
