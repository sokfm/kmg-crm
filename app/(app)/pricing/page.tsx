import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { savePackage, saveStationRates } from "../actions";

type Rate = { station: string; media_shop_sec: number; government_sec: number; local_per_k: number; direct_per_k: number; version: number };
const sec = (n: number) => new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n) + " €";

type Pkg = {
  id: string; station: string; kind: "spots" | "sponsorship" | "mention"; client_type: "local" | "media" | "all";
  name: string; description: string | null; spots_per_day: number | null; bonus_spots: number; max_sec: number | null;
  price: number; unit: "month" | "mention"; long_months: number | null; long_bonus_spots: number | null; long_price: number | null;
  notes: string | null; needs_check: boolean; active: boolean; sort: number; version: number;
};

const STATIONS = ["ΣΟΚ FM", "DALKAS", "ΜΠΛΕ", "NRG"];
const KIND: Record<Pkg["kind"], string> = { spots: "Πακέτα σποτ", sponsorship: "Χορηγίες εκπομπών", mention: "Αναφορές" };
const CLIENT: Record<Pkg["client_type"], string> = { local: "Τοπικός πελάτης", media: "Media shop", all: "Όλοι" };
const eur = (n: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 }).format(n) + " €";
const MONTHS = [1, 3, 6, 12];

// Σύνολο για Ν μήνες: από τους μήνες του bonus και πάνω ισχύει η τιμή bonus
function total(p: Pkg, m: number) {
  const bonus = p.long_months != null && p.long_price != null && m >= p.long_months;
  return { sum: m * (bonus ? p.long_price! : p.price), bonus };
}

function spotsText(spots: number | null, bonus: number | null) {
  if (spots == null) return null;
  return bonus ? `${spots}+${bonus} δώρο σποτ/ημέρα` : `${spots} σποτ/ημέρα`;
}

export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data } = await supabase.from("price_packages").select("*").order("sort").order("name");
  const all = (data ?? []) as Pkg[];
  const { data: rd } = await supabase.from("station_rates").select("*").order("sort");
  const rates = (rd ?? []) as Rate[];
  const client = sp.c === "local" || sp.c === "media" ? sp.c : null;
  const pkgs = all.filter((p) => (isAdmin || p.active) && (!client || p.client_type === client || p.client_type === "all"));
  const station = STATIONS.includes(sp.s) ? sp.s : null;
  const link = (s: string | null, c: string | null) => {
    const q = new URLSearchParams();
    if (s) q.set("s", s);
    if (c) q.set("c", c);
    return `/pricing${q.size ? `?${q}` : ""}`;
  };
  const shown = STATIONS.filter((s) => !station || s === station);

  return (
    <main className="wrap" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Τιμοκατάλογος</h1>
        <a href="/pricing/plan" className="btn">Κοστολόγηση πλάνου →</a>
      </div>
      <Flash sp={sp} />
      <p className="muted" style={{ marginTop: 0 }}>
        Όλες οι τιμές είναι <strong>χωρίς ΦΠΑ</strong>, για σποτ έως 30&apos;&apos;. Ελάχιστη διάρκεια 1 μήνας.
        Από 3 μήνες και πάνω ισχύει το <strong>bonus</strong> με προπληρωμή· χωρίς προπληρωμή ο πελάτης πληρώνει την κανονική τιμή
        και η διαφορά αφαιρείται στον τελευταίο μήνα.
      </p>

      <section className="card stack" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Τιμή ανά δευτερόλεπτο</h2>
        <p className="muted" style={{ margin: 0 }}>
          <strong>Media shop</strong>: η τιμή προς τα πρακτορεία (η επιστροφή τους είναι μέσα σε αυτή). <strong>Κρατικές</strong>: κρατικές διαφημίσεις.
          <strong> Κοστολόγηση πλάνου</strong>: € ανά δευτερόλεπτο για κάθε 1.000 ακροατές της ώρας (Χαλκίδα - Εύβοια) — τοπικός πελάτης / μεγάλος πελάτης direct.
        </p>
        <table className="table">
          <thead><tr><th>Σταθμός</th><th style={{ textAlign: "right" }}>Media shop</th><th style={{ textAlign: "right" }}>Κρατικές</th><th style={{ textAlign: "right" }}>Πλάνο τοπικού / 1.000</th><th style={{ textAlign: "right" }}>Πλάνο direct / 1.000</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.station}>
                <td><strong>{r.station}</strong></td>
                <td style={{ textAlign: "right" }}>{sec(r.media_shop_sec)}/sec</td>
                <td style={{ textAlign: "right" }}>{sec(r.government_sec)}/sec</td>
                <td style={{ textAlign: "right" }}>{sec(r.local_per_k)}</td>
                <td style={{ textAlign: "right" }}>{sec(r.direct_per_k)}</td>
                {isAdmin && (
                  <td>
                    <details>
                      <summary className="muted" style={{ cursor: "pointer" }}>Αλλαγή</summary>
                      <form action={saveStationRates} className="stack" style={{ marginTop: 8, minWidth: 220 }}>
                        <input type="hidden" name="station" value={r.station} />
                        <input type="hidden" name="version" value={r.version} />
                        <label>Media shop €/sec<input name="media_shop_sec" inputMode="decimal" defaultValue={String(r.media_shop_sec)} /></label>
                        <label>Κρατικές €/sec<input name="government_sec" inputMode="decimal" defaultValue={String(r.government_sec)} /></label>
                        <label>Πλάνο τοπικού<input name="local_per_k" inputMode="decimal" defaultValue={String(r.local_per_k)} /></label>
                        <label>Πλάνο direct<input name="direct_per_k" inputMode="decimal" defaultValue={String(r.direct_per_k)} /></label>
                        <SubmitButton pending="Αποθήκευση…">Αποθήκευση</SubmitButton>
                      </form>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Παράδειγμα: σποτ 30&apos;&apos; στον ΣΟΚ για media shop = 30 × {rates[0] ? sec(rates[0].media_shop_sec) : "—"} = {rates[0] ? eur(30 * rates[0].media_shop_sec) : "—"}.</p>
      </section>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <a className={`chip ${!station ? "on" : ""}`} href={link(null, client)}>Όλοι οι σταθμοί</a>
        {STATIONS.map((s) => <a key={s} className={`chip ${station === s ? "on" : ""}`} href={link(s, client)}>{s}</a>)}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>Πελάτης:</span>
        <a className={`chip ${!client ? "on" : ""}`} href={link(station, null)}>Όλα</a>
        <a className={`chip ${client === "local" ? "on" : ""}`} href={link(station, "local")}>Τοπικός</a>
        <a className={`chip ${client === "media" ? "on" : ""}`} href={link(station, "media")}>Media shop</a>
      </div>

      {shown.map((st) => {
        const list = pkgs.filter((p) => p.station === st);
        return (
          <section key={st} className="card stack" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>{st}</h2>
            {list.length === 0 && <p className="muted">Δεν υπάρχουν πακέτα ακόμα.</p>}
            {(["spots", "sponsorship", "mention"] as const).map((k) => {
              const items = list.filter((p) => p.kind === k);
              if (!items.length) return null;
              return (
                <div key={k} className="stack">
                  <h3 style={{ margin: "6px 0 0" }}>{KIND[k]}</h3>
                  {items.map((p) => (
                    <div key={p.id} style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12, opacity: p.active ? 1 : 0.55 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <strong>{p.name}</strong>{" "}
                          <span className="badge gray">{CLIENT[p.client_type]}</span>{" "}
                          {p.needs_check && <span className="badge late">Προς επιβεβαίωση</span>}{" "}
                          {!p.active && <span className="badge faint">Ανενεργό</span>}
                          <div className="muted">
                            {[p.description, spotsText(p.spots_per_day, p.bonus_spots)].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{eur(p.price)}<span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> / {p.unit === "mention" ? "αναφορά" : "μήνα"}</span></div>
                          {p.long_months != null && p.long_price != null && (
                            <div className="muted">
                              Από {p.long_months} μήνες: <strong>{eur(p.long_price)}</strong>/μήνα
                              {p.long_bonus_spots != null && p.spots_per_day != null ? ` · ${spotsText(p.spots_per_day, p.long_bonus_spots)}` : ""}
                            </div>
                          )}
                        </div>
                      </div>

                      {p.unit === "month" && (
                        <table className="table" style={{ marginTop: 8, fontSize: 13 }}>
                          <thead><tr><th>Διάρκεια</th>{MONTHS.map((m) => <th key={m} style={{ textAlign: "right" }}>{m} {m === 1 ? "μήνας" : "μήνες"}</th>)}</tr></thead>
                          <tbody>
                            <tr>
                              <td>Σύνολο</td>
                              {MONTHS.map((m) => { const t = total(p, m); return <td key={m} style={{ textAlign: "right" }}>{eur(t.sum)}{t.bonus && <span className="badge good" style={{ marginLeft: 4 }}>bonus</span>}</td>; })}
                            </tr>
                            {p.long_months != null && p.long_price != null && p.long_price < p.price && (
                              <tr className="muted">
                                <td>Χωρίς προπληρωμή</td>
                                {MONTHS.map((m) => {
                                  const t = total(p, m);
                                  if (!t.bonus) return <td key={m} style={{ textAlign: "right" }}>—</td>;
                                  const last = p.price - m * (p.price - p.long_price!);
                                  return <td key={m} style={{ textAlign: "right" }}>{m - 1}×{eur(p.price)} + τελευταίος {eur(last)}</td>;
                                })}
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                      {p.notes && <div className="msg" style={{ marginTop: 8, fontSize: 13 }}>{p.notes}</div>}

                      {isAdmin && (
                        <details style={{ marginTop: 8 }}>
                          <summary className="muted" style={{ cursor: "pointer" }}>Αλλαγή</summary>
                          <PackageForm p={p} />
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}

      {isAdmin && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>+ Νέο πακέτο</summary>
          <PackageForm />
        </details>
      )}
    </main>
  );
}

function PackageForm({ p }: { p?: Pkg }) {
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));
  return (
    <form action={savePackage} className="stack" style={{ marginTop: 10 }}>
      {p && <><input type="hidden" name="id" value={p.id} /><input type="hidden" name="version" value={p.version} /></>}
      <div className="grid2">
        <label>Σταθμός
          <select name="station" defaultValue={p?.station ?? "ΣΟΚ FM"}>{STATIONS.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label>Είδος
          <select name="kind" defaultValue={p?.kind ?? "spots"}>
            <option value="spots">Πακέτο σποτ</option><option value="sponsorship">Χορηγία εκπομπής</option><option value="mention">Αναφορά</option>
          </select>
        </label>
        <label>Όνομα<input name="name" defaultValue={p?.name ?? ""} required /></label>
        <label>Για
          <select name="client_type" defaultValue={p?.client_type ?? "local"}>
            <option value="local">Τοπικό πελάτη</option><option value="media">Media shop</option><option value="all">Όλους</option>
          </select>
        </label>
      </div>
      <label>Τι περιλαμβάνει<input name="description" defaultValue={p?.description ?? ""} placeholder="π.χ. 2 αναφορές + 2 σποτ, 17:00–20:00" /></label>
      <div className="grid2">
        <label>Σποτ την ημέρα<input name="spots_per_day" inputMode="numeric" defaultValue={n(p?.spots_per_day)} /></label>
        <label>Δώρο σποτ την ημέρα<input name="bonus_spots" inputMode="numeric" defaultValue={n(p?.bonus_spots ?? 0)} /></label>
        <label>Τιμή (€ χωρίς ΦΠΑ, ανά μήνα ή ανά αναφορά)<input name="price" inputMode="decimal" defaultValue={n(p?.price)} required /></label>
        <label>Μέγιστη διάρκεια σποτ (sec)<input name="max_sec" inputMode="numeric" defaultValue={n(p?.max_sec ?? 30)} /></label>
      </div>
      <fieldset className="stack" style={{ border: "1px dashed #ddd", borderRadius: 10, padding: 10 }}>
        <legend className="muted">Bonus για πολλούς μήνες (κενό = χωρίς bonus)</legend>
        <div className="grid2">
          <label>Από πόσους μήνες<input name="long_months" inputMode="numeric" defaultValue={n(p?.long_months)} placeholder="3" /></label>
          <label>Τιμή bonus ανά μήνα (€)<input name="long_price" inputMode="decimal" defaultValue={n(p?.long_price)} /></label>
          <label>Δώρο σποτ με το bonus<input name="long_bonus_spots" inputMode="numeric" defaultValue={n(p?.long_bonus_spots)} /></label>
        </div>
      </fieldset>
      <label>Σημείωση<input name="notes" defaultValue={p?.notes ?? ""} /></label>
      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" name="needs_check" value="1" defaultChecked={p?.needs_check ?? false} /> Προς επιβεβαίωση</label>
        <label className="row" style={{ gap: 6 }}>
          <select name="active" defaultValue={p?.active === false ? "0" : "1"}><option value="1">Ενεργό</option><option value="0">Ανενεργό (δεν το βλέπουν οι Account Executives)</option></select>
        </label>
      </div>
      <div><SubmitButton pending="Αποθήκευση…">{p ? "Αποθήκευση" : "Προσθήκη"}</SubmitButton></div>
    </form>
  );
}
