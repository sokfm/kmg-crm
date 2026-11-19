"use client";

import { useFormStatus } from "react-dom";

// Κουμπί που δείχνει ότι κάτι τρέχει: απενεργοποιείται, αλλάζει κείμενο και
// εμφανίζει μπάρα προόδου μέχρι να τελειώσει η ενέργεια.
export function SubmitButton({
  children, pending, className, name, value, hint,
}: { children: React.ReactNode; pending?: string; className?: string; name?: string; value?: string; hint?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button type="submit" className={className} name={name} value={value} disabled={busy} aria-busy={busy}>
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
