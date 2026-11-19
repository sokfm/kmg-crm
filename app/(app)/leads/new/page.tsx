import { requireProfile } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { createLead } from "../../actions";
import { Flash } from "@/components/Flash";

const STATIONS = ["ΣΟΚ FM", "DALKAS", "ΜΠΛΕ", "NRG", "lalala.gr", "Social"];

// Χρόνος για το ψάξιμο της AI στο ίντερνετ
export const maxDuration = 120;

export default async function NewLead({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  return (
    <main className="wrap" style={{ maxWidth: 640 }}>
      <h1>Νέο lead</h1>
      <Flash sp={sp} />
      {sp.dup && (
        <div className="card alert">
          <strong>Μοιάζει να υπάρχει ήδη:</strong> {sp.dup}.
          <div className="muted">Αν είναι άλλη επιχείρηση, πάτα «Καταχώριση» ξανά. Αν είναι ο ίδιος, μίλα πρώτα με τον υπεύθυνο.</div>
        </div>
      )}
      <form action={createLead} className="stack card">
        {sp.dup && <input type="hidden" name="confirm_duplicate" value="1" />}
        <label>Επιχείρηση *<input name="company_name" required defaultValue={sp.company_name} placeholder="π.χ. Φούρνος Παπαδόπουλος" /></label>
        <div className="grid2">
          <label>Υπεύθυνος επικοινωνίας<input name="contact_name" defaultValue={sp.contact_name} /></label>
          <label>Τηλέφωνο<input name="phone" type="tel" defaultValue={sp.phone} /></label>
          <label>Email<input name="email" type="email" defaultValue={sp.email} /></label>
          <label>Περιοχή<input name="area" defaultValue={sp.area} placeholder="π.χ. Χαλκίδα κέντρο" /></label>
          <label>Από πού ήρθε
            <select name="source" defaultValue={sp.source ?? "phone"}>
              <option value="phone">Τηλεφώνησε</option>
              <option value="site">Site</option>
              <option value="facebook">Facebook / Instagram</option>
              <option value="seller">Το βρήκα εγώ</option>
              <option value="competition_watch">Ακούστηκε σε άλλον σταθμό</option>
            </select>
          </label>
          <label>Τι αφορά
            <select name="product_line" defaultValue={sp.product_line ?? "radio"}>
              <option value="radio">Ραδιόφωνο</option>
              <option value="digital">Digital / social</option>
            </select>
          </label>
          <label>Αγορά
            <select name="market" defaultValue="chalkida">
              <option value="chalkida">Χαλκίδα / Εύβοια</option>
              <option value="athens">Αθήνα</option>
            </select>
          </label>
          {isAdmin && (
            <label>Ανάθεση σε
              <select name="owner_id" defaultValue="">
                <option value="">Αργότερα</option>
                {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
          )}
        </div>
        <fieldset className="row" style={{ border: 0, padding: 0 }}>
          {STATIONS.map((st) => (
            <label key={st} className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
              <input type="checkbox" name="stations" value={st} /> {st}
            </label>
          ))}
        </fieldset>
        <div className="grid2">
          <label>Επόμενο βήμα *<input name="next_step" required defaultValue={sp.next_step} placeholder="π.χ. Τηλέφωνο για ραντεβού" /></label>
          <label>Πότε *<input name="next_step_due" type="date" required defaultValue={sp.next_step_due ?? tomorrow} /></label>
        </div>
        <label>Εκτιμώμενη αξία (€, αν την ξέρεις)<input name="expected_value" inputMode="decimal" placeholder="π.χ. 1.500" /></label>
        <label>Σημειώσεις<textarea name="notes" defaultValue={sp.notes} /></label>
        {!isAdmin && <p className="muted">Αν το βρήκες εσύ, μένει σε σένα. Αλλιώς πάει στον Νίκο για ανάθεση. Τα digital πάνε στη Μαρία.</p>}
        <SubmitButton>Καταχώριση</SubmitButton>
      </form>
    </main>
  );
}
