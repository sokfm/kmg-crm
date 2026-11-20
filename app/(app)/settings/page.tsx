import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { PricingBody } from "@/components/PricingBody";
import { SubmitButton } from "@/components/SubmitButton";
import { PushSetup } from "@/components/PushSetup";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { vapid } from "@/lib/push";
import { disconnectOutlook, setPassword, syncMailNow } from "../actions";
import { saveOfferContact } from "../proposal-actions";

export const maxDuration = 300;

const fmt = (d: string | null) =>
  d ? new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(new Date(d)) : "—";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, profile, isAdmin } = await requireProfile();
  const tab = isAdmin && sp.tab === "pricing" ? "pricing" : "general";
  const { data: acc } = await supabase.from("my_mail_account").select("*").maybeSingle();
  const { data: offer } = await supabase.from("profiles").select("offer_name, offer_phone").eq("id", profile.id).maybeSingle();
  const { count: devices } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", profile.id);
  let pushKey: string | null = null;
  try { pushKey = (await vapid(supabaseAdmin())).publicKey; } catch { pushKey = null; }
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const count = async (status: string) =>
    (await supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("status", status).gte("created_at", since)).count ?? 0;
  const [logged, leads, review] = acc ? await Promise.all([count("logged"), count("lead_created"), count("review")]) : [0, 0, 0];
  const [nLogged, nLeads, nReview, nTasks] = (sp.n ?? "").split("-");

  return (
    <main className="wrap" style={{ maxWidth: tab === "pricing" ? 1000 : 720 }}>
      <h1>Ρυθμίσεις</h1>
      {isAdmin && (
        <div className="sf-tabs" style={{ marginBottom: 14 }}>
          <a href="/settings" className={tab === "general" ? "on" : ""}>Γενικά</a>
          <a href="/settings?tab=pricing" className={tab === "pricing" ? "on" : ""}>Κοστολόγηση</a>
        </div>
      )}
      <Flash sp={sp} />
      {tab === "pricing" ? <PricingBody sp={sp} edit /> : <>
      {sp.ok === "sync" && sp.n && (
        <div className="msg ok">
          Καταγράφηκαν {nLogged} email σε καρτέλες · {nLeads} νέα leads · {nReview} προς έλεγχο · {nTasks} εργασίες.
        </div>
      )}

      {tab === "general" && (
        <div className="card stack" id="push">
          <h2 style={{ margin: 0 }}>Υπενθυμίσεις στο κινητό</h2>
          <p className="muted" style={{ margin: 0 }}>Έρχονται σαν μήνυμα, ακόμα κι όταν το CRM είναι κλειστό: 10 λεπτά πριν από κάθε επόμενο βήμα ή εργασία που έχει ώρα, μία σύνοψη στις 09:00 με όσα έχεις σήμερα, και όποτε σου αναθέτουν κάτι.</p>
          <PushSetup publicKey={pushKey} devices={devices ?? 0} />
        </div>
      )}

      <form action={saveOfferContact} className="card stack">
        <h2 style={{ margin: 0 }}>Τα στοιχεία σου στις προσφορές</h2>
        <p className="muted" style={{ margin: 0 }}>Γράφονται στο PDF που πάει στον πελάτη, μαζί με το email σου ({profile.email}).</p>
        <div className="grid2">
          <label>Ονοματεπώνυμο<input name="offer_name" defaultValue={offer?.offer_name ?? ""} placeholder="π.χ. Nikos Kartelias" maxLength={60} /></label>
          <label>Κινητό<input name="offer_phone" defaultValue={offer?.offer_phone ?? ""} placeholder="π.χ. 697 000 0000" maxLength={30} /></label>
        </div>
        <div><SubmitButton pending="Αποθήκευση…">Αποθήκευση</SubmitButton></div>
      </form>

      <form action={setPassword} className="card stack">
        <h2 style={{ margin: 0 }}>Κωδικός για το κινητό</h2>
        <p className="muted" style={{ margin: 0 }}>
          Βάλε έναν κωδικό και στο κινητό μπαίνεις με email + κωδικό, χωρίς σύνδεσμο στο email. Μετά την πρώτη φορά το κινητό σε θυμάται.
          Τουλάχιστον 10 χαρακτήρες· μην τον χρησιμοποιείς αλλού και μην τον στέλνεις σε κανέναν.
        </p>
        <div className="grid2">
          <label>Νέος κωδικός<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
          <label>Ξανά ο ίδιος<input name="password2" type="password" autoComplete="new-password" minLength={10} required /></label>
        </div>
        <div><SubmitButton pending="Αποθήκευση…">Αποθήκευση κωδικού</SubmitButton></div>
      </form>

      <div className="card stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2>Σύνδεση Outlook</h2>
        {acc ? (
          <>
            <div>✅ Συνδεδεμένο: <strong>{acc.ms_email}</strong> από {fmt(acc.connected_at)}</div>
            <div className="muted">Τελευταίος έλεγχος: {fmt(acc.last_sync_at)} · γίνεται αυτόματα κάθε 5 λεπτά</div>
            {acc.last_error && <div className="msg error">Τελευταίο σφάλμα: {acc.last_error}</div>}
            <div className="muted">Τελευταίες 7 μέρες: {logged} email σε καρτέλες · {leads} νέα leads · {review} προς έλεγχο</div>
            <div className="row">
              <form action={syncMailNow}><SubmitButton pending="Γίνεται έλεγχος των email…" hint="Διαβάζει και ταξινομεί τα email. Μπορεί να πάρει 1–2 λεπτά — μην κλείσεις τη σελίδα.">Έλεγχος τώρα</SubmitButton></form>
              <form action={disconnectOutlook}><SubmitButton className="danger" pending="Αποσύνδεση…">Αποσύνδεση</SubmitButton></form>
            </div>
          </>
        ) : (
          <>
            <p>
              Σύνδεσε το email σου ({profile.email}) για να γράφονται αυτόματα στις καρτέλες τα email με πελάτες,
              να γίνονται leads τα νέα αιτήματα και να βγαίνουν εργασίες.
            </p>
            <p className="muted">
              Το CRM κρατάει μόνο θέμα, ημερομηνία, σύντομη περίληψη και σύνδεσμο προς το Outlook. Προσωπικά και άσχετα email αγνοούνται.
              Ελέγχει τις τελευταίες 14 μέρες και μετά ό,τι νέο.
            </p>
            <a className="btn" href="/api/outlook/connect" style={{ alignSelf: "flex-start" }}>Σύνδεση Outlook</a>
          </>
        )}
      </div>
      </>}
    </main>
  );
}
