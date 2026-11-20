"use client";

import { useState } from "react";
import { moveLead } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/SubmitButton";

export type Movable = { id: string; version: number; company_name: string; next_step: string | null; next_step_due: string | null; expected_value: number | null };

export const OPEN_STAGES = [
  ["new", "Νέο lead"],
  ["contacted", "Έγινε επαφή"],
  ["meeting", "Ραντεβού"],
  ["proposal", "Πρόταση"],
  ["negotiation", "Διαπραγμάτευση"],
] as const;
const LOST: Record<string, string> = { not_now: "Όχι τώρα", no_budget: "Όχι budget", competitor: "Πήγε σε άλλον σταθμό", never: "Όχι ποτέ" };
const ALL: Record<string, string> = { ...Object.fromEntries(OPEN_STAGES), won: "Κλείσαμε ✓", lost: "Χάθηκε" };
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Παράθυρο αλλαγής σταδίου: κάθε ανοιχτό στάδιο ζητά επόμενο βήμα, το «Χάθηκε» ζητά είδος «όχι».
export function MoveDialog({ card, to: initial, today, back, onClose }: { card: Movable; to: string; today: string; back: string; onClose: () => void }) {
  const [to, setTo] = useState(initial);
  const [kind, setKind] = useState("");
  const [until, setUntil] = useState("");
  const minus14 = (d: string) => { const x = new Date(Date.parse(`${d}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10); return x > today ? x : plus(1); };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form action={moveLead} className="modal stack" onClick={(e) => e.stopPropagation()}>
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="version" value={card.version} />
        <input type="hidden" name="back" value={back} />
        <h2>{card.company_name}</h2>
        <label>Πάει στο
          <select name="status" value={to} onChange={(e) => setTo(e.target.value)}>
            {Object.entries(ALL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {to === "lost" ? (
          <>
            <label>Τι «όχι» ήταν *
              <select name="lost_kind" required value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="" disabled>Διάλεξε…</option>
                {Object.entries(LOST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Γιατί (με δικά σου λόγια)<input name="lost_reason" /></label>
            {kind === "never" ? (
              <p className="muted">«Όχι ποτέ»: το CRM δεν θα σου το ξαναθυμίσει. Το lead μένει στα Χαμένα με όλο το ιστορικό.</p>
            ) : (
              <>
                {kind === "competitor" && (
                  <label>Μέχρι πότε παίζει εκεί; (αν το ξέρεις)
                    <input name="competitor_until" type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                )}
                <div className="grid2">
                  <label>Τι κάνουμε τότε;<input name="next_step" placeholder="π.χ. Ξανά πριν το Πάσχα" /></label>
                  <label>Πότε ξαναχτυπάμε την πόρτα;
                    <input key={kind + until} name="reknock_on" type="date" min={plus(1)} defaultValue={kind === "competitor" && until ? minus14(until) : plus(90)} />
                  </label>
                </div>
                <p className="muted" style={{ marginTop: -6 }}>
                  {kind === "competitor" && until ? "Προτείνω 14 ημέρες πριν λήξει η καμπάνια του εκεί. " : ""}Εκείνη τη μέρα θα σου ανοίξει μόνη της εργασία «Ξαναχτύπα» και θα σου έρθει ειδοποίηση.
                </p>
              </>
            )}
          </>
        ) : to === "won" ? (
          <>
            <label>Αξία που κλείσαμε (€)<input name="expected_value" inputMode="decimal" defaultValue={card.expected_value ?? ""} placeholder="π.χ. 1.500" /></label>
            <label>Πότε ξεκινάει στον αέρα; (επιβεβαιωμένη έναρξη)<input name="confirmed_start" type="date" /></label>
            <p className="muted" style={{ marginTop: -6 }}>Από αυτή τη μέρα μοιράζεται ο τζίρος στους μήνες. Αν δεν την ξέρεις ακόμα, άφησέ το κενό και βάλ' τη μετά μέσα στην πρόταση.</p>
            <p className="muted">Ο τζίρος στο dashboard έρχεται από την τιμολόγηση· αυτή η αξία μετράει στα «κλεισμένα deals».</p>
          </>
        ) : (
          <>
            <div className="grid2">
              <label>Επόμενο βήμα *<input name="next_step" required defaultValue={card.next_step ?? ""} placeholder="π.χ. Στέλνω πρόταση" /></label>
              <label>Πότε *<span className="row" style={{ gap: 6 }}><input name="next_step_due" type="date" required defaultValue={card.next_step_due && card.next_step_due >= today ? card.next_step_due : plus(2)} /><input name="next_step_time" type="time" aria-label="Ώρα (προαιρετικά)" title="Ώρα (προαιρετικά): θα χτυπήσει υπενθύμιση" style={{ maxWidth: 120 }} defaultValue="" /></span></label>
            </div>
            <label>Εκτιμώμενη αξία (€)<input name="expected_value" inputMode="decimal" defaultValue={card.expected_value ?? ""} placeholder="π.χ. 1.500" /></label>
          </>
        )}
        <div className="row">
          <SubmitButton pending="Αποθήκευση…">Αποθήκευση</SubmitButton>
          <button type="button" className="secondary" onClick={onClose}>Άκυρο</button>
        </div>
      </form>
    </div>
  );
}

// Η μπάρα σταδίων (όπως στο Salesforce): πατάς ένα στάδιο → ανοίγει το παράθυρο αλλαγής.
export function StagePath({ card, status, today }: { card: Movable; status: string; today: string }) {
  const [to, setTo] = useState<string | null>(null);
  const idx = OPEN_STAGES.findIndex(([k]) => k === status);
  const closed = status === "won" || status === "lost";
  return (
    <>
      <div className="path">
        {OPEN_STAGES.map(([k, label], i) => {
          const state = closed || i < idx ? "done" : i === idx ? "current" : "todo";
          return (
            <button key={k} type="button" className={`step ${state}`} onClick={() => k !== status && setTo(k)} title={k === status ? "Τρέχον στάδιο" : `Μετακίνηση σε «${label}»`}>
              {state === "done" ? "✓" : label}
              {state === "done" && <span className="sr">{label}</span>}
            </button>
          );
        })}
        <button type="button" className={`step end ${status === "won" ? "won" : status === "lost" ? "lost" : "todo"}`} onClick={() => setTo(status === "won" ? "lost" : "won")}>
          {status === "won" ? "Κλείσαμε ✓" : status === "lost" ? "Χάθηκε" : "Έκλεισε"}
        </button>
      </div>
      {to && <MoveDialog card={card} to={to} today={today} back={`/leads/${card.id}`} onClose={() => setTo(null)} />}
    </>
  );
}
