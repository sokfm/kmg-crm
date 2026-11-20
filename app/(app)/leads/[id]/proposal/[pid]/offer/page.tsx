import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { STATIONS, itemTotal } from "@/lib/pricing";
import { VALID_DAYS, autoSubtitle, defaultText, months, type OfferItem } from "@/lib/offer";
import { issueOffer, saveOfferTexts, uploadLogo } from "../../../../../proposal-actions";

const eur = (n: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 }).format(n) + " €";
const dt = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }).format(new Date(d));

export default async function OfferPrep({ params, searchParams }: { params: Promise<{ id: string; pid: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("id, company_name, customer_id, owner_id").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data: p } = await supabase.from("proposals").select("id, title, client_type, offer_subtitle, req_status, proposal_items(*)").eq("id", pid).eq("lead_id", id).maybeSingle();
  if (!p) notFound();
  const order = [...STATIONS] as string[];
  const items = ((p.proposal_items ?? []) as OfferItem[]).sort((a, b) => order.indexOf(a.station) - order.indexOf(b.station));
  const [{ data: tot }, { data: lg }, { data: past }, { data: ae }] = await Promise.all([
    supabase.from("proposal_totals").select("list_total, final_total").eq("proposal_id", pid).maybeSingle(),
    lead.customer_id ? supabase.from("logos").select("data").eq("customer_id", lead.customer_id).maybeSingle() : supabase.from("logos").select("data").eq("lead_id", id).maybeSingle(),
    supabase.from("proposal_offers").select("id, final_total, valid_until, created_at, profiles!proposal_offers_created_by_fkey(full_name)").eq("proposal_id", pid).order("created_at", { ascending: false }),
    supabase.from("profiles").select("full_name, offer_name, offer_phone, email").eq("id", lead.owner_id ?? profile.id).maybeSingle(),
  ]);
  const ids = <><input type="hidden" name="lead_id" value={id} /><input type="hidden" name="proposal_id" value={pid} /></>;
  const pending = p.req_status === "pending";
  const offers = (past ?? []) as unknown as { id: string; final_total: number; valid_until: string; created_at: string; profiles: { full_name: string } | null }[];

  return (
    <main className="wrap" style={{ maxWidth: 900 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Προσφορά για τον πελάτη</h1>
        <Link href={`/leads/${id}/proposal/${pid}`} className="muted">← {p.title}: {lead.company_name}</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted" style={{ marginTop: 0 }}>Το PDF που θα στείλεις: εξώφυλλο, πίνακας ανά ραδιόφωνο με το σύνολο, κλείσιμο. Ισχύει {VALID_DAYS} ημέρες από την έκδοση. Τα ποσά έρχονται από την πρόταση και δεν αλλάζουν εδώ.</p>

      <form action={saveOfferTexts} className="card stack">
        {ids}
        <h2 style={{ margin: 0 }}>1. Τι θα διαβάσει ο πελάτης</h2>
        <label>Τίτλος καμπάνιας (κάτω από το όνομά του)<input name="subtitle" defaultValue={p.offer_subtitle ?? ""} placeholder={autoSubtitle(items)} maxLength={120} /></label>
        {items.length === 0 && <p className="muted">Η πρόταση είναι άδεια.</p>}
        {items.map((i) => {
          const d = defaultText(i);
          return (
            <label key={i.id}>{i.station} · {months(i.months)} · {eur(itemTotal(i).total)}
              <input name={`text_${i.id}`} defaultValue={i.offer_text ?? ""} placeholder={[d.title, d.sub].filter(Boolean).join(" — ")} maxLength={160} />
            </label>
          );
        })}
        <div className="muted" style={{ fontSize: 13 }}>Άφησε κενό για να μπει το κείμενο που προτείνει το CRM (φαίνεται με γκρι). Γράψε δικό σου όπου θέλεις, π.χ. «100 FREE SPOT».</div>
        <div><SubmitButton pending="Αποθήκευση…">Αποθήκευση κειμένων</SubmitButton></div>
      </form>

      <form action={uploadLogo} className="card stack">
        {ids}
        <h2 style={{ margin: 0 }}>2. Λογότυπο πελάτη</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {lg?.data ? <img src={lg.data as string} alt="Λογότυπο πελάτη" style={{ maxWidth: 240, maxHeight: 110, border: "1px solid #ebe8ef", borderRadius: 10, padding: 8, background: "#fff" }} />
          : <p className="muted" style={{ margin: 0 }}>Δεν υπάρχει ακόμα. Χωρίς λογότυπο, η προσφορά γράφει το όνομα του πελάτη με γράμματα.</p>}
        <label>{lg?.data ? "Αλλαγή λογοτύπου" : "Ανέβασε λογότυπο"} (PNG, JPG ή WEBP, έως 700 KB)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required /></label>
        <div className="muted" style={{ fontSize: 13 }}>Μένει στον πελάτη και μπαίνει μόνο του στις επόμενες προσφορές.</div>
        <div><SubmitButton pending="Ανέβασμα…">Αποθήκευση λογοτύπου</SubmitButton></div>
      </form>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>3. Έκδοση</h2>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>Τελική τιμή προς τον πελάτη{Number(tot?.final_total ?? 0) < Number(tot?.list_total ?? 0) ? <> <span className="muted">(από {eur(Number(tot?.list_total))})</span></> : null}</span>
          <strong style={{ fontSize: 22 }}>{eur(Number(tot?.final_total ?? 0))}</strong>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Υπεύθυνος στην προσφορά: <strong>{ae?.offer_name ?? ae?.full_name ?? "—"}</strong>{ae?.offer_phone ? ` · ${ae.offer_phone}` : ""}{ae?.email ? ` · ${ae.email}` : ""}.
          {!ae?.offer_name && " Το πλήρες όνομα και το κινητό μπαίνουν από τις Ρυθμίσεις του καθενός."}
        </div>
        {pending ? (
          <div className="msg" style={{ background: "var(--orange-bg)" }}>Υπάρχει αίτημα ειδικής τιμής σε αναμονή. Η προσφορά βγαίνει μόλις απαντηθεί.</div>
        ) : (
          <form action={issueOffer}>{ids}<SubmitButton pending="Ετοιμάζεται…">Έκδοση προσφοράς και PDF</SubmitButton></form>
        )}
        <div className="muted" style={{ fontSize: 13 }}>Αποθήκευσε πρώτα τα κείμενα. Κάθε έκδοση κρατιέται από κάτω όπως ακριβώς βγήκε. Το PDF το στέλνεις εσύ από το email σου.</div>
      </div>

      {offers.length > 0 && (
        <div className="card">
          <h2>Προσφορές που έχουν βγει ({offers.length})</h2>
          <div className="list">
            {offers.map((o) => (
              <Link key={o.id} href={`/offer/${o.id}`} className="item">
                <div className="grow">{dt(o.created_at)} <span className="muted">· {o.profiles?.full_name ?? ""} · ισχύει έως {new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short" }).format(new Date(o.valid_until))}</span></div>
                <span className="badge">{eur(Number(o.final_total))}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
