import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { ACTIVITY, LOST_KINDS, STAGES, dateGr } from "@/lib/format";
import { addActivity, updateLead } from "../../actions";
import { Flash } from "@/components/Flash";

export default async function LeadPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data: acts } = await supabase
    .from("activities")
    .select("id, type, summary, occurred_at, profiles!activities_user_id_fkey(full_name)")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false });
  const { data: people } = isAdmin
    ? await supabase.from("profiles").select("id, full_name").in("role", ["ceo", "sales_manager", "account_exec"]).eq("active", true)
    : { data: [] as { id: string; full_name: string }[] };
  const activities = (acts ?? []) as unknown as { id: string; type: string; summary: string; occurred_at: string; profiles: { full_name: string } | null }[];
  const lastContact = activities.find((a) => a.type !== "note");
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <div>
        <Link href="/leads" className="muted">← Leads</Link>
        <h1>{lead.company_name}</h1>
        <div className="row muted">
          <span className="badge">{STAGES[lead.status]}</span>
          <span>{lead.contact_name ?? ""} {lead.phone ? `· ${lead.phone}` : ""}</span>
          <span>· Τελευταία επαφή: {lastContact ? dateGr(lastContact.occurred_at) : "καμία ακόμα"}</span>
          {lead.customer_id && <Link href={`/customers/${lead.customer_id}`}>· Καρτέλα πελάτη</Link>}
        </div>
      </div>
      <Flash sp={sp} />

      <div className="card">
        <h2>Κατέγραψε επαφή</h2>
        <form action={addActivity} className="stack">
          <input type="hidden" name="lead_id" value={lead.id} />
          <div className="row">
            <select name="type" defaultValue="call">
              {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input name="summary" className="grow" placeholder="Τι ειπώθηκε;" required />
          </div>
          <div className="grid2">
            <label>Επόμενο βήμα<input name="next_step" placeholder="π.χ. Στέλνω πρόταση" /></label>
            <label>Πότε<input name="next_step_due" type="date" defaultValue={in3} /></label>
          </div>
          <p className="muted">Η «Σημείωση» δεν μετράει ως επαφή. Μόνο κλήση, ραντεβού, Viber και email.</p>
          <button type="submit">Καταγραφή</button>
        </form>
      </div>

      <div className="card">
        <h2>Στοιχεία και στάδιο</h2>
        <form action={updateLead} className="stack">
          <input type="hidden" name="id" value={lead.id} />
          <input type="hidden" name="version" value={lead.version} />
          <div className="grid2">
            <label>Στάδιο
              <select name="status" defaultValue={lead.status}>
                {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Αν χάθηκε: τι «όχι» ήταν
              <select name="lost_kind" defaultValue={lead.lost_kind ?? ""}>
                <option value="">—</option>
                {Object.entries(LOST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Επόμενο βήμα<input name="next_step" defaultValue={lead.next_step ?? ""} /></label>
            <label>Πότε<input name="next_step_due" type="date" defaultValue={lead.next_step_due ?? ""} /></label>
            <label>Υπεύθυνος επικοινωνίας<input name="contact_name" defaultValue={lead.contact_name ?? ""} /></label>
            <label>Τηλέφωνο<input name="phone" defaultValue={lead.phone ?? ""} /></label>
            <label>Email<input name="email" defaultValue={lead.email ?? ""} /></label>
            {isAdmin && (
              <label>Πωλητής
                <select name="owner_id" defaultValue={lead.owner_id ?? ""}>
                  <option value="">Χωρίς ανάθεση</option>
                  {people!.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>Γιατί χάθηκε (με δικά σου λόγια)<input name="lost_reason" defaultValue={lead.lost_reason ?? ""} /></label>
          <label>Σημειώσεις<textarea name="notes" defaultValue={lead.notes ?? ""} /></label>
          <p className="muted">Ακόμα και ένα «όχι τώρα» κρατάει επόμενο βήμα: πότε ξαναχτυπάμε την πόρτα.</p>
          <button type="submit">Αποθήκευση</button>
        </form>
      </div>

      <div className="card">
        <h2>Ιστορικό επαφών</h2>
        {activities.length === 0 && <p className="muted">Καμία επαφή ακόμα.</p>}
        <table>
          <tbody>
            {activities.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: "nowrap" }}>{dateGr(a.occurred_at)}</td>
                <td><span className={`badge ${a.type === "note" ? "gray" : ""}`}>{ACTIVITY[a.type]}</span></td>
                <td>{a.summary}</td>
                <td className="muted">{a.profiles?.full_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
