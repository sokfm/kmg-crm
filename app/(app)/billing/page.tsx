import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { eur } from "@/lib/format";
import { answerBillingLead, answerBillingName, syncBillingNow } from "../billing-actions";

export const maxDuration = 120;

const fmt = (d: string | null) =>
  d ? new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(new Date(d)) : "—";
const MON = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιούν", "Ιούλ", "Αύγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const per = (p: string) => `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const money = (a: number | null, t: string) => (a != null ? eur(Number(a)) : t === "FREE" ? "FREE" : "—");

type Line = {
  record_id: string; customer_id: string | null; customer_name_raw: string; name_key: string; period: string; station: string | null;
  amount: number | null; amount_type: string; account_executive_raw: string | null; agent_raw: string | null;
  origin: string | null; lead_hint: string | null; lead_id: string | null; added_at: string | null;
};
type Sug = { id: string; display_name: string; last_period: string | null; served_by: string | null };

// Τιμολόγηση από το Excel: τι διαβάστηκε, και οι ερωτήσεις που περιμένουν απάντηση. Μόνο Νίκος και Γιάννα.
export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  if (!isAdmin) redirect("/today");

  const cols = "record_id, customer_id, customer_name_raw, name_key, period, station, amount, amount_type, account_executive_raw, agent_raw, origin, lead_hint, lead_id, added_at";
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: log }, { data: names }, { data: orphan }, { data: hinted }, { data: recent }, { data: unbilled }] = await Promise.all([
    supabase.from("billing_sync_log").select("ran_at, ok, summary, error").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("billing_names").select("name_key, source_name, asked_at").is("customer_id", null).order("asked_at"),
    supabase.from("history_lines").select(cols).is("customer_id", null).eq("source_scope", "monthly_billing").order("period"),
    supabase.from("history_lines").select(cols).not("lead_hint", "is", null).is("origin", null).eq("source_scope", "monthly_billing").order("period"),
    supabase.from("history_lines").select(cols).gte("added_at", since).eq("source_scope", "monthly_billing").order("added_at", { ascending: false }).limit(60),
    supabase.from("won_not_billed").select("id, company_name, owner_id, closed_at, expected_value").order("closed_at"),
  ]);
  const orphanLines = (orphan ?? []) as Line[];
  const hintLines = (hinted ?? []) as Line[];
  const recentLines = (recent ?? []) as Line[];

  // Προτάσεις «μήπως είναι αυτός;» για κάθε όνομα που περιμένει (και ό,τι έψαξε ο χρήστης για ένα από αυτά)
  const sugs = new Map<string, Sug[]>();
  await Promise.all((names ?? []).map(async (n) => {
    const { data } = await supabase.rpc("billing_name_suggestions", { p_key: n.name_key, p_search: sp.k === n.name_key ? sp.q ?? null : null });
    sugs.set(n.name_key, (data ?? []) as Sug[]);
  }));

  // Ομάδες «πελάτης + lead» για την ερώτηση «ήρθε από αυτό το lead;»
  const groups = new Map<string, { customer: string; lead: string; lines: Line[] }>();
  for (const l of hintLines) {
    if (!l.customer_id || !l.lead_hint) continue;
    const k = `${l.customer_id}|${l.lead_hint}`;
    const g = groups.get(k) ?? { customer: l.customer_id, lead: l.lead_hint, lines: [] };
    g.lines.push(l); groups.set(k, g);
  }
  const custIds = [...new Set([...recentLines, ...hintLines].map((l) => l.customer_id).filter(Boolean))] as string[];
  const leadIds = [...new Set([...hintLines.map((l) => l.lead_hint), ...recentLines.map((l) => l.lead_id)].filter(Boolean))] as string[];
  const [{ data: custs }, { data: leads }, { data: people }] = await Promise.all([
    custIds.length ? supabase.from("customers_x").select("id, display_name, status, owner_id, served_by").in("id", custIds) : Promise.resolve({ data: [] as { id: string; display_name: string; status: string; owner_id: string | null; served_by: string | null }[] }),
    leadIds.length ? supabase.from("leads").select("id, company_name, owner_id, closed_at, expected_value").in("id", leadIds) : Promise.resolve({ data: [] as { id: string; company_name: string; owner_id: string | null; closed_at: string | null; expected_value: number | null }[] }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const cust = new Map((custs ?? []).map((c) => [c.id as string, c]));
  const lead = new Map((leads ?? []).map((l) => [l.id as string, l]));
  const who = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  const sm = (log?.summary ?? {}) as { added?: number; changed?: number; removed?: number; touched?: string[]; problems?: string[] };
  const questions = (names ?? []).length + groups.size;
  const [nAdd, nChg, nRem] = (sp.n ?? "").split("-");

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <h1>Τιμολόγηση από το Excel</h1>
      {sp.ok !== "billsync" && <Flash sp={sp} />}
      {sp.ok === "billsync" && <div className="msg ok">Διαβάστηκε. Νέες γραμμές: {nAdd} · άλλαξαν: {nChg} · έφυγαν από το Excel: {nRem}.</div>}

      <div className="card stack">
        <div className="row">
          <div className="grow">
            <strong>Τελευταία ενημέρωση: {log ? fmt(log.ran_at) : "δεν έχει γίνει ακόμα"}</strong>
            {log && <div className="muted">Νέες γραμμές {sm.added ?? 0} · άλλαξαν {sm.changed ?? 0} · έφυγαν {sm.removed ?? 0}{sm.touched?.length ? ` · μήνες: ${sm.touched.map(per).join(", ")}` : ""}</div>}
          </div>
          <form action={syncBillingNow}><SubmitButton pending="Διαβάζω τα Excel…" hint="Κατεβάζει τα δύο αρχεία από το Dropbox και τα συγκρίνει. Λίγα δευτερόλεπτα.">Ενημέρωση τώρα</SubmitButton></form>
        </div>
        {log && !log.ok && <div className="msg error">Κάτι δεν διαβάστηκε: {log.error}</div>}
        {!!sm.problems?.length && log?.ok && <div className="msg error">{sm.problems.join(" · ")}</div>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Το Excel είναι ο πραγματικός τζίρος και το CRM το ακολουθεί κάθε βράδυ. Γραμμή που σβήνεται από το Excel βγαίνει και από τα σύνολα εδώ.
          Γραμμές που περιμένουν απάντηση μετράνε κανονικά στον τζίρο.
        </p>
      </div>

      <h2>Ποιος πελάτης είναι; {(names ?? []).length > 0 && <span className="badge">{(names ?? []).length}</span>}</h2>
      {!(names ?? []).length && <p className="muted">Καμία ερώτηση. Όλα τα ονόματα του Excel αντιστοιχούν σε πελάτη.</p>}
      {(names ?? []).map((n) => {
        const mine = orphanLines.filter((l) => l.name_key === n.name_key);
        const list = sugs.get(n.name_key) ?? [];
        return (
          <div key={n.name_key} className="card stack" id={`n-${n.name_key.replace(/\s+/g, "-")}`}>
            <div>
              <strong>{n.source_name}</strong>
              <div className="muted">
                {mine.map((l) => `${per(l.period)} · ${l.station ?? "—"} · ${money(l.amount, l.amount_type)}`).join("  |  ")}
                {mine[0] && ` — στο Excel: ${[mine[0].account_executive_raw, mine[0].agent_raw].filter(Boolean).join(" / ") || "—"}`}
              </div>
            </div>
            <form action={answerBillingName} className="stack">
              <input type="hidden" name="key" value={n.name_key} />
              {list.map((c) => (
                <label key={c.id} className="pick">
                  <input type="radio" name="pick" value={c.id} required /> Είναι ο <strong>{c.display_name}</strong>
                  <span className="muted"> {c.last_period ? `· έπαιξε τελευταία ${per(c.last_period)}` : "· δεν έχει παίξει"}{c.served_by ? ` · ${c.served_by}` : ""}</span>
                </label>
              ))}
              <label className="pick"><input type="radio" name="pick" value="new" required defaultChecked={!list.length} /> <strong>Νέος πελάτης</strong> <span className="muted">· ανοίγει με το όνομα του Excel</span></label>
              <div><SubmitButton pending="Αποθήκευση…">Αποθήκευση</SubmitButton></div>
            </form>
            <form method="get" action="/billing" className="row">
              <input type="hidden" name="k" value={n.name_key} />
              <input name="q" defaultValue={sp.k === n.name_key ? sp.q ?? "" : ""} placeholder="Δεν τον βλέπεις; Γράψε πώς τον ξέρεις" className="grow" />
              <button className="secondary" type="submit">Ψάξε</button>
            </form>
          </div>
        );
      })}

      <h2>Ήρθε από lead του CRM; {groups.size > 0 && <span className="badge">{groups.size}</span>}</h2>
      {!groups.size && <p className="muted">Καμία ερώτηση. Όταν μπει στο Excel πελάτης που έχει κερδισμένο lead εκείνες τις μέρες, θα ρωτήσω εδώ.</p>}
      {[...groups.values()].map((g) => {
        const c = cust.get(g.customer);
        const l = lead.get(g.lead);
        const total = g.lines.reduce((s, x) => s + Number(x.amount ?? 0), 0);
        return (
          <div key={`${g.customer}|${g.lead}`} className="card stack">
            <div>
              <strong>{c?.display_name ?? g.lines[0].customer_name_raw}</strong> · {eur(total)} στο Excel
              <div className="muted">{g.lines.map((x) => `${per(x.period)} · ${x.station ?? "—"} · ${money(x.amount, x.amount_type)}`).join("  |  ")}</div>
            </div>
            <div>
              Κερδισμένο lead: <Link href={`/leads/${g.lead}`}><strong>{l?.company_name ?? "lead"}</strong></Link>
              <span className="muted"> · {who.get(l?.owner_id ?? "") ?? "χωρίς υπεύθυνο"} · έκλεισε {fmt(l?.closed_at ?? null)}{l?.expected_value ? ` · πρόταση ${eur(Number(l.expected_value))}` : ""}</span>
              {!!l?.expected_value && Math.abs(Number(l.expected_value) - total) >= 1 && (
                <div className="late-txt">Διαφορά πρότασης και Excel: {eur(Math.abs(Number(l.expected_value) - total))}</div>
              )}
            </div>
            <div className="row">
              <form action={answerBillingLead}>
                <input type="hidden" name="customer" value={g.customer} /><input type="hidden" name="lead" value={g.lead} /><input type="hidden" name="yes" value="1" />
                <SubmitButton pending="…">Ναι, είναι αυτό</SubmitButton>
              </form>
              <form action={answerBillingLead}>
                <input type="hidden" name="customer" value={g.customer} /><input type="hidden" name="lead" value={g.lead} /><input type="hidden" name="yes" value="0" />
                <SubmitButton className="secondary" pending="…">Όχι, ήρθε εκτός CRM</SubmitButton>
              </form>
            </div>
          </div>
        );
      })}

      <h2>Κλείστηκε αλλά δεν τιμολογήθηκε {(unbilled ?? []).length > 0 && <span className="badge">{(unbilled ?? []).length}</span>}</h2>
      {!(unbilled ?? []).length ? (
        <p className="muted">Κανένα. Κάθε κερδισμένο lead έχει γραμμή στο Excel από τον μήνα που έκλεισε και μετά.</p>
      ) : (
        <div className="list">
          {(unbilled ?? []).map((u) => (
            <Link key={u.id} href={`/leads/${u.id}`} className="item">
              <span className="grow"><span className="title">{u.company_name}</span><br /><span className="muted">{who.get(u.owner_id ?? "") ?? "χωρίς υπεύθυνο"} · κερδισμένο {fmt(u.closed_at)}</span></span>
              {!!u.expected_value && <strong>{eur(Number(u.expected_value))}</strong>}
              <span className="muted">›</span>
            </Link>
          ))}
        </div>
      )}

      <h2>Τι μπήκε τις τελευταίες 14 ημέρες</h2>
      {!recentLines.length ? <p className="muted">Τίποτα νέο.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Μήνας</th><th>Πελάτης</th><th>Σταθμός</th><th className="num">Ποσό</th><th>Ετικέτα</th></tr></thead>
            <tbody>
              {recentLines.map((l) => {
                const c = l.customer_id ? cust.get(l.customer_id) : null;
                return (
                  <tr key={l.record_id}>
                    <td>{per(l.period)}</td>
                    <td>
                      {l.customer_id ? <Link href={`/customers/${l.customer_id}`}>{c?.display_name ?? l.customer_name_raw}</Link> : <span className="late-txt">{l.customer_name_raw} (περιμένει απάντηση)</span>}
                      {c && c.status === "base" && !c.owner_id && <div className="muted" style={{ fontSize: 12 }}>στη βάση, χωρίς υπεύθυνο{c.served_by ? ` · στο Excel: ${c.served_by}` : ""}</div>}
                    </td>
                    <td>{l.station ?? "—"}</td>
                    <td className="num">{money(l.amount, l.amount_type)}</td>
                    <td>{l.origin === "lead" ? <Link href={`/leads/${l.lead_id}`}>Από lead</Link> : l.origin === "direct" ? "Εκτός CRM" : l.lead_hint ? "Θέλει απάντηση" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {questions === 0 && <p className="muted" style={{ marginTop: 18 }}>Δεν περιμένει τίποτα απάντηση.</p>}
    </main>
  );
}
