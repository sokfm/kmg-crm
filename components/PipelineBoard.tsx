"use client";

import Link from "next/link";
import { useState } from "react";
import { moveLead } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/SubmitButton";

export type Card = {
  id: string; version: number; company_name: string; status: string; next_step: string | null; next_step_due: string | null;
  expected_value: number | null; product_line: string; stations: string[]; owner: string | null; last_contact: string | null;
};

const OPEN = [
  ["new", "Νέο lead"],
  ["contacted", "Έγινε επαφή"],
  ["meeting", "Ραντεβού"],
  ["proposal", "Πρόταση"],
  ["negotiation", "Διαπραγμάτευση"],
] as const;
const LOST: Record<string, string> = { not_now: "Όχι τώρα", no_budget: "Όχι budget", competitor: "Πήγε σε άλλον σταθμό", never: "Όχι ποτέ" };
const ALL: Record<string, string> = { ...Object.fromEntries(OPEN), won: "Κλείσαμε ✓", lost: "Χάθηκε" };

const eur = (v: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 }).format(v) + " €";
const day = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short" }).format(new Date(d));
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export function PipelineBoard({ cards, today, wonMonth, lostMonth }: { cards: Card[]; today: string; wonMonth: { n: number; v: number }; lostMonth: number }) {
  const [move, setMove] = useState<{ card: Card; to: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const drop = (to: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const card = cards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
    if (card && card.status !== to) setMove({ card, to });
  };
  const zone = (to: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(to); },
    onDragLeave: () => setOver((o) => (o === to ? null : o)),
    onDrop: drop(to),
  });

  return (
    <>
      <div className="board">
        {OPEN.map(([key, label]) => {
          const col = cards.filter((c) => c.status === key);
          const sum = col.reduce((t, c) => t + Number(c.expected_value ?? 0), 0);
          return (
            <section key={key} className={`col ${over === key ? "over" : ""}`} {...zone(key)}>
              <header>
                <strong>{label}</strong> <span className="badge gray">{col.length}</span>
                <div className="muted">{sum ? eur(sum) : "—"}</div>
              </header>
              {col.map((c) => {
                const late = c.next_step_due && c.next_step_due < today;
                const stale = !c.last_contact || c.last_contact < plus(-14);
                return (
                  <article key={c.id} className={`deal ${late ? "late" : ""}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}>
                    <Link href={`/leads/${c.id}`} className="title">{c.company_name}</Link>
                    <div className="muted">
                      {c.owner ?? "Χωρίς ανάθεση"}{c.product_line === "digital" ? " · digital" : ""}{c.stations.length ? " · " + c.stations.join(", ") : ""}
                    </div>
                    {c.expected_value ? <div className="val">{eur(Number(c.expected_value))}</div> : null}
                    <div className={`next ${late ? "late" : ""}`}>
                      → {c.next_step ?? "—"}{c.next_step_due ? ` · ${day(c.next_step_due)}` : ""}
                    </div>
                    {stale && <div className="muted" style={{ fontSize: 11 }}>⚠ καμία επαφή 14+ μέρες</div>}
                    <button type="button" className="secondary mv" onClick={() => setMove({ card: c, to: OPEN[Math.min(OPEN.findIndex(([k]) => k === c.status) + 1, OPEN.length - 1)][0] })}>
                      Μετακίνηση ›
                    </button>
                  </article>
                );
              })}
            </section>
          );
        })}
        <section className="col closed">
          <div className={`drop won ${over === "won" ? "over" : ""}`} {...zone("won")}>
            <strong>✓ Κλείσαμε</strong>
            <div className="muted">αυτόν τον μήνα: {wonMonth.n}{wonMonth.v ? ` · ${eur(wonMonth.v)}` : ""}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
          <div className={`drop lost ${over === "lost" ? "over" : ""}`} {...zone("lost")}>
            <strong>✕ Χάθηκε</strong>
            <div className="muted">αυτόν τον μήνα: {lostMonth}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
        </section>
      </div>

      {move && (
        <div className="modal-bg" onClick={() => setMove(null)}>
          <form action={moveLead} className="modal stack" onClick={(e) => e.stopPropagation()}>
            <input type="hidden" name="id" value={move.card.id} />
            <input type="hidden" name="version" value={move.card.version} />
            <h2>{move.card.company_name}</h2>
            <label>Πάει στο
              <select name="status" value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value })}>
                {Object.entries(ALL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {move.to === "lost" ? (
              <>
                <label>Τι «όχι» ήταν *
                  <select name="lost_kind" required defaultValue="">
                    <option value="" disabled>Διάλεξε…</option>
                    {Object.entries(LOST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Γιατί (με δικά σου λόγια)<input name="lost_reason" /></label>
                <div className="grid2">
                  <label>Πότε ξαναχτυπάμε την πόρτα;<input name="next_step" placeholder="π.χ. Ξανά πριν το Πάσχα" /></label>
                  <label>Ημερομηνία<input name="next_step_due" type="date" defaultValue={plus(90)} /></label>
                </div>
              </>
            ) : move.to === "won" ? (
              <>
                <label>Αξία που κλείσαμε (€)<input name="expected_value" inputMode="decimal" defaultValue={move.card.expected_value ?? ""} placeholder="π.χ. 1.500" /></label>
                <p className="muted">Ο τζίρος στο dashboard θα έρχεται από την τιμολόγηση· αυτή η αξία μετράει στα «κλεισμένα deals».</p>
              </>
            ) : (
              <>
                <div className="grid2">
                  <label>Επόμενο βήμα *<input name="next_step" required defaultValue={move.card.next_step ?? ""} placeholder="π.χ. Στέλνω πρόταση" /></label>
                  <label>Πότε *<input name="next_step_due" type="date" required defaultValue={move.card.next_step_due && move.card.next_step_due >= today ? move.card.next_step_due : plus(2)} /></label>
                </div>
                <label>Εκτιμώμενη αξία (€)<input name="expected_value" inputMode="decimal" defaultValue={move.card.expected_value ?? ""} placeholder="π.χ. 1.500" /></label>
              </>
            )}
            <div className="row">
              <SubmitButton pending="Αποθήκευση…">Αποθήκευση</SubmitButton>
              <button type="button" className="secondary" onClick={() => setMove(null)}>Άκυρο</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
