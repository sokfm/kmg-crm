import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoSelect } from "@/components/AutoSelect";
import { CLIENT_HINT, CLIENT_LABEL, STATIONS, itemTotal, type ClientType, type Item } from "@/lib/pricing";
import { addPackageItem, deleteItem, setClientType, setItemMonths } from "../../../proposal-actions";

type Pkg = {
  id: string; station: string; kind: "spots" | "sponsorship" | "mention"; client_type: string; name: string; description: string | null;
  spots_per_day: number | null; bonus_spots: number; price: number; long_months: number | null; long_price: number | null; long_bonus_spots: number | null;
};
const eur = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
const KIND: Record<Pkg["kind"], string> = { spots: "Πακέτο σποτ", sponsorship: "Χορηγία εκπομπής", mention: "Αναφορές" };
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1 μήνας" : `${i + 1} μήνες` }));
const TYPES: ClientType[] = ["local", "media", "direct", "government"];

export default async function ProposalPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("id, company_name, customer_id, customers(agency_id)").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data: p } = await supabase.from("proposals").select("id, client_type, proposal_items(*)").eq("lead_id", id).maybeSingle();
  const type = (p?.client_type ?? null) as ClientType | null;
  const items = ((p?.proposal_items ?? []) as Item[]).sort((a, b) => STATIONS.indexOf(a.station as (typeof STATIONS)[number]) - STATIONS.indexOf(b.station as (typeof STATIONS)[number]));
  const hasAgency = !!(lead.customers as unknown as { agency_id: string | null } | null)?.agency_id;
  const add = (STATIONS as readonly string[]).includes(sp.add) ? sp.add : null;
  const base = `/leads/${id}/proposal`;

  const { data: pk } = add && type
    ? await supabase.from("price_packages").select("*").eq("station", add).eq("active", true).in("client_type", [type === "local" ? "local" : "media", "all"]).order("sort")
    : { data: [] };
  // Πακέτα σποτ και χορηγίες υπάρχουν μόνο για τοπικούς· αναφορές για όλους εκτός από κρατικές
  const pkgs = ((pk ?? []) as Pkg[]).filter((x) => (type === "local" ? true : type === "government" ? false : x.kind === "mention"));
  const budget = items.reduce((a, i) => a + itemTotal(i).total, 0);
  const perStation = STATIONS.map((st) => ({ st, sum: items.filter((i) => i.station === st).reduce((a, i) => a + itemTotal(i).total, 0) })).filter((x) => x.sum > 0);

  return (
    <main className="wrap" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Πρόταση · {lead.company_name}</h1>
        <Link href={`/leads/${id}`} className="muted">← Πίσω στο lead</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted" style={{ marginTop: 0 }}>Εσωτερικό εργαλείο: εδώ στήνεις τα νούμερα. Δεν στέλνεται τίποτα στον πελάτη. Τιμές χωρίς ΦΠΑ.</p>

      {!type || sp.change === "1" ? (
        <form action={setClientType} className="card stack">
          <input type="hidden" name="lead_id" value={id} />
          <h2 style={{ margin: 0 }}>Τι πελάτης είναι;</h2>
          <p className="muted" style={{ margin: 0 }}>Το ορίζεις μία φορά και ισχύει για όλα τα μέσα της πρότασης.{hasAgency ? " Η καρτέλα του πελάτη έχει πρακτορείο, γι' αυτό είναι προεπιλεγμένο το Media shop." : ""}</p>
          {TYPES.map((t) => (
            <label key={t} className="row" style={{ gap: 10, alignItems: "flex-start", border: "1px solid #ebe8ef", borderRadius: 12, padding: 12, cursor: "pointer" }}>
              <input type="radio" name="client_type" value={t} defaultChecked={(type ?? (hasAgency ? "media" : "local")) === t} style={{ width: "auto", marginTop: 3 }} />
              <span><strong>{CLIENT_LABEL[t]}</strong><br /><span className="muted">{CLIENT_HINT[t]}</span></span>
            </label>
          ))}
          <div><SubmitButton pending="Αποθήκευση…">Συνέχεια</SubmitButton></div>
        </form>
      ) : (
        <>
          <div className="card row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted">Πελάτης:</span>
            <span className="badge onair">{CLIENT_LABEL[type]}</span>
            {hasAgency && type !== "media" && <span className="badge late">Η καρτέλα του έχει πρακτορείο</span>}
            <span style={{ flex: 1 }} />
            {items.length === 0 && <Link href={`${base}?change=1`} className="muted">Αλλαγή</Link>}
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>Τι περιλαμβάνει</h2>
            {items.length === 0 && <p className="muted" style={{ margin: 0 }}>Άδεια ακόμα. Διάλεξε μέσο από κάτω για να ξεκινήσεις.</p>}
            {STATIONS.filter((st) => items.some((i) => i.station === st)).map((st) => (
              <div key={st} className="stack">
                <h3 style={{ margin: "6px 0 0" }}>{st}</h3>
                {items.filter((i) => i.station === st).map((i) => {
                  const t = itemTotal(i);
                  return (
                    <div key={i.id} style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <div style={{ minWidth: 200, flex: 1 }}>
                          <strong>{i.title}</strong> <span className="badge gray">{i.kind === "plan" ? "Κοστολόγηση" : "Τιμοκατάλογος"}</span>
                          <div className="muted">{t.bonus && i.long_detail ? i.long_detail : i.detail}</div>
                          <div className="muted" style={{ fontSize: 13 }}>
                            {eur(t.perMonth)} / μήνα{t.bonus && <span className="badge good" style={{ marginLeft: 6 }}>bonus {i.long_months}+ μηνών</span>}
                            {!t.bonus && i.long_months != null && i.long_amount != null && <> · από {i.long_months} μήνες: {eur(Number(i.long_amount))}/μήνα</>}
                          </div>
                        </div>
                        <form action={setItemMonths} className="row" style={{ gap: 6, alignItems: "center" }}>
                          <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="version" value={i.version} />
                          <span className="muted" style={{ fontSize: 13 }}>Διάρκεια</span>
                          <AutoSelect name="months" value={String(i.months)} options={MONTH_OPTS} label="Διάρκεια σε μήνες" />
                        </form>
                        <div style={{ textAlign: "right", minWidth: 110 }}>
                          <div style={{ fontSize: 18, fontWeight: 800 }}>{eur(t.total)}</div>
                          <div className="row" style={{ gap: 10, justifyContent: "flex-end", fontSize: 13 }}>
                            {i.kind === "plan" && <Link href={`${base}/plan?item=${i.id}`}>Άνοιγμα πλάνου</Link>}
                            <form action={deleteItem}>
                              <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="id" value={i.id} />
                              <button type="submit" className="linklike" style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", fontWeight: 500, cursor: "pointer", textDecoration: "underline" }}>Αφαίρεση</button>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {items.length > 0 && (
              <div style={{ borderTop: "2px solid #ebe8ef", paddingTop: 12 }}>
                {perStation.length > 1 && perStation.map((x) => (
                  <div key={x.st} className="row muted" style={{ justifyContent: "space-between" }}><span>{x.st}</span><span>{eur(x.sum)}</span></div>
                ))}
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong>Συνολικό μπάτζετ</strong>
                  <span style={{ fontSize: 26, fontWeight: 800 }}>{eur(budget)}</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>Χωρίς ΦΠΑ και χωρίς εκπτώσεις. Οι εκπτώσεις θα μπαίνουν εδώ, πάνω στο σύνολο.</div>
              </div>
            )}
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>{items.length ? "Πρόσθεσε κι άλλο μέσο" : "Διάλεξε μέσο"}</h2>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {STATIONS.map((st) => <Link key={st} href={`${base}?add=${encodeURIComponent(st)}`} className={`btn ${add === st ? "" : "secondary"}`}>{st}</Link>)}
            </div>
            {add && (
              <div className="stack">
                <h3 style={{ margin: "6px 0 0" }}>{add} · {CLIENT_LABEL[type]}</h3>
                <div style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12 }} className="row">
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <strong>Κοστολόγηση πλάνου</strong>
                    <div className="muted">
                      {type === "local" && "Με τοπικές τιμές: για σποτ μεγαλύτερο ή μικρότερο από 30'', ή καμπάνια με διαφορετικά σποτ."}
                      {type === "direct" && "Με τιμές direct, ανά break και ακροατές."}
                      {type === "media" && "Με τη σταθερή τιμή ανά δευτερόλεπτο των media shops."}
                      {type === "government" && "Με τη σταθερή τιμή ανά δευτερόλεπτο για κρατικές."}
                    </div>
                  </div>
                  <Link href={`${base}/plan?station=${encodeURIComponent(add)}`} className="btn">Άνοιγμα →</Link>
                </div>
                {pkgs.map((x) => (
                  <form key={x.id} action={addPackageItem} style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12 }} className="row">
                    <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="package_id" value={x.id} />
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <strong>{x.name}</strong> <span className="badge gray">{KIND[x.kind]}</span>
                      <div className="muted">
                        {[x.description, x.spots_per_day != null ? (x.bonus_spots ? `${x.spots_per_day}+${x.bonus_spots} δώρο σποτ/ημέρα` : `${x.spots_per_day} σποτ/ημέρα`) : null].filter(Boolean).join(" · ")}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {eur(Number(x.price))} / {x.kind === "mention" ? "αναφορά" : "μήνα"}
                        {x.long_months != null && x.long_price != null && <> · από {x.long_months} μήνες: {eur(Number(x.long_price))}/μήνα{x.long_bonus_spots != null && x.spots_per_day != null ? ` (${x.spots_per_day}+${x.long_bonus_spots})` : ""}</>}
                      </div>
                    </div>
                    {x.kind === "mention" && <label style={{ width: 130, fontSize: 12 }}>Αναφορές τον μήνα<input name="qty" inputMode="numeric" defaultValue="10" /></label>}
                    <SubmitButton pending="…">Προσθήκη</SubmitButton>
                  </form>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
