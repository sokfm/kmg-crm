import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { createLead } from "../../actions";
import { Flash } from "@/components/Flash";
import { VoiceLead } from "@/components/VoiceLead";
import { STAGE_INFO } from "@/lib/stages";

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
      {sp.dup_kind && (
        <div className="card alert stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sp.dup_kind === "customer" ? (
            <>
              <div>
                <strong>Υπάρχει ήδη πελάτης «{sp.dup_name}»</strong>{" "}
                <span className="muted">({sp.dup_owner === "Βάση πελατών" ? "στη βάση, χωρίς Account Executive" : `Account Executive: ${sp.dup_owner}`})</span>
              </div>
              <div className="muted">Είναι ο ίδιος; Τότε το lead μπαίνει στην καρτέλα του, με όλο το ιστορικό του.{sp.dup_owner === "Βάση πελατών" ? (isAdmin ? " Ο πελάτης βγαίνει από τη βάση και περνά σε όποιον αναθέσεις το lead (ή σε σένα)." : " Θα σταλεί και αίτημα στον Νίκο να σου δοθεί ο πελάτης.") : ""}</div>
              <div className="row">
                <SubmitButton name="dup_action" value="same" form="leadform">Ναι, είναι ο ίδιος</SubmitButton>
                <SubmitButton name="dup_action" value="different" form="leadform" className="secondary">Όχι, άλλη επιχείρηση</SubmitButton>
                {(isAdmin || sp.dup_owner === "Βάση πελατών") && <Link href={`/customers/${sp.dup_id}`} target="_blank">Δες την καρτέλα ↗</Link>}
              </div>
            </>
          ) : (
            <>
              <div><strong>Υπάρχει ήδη ανοιχτό lead «{sp.dup_name}»</strong> <span className="muted">({sp.dup_owner})</span></div>
              <div className="muted">Αν είναι η ίδια επιχείρηση, συνέχισε στο υπάρχον lead για να μη γίνουν δύο.</div>
              <div className="row">
                {isAdmin && <Link className="btn" href={`/leads/${sp.dup_id}`}>Άνοιξε το υπάρχον lead</Link>}
                <SubmitButton name="dup_action" value="different" form="leadform" className="secondary">Είναι άλλη επιχείρηση, καταχώριση</SubmitButton>
              </div>
            </>
          )}
        </div>
      )}
      {!sp.dup_kind && !sp.voice && <VoiceLead />}
      {sp.voice && !sp.dup_kind && (
        <div className="msg ok">
          Γέμισα τη φόρμα από αυτά που είπες. <strong>Έλεγξε τα και πάτα Καταχώριση.</strong>
          {sp.missing ? ` Δεν άκουσα: ${sp.missing}.` : ""} <Link href="/leads/new">Να το ξαναπώ</Link>
        </div>
      )}
      <form action={createLead} id="leadform" className="stack card" key={sp.voice ? JSON.stringify(sp) : "form"}>
        {sp.dup_kind && <><input type="hidden" name="dup_kind" value={sp.dup_kind} /><input type="hidden" name="dup_id" value={sp.dup_id} /></>}
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
          <label>Ενδιαφέρεται για
            <select name="product_line" defaultValue={sp.product_line ?? "radio"}>
              <option value="radio">Radio</option>
              <option value="digital">Digital</option>
              <option value="both">Radio και Digital</option>
            </select>
          </label>
          <label>Αγορά
            <select name="market" defaultValue={sp.market ?? "chalkida"}>
              <option value="chalkida">Χαλκίδα / Εύβοια</option>
              <option value="athens">Αθήνα</option>
            </select>
          </label>
          {isAdmin && (
            <label>Ανάθεση σε
              <select name="owner_id" defaultValue={sp.owner_id ?? ""}>
                <option value="">Αργότερα</option>
                {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
          )}
        </div>
        <fieldset className="row" style={{ border: 0, padding: 0 }}>
          {STATIONS.map((st) => (
            <label key={st} className="row" style={{ flexDirection: "row", fontWeight: 400 }}>
              <input type="checkbox" name="stations" value={st} defaultChecked={(sp.stations ?? "").split(",").includes(st)} /> {st}
            </label>
          ))}
        </fieldset>
        <div className="grid2">
          <label>Επόμενο βήμα *<input name="next_step" required defaultValue={sp.next_step} list="new-steps" placeholder="π.χ. Πρώτη κλήση" /><datalist id="new-steps">{STAGE_INFO.new.steps.map((t) => <option key={t} value={t} />)}</datalist></label>
          <label>Πότε *<span className="row" style={{ gap: 6 }}><input name="next_step_due" type="date" required defaultValue={sp.next_step_due ?? tomorrow} /><input name="next_step_time" type="time" aria-label="Ώρα (προαιρετικά)" title="Ώρα (προαιρετικά): θα χτυπήσει υπενθύμιση" style={{ maxWidth: 120 }} defaultValue={sp.next_step_time ?? ""} /></span></label>
        </div>
        <label>Εκτιμώμενη αξία (€, αν την ξέρεις)<input name="expected_value" inputMode="decimal" placeholder="π.χ. 1.500" defaultValue={sp.expected_value} /></label>
        <label>Σημειώσεις<textarea name="notes" defaultValue={sp.notes} /></label>
        {!isAdmin && <p className="muted">Αν το βρήκες εσύ, μένει σε σένα. Αλλιώς πάει στον Νίκο για ανάθεση. Τα digital πάνε στη Μαρία.</p>}
        {sp.dup_kind ? <p className="muted" style={{ margin: 0 }}>Απάντησε επάνω: είναι ο ίδιος ή άλλη επιχείρηση;</p> : <SubmitButton>Καταχώριση</SubmitButton>}
      </form>
    </main>
  );
}
