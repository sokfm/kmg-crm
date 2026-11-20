import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireProfile } from "@/lib/auth";
import { dateGr } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { applySuggestions, reviewAsAgency, reviewAsCustomer, reviewAsLead, reviewAsSameLead, reviewIgnore } from "../actions";

const KIND: Record<string, string> = {
  new_lead: "Πιθανό νέο lead",
  existing_customer: "Μάλλον υπάρχων πελάτης",
  agency: "Πρακτορείο",
};

type Em = {
  id: string; direction: string; counterpart_email: string; counterpart_name: string | null; subject: string;
  occurred_at: string; web_link: string | null; summary: string | null; ai_kind: string | null; ai_confidence: number | null;
  ai_reason: string | null; ai_company: string | null; ai_contact_name: string | null; ai_phone: string | null;
  ai_tasks: Idea[] | null; ai_next_step: string | null; ai_next_due: string | null; lead_hint_label: string | null;
};
type Idea = { title: string; due_date: string | null };
type Sug = {
  id: string; direction: string; subject: string; occurred_at: string; web_link: string | null; summary: string | null;
  ai_tasks: Idea[] | null; ai_next_step: string | null; ai_next_due: string | null; lead_id: string | null;
  customers: { display_name: string } | null; leads: { company_name: string } | null; agencies: { name: string } | null;
};
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Λέξη για αναζήτηση πελάτη: η πρώτη «σημαντική» λέξη της εταιρείας ή του domain
function guessWord(e: Em) {
  const fromCompany = (e.ai_company ?? "").split(/[\s\-–,.]+/).find((w) => w.length >= 3);
  if (fromCompany) return fromCompany;
  const dom = e.counterpart_email.split("@")[1]?.split(".")[0] ?? "";
  return ["gmail", "yahoo", "hotmail", "outlook", "otenet", "live"].includes(dom) ? "" : dom;
}

// Χρόνος για το ψάξιμο της AI στο ίντερνετ
export const maxDuration = 120;

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data } = await supabase
    .from("email_messages")
    .select("id, direction, counterpart_email, counterpart_name, subject, occurred_at, web_link, summary, ai_kind, ai_confidence, ai_reason, ai_company, ai_contact_name, ai_phone, ai_tasks, ai_next_step, ai_next_due, lead_hint_label")
    .eq("status", "review")
    .order("occurred_at", { ascending: false })
    .limit(30);
  const items = (data ?? []) as Em[];
  const { data: sugData } = await supabase
    .from("email_messages")
    .select("id, direction, subject, occurred_at, web_link, summary, ai_tasks, ai_next_step, ai_next_due, lead_id, customers(display_name), leads(company_name), agencies(name)")
    .eq("suggest", "pending")
    .order("occurred_at", { ascending: false })
    .limit(30);
  const sugs = (sugData ?? []) as unknown as Sug[];
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };

  const { data: agencyData } = await supabase.from("agencies").select("id, name, domains").order("name");
  const agencies = (agencyData ?? []) as { id: string; name: string; domains: string[] }[];
  const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9α-ω]/g, "");
  // Ποιο πρακτορείο ταιριάζει: από τη διεύθυνση (umedia.gr ↔ U MEDIA) ή από το όνομα του αποστολέα
  const guessAgency = (e: Em) => {
    const dom = e.counterpart_email.slice(e.counterpart_email.indexOf("@")).toLowerCase();
    const word = squash(dom.slice(1).split(".")[0]);
    return (
      agencies.find((a) => a.domains?.includes(dom)) ??
      agencies.find((a) => squash(a.name).length >= 2 && (word === squash(a.name) || word.startsWith(squash(a.name)) || squash(a.name).startsWith(word)))
    )?.id ?? "";
  };

  // Υποψήφιοι πελάτες για κάθε email (ή αναζήτηση που έκανε ο χρήστης)
  const candidates: Record<string, { id: string; display_name: string; status: string }[]> = {};
  for (const e of items) {
    const word = sp.find === e.id && sp.q ? sp.q : guessWord(e);
    if (!word) { candidates[e.id] = []; continue; }
    const { data: c } = await supabase.from("customers_x").select("id, display_name, status").ilike("display_name", `%${word}%`).order("lifetime_revenue", { ascending: false, nullsFirst: false }).limit(6);
    candidates[e.id] = c ?? [];
  }

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <h1>Προς έλεγχο</h1>
      <p className="muted">
        Email που αφορούν πωλήσεις. Τίποτα δεν γίνεται lead, εργασία ή επόμενο βήμα πριν πατήσεις εσύ ΟΚ. Κάθε απάντησή σου τη μαθαίνει: την επόμενη φορά ο ίδιος αποστολέας μπαίνει στην καρτέλα του μόνος του.
      </p>
      <Flash sp={sp} />
      {items.length === 0 && sugs.length === 0 && <div className="card good">Τίποτα για έλεγχο. 👌</div>}

      {items.map((e) => (
        <div key={e.id} className="card stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row">
            <span className="badge">{KIND[e.ai_kind ?? ""] ?? e.ai_kind}</span>
            <span className="muted">{e.direction === "in" ? "Από" : "Προς"} {e.counterpart_name ? `${e.counterpart_name} · ` : ""}{e.counterpart_email} · {dateGr(e.occurred_at)}</span>
            <span className="grow" />
            {e.web_link && <a href={e.web_link} target="_blank" rel="noreferrer">Άνοιγμα στο Outlook ↗</a>}
          </div>
          <div><strong>{e.subject}</strong></div>
          {e.summary && <div>{e.summary}</div>}
          {e.ai_reason && <div className="muted">AI: {e.ai_reason}</div>}

          {e.lead_hint_label && (
            <form action={reviewAsSameLead} className="card warn stack" style={{ margin: 0 }}>
              <input type="hidden" name="id" value={e.id} />
              <div><strong>Μοιάζει με lead που υπάρχει ήδη:</strong> {e.lead_hint_label}</div>
              <div className="row"><SubmitButton>Είναι το ίδιο: βάλ' το εκεί</SubmitButton><span className="muted">Αν είναι άλλη επιχείρηση, άνοιξε «Είναι νέο lead» παρακάτω.</span></div>
            </form>
          )}

          <details open={e.ai_kind === "agency" || !!guessAgency(e)}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>🏢 Αφορά πρακτορείο</summary>
            <form action={reviewAsAgency} className="stack" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={e.id} />
              <div className="grid2">
                <label>Πρακτορείο
                  <select name="agency_id" defaultValue={guessAgency(e)}>
                    <option value="">Διάλεξε…</option>
                    {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                {isAdmin && <label>…ή νέο πρακτορείο<input name="new_name" placeholder="Όνομα, αν δεν υπάρχει στη λίστα" /></label>}
              </div>
              {isAdmin && (
                <label className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
                  <input type="checkbox" name="remember" value="1" defaultChecked />
                  Όλα τα email από {e.counterpart_email.split("@")[1]} να μπαίνουν αυτόματα σε αυτό το πρακτορείο
                </label>
              )}
              <SubmitButton>Στην καρτέλα του πρακτορείου</SubmitButton>
            </form>
          </details>

          <details open={e.ai_kind === "new_lead" && !e.lead_hint_label && !guessAgency(e)}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>➕ Είναι νέο lead</summary>
            <form action={reviewAsLead} className="stack" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={e.id} />
              <div className="grid2">
                <label>Επιχείρηση<input name="company" defaultValue={e.ai_company ?? e.counterpart_name ?? ""} required /></label>
                <label>Υπεύθυνος<input name="contact_name" defaultValue={e.ai_contact_name ?? e.counterpart_name ?? ""} /></label>
                <label>Τηλέφωνο<input name="phone" defaultValue={e.ai_phone ?? ""} /></label>
                {isAdmin && (
                  <label>Ανάθεση σε
                    <select name="owner_id" defaultValue="">
                      <option value="">Αργότερα</option>
                      {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="grid2">
                <label>Επόμενο βήμα<input name="next_step" defaultValue={e.ai_next_step ?? "Πρώτη κλήση"} required maxLength={160} /></label>
                <label>Πότε<input name="next_step_due" type="date" defaultValue={e.ai_next_due && e.ai_next_due >= plus(0) ? e.ai_next_due : plus(1)} required /></label>
              </div>
              {(e.ai_tasks ?? []).length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 13 }}>Εργασίες που προτείνει η AI (τσέκαρε όσες θέλεις)</strong>
                  {(e.ai_tasks ?? []).map((t, i) => (
                    <label key={i} className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
                      <input type="checkbox" name="task" value={i} /> {t.title}{t.due_date ? ` · ως ${dateGr(t.due_date)}` : ""}
                    </label>
                  ))}
                </div>
              )}
              <SubmitButton>ΟΚ, άνοιξε lead</SubmitButton>
            </form>
          </details>

          <details open={sp.find === e.id}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>🔗 Αφορά υπάρχοντα πελάτη</summary>
            <form action={reviewAsCustomer} className="stack" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={e.id} />
              {candidates[e.id].length > 0 ? (
                <select name="customer_id" required defaultValue="">
                  <option value="" disabled>Διάλεξε πελάτη…</option>
                  {candidates[e.id].map((c) => <option key={c.id} value={c.id}>{c.display_name}{c.status === "base" ? " (βάση)" : ""}</option>)}
                </select>
              ) : (
                <p className="muted">Δεν βρήκα πελάτη με παρόμοιο όνομα. Ψάξε παρακάτω.</p>
              )}
              <label className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
                <input type="checkbox" name="remember" value="1" defaultChecked={e.ai_kind !== "agency"} />
                Να θυμάσαι αυτή τη διεύθυνση για αυτόν τον πελάτη
              </label>
              {candidates[e.id].length > 0 && <SubmitButton>Σύνδεση με τον πελάτη</SubmitButton>}
            </form>
            <form className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="find" value={e.id} />
              <input name="q" placeholder="Αναζήτηση πελάτη…" defaultValue={sp.find === e.id ? sp.q : ""} className="grow" />
              <SubmitButton className="secondary">Αναζήτηση</SubmitButton>
            </form>
          </details>

          <form action={reviewIgnore} className="row">
            <input type="hidden" name="id" value={e.id} />
            <button name="mode" value="once" type="submit" className="secondary">Αγνόησε</button>
            <button name="mode" value="sender" type="submit" className="secondary">Αγνόησε πάντα αυτόν</button>
            <button name="mode" value="domain" type="submit" className="secondary">Αγνόησε όλο το {e.counterpart_email.split("@")[1]}</button>
          </form>
        </div>
      ))}
      {sugs.length > 0 && <h2 style={{ marginTop: 28 }}>Προτάσεις από email πελατών</h2>}
      {sugs.length > 0 && <p className="muted">Η επαφή έχει ήδη γραφτεί στην καρτέλα. Εδώ είναι ό,τι προτείνει η AI να γίνει. Γράφεται μόνο ό,τι τσεκάρεις.</p>}
      {sugs.map((g) => (
        <form key={g.id} action={applySuggestions} className="card stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="hidden" name="id" value={g.id} />
          <div className="row">
            <span className="badge">{g.leads?.company_name ?? g.customers?.display_name ?? g.agencies?.name ?? "Πελάτης"}</span>
            <span className="muted">{g.direction === "in" ? "Εισερχόμενο" : "Απεσταλμένο"} · {dateGr(g.occurred_at)}</span>
            <span className="grow" />
            {g.web_link && <a href={g.web_link} target="_blank" rel="noreferrer">Άνοιγμα στο Outlook ↗</a>}
          </div>
          <div><strong>{g.subject}</strong></div>
          {g.summary && <div>{g.summary}</div>}
          {(g.ai_tasks ?? []).map((t, i) => (
            <label key={i} className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
              <input type="checkbox" name="task" value={i} defaultChecked /> Εργασία: {t.title}{t.due_date ? ` · ως ${dateGr(t.due_date)}` : ""}
            </label>
          ))}
          {g.lead_id && g.ai_next_step && (
            <div className="stack" style={{ gap: 6 }}>
              <label className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
                <input type="checkbox" name="use_step" value="1" /> Άλλαξε το επόμενο βήμα του lead σε:
              </label>
              <div className="grid2">
                <input name="next_step" defaultValue={g.ai_next_step} maxLength={160} aria-label="Επόμενο βήμα" />
                <input name="next_step_due" type="date" defaultValue={g.ai_next_due && g.ai_next_due >= plus(0) ? g.ai_next_due : plus(2)} aria-label="Πότε" />
              </div>
            </div>
          )}
          <div className="row">
            <SubmitButton>ΟΚ, καταχώρισε όσα τσέκαρα</SubmitButton>
            <button name="mode" value="no" type="submit" className="secondary">Όχι, άσ' το</button>
          </div>
        </form>
      ))}
      <p className="muted"><Link href="/settings">Ρυθμίσεις σύνδεσης Outlook</Link></p>
    </main>
  );
}
