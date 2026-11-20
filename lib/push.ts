import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Ειδοποιήσεις στο κινητό (web push). ΜΟΝΟ στον server, με δικαιώματα συστήματος.
// Το ζεύγος κλειδιών φτιάχνεται μόνο του την πρώτη φορά και μένει στον πίνακα app_secrets (όχι στο git, όχι στη Vercel).
export async function vapid(admin: SupabaseClient): Promise<{ publicKey: string; privateKey: string }> {
  const read = async () => {
    const { data } = await admin.from("app_secrets").select("key, value").in("key", ["vapid_public", "vapid_private"]);
    const m = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
    return m.get("vapid_public") && m.get("vapid_private") ? { publicKey: m.get("vapid_public")!, privateKey: m.get("vapid_private")! } : null;
  };
  const have = await read();
  if (have) return have;
  const k = webpush.generateVAPIDKeys();
  await admin.from("app_secrets").upsert([{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }], { onConflict: "key", ignoreDuplicates: true });
  return (await read()) ?? k;
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

// Στέλνει σε όλες τις συσκευές ενός χρήστη. Συσκευές που δεν υπάρχουν πια σβήνονται.
export async function pushToUser(admin: SupabaseClient, userId: string, payload: PushPayload): Promise<number> {
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subs || subs.length === 0) return 0;
  const k = await vapid(admin);
  webpush.setVapidDetails("mailto:nikos@sokfm.gr", k.publicKey, k.privateKey);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

// Κάθε νέα ειδοποίηση του CRM (υπενθύμιση, ανάθεση εργασίας, έγκριση τιμής κ.λπ.) φεύγει και στο κινητό, μία φορά.
export async function flushNotifications(admin: SupabaseClient): Promise<{ notifications: number; pushed: number }> {
  const since = new Date(Date.now() - 6 * 3600000).toISOString();
  const { data } = await admin.from("notifications").select("id, user_id, title, link").is("pushed_at", null).gte("created_at", since).order("created_at").limit(200);
  let pushed = 0;
  for (const n of data ?? []) {
    pushed += await pushToUser(admin, n.user_id, { title: n.title, url: n.link ?? "/notifications", tag: n.id });
    await admin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id);
  }
  return { notifications: (data ?? []).length, pushed };
}
