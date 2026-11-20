"use client";
import { useEffect, useState } from "react";
import { removePush, savePush, testPush } from "@/app/(app)/push-actions";

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Άναμμα ειδοποιήσεων σε ΑΥΤΗ τη συσκευή. Κάθε κινητό ή υπολογιστής ανάβει ξεχωριστά.
export function PushSetup({ publicKey, devices }: { publicKey: string | null; devices: number }) {
  const [state, setState] = useState<"loading" | "unsupported" | "ios" | "off" | "on" | "blocked">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "ios" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch { setState("unsupported"); }
    })();
  }, []);

  async function turnOn() {
    if (!publicKey) return setMsg("Ο server δεν είναι έτοιμος ακόμα. Δοκίμασε σε λίγο.");
    setBusy(true); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
      const r = await savePush(sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, navigator.userAgent);
      if (r.ok) { setState("on"); setMsg("Έτοιμο. Σου έστειλα μια δοκιμαστική ειδοποίηση."); } else setMsg(r.error ?? "Δεν έγινε.");
    } catch { setMsg("Δεν έγινε. Δοκίμασε ξανά."); } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePush(sub.endpoint); await sub.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    const r = await testPush();
    setMsg(r.sent > 0 ? `Στάλθηκε σε ${r.sent} ${r.sent === 1 ? "συσκευή" : "συσκευές"}.` : "Δεν βρέθηκε συσκευή με αναμμένες ειδοποιήσεις.");
    setBusy(false);
  }

  return (
    <div className="stack">
      {state === "loading" && <p className="muted" style={{ margin: 0 }}>Έλεγχος συσκευής…</p>}
      {state === "ios" && (
        <div className="msg" style={{ background: "var(--orange-bg)" }}>
          <strong>Στο iPhone θέλει ένα βήμα πρώτα:</strong> άνοιξε το CRM στο Safari, πάτα το κουμπί «Κοινή χρήση» και μετά «Προσθήκη στην οθόνη Αφετηρίας». Άνοιξε το CRM από το νέο εικονίδιο και έλα ξανά εδώ.
        </div>
      )}
      {state === "unsupported" && <p className="muted" style={{ margin: 0 }}>Αυτός ο browser δεν δέχεται ειδοποιήσεις. Δοκίμασε Chrome ή Safari.</p>}
      {state === "blocked" && <div className="msg error">Οι ειδοποιήσεις είναι κλειστές για το CRM σε αυτή τη συσκευή. Άνοιξέ τες από τις ρυθμίσεις του κινητού ή του browser και ξαναμπές.</div>}
      {state === "off" && <div><button type="button" onClick={turnOn} disabled={busy}>{busy ? "Ανάβει…" : "🔔 Άναψε τις ειδοποιήσεις σε αυτή τη συσκευή"}</button></div>}
      {state === "on" && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="badge good">✓ Αναμμένες σε αυτή τη συσκευή</span>
          <button type="button" className="secondary" onClick={test} disabled={busy}>Στείλε δοκιμή</button>
          <button type="button" className="secondary" onClick={turnOff} disabled={busy}>Σβήσιμο</button>
        </div>
      )}
      {msg && <div className="muted">{msg}</div>}
      <div className="muted" style={{ fontSize: 13 }}>Συσκευές με αναμμένες ειδοποιήσεις στον λογαριασμό σου: {devices}. Κάθε κινητό ή υπολογιστής ανάβει ξεχωριστά.</div>
    </div>
  );
}
