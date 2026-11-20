"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoveDialog } from "@/components/MoveDialog";
import { STAGE_INFO } from "@/lib/stages";

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
  const [ghost, setGhost] = useState<{ card: Card; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Σύρσιμο με το δάχτυλο (κινητό/tablet): κρατάς πατημένη την κάρτα λίγο, τη σέρνεις σε άλλη στήλη, αφήνεις.
  // Το απλό σύρσιμο χωρίς κράτημα μένει κύλιση της σελίδας.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: { x: number; y: number } | null = null;
    let drag: Card | null = null;
    let target: string | null = null;
    let pos = { x: 0, y: 0 };
    let raf = 0;

    const stageAt = (x: number, y: number): string | null => {
      let best: string | null = null;
      let bestD = Infinity;
      board.querySelectorAll<HTMLElement>("[data-stage]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right) return;
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < bestD) { bestD = d; best = el.dataset.stage ?? null; }
      });
      return best;
    };
    const tick = () => {
      if (!drag) return;
      const r = board.getBoundingClientRect();
      const edge = 56;
      if (pos.x > r.right - edge) board.scrollLeft += 14;
      else if (pos.x < r.left + edge) board.scrollLeft -= 14;
      target = stageAt(pos.x, pos.y);
      setOver(target);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null; start = null;
      if (drag) {
        cancelAnimationFrame(raf);
        board.classList.remove("dragging");
        drag = null; target = null;
        setGhost(null); setOver(null);
      }
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return stop();
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-card]");
      if (!el || (e.target as HTMLElement).closest("button")) return;
      const card = cardsRef.current.find((c) => c.id === el.dataset.card);
      if (!card) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      pos = { x: t.clientX, y: t.clientY };
      timer = setTimeout(() => {
        timer = null;
        drag = card;
        board.classList.add("dragging");
        navigator.vibrate?.(12);
        setGhost({ card, x: pos.x, y: pos.y });
        raf = requestAnimationFrame(tick);
      }, 350);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (drag) {
        e.preventDefault();
        pos = { x: t.clientX, y: t.clientY };
        setGhost({ card: drag, x: pos.x, y: pos.y });
      } else if (start && timer && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) {
        stop(); // κουνήθηκε πριν «πιάσει»: είναι κύλιση
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (drag) {
        e.preventDefault(); // να μην ανοίξει το lead με το άφημα
        const card = drag;
        const to = stageAt(pos.x, pos.y);
        stop();
        if (to && to !== card.status) setMove({ card, to });
      } else stop();
    };
    const noMenu = (e: Event) => { if (drag || timer) e.preventDefault(); };
    board.addEventListener("touchstart", onStart, { passive: true });
    board.addEventListener("touchmove", onMove, { passive: false });
    board.addEventListener("touchend", onEnd, { passive: false });
    board.addEventListener("touchcancel", stop);
    board.addEventListener("contextmenu", noMenu);
    return () => {
      stop();
      board.removeEventListener("touchstart", onStart);
      board.removeEventListener("touchmove", onMove);
      board.removeEventListener("touchend", onEnd);
      board.removeEventListener("touchcancel", stop);
      board.removeEventListener("contextmenu", noMenu);
    };
  }, []);

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
      <div className="board" ref={boardRef}>
        {OPEN.map(([key, label]) => {
          const col = cards.filter((c) => c.status === key);
          const sum = col.reduce((t, c) => t + Number(c.expected_value ?? 0), 0);
          return (
            <section key={key} data-stage={key} className={`col col-${key} ${over === key ? "over" : ""}`} {...zone(key)}>
              <header>
                <span className="dot" />
                <strong className="grow">{label}</strong>
                <span className="col-n">{col.length}</span>
                <div className="col-sum">{sum ? eur(sum) : "\u00a0"}</div>
                <div className="col-means">{STAGE_INFO[key].means}</div>
              </header>
              {col.length === 0 && <div className="col-empty">Σύρε εδώ ένα deal</div>}
              {col.map((c) => {
                const late = c.next_step_due && c.next_step_due < today;
                const days = c.last_contact ? Math.round((Date.parse(today) - Date.parse(c.last_contact)) / 86400000) : null;
                const stale = days == null || days >= 14;
                const at = OPEN.findIndex(([k]) => k === c.status);
                const prev = at > 0 ? OPEN[at - 1] : null;
                const next = at < OPEN.length - 1 ? OPEN[at + 1] : null;
                const ini = (c.owner ?? "").split(" ").map((w) => w[0]).slice(0, 2).join("");
                return (
                  <article key={c.id} data-card={c.id} className={`deal ${ghost?.card.id === c.id ? "lifted" : ""}`} style={{ borderLeft: `5px solid ${c.color ?? "#c9c3d0"}` }} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}>
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
                    <div className="stage-btns">
                      {prev && <button type="button" className="secondary" aria-label={`Πίσω στο «${prev[1]}»`} onClick={() => setMove({ card: c, to: prev[0] })}>‹</button>}
                      {next && <button type="button" className="secondary nx" onClick={() => setMove({ card: c, to: next[0] })}>{next[1]} ›</button>}
                      <button type="button" className="secondary ok" aria-label="Κλείσαμε" onClick={() => setMove({ card: c, to: "won" })}>✓{next ? "" : " Κλείσαμε"}</button>
                      <button type="button" className="secondary no" aria-label="Χάθηκε" onClick={() => setMove({ card: c, to: "lost" })}>✕</button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
        <section className="col closed">
          <div data-stage="won" className={`drop won ${over === "won" ? "over" : ""}`} {...zone("won")}>
            <strong>Κλείσαμε</strong>
            <div className="muted">αυτόν τον μήνα: {wonMonth.n}{wonMonth.v ? ` · ${eur(wonMonth.v)}` : ""}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
          <div data-stage="lost" className={`drop lost ${over === "lost" ? "over" : ""}`} {...zone("lost")}>
            <strong>Χάθηκε</strong>
            <div className="muted">αυτόν τον μήνα: {lostMonth}</div>
            <div className="muted" style={{ fontSize: 11 }}>σύρε εδώ</div>
          </div>
        </section>
      </div>

      {ghost && (
        <div className="deal-ghost" style={{ left: ghost.x, top: ghost.y, borderLeft: `5px solid ${ghost.card.color ?? "#c9c3d0"}` }}>
          <strong>{ghost.card.company_name}</strong>
          {ghost.card.expected_value ? <span>{eur(Number(ghost.card.expected_value))}</span> : null}
        </div>
      )}

      {move && <MoveDialog card={move.card} to={move.to} today={today} back="/pipeline" onClose={() => setMove(null)} />}
    </>
  );
}
