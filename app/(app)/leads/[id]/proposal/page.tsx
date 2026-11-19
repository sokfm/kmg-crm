import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { dateGr } from "@/lib/format";
import { CLIENT_HINT, CLIENT_LABEL, itemTotal, type ClientType, type Item } from "@/lib/pricing";
import { createProposal } from "../../../proposal-actions";

const eur = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
const TYPES: ClientType[] = ["local", "media", "direct", "government"];

export default async function Proposals({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("id, company_name, customers(agency_id)").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data } = await supabase.from("proposals").select("id, title, client_type, is_main, created_at, proposal_items(station, monthly_amount, long_months, long_amount, months)").eq("lead_id", id).order("created_at", { ascending: false });
  const list = (data ?? []) as { id: string; title: string; client_type: ClientType | null; is_main: boolean; created_at: string; proposal_items: Pick<Item, "station" | "monthly_amount" | "long_months" | "long_amount" | "months">[] }[];
  const hasAgency = !!(lead.customers as unknown as { agency_id: string | null } | null)?.agency_id;
  // Το είδος πελάτη της τελευταίας πρότασης προτείνεται και για την επόμενη
  const lastType = list.find((p) => p.client_type)?.client_type ?? (hasAgency ? "media" : "local");

  return (
    <main className="wrap" style={{ maxWidth: 900 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Προτάσεις · {lead.company_name}</h1>
        <Link href={`/leads/${id}`} className="muted">← Πίσω στο lead</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted" style={{ marginTop: 0 }}>Εσωτερικό εργαλείο: τίποτα δεν στέλνεται στον πελάτη. Κάθε πρόταση κρατάει τα δικά της πακέτα και πλάνα. Τιμές χωρίς ΦΠΑ.</p>

      {list.length > 0 && (
        <div className="card stack">
          {list.map((p) => {
            const total = p.proposal_items.reduce((a, i) => a + itemTotal(i).total, 0);
            const stations = [...new Set(p.proposal_items.map((i) => i.station))];
            return (
              <Link key={p.id} href={`/leads/${id}/proposal/${p.id}`} className="row" style={{ justifyContent: "space-between", gap: 10, border: "1px solid #ebe8ef", borderRadius: 12, padding: 12, color: "inherit", flexWrap: "wrap" }}>
                <div>
                  <strong>{p.title}</strong> {p.is_main && <span className="badge good">Κύρια</span>} {p.client_type && <span className="badge gray">{CLIENT_LABEL[p.client_type]}</span>}
                  <div className="muted" style={{ fontSize: 13 }}>{dateGr(p.created_at)} · {stations.length ? stations.join(" · ") : "άδεια"}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{eur(total)}</div>
              </Link>
            );
          })}
        </div>
      )}

      <form action={createProposal} className="card stack">
        <input type="hidden" name="lead_id" value={id} />
        <h2 style={{ margin: 0 }}>Νέα πρόταση</h2>
        <label>Όνομα<input name="title" required maxLength={80} defaultValue={list.length ? "" : "Πρόταση"} placeholder="π.χ. Ανανέωση 2027, Πρόταση με DALKAS" /></label>
        <div className="muted">Τι πελάτης είναι; Ισχύει για όλα τα μέσα αυτής της πρότασης.{hasAgency ? " Η καρτέλα του έχει πρακτορείο." : ""}</div>
        {TYPES.map((t) => (
          <label key={t} className="row" style={{ gap: 10, alignItems: "flex-start", border: "1px solid #ebe8ef", borderRadius: 12, padding: 10, cursor: "pointer" }}>
            <input type="radio" name="client_type" value={t} defaultChecked={lastType === t} style={{ width: "auto", marginTop: 3 }} />
            <span><strong>{CLIENT_LABEL[t]}</strong><br /><span className="muted">{CLIENT_HINT[t]}</span></span>
          </label>
        ))}
        <div><SubmitButton pending="Δημιουργία…">Δημιουργία πρότασης</SubmitButton></div>
      </form>
    </main>
  );
}
