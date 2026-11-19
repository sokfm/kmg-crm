"use client";

import Link from "next/link";
import { useState } from "react";
import { MoveDialog } from "@/components/MoveDialog";

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

      {move && <MoveDialog card={move.card} to={move.to} today={today} back="/pipeline" onClose={() => setMove(null)} />}
    </>
  );
}
