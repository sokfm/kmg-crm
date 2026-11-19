import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

// Σύνδεση με σύνδεσμο στο email: κανένας κωδικός για να ξεχαστεί.
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
  redirect(error ? "/login?error=send" : "/login?sent=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 80 }}>
      <h1>KMG CRM</h1>
      <p className="muted">Γράψε το email της δουλειάς σου. Θα σου έρθει σύνδεσμος για να μπεις.</p>
      {sp.sent && <div className="msg ok">Σου στείλαμε σύνδεσμο. Άνοιξε το email σου.</div>}
      {sp.error === "send" && <div className="msg error">Δεν στάλθηκε. Είναι σωστό το email; Μόνο λογαριασμοί της ομάδας μπαίνουν.</div>}
      {sp.error === "link" && <div className="msg error">Ο σύνδεσμος δεν δούλεψε: έληξε, χρησιμοποιήθηκε ήδη ή άνοιξε σε άλλον browser. Ζήτα νέο και άνοιξέ τον στη συσκευή όπου τον ζήτησες.</div>}
      {sp.error === "noprofile" && <div className="msg error">Ο λογαριασμός σου δεν έχει ρόλο ακόμα. Μίλα με τον Νίκο.</div>}
      <form action={sendLink} className="stack card">
        <label>
          Email
          <input name="email" type="email" required placeholder="onoma@sokfm.gr" autoComplete="email" />
        </label>
        <button type="submit">Στείλε μου σύνδεσμο</button>
      </form>
    </main>
  );
}
