"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

// Κουμπί που δείχνει ότι κάτι τρέχει: απενεργοποιείται, αλλάζει κείμενο και
// εμφανίζει μπάρα προόδου μέχρι να τελειώσει η ενέργεια.
export function SubmitButton({
  children, pending, className, name, value, hint, form,
}: { children: React.ReactNode; pending?: string; className?: string; name?: string; value?: string; hint?: string; form?: string }) {
  const { pending: inForm } = useFormStatus();
  // Κουμπί ΕΞΩ από τη φόρμα του (form="…"): το useFormStatus δεν το «βλέπει», άρα δεν θα κλείδωνε και
  // ένα δεύτερο πάτημα θα έστελνε τη φόρμα δύο φορές. Το κλειδώνουμε μόνοι μας μόλις πατηθεί.
  const [clicked, setClicked] = useState(false);
  const busy = inForm || clicked;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button type="submit" className={className} name={name} value={value} form={form} disabled={busy} aria-busy={busy}
        onClick={form ? () => { setTimeout(() => setClicked(true), 0); setTimeout(() => setClicked(false), 12000); } : undefined}>
        {busy ? <><span className="spinner" /> {pending ?? "Περίμενε…"}</> : children}
      </button>
      {busy && hint && (
        <>
          <span className="progress"><span /></span>
          <span className="muted">{hint}</span>
        </>
      )}
    </span>
  );
}
