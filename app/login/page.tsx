import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

// Σύνδεση χωρίς κωδικό πρόσβασης: σύνδεσμος ή 6ψήφιος κωδικός στο email.
async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
  });
  redirect(error ? "/login?error=send" : `/login?sent=1&email=${encodeURIComponent(email)}`);
}

// Ο κωδικός δουλεύει από οποιαδήποτε συσκευή και δεν «καίγεται» από την προεπισκόπηση του Outlook.
async function verifyCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const token = String(formData.get("token") || "").replace(/\s/g, "");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  redirect(error ? `/login?sent=1&email=${encodeURIComponent(email)}&error=code` : "/today");
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 80 }}>
      <h1>KMG CRM</h1>
      <p className="muted">Γράψε το email της δουλειάς σου. Θα σου έρθει σύνδεσμος για να μπεις.</p>
      {sp.sent && <div className="msg ok">Σου στείλαμε email. Πάτα τον σύνδεσμο, ή γράψε παρακάτω τον κωδικό αν υπάρχει στο email.</div>}
      {sp.error === "send" && <div className="msg error">Δεν στάλθηκε. Είναι σωστό το email; Μόνο λογαριασμοί της ομάδας μπαίνουν. Αν ζήτησες πολλούς συνδέσμους, περίμενε λίγα λεπτά.</div>}
      {sp.error === "code" && <div className="msg error">Ο κωδικός δεν είναι σωστός ή έληξε. Ζήτα νέο email.</div>}
      {sp.error === "link" && <div className="msg error">Ο σύνδεσμος δεν δούλεψε: έληξε, χρησιμοποιήθηκε ήδη ή άνοιξε σε άλλον browser. Ζήτα νέο email.</div>}
      {sp.error === "noprofile" && <div className="msg error">Ο λογαριασμός σου δεν έχει ρόλο ακόμα. Μίλα με τον Νίκο.</div>}

      {sp.sent && sp.email ? (
        <form action={verifyCode} className="stack card">
          <input type="hidden" name="email" value={sp.email} />
          <label>
            Κωδικός από το email
            <input name="token" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" />
          </label>
          <button type="submit">Μπες</button>
        </form>
      ) : null}

      <form action={sendLink} className="stack card">
        <label>
          Email
          <input name="email" type="email" required placeholder="onoma@sokfm.gr" autoComplete="email" defaultValue={sp.email} />
        </label>
        <button type="submit" className={sp.sent ? "secondary" : undefined}>{sp.sent ? "Στείλε ξανά" : "Στείλε μου σύνδεσμο"}</button>
      </form>
    </main>
  );
}
