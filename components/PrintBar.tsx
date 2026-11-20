"use client";

// Η μπάρα πάνω από την προσφορά: δεν τυπώνεται. «Κατέβασμα PDF» ανοίγει την εκτύπωση του browser (Αποθήκευση ως PDF).
export function PrintBar({ back, auto }: { back: string; auto?: boolean }) {
  return (
    <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 5, background: "#0E0D11", color: "#fff", padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      ref={(el) => { if (el && auto && !el.dataset.done) { el.dataset.done = "1"; setTimeout(() => window.print(), 900); } }}>
      <a href={back} style={{ color: "#fff" }}>← Πίσω στην πρόταση</a>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 13, opacity: .8 }}>Στην εκτύπωση διάλεξε «Αποθήκευση ως PDF», οριζόντια, χωρίς περιθώρια.</span>
      <button type="button" onClick={() => window.print()}>Κατέβασμα PDF</button>
    </div>
  );
}
