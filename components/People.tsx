import { SubmitButton } from "@/components/SubmitButton";
import { deleteContact, saveContact } from "@/app/(app)/actions";

// Πρόσωπα μιας επιχείρησης (όπως τα Contacts του Salesforce).
export type Person = {
  id: string; version: number; name: string | null; title: string | null; roles: string[]; email: string | null;
  phone: string | null; mobile: string | null; birthday: string | null; notes: string | null; is_primary: boolean; do_not_contact: boolean;
};
export const PERSON_SELECT = "id, version, name, title, roles, email, phone, mobile, birthday, notes, is_primary, do_not_contact";

const ROLES: [string, string][] = [
  ["decision", "Αποφασίζει"],
  ["owner", "Ιδιοκτήτης"],
  ["billing", "Λογιστήριο / τιμολόγια"],
  ["marketing", "Marketing / διαφήμιση"],
  ["daily", "Καθημερινή επαφή"],
];
const ROLE_LABEL = Object.fromEntries(ROLES);
const TITLES = ["Ιδιοκτήτης", "Γενικός Διευθυντής", "Υπεύθυνος καταστήματος", "Λογιστήριο", "Marketing", "Γραμματεία", "Συνεργάτης"];
const viber = (n: string) => `viber://chat?number=${encodeURIComponent(n.replace(/[^\d+]/g, "").replace(/^(?!\+)/, "+30"))}`;
const bday = (d: string | null) => (d ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long" }).format(new Date(d)) : null);

function Fields({ p }: { p?: Person }) {
  return (
    <>
      <div className="grid2">
        <label>Ονοματεπώνυμο<input name="name" defaultValue={p?.name ?? ""} placeholder="π.χ. Γιώργος Παπαδόπουλος" /></label>
        <label>Θέση
          <input name="title" list="titles" defaultValue={p?.title ?? ""} placeholder="π.χ. Ιδιοκτήτης" />
        </label>
        <label>Κινητό<input name="mobile" type="tel" defaultValue={p?.mobile ?? ""} /></label>
        <label>Σταθερό<input name="phone" type="tel" defaultValue={p?.phone ?? ""} /></label>
        <label>Email<input name="email" type="email" defaultValue={p?.email ?? ""} /></label>
        <label>Γενέθλια / γιορτή<input name="birthday" type="date" defaultValue={p?.birthday ?? ""} /></label>
      </div>
      <div className="seg">
        {ROLES.map(([k, v]) => (
          <label key={k}><input type="checkbox" name="roles" value={k} defaultChecked={p?.roles?.includes(k)} /><span>{v}</span></label>
        ))}
      </div>
      <label>Σημειώσεις<input name="notes" defaultValue={p?.notes ?? ""} placeholder="π.χ. Τον βρίσκεις μετά τις 14:00, προτιμά Viber" /></label>
      <div className="row" style={{ gap: 16 }}>
        <label className="row" style={{ flexDirection: "row", fontWeight: 500 }}><input type="checkbox" name="is_primary" value="1" defaultChecked={p?.is_primary} /> Κύρια επαφή</label>
        <label className="row" style={{ flexDirection: "row", fontWeight: 500 }}><input type="checkbox" name="do_not_contact" value="1" defaultChecked={p?.do_not_contact} /> Να μην τον καλούμε</label>
      </div>
      <datalist id="titles">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}

export function PeopleCard({ people, customerId, leadId, back, canEdit }: { people: Person[]; customerId?: string; leadId?: string; back: string; canEdit: boolean }) {
  const sorted = [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.name ?? "").localeCompare(b.name ?? ""));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="grow" style={{ margin: 0 }}>Πρόσωπα ({people.length})</h2>
      </div>
      {people.length === 0 && <p className="muted" style={{ marginTop: 0 }}>Κανένα πρόσωπο ακόμα. Πρόσθεσε ποιος αποφασίζει, ποιος πληρώνει και με ποιον μιλάτε καθημερινά.</p>}
      <div className="people">
        {sorted.map((p) => (
          <div key={p.id} className={`person ${p.do_not_contact ? "dnc" : ""}`}>
            <div className="person-head">
              <span className="day-av sm" style={{ background: "#fde3f9", color: "#8a0d70" }}>{(p.name ?? p.email ?? "?").trim().slice(0, 1).toUpperCase()}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <strong>{p.name ?? p.email ?? "Χωρίς όνομα"}</strong>{p.is_primary && <span className="badge" style={{ marginLeft: 6 }}>κύρια επαφή</span>}
                {p.do_not_contact && <span className="badge late" style={{ marginLeft: 6 }}>όχι κλήσεις</span>}
                <div className="muted">{[p.title, ...p.roles.map((r) => ROLE_LABEL[r] ?? r)].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
            <div className="person-links">
              {p.mobile && <><a href={`tel:${p.mobile}`}>📱 {p.mobile}</a><a href={viber(p.mobile)}>Viber</a></>}
              {p.phone && <a href={`tel:${p.phone}`}>☎ {p.phone}</a>}
              {p.email && <a href={`mailto:${p.email}`}>✉ {p.email}</a>}
              {p.birthday && <span className="muted">🎂 {bday(p.birthday)}</span>}
            </div>
            {p.notes && <div className="muted" style={{ marginTop: 4 }}>{p.notes}</div>}
            {canEdit && (
              <details style={{ marginTop: 6 }}>
                <summary className="muted" style={{ cursor: "pointer" }}>Επεξεργασία</summary>
                <form action={saveContact} className="stack" style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="version" value={p.version} />
                  <input type="hidden" name="back" value={back} />
                  <Fields p={p} />
                  <div className="row">
                    <SubmitButton>Αποθήκευση</SubmitButton>
                  </div>
                </form>
                <form action={deleteContact} style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value={back} />
                  <SubmitButton className="danger" pending="Διαγραφή…">Διαγραφή προσώπου</SubmitButton>
                </form>
              </details>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>+ Νέο πρόσωπο</summary>
          <form action={saveContact} className="stack" style={{ marginTop: 10 }}>
            {customerId && <input type="hidden" name="customer_id" value={customerId} />}
            {leadId && <input type="hidden" name="lead_id" value={leadId} />}
            <input type="hidden" name="back" value={back} />
            <Fields />
            <div><SubmitButton>Προσθήκη</SubmitButton></div>
            <p className="muted" style={{ margin: 0 }}>Το email του προσώπου συνδέεται με το Outlook: τα email του μπαίνουν αυτόματα σε αυτή την καρτέλα.</p>
          </form>
        </details>
      )}
    </div>
  );
}
