"use client";

import { useRef, useState } from "react";

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

// Υπαγόρευση με το μικρόφωνο του browser (ελληνικά). Όπου δεν υπάρχει, ο χρήστης μιλάει στο μικρόφωνο του πληκτρολογίου.
export function useDictation() {
  const [text, setText] = useState("");
  const [live, setLive] = useState("");
  const [listening, setListening] = useState(false);
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);

  const stop = () => rec.current?.stop();
  const toggle = () => {
    if (listening) { stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setMicMsg("Αυτός ο browser δεν έχει δικό του μικρόφωνο εδώ. Πάτα μέσα στο πλαίσιο και χρησιμοποίησε το μικρόφωνο του πληκτρολογίου."); return; }
    const r = new Ctor();
    r.lang = "el-GR"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let fin = "", tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
      if (fin) setText((t) => (t ? t.trimEnd() + " " : "") + fin.trim());
      setLive(tmp);
    };
    r.onend = () => { setListening(false); setLive(""); };
    r.onerror = (e) => { setListening(false); setLive(""); setMicMsg(e.error === "not-allowed" ? "Δεν δόθηκε άδεια για το μικρόφωνο. Δώσε άδεια στον browser ή χρησιμοποίησε το μικρόφωνο του πληκτρολογίου." : "Το μικρόφωνο σταμάτησε. Πάτα ξανά ή γράψε το."); };
    rec.current = r; setMicMsg(null); setListening(true);
    try { r.start(); } catch { setListening(false); }
  };
  const shown = text + (live ? (text ? " " : "") + live : "");
  const edit = (v: string) => { setText(v); setLive(""); };
  return { text, shown, edit, listening, toggle, stop, micMsg };
}
