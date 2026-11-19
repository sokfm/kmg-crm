"use client";

// Λίστα επιλογής που αποθηκεύει μόνη της μόλις αλλάξει (χωρίς κουμπί)
export function AutoSelect({ name, value, options, label }: { name: string; value: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <select name={name} defaultValue={value} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ width: "auto", padding: "6px 8px" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
