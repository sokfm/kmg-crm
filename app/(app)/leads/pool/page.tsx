import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { LOST_KINDS, dateGr } from "@/lib/format";
import { decideClaim, requestLost } from "../../pool-actions";

type Row = { id: string; company_name: string; area: string | null; lost_kind: string; lost_reason: string | null; closed_at: string | null; released_at: string | null;
  interests: string[] | null; stations: string[] | null; had_it: string | null; my_request: string | null; pending_requests: number };
type Claim = { id: string; lead_id: string; user_id: string; note: string | null; requested_at: string };

// Διαθέσιμα χαμένα: leads που χάθηκαν και ο υπεύθυνός τους δεν τα ξανατρέχει. Όποιος τα θέλει τα ζητάει· ΟΚ δίνει ο Νίκος ή η Γιάννα.
export default async function Pool({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireProfile();
  const { data } = await supabase.from("lost_pool").select("*").order("released_at", { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as Row[];
  const { data: cl } = isAdmin ? await supabase.from("lead_claims").select("id, lead_id, user_id, note, requested_at").eq("status", "pending").order("requested_at") : { data: [] };
  const claims = (cl ?? []) as Claim[];
  const uids = [...new Set(claims.map((c) => c.user_id))];
  const { data: pn } = uids.length ? await supabase.from("profiles").select("id, full_name").in("id", uids) : { data: [] as { id: string; full_name: string }[] };
  const who = new Map((pn ?? []).map((p) => [p.id as string, p.full_name as string]));
  const lead = new Map(rows.map((r) => [r.id, r]));

  return (
    <main className="wrap" style={{ maxWidth: 900 }}>
      <Link href="/leads" className="muted">← Leads</Link>
      <h1 style={{ marginTop: 4 }}>Διαθέσιμα χαμένα ({rows.length})</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Leads που είπαν «όχι» και ο υπεύθυνός τους δεν τα ξανατρέχει. Όποιος Account Executive θέλει ένα, το ζητάει· το ΟΚ το δίνει ο Νίκος ή η Γιάννα.
        Με το ΟΚ το lead ξανανοίγει στο όνομά του, με τηλέφωνα και όλο το ιστορικό.
      </p>
      <Flash sp={sp} />

      {isAdmin && claims.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Αιτήματα που περιμένουν ({claims.length})</h2>
          {claims.map((c) => {
            const l = lead.get(c.lead_id);
            return (
              <div key={c.id} style={{ borderTop: "1px solid #ebe8ef", paddingTop: 10 }} className="stack">
                <div><strong>{who.get(c.user_id) ?? "Account Executive"}</strong> ζητάει το <Link href={`/leads/${c.lead_id}`} style={{ fontWeight: 700 }}>{l?.company_name ?? "lead"}</Link>
                  {l && <span className="muted"> · είχε πει «{LOST_KINDS[l.lost_kind] ?? ""}»{l.had_it ? ` · το είχε: ${l.had_it}` : ""}</span>}</div>
                {c.note && <div>«{c.note}»</div>}
                <form action={decideClaim} className="row" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" name="approve" value="1">✓ ΟΚ, δώσ' το</button>
                  <button type="submit" name="approve" value="0" className="secondary">Όχι</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      {rows.length === 0 && <p className="muted">Κανένα διαθέσιμο αυτή τη στιγμή.</p>}
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              {isAdmin ? <Link href={`/leads/${r.id}`} style={{ fontWeight: 800, fontSize: 16 }}>{r.company_name}</Link> : <strong style={{ fontSize: 16 }}>{r.company_name}</strong>}
              <span className="badge gray">{LOST_KINDS[r.lost_kind] ?? r.lost_kind}</span>
              {(r.interests ?? []).includes("digital") && <span className="badge">digital</span>}
              {(r.stations ?? []).map((st) => <span key={st} className="badge gray">{st}</span>)}
              <span className="grow" />
              {r.pending_requests > 0 && isAdmin && <span className="badge late">{r.pending_requests === 1 ? "1 αίτημα" : `${r.pending_requests} αιτήματα`}</span>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {r.area ? `${r.area} · ` : ""}χάθηκε {r.closed_at ? dateGr(r.closed_at) : "—"}{r.had_it ? ` · το είχε: ${r.had_it}` : " · χωρίς Account Executive"}{r.released_at ? ` · διαθέσιμο από ${dateGr(r.released_at)}` : ""}
            </div>
            {r.lost_reason && <div>«{r.lost_reason}»</div>}
            {!isAdmin && (r.my_request === "pending" ? (
              <div className="msg" style={{ margin: 0 }}>⏳ Το έχεις ζητήσει. Περιμένει ΟΚ από τον Νίκο ή τη Γιάννα.</div>
            ) : (
              <form action={requestLost} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input type="hidden" name="lead_id" value={r.id} />
                <input name="note" placeholder="Γιατί εσύ; (προαιρετικά)" maxLength={300} className="grow" style={{ minWidth: 200 }} />
                <SubmitButton pending="Στέλνεται…">Το θέλω</SubmitButton>
                {r.my_request === "rejected" && <span className="muted" style={{ fontSize: 13 }}>Το προηγούμενο αίτημά σου δεν εγκρίθηκε.</span>}
              </form>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
