"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDictation } from "@/components/useDictation";
import { interpretNewLead } from "@/app/(app)/voice-actions";

// Νέο lead με τη φωνή: μιλάς, η AI γεμίζει τη φόρμα από κάτω, εσύ ελέγχεις και πατάς Καταχώριση.
export function VoiceLead() {
  const { text, shown, edit, listening, toggle, stop, micMsg } = useDictation();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => {
    stop(); setMsg(null);
    start(async () => {
      const out = await interpretNewLead(text);
      if (out.ok) router.push(`/leads/new?${out.query}`); else setMsg(out.error);
    });
  };
  return (
    <div className="card stack">
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <button type="button" onClick={toggle} aria-pressed={listening} style={{ borderRadius: 999, width: 52, height: 52, padding: 0, fontSize: 22, background: listening ? "#E2001A" : undefined, color: listening ? "#fff" : undefined }} title={listening ? "Σταμάτα" : "Μίλα"}>
          {listening ? "■" : "🎤"}
        </button>
        <div style={{ flex: 1 }}>
          <strong>{listening ? "Σε ακούω… πάτα ■ όταν τελειώσεις" : "Πες μου το νέο lead"}</strong>
          <div className="muted" style={{ fontSize: 13 }}>π.χ. «Με πήρε ο Γιώργος από τον Φούρνο Παπαδόπουλο στη Χαλκίδα, 6971234567, θέλει ΣΟΚ για τα Χριστούγεννα, να του στείλω προσφορά αύριο»</div>
        </div>
      </div>
      <textarea value={shown} onChange={(e) => edit(e.target.value)} rows={3} maxLength={2500} style={{ width: "100%" }} placeholder="Μίλα με το μικρόφωνο ή γράψε εδώ…" aria-label="Περιγραφή νέου lead" />
      {(msg ?? micMsg) && <div className="msg error">{msg ?? micMsg}</div>}
      <div><button type="button" onClick={go} disabled={busy || text.trim().length < 8}>{busy ? "Το σκέφτομαι…" : "Γέμισε τη φόρμα"}</button></div>
    </div>
  );
}
