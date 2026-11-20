import { STATION_LOGO, STATION_NAME, dateLong, type Snapshot } from "@/lib/offer";

const eur = (v: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 }).format(v) + " €";
const CSS = `
@page { size: 1280px 720px; margin: 0; }
.offer, .offer * { box-sizing: border-box; }
.offer { --red: #E2001A; --yellow: #FFCB05; --gray: #55565A; --soft: #F4F4F6; font-family: Manrope, Inter, system-ui, sans-serif; color: #2f2f33; }
.offer .page { width: 1280px; height: 720px; position: relative; overflow: hidden; background: #fff; page-break-after: always; break-after: page; margin: 0 auto 16px; box-shadow: 0 2px 14px rgba(0,0,0,.12); }
.offer .stripes { position: absolute; left: -60px; top: -40px; width: 300px; height: 820px; transform: skewX(-12deg); display: flex; }
.offer .stripes i { display: block; height: 100%; }
.offer .eyebrow { font-size: 15px; letter-spacing: .22em; font-weight: 700; color: var(--red); text-transform: uppercase; }
.offer .cover .body { position: absolute; left: 380px; top: 130px; right: 80px; }
.offer .cover h1 { font-size: 60px; line-height: 1.04; margin: 14px 0 10px; font-weight: 800; letter-spacing: -.02em; }
.offer .cover .sub { font-size: 24px; color: var(--gray); }
.offer .cover .clogo { margin-top: 34px; max-width: 320px; max-height: 150px; display: block; }
.offer .cover .meta { margin-top: 40px; display: flex; gap: 48px; font-size: 15px; }
.offer .cover .meta b { display: block; font-size: 12px; letter-spacing: .14em; color: #8a8b90; font-weight: 700; margin-bottom: 4px; }
.offer .kmg { position: absolute; right: 56px; bottom: 36px; height: 120px; }
.offer .side { position: absolute; left: 0; top: 0; bottom: 0; width: 300px; background: var(--gray); color: #fff; padding: 64px 36px; }
.offer .side .bar { width: 64px; height: 8px; background: var(--yellow); margin-bottom: 22px; box-shadow: 64px 0 0 var(--red); }
.offer .side h2 { font-size: 34px; line-height: 1.1; margin: 0 0 14px; font-weight: 800; color: #fff; }
.offer .side p { font-size: 15px; line-height: 1.5; color: #e3e3e6; margin: 0; }
.offer .side .client { position: absolute; left: 36px; right: 30px; bottom: 44px; font-size: 13px; color: #cfcfd4; }
.offer .side .client b { display: block; font-size: 21px; color: #fff; }
.offer .side .client img { display: block; max-width: 200px; max-height: 80px; background: #fff; border-radius: 8px; padding: 8px; margin-top: 8px; }
.offer .main { position: absolute; left: 340px; top: 44px; right: 48px; }
.offer table { width: 100%; border-collapse: separate; border-spacing: 0 6px; font-size: 15px; }
.offer th { font-size: 11.5px; letter-spacing: .12em; text-align: left; color: #fff; background: var(--gray); padding: 10px 12px; font-weight: 700; border: 0; text-transform: uppercase; }
.offer th:first-child { border-radius: 8px 0 0 8px; } .offer th:last-child { border-radius: 0 8px 8px 0; text-align: right; }
.offer td { background: var(--soft); padding: 9px 12px; vertical-align: middle; border: 0; }
.offer td:first-child { border-radius: 8px 0 0 8px; width: 118px; background: #fff; border: 1px solid #e6e6ea; border-right: 0; text-align: center; padding: 4px; }
.offer td:last-child { border-radius: 0 8px 8px 0; text-align: right; font-weight: 800; font-size: 19px; white-space: nowrap; }
.offer td .d { font-weight: 700; } .offer td .s { font-size: 12.5px; color: #6d6e73; }
.offer td img { max-height: 50px; max-width: 100px; display: inline-block; vertical-align: middle; }
.offer .tight td { padding-top: 5px; padding-bottom: 5px; } .offer .tight td img { max-height: 36px; } .offer .tight { font-size: 14px; }
.offer .numc { text-align: center; font-weight: 700; white-space: nowrap; }
.offer .total { margin-top: 4px; background: #fff; border: 2px solid var(--gray); border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; gap: 16px; }
.offer .total .logos img { height: 38px; margin-right: 6px; vertical-align: middle; }
.offer .total .lbl { font-weight: 800; font-size: 18px; } .offer .total .lbl span { display: block; font-weight: 500; font-size: 13px; color: #6d6e73; }
.offer .total .grow { flex: 1; }
.offer .total .old { font-size: 19px; color: #8a8b90; text-decoration: line-through; }
.offer .total .new { font-size: 38px; font-weight: 800; letter-spacing: -.02em; line-height: 1.05; }
.offer .save { background: var(--yellow); color: #2f2f33; font-weight: 800; padding: 8px 14px; border-radius: 999px; font-size: 16px; white-space: nowrap; }
.offer .foot { position: absolute; left: 340px; right: 48px; bottom: 28px; display: flex; align-items: flex-end; gap: 24px; }
.offer .foot ul { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.5; color: #55565A; flex: 1; }
.offer .foot .who { font-size: 13px; line-height: 1.5; border-left: 3px solid var(--red); padding-left: 12px; white-space: nowrap; }
.offer .foot .who b { display: block; font-size: 15px; }
.offer .foot img { height: 74px; }
.offer .thanks { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.offer .thanks img { height: 170px; } .offer .thanks h3 { font-size: 30px; font-weight: 500; margin: 34px 0 8px; }
.offer .thanks p { color: #6d6e73; font-size: 15px; margin: 2px 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; }
  .offer .page { margin: 0; box-shadow: none; }
  .offer .page:last-child { page-break-after: auto; break-after: auto; }
  .offer-wrap { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
  .no-print { display: none !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

// Οι τρεις σελίδες της προσφοράς (εξώφυλλο, πίνακας, κλείσιμο), όπως θα τις δει ο πελάτης
export function OfferDoc({ s, logo }: { s: Snapshot; logo: string | null }) {
  const stations = [...new Set(s.rows.map((r) => r.station))];
  const saved = Math.round((s.list - s.final) * 100) / 100;
  const tight = s.rows.length > 4;
  const contact = [s.ae.name, s.ae.phone, s.ae.email].filter(Boolean).join(" · ");
  return (
    <div className="offer">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="page cover">
        <div className="stripes"><i style={{ width: 120, background: "var(--yellow)" }} /><i style={{ width: 90, background: "var(--red)" }} /><i style={{ width: 90, background: "var(--gray)" }} /></div>
        <div className="body">
          <div className="eyebrow">Πρόταση ραδιοφωνικής προβολής</div>
          <h1>{s.company}</h1>
          {s.subtitle && <div className="sub">{s.subtitle}</div>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo && <img className="clogo" src={logo} alt={s.company} />}
          <div className="meta">
            <div><b>ΗΜΕΡΟΜΗΝΙΑ</b>{dateLong(s.issued)}</div>
            <div><b>ΙΣΧΥΕΙ ΕΩΣ</b>{dateLong(s.validUntil)}</div>
            <div><b>ΥΠΕΥΘΥΝΟΣ</b>{s.ae.name}</div>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="kmg" src="/kmg.png" alt="Kartelias Media Group" />
      </section>

      <section className="page">
        <div className="side">
          <div className="bar" />
          <h2>Η πρότασή μας</h2>
          <p>{stations.length > 1 ? `${stations.length} ραδιόφωνα, μία καμπάνια.` : `Καμπάνια στον ${STATION_NAME[stations[0]] ?? stations[0] ?? ""}.`}{saved > 0 ? ` Κερδίζετε ${eur(saved)}.` : ""}</p>
          <div className="client">
            για την επιχείρηση
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt={s.company} /> : <b>{s.company}</b>}
          </div>
        </div>
        <div className="main">
          <table className={tight ? "tight" : undefined}>
            <thead><tr><th>Ράδιο</th><th>Περίοδος</th><th>Περιγραφή</th><th style={{ textAlign: "center" }}>{s.local ? "Σποτ / ημέρα" : "Sec"}</th><th style={{ textAlign: "center" }}>{s.local ? "Σύνολο σποτ" : "Avg / sec"}</th><th>Τιμή</th></tr></thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td><img src={STATION_LOGO[r.station]} alt={STATION_NAME[r.station] ?? r.station} /></td>
                  <td className="d" style={{ whiteSpace: "nowrap" }}>{r.period}</td>
                  <td><div className="d">{r.title}</div>{r.sub && <div className="s">{r.sub}</div>}</td>
                  <td className="numc">{r.c1}</td>
                  <td className="numc">{r.c2}</td>
                  <td>{eur(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="total">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="logos">{stations.map((st) => <img key={st} src={STATION_LOGO[st]} alt="" />)}</div>
            <div className="lbl">Σύνολο καμπάνιας<span>{[s.totalSpots ? `${new Intl.NumberFormat("el-GR").format(Math.round(s.totalSpots))} σποτ` : null, ...s.reasons].filter(Boolean).join(" · ")}</span></div>
            <div className="grow" />
            {saved > 0 && <span className="save">Κέρδος {eur(saved)}</span>}
            <div style={{ textAlign: "right" }}>{saved > 0 && <div className="old">{eur(s.list)}</div>}<div className="new">{eur(s.final)}</div></div>
          </div>
        </div>
        <div className="foot">
          <ul>
            <li>Στις παραπάνω τιμές δεν συμπεριλαμβάνεται ΦΠΑ 24%.</li>
            <li>Σε περίπτωση διαφοροποίησης των δευτερολέπτων, διαμορφώνεται ανάλογα και το τελικό κόστος του προγράμματος.</li>
            <li>Η πρόταση ισχύει έως {dateLong(s.validUntil)}.</li>
          </ul>
          <div className="who"><b>{s.ae.name}</b>{s.ae.phone}{s.ae.phone && <br />}{s.ae.email}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kmg.png" alt="Kartelias Media Group" />
        </div>
      </section>

      <section className="page thanks">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/kmg.png" alt="Kartelias Media Group" />
        <h3>#Thank you for listening</h3>
        <p>{contact}</p>
        <p>www.karteliasmediagroup.gr</p>
      </section>
    </div>
  );
}
