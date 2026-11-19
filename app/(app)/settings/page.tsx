import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { disconnectOutlook, syncMailNow } from "../actions";

export const maxDuration = 300;

const fmt = (d: string | null) =>
  d ? new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(new Date(d)) : "—";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireProfile();
  const { data: acc } = await supabase.from("my_mail_account").select("*").maybeSingle();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const count = async (status: string) =>
    (await supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("status", status).gte("created_at", since)).count ?? 0;
  const [logged, leads, review] = acc ? await Promise.all([count("logged"), count("lead_created"), count("review")]) : [0, 0, 0];
  const [nLogged, nLeads, nReview, nTasks] = (sp.n ?? "").split("-");

  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <h1>Ρυθμίσεις</h1>
      <Flash sp={sp} />
      {sp.ok === "sync" && sp.n && (
        <div className="msg ok">
          Καταγράφηκαν {nLogged} email σε καρτέλες · {nLeads} νέα leads · {nReview} προς έλεγχο · {nTasks} εργασίες.
        </div>
      )}

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
    </main>
  );
}
