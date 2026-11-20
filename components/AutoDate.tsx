"use client";

// Ημερομηνία που αποθηκεύεται μόλις αλλάξει (χωρίς κουμπί)
export function AutoDate({ name, value, label }: { name: string; value: string; label: string }) {
  return <input type="date" name={name} defaultValue={value} aria-label={label} onChange={(e) => { if (e.currentTarget.value) e.currentTarget.form?.requestSubmit(); }} style={{ maxWidth: 160 }} />;
}
