import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { eur, periodGr } from "@/lib/format";
import { decideWeb, runWebBatch, setWebAuto } from "../actions";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";

export const maxDuration = 300;

// Διαχείριση: έλεγχος πελατών στο ίντερνετ και λίστα όσων δεν βρέθηκαν ή έκλεισαν.
export default async function WebCheck({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/today");

  const count = async (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => (await f(base())).count ?? 0;
  const base = () => supabase.from("customers").select("id", { count: "exact", head: true });
  const [total, checked, found, closedConfirmed, pending, runs, setting, { data: review }] = await Promise.all([
    count((q) => q),
    count((q) => q.not("web_checked_at", "is", null)),
    count((q) => q.eq("web_status", "found")),
    count((q) => q.not("closed_at", "is", null)),
    count((q) => q.in("web_status", ["not_found", "closed", "error"]).is("web_reviewed_at", null).is("closed_at", null)),
    supabase.from("web_runs").select("searches, input_tokens, output_tokens").limit(5000),
    supabase.from("app_settings").select("value").eq("key", "web_auto").maybeSingle(),
    supabase.from("customers")
      .select("id, display_name, status, last_period, lifetime_revenue, web_status, web_note, web_sources, agency")
      .in("web_status", ["not_found", "closed", "error"]).is("web_reviewed_at", null).is("closed_at", null)
      .order("status").order("last_period", { ascending: false, nullsFirst: false }).limit(40),
  ]);
  const r = runs.data ?? [];
  const searches = r.reduce((s, x) => s + x.searches, 0);
  // Εκτίμηση: 10$/1.000 αναζητήσεις + tokens (περίπου 1$/εκ. input, 5$/εκ. output)
  const cost = searches * 0.01 + r.reduce((s, x) => s + x.input_tokens / 1e6 + (x.output_tokens * 5) / 1e6, 0);
  const perOne = r.length ? cost / r.length : 0.03;
  const left = total - checked - closedConfirmed;
  const auto = (setting.data?.value ?? {}) as { on?: boolean; error?: string | null; finished?: boolean };
  const [d, f, rv, er] = (sp.n ?? "").split("-");

  return (
    <main className="wrap" style={{ maxWidth: 980 }}>
      <div>
        <h1>Έλεγχος online</h1>
        <p className="muted" style={{ margin: 0 }}>
          Η AI ψάχνει κάθε πελάτη στο ίντερνετ και συμπληρώνει τηλέφωνο, email, site, διεύθυνση και κατηγορία. Όσοι δεν βρίσκονται ή φαίνονται κλειστοί
          έρχονται εδώ για να αποφασίσεις. Δεν σβήνεται τίποτα μόνο του.
        </p>
      </div>
      <Flash sp={sp} />
      {sp.ok === "webbatch" && <div className="msg ok">Ελέγχθηκαν {d}: βρέθηκαν {f}, για έλεγχο {rv}{Number(er) ? `, σφάλματα ${er}` : ""}.</div>}
      {auto.error && <div className="msg error">Το αυτόματο ψάξιμο σταμάτησε: {auto.error}</div>}

      <div className="kpis">
        <div className="card kpi-card"><span className="muted">Ελέγχθηκαν</span><span className="kpi">{checked} / {total}</span><span className="muted">απομένουν {left}</span></div>
        <div className="card kpi-card"><span className="muted">Βρέθηκαν online</span><span className="kpi">{found}</span><span className="muted">με στοιχεία επικοινωνίας</span></div>
        <div className={`card kpi-card ${pending ? "hot" : ""}`}><span className="muted">Θέλουν απόφαση</span><span className="kpi">{pending}</span><span className="muted">δεν βρέθηκαν ή έκλεισαν</span></div>
        <div className="card kpi-card"><span className="muted">Κόστος μέχρι τώρα (εκτίμηση)</span><span className="kpi">{cost.toFixed(2)} $</span><span className="muted">{searches} αναζητήσεις · για όλους ~{(left * perOne).toFixed(0)} $ ακόμα</span></div>
      </div>

      <div className="card stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Ψάξιμο</h2>
        <p className="muted" style={{ margin: 0 }}>Πρώτα οι ενεργοί πελάτες, μετά η βάση από τους πιο πρόσφατους. Ξεκίνα με δοκιμή 10 για να δεις ποιότητα και κόστος.</p>
        <div className="row">
          <form action={runWebBatch}><input type="hidden" name="n" value="10" /><SubmitButton pending="Ψάχνω 10…" hint="Περίπου 1 λεπτό">Δοκιμή σε 10</SubmitButton></form>
          <form action={runWebBatch}><input type="hidden" name="n" value="50" /><SubmitButton className="secondary" pending="Ψάχνω 50…" hint="Περίπου 4 λεπτά">Ψάξε 50</SubmitButton></form>
          <span className="grow" />
          <form action={setWebAuto} className="row">
            <input type="hidden" name="on" value={auto.on ? "0" : "1"} />
            <span className="muted">{auto.on ? "Αυτόματο: ανοιχτό (15 πελάτες / 10 λεπτά)" : auto.finished ? "Αυτόματο: τελείωσε" : "Αυτόματο: κλειστό"}</span>
            <SubmitButton className={auto.on ? "secondary" : "dark"}>{auto.on ? "Σταμάτημα" : "Ψάξε όλους αυτόματα"}</SubmitButton>
          </form>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="day-head"><h2 className="grow" style={{ margin: 0 }}>Δεν βρέθηκαν ή έκλεισαν</h2><span className="badge">{pending}</span></div>
        {(review ?? []).length === 0 && <p className="muted" style={{ padding: 18 }}>Τίποτα για απόφαση.</p>}
        {(review ?? []).map((c) => (
          <div key={c.id} className="day-row" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 260 }}>
              <Link href={`/customers/${c.id}`} style={{ fontWeight: 800 }}>{c.display_name}</Link>{" "}
              <span className={`badge ${c.web_status === "closed" ? "late" : "gray"}`}>{c.web_status === "closed" ? "Φαίνεται κλειστή" : c.web_status === "error" ? "Σφάλμα" : "Δεν βρέθηκε"}</span>
              <div className="muted">
                {c.status === "active" ? "Ενεργός" : "Βάση"} · τελευταία {periodGr(c.last_period)} · {eur(c.lifetime_revenue)}{c.agency ? ` · ${c.agency}` : ""}
              </div>
              {c.web_note && <div className="muted">AI: {c.web_note}</div>}
              {(c.web_sources ?? []).slice(0, 2).map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer" className="muted" style={{ marginRight: 10 }}>πηγή ↗</a>)}
            </div>
            <a className="btn secondary" href={`https://www.google.com/search?q=${encodeURIComponent(c.display_name + " Χαλκίδα")}`} target="_blank" rel="noreferrer">Google ↗</a>
            <form action={decideWeb}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="closed" value="0" /><SubmitButton className="secondary">Υπάρχει</SubmitButton></form>
            <form action={decideWeb}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="closed" value="1" /><SubmitButton className="dark">Έκλεισε</SubmitButton></form>
          </div>
        ))}
      </div>
    </main>
  );
}
