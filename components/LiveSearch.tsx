"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Αναζήτηση που ψάχνει την ώρα που γράφεις (χωρίς κουμπί). Κρατάει τα υπόλοιπα φίλτρα της σελίδας.
export function LiveSearch({ value, placeholder, className, style, autoFocus }: { value: string; placeholder: string; className?: string; style?: React.CSSProperties; autoFocus?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(value);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function go(v: string) {
    if (v.trim() === last.current.trim()) return;
    last.current = v;
    const p = new URLSearchParams(params.toString());
    if (v.trim()) p.set("q", v.trim()); else p.delete("q");
    p.delete("page"); p.delete("ok"); p.delete("error");
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  }

  return (
    <input
      name="q" type="search" value={text} placeholder={placeholder} className={className} style={style} autoFocus={autoFocus}
      autoComplete="off" aria-label={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => go(v), 250);
      }}
    />
  );
}
