import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoSelect } from "@/components/AutoSelect";
import { AutoDate } from "@/components/AutoDate";
import { addDays, proposalByMonth, ymLabel } from "@/lib/forecast";
import { today as todayStr } from "@/lib/format";
import { dateGr } from "@/lib/format";
import { CLIENT_HINT, CLIENT_LABEL, STATIONS, itemTotal, type ClientType, type Item } from "@/lib/pricing";
import { addPackageItem, copyProposal, decideDiscount, deleteItem, deleteProposal, renameProposal, requestDiscount, setClientType, setConfirmedStart, setItemMonths, setItemStart, setMainProposal, togglePrepay } from "../../../../proposal-actions";

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
}: { params: Promise<{ id: string; pid: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data: lead } = await supabase.from("leads").select("id, company_name, status, customer_id, customers(agency_id)").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const { data: p } = await supabase.from("proposals").select("id, code, sent_at, client_type, title, is_main, version, prepay, req_amount, req_reason, req_status, decided_note, requester:profiles!proposals_req_by_fkey(full_name), decider:profiles!proposals_decided_by_fkey(full_name), proposal_items(*)").eq("id", pid).eq("lead_id", id).maybeSingle();
  if (!p) notFound();
  const type = (p?.client_type ?? null) as ClientType | null;
  const items = ((p?.proposal_items ?? []) as Item[]).sort((a, b) => STATIONS.indexOf(a.station as (typeof STATIONS)[number]) - STATIONS.indexOf(b.station as (typeof STATIONS)[number]));
  const locked = !!p.sent_at;
  const sentOn = p.sent_at ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" }).format(new Date(p.sent_at)) : "";
  const hasAgency = !!(lead.customers as unknown as { agency_id: string | null } | null)?.agency_id;
  const add = !locked && (STATIONS as readonly string[]).includes(sp.add) ? sp.add : null;
  const base = `/leads/${id}/proposal/${pid}`;
  const ids = <><input type="hidden" name="lead_id" value={id} /><input type="hidden" name="proposal_id" value={pid} /></>;

  const { data: pk } = add && type
    ? await supabase.from("price_packages").select("*").eq("station", add).eq("active", true).in("client_type", [type === "local" ? "local" : "media", "all"]).order("sort")
    : { data: [] };
  // Πακέτα σποτ και χορηγίες υπάρχουν μόνο για τοπικούς· αναφορές για όλους εκτός από κρατικές
  const pkgs = ((pk ?? []) as Pkg[]).filter((x) => (type === "local" ? true : type === "government" ? false : x.kind === "mention"));
  const budget = items.reduce((a, i) => a + itemTotal(i).total, 0);
  const { data: tot } = await supabase.from("proposal_totals").select("list_total, combo_pct, prepay_pct, book_total, final_total").eq("proposal_id", pid).maybeSingle();
  const T = { list: Number(tot?.list_total ?? budget), combo: Number(tot?.combo_pct ?? 0), prepay: Number(tot?.prepay_pct ?? 0), book: Number(tot?.book_total ?? budget), final: Number(tot?.final_total ?? budget) };
  const leadOpen = !["won", "lost"].includes(lead.status as string);
  const fOpts = { open: leadOpen, today: todayStr() };
  const byMonth = proposalByMonth(items, T.final, fOpts);
  const askConfirm = locked || lead.status === "won";   // από τη στιγμή που στάλθηκε ή κλείστηκε, ζητάμε την πραγματική έναρξη
  const allConfirmed = items.length > 0 && items.every((i) => i.confirmed_start);
  const afterCombo = Math.round(T.list * (100 - T.combo)) / 100;
  const requester = (p.requester as unknown as { full_name: string } | null)?.full_name ?? "Account Executive";
  const decider = (p.decider as unknown as { full_name: string } | null)?.full_name ?? "";
  const perStation = STATIONS.map((st) => ({ st, sum: items.filter((i) => i.station === st).reduce((a, i) => a + itemTotal(i).total, 0) })).filter((x) => x.sum > 0);

  return (
    <main className="wrap" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>{p.title} · {lead.company_name} <span className="badge gray" style={{ verticalAlign: "middle" }}>{p.code}</span></h1>
        <Link href={`/leads/${id}/proposal`} className="muted">← Όλες οι προτάσεις</Link>
      </div>
      <Flash sp={sp} />
      {locked ? (
        <div className="msg" style={{ background: "var(--orange-bg)" }}>
          <strong>🔒 Κλειδωμένη.</strong> Εκδόθηκε για αποστολή στις {sentOn}. Δεν αλλάζει πια τίποτα, ώστε ο κωδικός {p.code} να δείχνει πάντα αυτό που πήρε ο πελάτης. Θέλεις αλλαγή; Πάτα «Αντίγραφο»: ανοίγει καινούργια πρόταση με νέο κωδικό.
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>Εσωτερικό εργαλείο: εδώ στήνεις τα νούμερα. Τιμές χωρίς ΦΠΑ. Μόλις την εκδώσεις για αποστολή, κλειδώνει.</p>
      )}

      {!type || (sp.change === "1" && !locked) ? (
        <form action={setClientType} className="card stack">
          {ids}
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
            {items.length === 0 && !locked && <Link href={`${base}?change=1`} className="muted">Αλλαγή</Link>}
          </div>

          <div className="card row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <form action={renameProposal} className="row" style={{ gap: 6, alignItems: "flex-end", flex: 1, minWidth: 240 }}>
              {ids}<input type="hidden" name="version" value={p.version} />
              <label style={{ flex: 1 }}>Όνομα πρότασης<input name="title" defaultValue={p.title} required maxLength={80} /></label>
              <button type="submit" className="secondary">Αποθήκευση</button>
            </form>
            {p.is_main ? (
              <span className="badge good" title="Το σύνολό της γράφεται ως Εκτιμώμενη αξία του lead">Κύρια πρόταση</span>
            ) : (
              <form action={setMainProposal}>{ids}<button type="submit" className="secondary">Να μετράει αυτή στο lead</button></form>
            )}
            {items.length > 0 && <Link href={`${base}/offer`} className="btn">{locked ? "Η προσφορά που στάλθηκε →" : "Προσφορά για τον πελάτη →"}</Link>}
            <form action={copyProposal}>{ids}<button type="submit" className={locked ? "" : "secondary"}>{locked ? "Αντίγραφο (νέα πρόταση)" : "Αντίγραφο"}</button></form>
            {items.length === 0 && <form action={deleteProposal}>{ids}<button type="submit" className="secondary">Διαγραφή</button></form>}
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
                        {locked ? <span className="muted" style={{ fontSize: 13 }}>Διάρκεια: {MONTH_OPTS[i.months - 1]?.label ?? `${i.months} μήνες`}</span> : (
                        <form action={setItemMonths} className="row" style={{ gap: 6, alignItems: "center" }}>
                          {ids}<input type="hidden" name="id" value={i.id} /><input type="hidden" name="version" value={i.version} />
                          <span className="muted" style={{ fontSize: 13 }}>Διάρκεια</span>
                          <AutoSelect name="months" value={String(i.months)} options={MONTH_OPTS} label="Διάρκεια σε μήνες" />
                        </form>)}
                        {locked ? (
                          <span className="muted" style={{ fontSize: 13 }}>Έναρξη προσφοράς: {i.start_date ? dateGr(i.start_date) : "—"}</span>
                        ) : i.kind === "plan" ? (
                          <span className="muted" style={{ fontSize: 13 }}>Έναρξη: {i.start_date ? `${dateGr(i.start_date)} έως ${dateGr(addDays(i.start_date, i.months * 30 - 1))}` : "—"}<br />(αλλάζει μέσα στο πλάνο)</span>
                        ) : (
                          <form action={setItemStart} className="row" style={{ gap: 6, alignItems: "center" }}>
                            {ids}<input type="hidden" name="id" value={i.id} /><input type="hidden" name="version" value={i.version} />
                            <span className="muted" style={{ fontSize: 13 }}>Έναρξη</span>
                            <AutoDate name="start_date" value={i.start_date ?? ""} label="Ημερομηνία έναρξης καμπάνιας" />
                            {i.start_date && <span className="muted" style={{ fontSize: 13 }}>έως {dateGr(addDays(i.start_date, i.months * 30 - 1))}</span>}
                          </form>
                        )}
                        {askConfirm && (
                          <form action={setConfirmedStart} className="row" style={{ gap: 6, alignItems: "center" }}>
                            {ids}<input type="hidden" name="id" value={i.id} />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{i.confirmed_start ? "✓ Επιβεβαιωμένη έναρξη" : "Επιβεβαιωμένη έναρξη;"}</span>
                            <AutoDate name="confirmed_start" value={i.confirmed_start ?? ""} label="Επιβεβαιωμένη έναρξη" />
                            {i.confirmed_start && <span className="muted" style={{ fontSize: 13 }}>έως {dateGr(addDays(i.confirmed_start, i.months * 30 - 1))}</span>}
                          </form>
                        )}
                        <div style={{ textAlign: "right", minWidth: 110 }}>
                          <div style={{ fontSize: 18, fontWeight: 800 }}>{eur(t.total)}</div>
                          <div className="row" style={{ gap: 10, justifyContent: "flex-end", fontSize: 13 }}>
                            {i.kind === "plan" && <Link href={`${base}/plan?item=${i.id}`}>Άνοιγμα πλάνου</Link>}
                            {!locked && <form action={deleteItem}>
                              {ids}<input type="hidden" name="id" value={i.id} />
                              <button type="submit" className="linklike" style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", fontWeight: 500, cursor: "pointer", textDecoration: "underline" }}>Αφαίρεση</button>
                            </form>}
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
                <div className="row" style={{ justifyContent: "space-between" }}><span>Τιμή τιμοκαταλόγου</span><strong>{eur(T.list)}</strong></div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span>Combo 8% <span className="muted">· πάνω από ένα ραδιόφωνο</span></span>
                  {T.combo ? <strong>− {eur(T.list - afterCombo)}</strong> : <span className="muted">δεν ισχύει (ένα ραδιόφωνο)</span>}
                </div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {locked ? <span>Προπληρωμή 10% <span className="muted">· {p.prepay ? "ναι" : "όχι"}</span></span> : <form action={togglePrepay} className="row" style={{ gap: 8, alignItems: "center" }}>
                    {ids}<input type="hidden" name="version" value={p.version} /><input type="hidden" name="prepay" value={p.prepay ? "0" : "1"} />
                    <span>Προπληρωμή 10%</span>
                    <button type="submit" className={p.prepay ? "" : "secondary"} style={{ padding: "5px 12px" }} aria-pressed={p.prepay}>{p.prepay ? "✓ Ναι" : "Όχι"}</button>
                  </form>}
                  {T.prepay ? <strong>− {eur(afterCombo - T.book)}</strong> : <span className="muted">—</span>}
                </div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid #ebe8ef", paddingTop: 8, marginTop: 6 }}>
                  <strong>{p.req_status === "approved" ? "Τιμή by the book" : "Συνολικό μπάτζετ"}</strong>
                  <span style={p.req_status === "approved" ? { fontSize: 16, textDecoration: "line-through", color: "var(--muted)" } : { fontSize: 26, fontWeight: 800 }}>{eur(T.book)}</span>
                </div>
                {p.req_status === "approved" && (
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong>Συνολικό μπάτζετ <span className="badge good">ειδική τιμή</span></strong>
                    <span style={{ fontSize: 26, fontWeight: 800 }}>{eur(T.final)}</span>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 13 }}>Χωρίς ΦΠΑ. Το 8% και το 10% είναι by the book και δεν θέλουν έγκριση.</div>

                <div style={{ background: "#f7f6f9", borderRadius: 12, padding: 12, marginTop: 10 }}>
                  <strong>Τζίρος ανά μήνα</strong> <span className="muted" style={{ fontSize: 13 }}>· το ποσό σπάει στις ημέρες που παίζει κάθε μήνα</span>
                  {byMonth.months.length > 0 && (
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      {byMonth.months.map((m) => <span key={m.ym} className="badge gray" style={{ fontSize: 13 }}>{ymLabel(m.ym)}: <strong>{eur(m.amount)}</strong></span>)}
                    </div>
                  )}
                  {byMonth.undated > 0 && <div className="late-txt" style={{ fontSize: 13, marginTop: 6 }}>{eur(byMonth.undated)} χωρίς μήνα: βάλε ημερομηνία έναρξης στις γραμμές που δεν έχουν.</div>}
                  <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                    {allConfirmed ? "✓ Υπολογισμένο με την επιβεβαιωμένη έναρξη."
                      : byMonth.rolled ? "Η έναρξη της προσφοράς έχει περάσει και το lead δεν έχει κλείσει, οπότε μετράω από σήμερα. Διορθώνεται μόνο του όταν μπει επιβεβαιωμένη έναρξη."
                      : "Εκτίμηση με την έναρξη της προσφοράς, μέχρι να μπει η επιβεβαιωμένη."}
                  </div>
                  {askConfirm && (
                    <form action={setConfirmedStart} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                      {ids}
                      <strong style={{ fontSize: 13 }}>Επιβεβαιωμένη έναρξη για όλες τις γραμμές</strong>
                      <input type="date" name="confirmed_start" required aria-label="Επιβεβαιωμένη έναρξη για όλες τις γραμμές" style={{ maxWidth: 160 }} />
                      <SubmitButton pending="…">Ισχύει για όλες</SubmitButton>
                    </form>
                  )}
                </div>
                {(!locked || p.req_status === "approved") && <div style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12, marginTop: 10 }} className="stack">
                  <strong>Ειδική τιμή (θέλει έγκριση)</strong>
                  {p.req_status === "pending" && (
                    <>
                      <div className="msg" style={{ background: "var(--orange-bg)" }}>
                        <strong>Αναμένει έγκριση:</strong> {requester} ζητάει <strong>{eur(Number(p.req_amount))}</strong> αντί {eur(T.book)} (−{eur(T.book - Number(p.req_amount))}, {(100 * (1 - Number(p.req_amount) / T.book)).toFixed(1).replace(".", ",")}%).
                        <br />Λόγος: {p.req_reason}
                      </div>
                      {isAdmin ? (
                        <form action={decideDiscount} className="stack">
                          {ids}
                          <label>Σχόλιο (προαιρετικό)<input name="note" maxLength={200} /></label>
                          <div className="row" style={{ gap: 8 }}>
                            <button type="submit" name="decision" value="approve">Έγκριση {eur(Number(p.req_amount))}</button>
                            <button type="submit" name="decision" value="reject" className="secondary">Απόρριψη</button>
                          </div>
                        </form>
                      ) : <div className="muted">Θα ειδοποιηθείς μόλις απαντήσει ο Νίκος ή η Γιάννα. Μέχρι τότε ισχύει η τιμή by the book.</div>}
                    </>
                  )}
                  {p.req_status === "approved" && <div className="msg ok">Εγκρίθηκε {eur(Number(p.req_amount))}{decider ? ` από ${decider}` : ""}. Λόγος: {p.req_reason}{p.decided_note ? ` · Σχόλιο: ${p.decided_note}` : ""}. {locked ? "" : " Αν αλλάξεις κάτι στην πρόταση, η έγκριση ακυρώνεται."}</div>}
                  {p.req_status === "rejected" && <div className="msg error">Δεν εγκρίθηκε η τιμή {eur(Number(p.req_amount))}{decider ? ` (${decider})` : ""}{p.decided_note ? `: ${p.decided_note}` : "."} Ισχύει η τιμή by the book.</div>}
                  {!locked && p.req_status !== "pending" && p.req_status !== "approved" && (
                    <form action={requestDiscount} className="stack">
                      {ids}
                      <div className="muted">{isAdmin ? "Βάλε την τελική τιμή και τον λόγο. Ισχύει αμέσως." : "Ο πελάτης θέλει καλύτερη τιμή; Γράψε πόσο και γιατί, και πάει για έγκριση στον Νίκο και τη Γιάννα."}</div>
                      <div className="grid2">
                        <label>Τελική τιμή που ζητάς (€, χωρίς ΦΠΑ)<input name="amount" inputMode="decimal" required placeholder={String(Math.floor(T.book / 50) * 50 || "")} /></label>
                        <label>Λόγος<input name="reason" required maxLength={300} placeholder="π.χ. Ο πελάτης θέλει 1.000 για να το κλείσει σήμερα" /></label>
                      </div>
                      <div><SubmitButton pending="Αποστολή…">{isAdmin ? "Ορισμός ειδικής τιμής" : "Ζήτα έγκριση"}</SubmitButton></div>
                    </form>
                  )}
                </div>}
              </div>
            )}
          </div>

          {!locked && <div className="card stack">
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
                      {type === "local" && "Με τοπικές τιμές ανά break: για σποτ μεγαλύτερο ή μικρότερο από 30'', ή καμπάνια με διαφορετικά σποτ."}
                      {type === "direct" && "Με τιμές direct ανά break."}
                      {type === "media" && "Με τη σταθερή τιμή ανά δευτερόλεπτο των media shops."}
                      {type === "government" && "Με τη σταθερή τιμή ανά δευτερόλεπτο για κρατικές."}
                    </div>
                  </div>
                  <Link href={`${base}/plan?station=${encodeURIComponent(add)}`} className="btn">Άνοιγμα →</Link>
                </div>
                {pkgs.map((x) => (
                  <form key={x.id} action={addPackageItem} style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12 }} className="row">
                    {ids}<input type="hidden" name="package_id" value={x.id} />
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
          </div>}
        </>
      )}
    </main>
  );
}
