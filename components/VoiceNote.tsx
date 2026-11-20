"use client";

import { useState, useTransition } from "react";
import { useDictation } from "@/components/useDictation";
import { applyVoice, interpretVoice } from "@/app/(app)/voice-actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { VoiceResult } from "@/lib/voice";

const TYPES: [string, string][] = [["call", "📞 Τηλέφωνο"], ["meeting", "🤝 Ραντεβού"], ["viber", "💬 Viber"], ["email", "✉️ Email"], ["note", "📝 Σημείωση (όχι επαφή)"]];
const STAGES: [string, string][] = [["new", "1. Νέο lead"], ["contacted", "2. Έγινε επαφή"], ["meeting", "3. Ραντεβού"], ["proposal", "4. Πρόταση"], ["negotiation", "5. Διαπραγμάτευση"]];

// «Πες το»: μιλάς (ή γράφεις), η AI προτείνει τι καταγράφεται και ποιο είναι το επόμενο βήμα, εσύ ελέγχεις και πατάς Καταχώριση.
export function VoiceNote({ leadId, version, stage, today }: { leadId: string; version: number; stage: string; today: string }) {
  const { text, shown, edit, listening, toggle: toggleMic, stop, micMsg } = useDictation();
  const [msg, setMsg] = useState<string | null>(null);
  const [res, setRes] = useState<VoiceResult | null>(null);
  const [busy, start] = useTransition();

  const understand = () => {
    stop();
    setMsg(null);
    start(async () => {
      const out = await interpretVoice(leadId, text);
      if (out.ok) setRes(out.result); else setMsg(out.error);
    });
  };

  if (res) {
    return (
      <form action={applyVoice} className="stack" style={{ border: "2px solid var(--brand, #ED30D2)", borderRadius: 12, padding: 12 }}>
        <input type="hidden" name="lead_id" value={leadId} /><input type="hidden" name="version" value={version} />
        <strong>Κατάλαβα αυτά. Έλεγξε, διόρθωσε ό,τι θέλεις και πάτα Καταχώριση.</strong>
        {res.unclear && <div className="msg" style={{ background: "var(--orange-bg)" }}>⚠️ {res.unclear}</div>}
        <div className="grid2">
          <label>Είδος επαφής
            <select name="type" defaultValue={res.activity_type}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>Στάδιο
            <select name="stage" defaultValue={res.stage ?? stage}>{STAGES.map(([k, l]) => <option key={k} value={k}>{l}{k === stage ? " (τωρινό)" : ""}</option>)}</select>
          </label>
        </div>
        <label>Τι έγινε<textarea name="summary" defaultValue={res.summary} rows={3} required maxLength={600} style={{ width: "100%" }} /></label>
        <div className="grid2">
          <label>Επόμενο βήμα<input name="next_step" defaultValue={res.next_step ?? ""} required maxLength={160} /></label>
          <label>Πότε<span className="row" style={{ gap: 6 }}><input type="date" name="next_step_due" defaultValue={res.next_step_due ?? ""} min={today} required /><input name="next_step_time" type="time" aria-label="Ώρα (προαιρετικά)" title="Ώρα (προαιρετικά): θα χτυπήσει υπενθύμιση" style={{ maxWidth: 120 }} defaultValue={res.next_step_time ?? ""} /></span></label>
        </div>
        {res.tasks.length > 0 && (
          <div className="stack">
            <span className="muted">Επιπλέον εργασίες (ξετσέκαρε όσες δεν θέλεις)</span>
            {res.tasks.map((t, i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="task_keep" value={i} defaultChecked style={{ width: "auto" }} aria-label="Να μπει" />
                <input name="task_title" defaultValue={t.title} style={{ flex: 1 }} aria-label="Εργασία" />
                <input type="date" name="task_due" defaultValue={t.due_date ?? ""} style={{ width: 150 }} aria-label="Προθεσμία" />
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <SubmitButton pending="Καταχώριση…">Καταχώριση</SubmitButton>
          <button type="button" className="secondary" onClick={() => setRes(null)}>Πίσω, να το ξαναπώ</button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack" style={{ border: "1px solid #ebe8ef", borderRadius: 12, padding: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <button type="button" onClick={toggleMic} aria-pressed={listening} style={{ borderRadius: 999, width: 52, height: 52, padding: 0, fontSize: 22, background: listening ? "#E2001A" : undefined, color: listening ? "#fff" : undefined }} title={listening ? "Σταμάτα" : "Μίλα"}>
          {listening ? "■" : "🎤"}
        </button>
        <div style={{ flex: 1 }}>
          <strong>{listening ? "Σε ακούω… πάτα ■ όταν τελειώσεις" : "Πες μου τι έγινε με τον πελάτη"}</strong>
          <div className="muted" style={{ fontSize: 13 }}>π.χ. «Μίλησα με τον ιδιοκτήτη, θέλει προσφορά για ΣΟΚ και DALKAS, να τον πάρω την Τρίτη»</div>
        </div>
      </div>
      <textarea value={shown} onChange={(e) => edit(e.target.value)} rows={3} maxLength={2500} style={{ width: "100%" }} placeholder="Μίλα με το μικρόφωνο ή γράψε εδώ…" aria-label="Τι έγινε" />
      {(msg ?? micMsg) && <div className="msg error">{msg ?? micMsg}</div>}
      <div><button type="button" onClick={understand} disabled={busy || text.trim().length < 8}>{busy ? "Το σκέφτομαι…" : "Βγάλε τα επόμενα βήματα"}</button></div>
    </div>
  );
}
