"use client";

import Link from "next/link";
import { useState } from "react";
import { MoveDialog } from "@/components/MoveDialog";

export type Card = {
  id: string; version: number; company_name: string; status: string; next_step: string | null; next_step_due: string | null;
  expected_value: number | null; product_line: string; interests: string[]; stations: string[]; owner: string | null; color: string | null; last_contact: string | null;
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
            <section key={key} className={`col col-${key} ${over === key ? "over" : ""}`} {...zone(key)}>
              <header>
                <span className="dot" />
                <strong className="grow">{label}</strong>
                <span className="col-n">{col.length}</span>
                <div className="col-sum">{sum ? eur(sum) : "\u00a0"}</div>
              </header>
              {col.length === 0 && <div className="col-empty">Σύρε εδώ ένα deal</div>}
              {col.map((c) => {
                const late = c.next_step_due && c.next_step_due < today;
                const days = c.last_contact ? Math.round((Date.parse(today) - Date.parse(c.last_contact)) / 86400000) : null;
                const stale = days == null || days >= 14;
                const ini = (c.owner ?? "").split(" ").map((w) => w[0]).slice(0, 2).join("");
                return (
                  <article key={c.id} className="deal" style={{ borderLeft: `5px solid ${c.color ?? "#c9c3d0"}` }} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}>
                    <div className="deal-top" style={{ flexWrap: "wrap", alignItems: "center" }}>
                      <span className="val" style={{ fontSize: 17, fontWeight: 800 }}>{c.expected_value ? eur(Number(c.expected_value)) : <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>χωρίς μπάτζετ</span>}</span>
                      <span className="grow" />
                      {late && <span className="badge late" style={{ fontSize: 11 }}>καθυστερεί</span>}
                    </div>
                    <Link href={`/leads/${c.id}`} className="title">{c.company_name}</Link>
                    <div className={`next ${late ? "late" : ""}`}>
                      → {c.next_step ?? "—"}{c.next_step_due ? ` · ${day(c.next_step_due)}` : ""}
                    </div>
                    <div className="deal-foot">
                      {c.interests.includes("digital") && <span className="tag dig">{c.interests.includes("radio") ? "+ digital" : "digital"}</span>}
                      {c.stations.map((st) => <span key={st} className="tag">{st}</span>)}
                      <span className="grow" />
                      {stale && <span className="stale">{days == null ? "καμία επαφή" : `${days} μέρες χωρίς επαφή`}</span>}
                      {ini ? <span className="own" title={c.owner ?? ""} style={c.color ? { background: c.color, color: "#fff" } : undefined}>{ini}</span> : <span className="own none" title="Χωρίς ανάθεση">?</span>}
                    </div>
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
            <strong>Κλείσαμε</strong>
            <div className="muted">αυτόν τον μήνα: {wonMonth.n}{wonMonth.v ? ` · ${eur(wonMonth.v)}` : ""}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
          <div className={`drop lost ${over === "lost" ? "over" : ""}`} {...zone("lost")}>
            <strong>Χάθηκε</strong>
            <div className="muted">αυτόν τον μήνα: {lostMonth}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
        </section>
      </div>

      {move && <MoveDialog card={move.card} to={move.to} today={today} back="/pipeline" onClose={() => setMove(null)} />}
    </>
  );
}
