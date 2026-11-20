import { SubmitButton } from "@/components/SubmitButton";
import { requestAccess } from "@/app/(app)/access-actions";

export type MyAccess = { status: string; reason: string; decided_note: string | null; expires_at: string | null; requested_at: string } | null;
const day = (d: string) => new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", timeZone: "Europe/Athens" }).format(new Date(d));

// Κλειδαριά: τι είναι κλειδωμένο και πώς ζητάς πρόσβαση από τον Νίκο
export function AccessLock({ customerId, what, mine }: { customerId: string; what: string; mine: MyAccess }) {
  const pending = mine?.status === "pending";
  return (
    <div className="card stack" style={{ background: "var(--orange-bg)" }}>
      <strong>🔒 {what}</strong>
      <span className="muted">Ο τζίρος και το ιστορικό φαίνονται μόνο σε πελάτες που έχεις τρέξει εσύ. Για τους υπόλοιπους ζητάς πρόσβαση από τον Νίκο· αν εγκρίνει, ανοίγει για 7 ημέρες.</span>
      {pending ? (
        <div className="msg" style={{ margin: 0 }}>⏳ Έχεις ζητήσει πρόσβαση στις {day(mine!.requested_at)}: «{mine!.reason}». Περιμένει τον Νίκο.</div>
      ) : (
        <>
          {mine?.status === "rejected" && <div className="msg error" style={{ margin: 0 }}>Το προηγούμενο αίτημα δεν εγκρίθηκε{mine.decided_note ? `: «${mine.decided_note}»` : "."}</div>}
          {mine?.status === "approved" && mine.expires_at && <div className="muted">Η προηγούμενη πρόσβαση έληξε στις {day(mine.expires_at)}.</div>}
          <form action={requestAccess} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input name="reason" required maxLength={400} placeholder="Γιατί τη χρειάζεσαι; π.χ. θα του προτείνω ανανέωση" className="grow" style={{ minWidth: 220 }} />
            <SubmitButton pending="Στέλνεται…">Ζήτα πρόσβαση</SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
