"use client";
import { useEffect, useState } from "react";
import { mergeCustomers } from "@/app/(app)/actions";

type Sel = { id: string; name: string; rev: number };

// Μπάρα ένωσης στο κάτω μέρος της λίστας πελατών: τσεκάρεις 2+, διαλέγεις όνομα, ενώνεις ΧΩΡΙΣ να φύγεις από τη σελίδα.
export function MergeBar({ back }: { back: string }) {
  const [sel, setSel] = useState<Sel[]>([]);
  const [keep, setKeep] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => {
      const s = [...document.querySelectorAll<HTMLInputElement>('input[name="ids"][form="merge"]:checked')]
        .map((x) => ({ id: x.value, name: x.dataset.name ?? "", rev: Number(x.dataset.rev ?? 0) }));
      setSel(s); setSure(false);
      setKeep((k) => (s.some((x) => x.id === k) ? k : [...s].sort((a, b) => b.rev - a.rev)[0]?.id ?? ""));
    };
    read();
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, []);

  if (sel.length < 2) return null;
  const clear = () => { document.querySelectorAll<HTMLInputElement>('input[name="ids"][form="merge"]:checked').forEach((x) => { x.checked = false; }); setSel([]); };

  return (
    <form action={mergeCustomers} onSubmit={() => setBusy(true)}
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, background: "#14171F", color: "#fff", padding: "10px 14px", boxShadow: "0 -6px 20px rgba(0,0,0,.25)" }}>
      {sel.map((x) => <input key={x.id} type="hidden" name="ids" value={x.id} />)}
      <input type="hidden" name="back" value={back} />
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
        <strong>🔗 {sel.length} πελάτες → ένας</strong>
        <label className="row" style={{ flexDirection: "row", gap: 6, alignItems: "center", color: "#fff", fontWeight: 400 }}>
          κρατάω το όνομα
          <select name="keep_id" value={keep} onChange={(e) => { setKeep(e.target.value); setSure(false); }} style={{ maxWidth: 260 }}>
            {sel.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {!sure ? (
          <button type="button" onClick={() => setSure(true)}>Ένωση εδώ</button>
        ) : (
          <>
            <span style={{ fontSize: 13 }}>Δεν αναιρείται. Σίγουρα;</span>
            <button type="submit" disabled={busy}>{busy ? "Ενώνονται…" : "Ναι, ένωσέ τους"}</button>
          </>
        )}
        <button type="button" className="secondary" onClick={clear} disabled={busy}>Άκυρο</button>
      </div>
    </form>
  );
}
