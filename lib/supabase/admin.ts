import { createClient } from "@supabase/supabase-js";

// Πρόσβαση με δικαιώματα συστήματος. ΜΟΝΟ στον server (συγχρονισμός email,
// αποθήκευση σύνδεσης Outlook). Ποτέ σε σελίδα που φτάνει στον browser.
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Λείπει το SUPABASE_SERVICE_ROLE_KEY στη Vercel");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
