import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { dateGr } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { reviewAsCustomer, reviewAsLead, reviewIgnore } from "../actions";

const KIND: Record<string, string> = {
  new_lead: "Πιθανό νέο lead",
  existing_customer: "Μάλλον υπάρχων πελάτης",
  agency: "Πρακτορείο",
};

type Em = {
  id: string; direction: string; counterpart_email: string; counterpart_name: string | null; subject: string;
  occurred_at: string; web_link: string | null; summary: string | null; ai_kind: string | null; ai_confidence: number | null;
  ai_reason: string | null; ai_company: string | null; ai_contact_name: string | null; ai_phone: string | null;
};

// Λέξη για αναζήτηση πελάτη: η πρώτη «σημαντική» λέξη της εταιρείας ή του domain
function guessWord(e: Em) {
  const fromCompany = (e.ai_company ?? "").split(/[\s\-–,.]+/).find((w) => w.length >= 3);
  if (fromCompany) return fromCompany;
  const dom = e.counterpart_email.split("@")[1]?.split(".")[0] ?? "";
  return ["gmail", "yahoo", "hotmail", "outlook", "otenet", "live"].includes(dom) ? "" : dom;
}

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data } = await supabase
    .from("email_messages")
    .select("id, direction, counterpart_email, counterpart_name, subject, occurred_at, web_link, summary, ai_kind, ai_confidence, ai_reason, ai_company, ai_contact_name, ai_phone")
    .eq("status", "review")
    .order("occurred_at", { ascending: false })
    .limit(30);
  const items = (data ?? []) as Em[];
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };

  // Υποψήφιοι πελάτες για κάθε email (ή αναζήτηση που έκανε ο χρήστης)
  const candidates: Record<string, { id: string; display_name: string; status: string }[]> = {};
  for (const e of items) {
    const word = sp.find === e.id && sp.q ? sp.q : guessWord(e);
    if (!word) { candidates[e.id] = []; continue; }
    const { data: c } = await supabase.from("customers").select("id, display_name, status").ilike("display_name", `%${word}%`).order("lifetime_revenue", { ascending: false }).limit(6);
    candidates[e.id] = c ?? [];
  }

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <h1>Προς έλεγχο</h1>
      <p className="muted">
        Email που η AI πιστεύει ότι αφορούν πωλήσεις αλλά δεν είναι σίγουρη. Κάθε απάντησή σου τη μαθαίνει: την επόμενη φορά ο ίδιος αποστολέας μπαίνει αυτόματα.
      </p>
      <Flash sp={sp} />
      {items.length === 0 && <div className="card good">Τίποτα για έλεγχο. 👌</div>}

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

          <details>
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
              <button type="submit">Δημιουργία lead</button>
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
                Να θυμάσαι αυτή τη διεύθυνση για αυτόν τον πελάτη {e.ai_kind === "agency" && "(όχι για πρακτορεία που στέλνουν για πολλούς)"}
              </label>
              {candidates[e.id].length > 0 && <button type="submit">Σύνδεση με τον πελάτη</button>}
            </form>
            <form className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="find" value={e.id} />
              <input name="q" placeholder="Αναζήτηση πελάτη…" defaultValue={sp.find === e.id ? sp.q : ""} className="grow" />
              <button type="submit" className="secondary">Αναζήτηση</button>
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
      <p className="muted"><Link href="/settings">Ρυθμίσεις σύνδεσης Outlook</Link></p>
    </main>
  );
}
