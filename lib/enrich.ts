import type { SupabaseClient } from "@supabase/supabase-js";

// Η AI ψάχνει μια επιχείρηση στο ίντερνετ και επιστρέφει βασικά στοιχεία.
// Κόστος: ~10$ ανά 1.000 αναζητήσεις + tokens. Κάθε επιχείρηση: έως 3 αναζητήσεις.

export type WebInfo = {
  status: "found" | "not_found" | "closed";
  official_name: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  confidence: number;
  note: string;
  sources: string[];
};
type Usage = { searches: number; input: number; output: number };

const SYSTEM = `Είσαι βοηθός έρευνας για το CRM της Kartelias Media Group (ραδιόφωνα ΣΟΚ FM, DALKAS, ΜΠΛΕ, NRG στη Χαλκίδα / Εύβοια).
Σου δίνουν το όνομα μιας επιχείρησης-διαφημιζόμενου, όπως γράφεται στα τιμολόγια του ραδιοφώνου (συχνά εμπορική ονομασία, μπορεί με ορθογραφικά λάθη ή προσθήκες όπως «-ΧΟΡΗΓΙΑ»).
Οι περισσότερες είναι τοπικές επιχειρήσεις στη Χαλκίδα και την Εύβοια· κάποιες είναι εθνικές μάρκες που διαφημίζονται μέσω πρακτορείου.

Ψάξε στο ίντερνετ (έως 3 αναζητήσεις· βάλε «Χαλκίδα» ή «Εύβοια» στην αναζήτηση για τοπικές επιχειρήσεις) και βρες: τηλέφωνο, email, website, διεύθυνση, κατηγορία δραστηριότητας.
Κανόνες:
- Γράψε ΜΟΝΟ στοιχεία που είδες στα αποτελέσματα. Ποτέ μην εφευρίσκεις τηλέφωνο ή email. Ό,τι δεν βρήκες = null.
- Προτίμησε το κατάστημα στη Χαλκίδα / Εύβοια αν υπάρχουν πολλά με το ίδιο όνομα.
- Κατηγορία: σύντομα στα ελληνικά (π.χ. «Εστίαση – καφέ», «Κρεοπωλείο», «Οινοποιείο», «Σούπερ μάρκετ», «Αυτοκίνητα», «Υγεία – ιατρείο», «Εκπαίδευση», «Ένδυση», «Δήμος / φορέας», «Εκδηλώσεις»).
- status: "found" αν βρήκες με σιγουριά την επιχείρηση· "closed" αν πηγή λέει ότι έκλεισε μόνιμα· "not_found" αν δεν τη βρήκες ή δεν είσαι σίγουρος ότι είναι η ίδια.
- confidence 0–1: πόσο σίγουρος είσαι ότι είναι η ίδια επιχείρηση.
- note: μία σύντομη πρόταση στα ελληνικά (τι βρήκες ή γιατί όχι).
Στο τέλος κάλεσε ΟΠΩΣΔΗΠΟΤΕ το εργαλείο record.`;

const RECORD_TOOL = {
  name: "record",
  description: "Καταγραφή των στοιχείων που βρέθηκαν για την επιχείρηση.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["found", "not_found", "closed"] },
      official_name: { type: ["string", "null"] },
      category: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      website: { type: ["string", "null"] },
      address: { type: ["string", "null"] },
      confidence: { type: "number" },
      note: { type: "string" },
      sources: { type: "array", items: { type: "string" } },
    },
    required: ["status", "confidence", "note", "sources"],
  },
};

export class EnrichStop extends Error {}

type Block = { type: string; name?: string; input?: unknown; [k: string]: unknown };
type ApiResp = { content: Block[]; stop_reason: string; usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } } };

async function call(body: Record<string, unknown>): Promise<ApiResp> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new EnrichStop("Λείπει το ANTHROPIC_API_KEY στη Vercel");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Χωρίς πίστωση, λάθος κλειδί ή απενεργοποιημένη αναζήτηση: σταματάμε όλη τη σειρά
    if ([400, 401, 402, 403, 429].includes(res.status) && /credit|billing|balance|permission|not enabled|web_search|rate/i.test(raw)) {
      throw new EnrichStop(`AI ${res.status}: ${raw.slice(0, 220)}`);
    }
    throw new Error(`AI ${res.status}: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw) as ApiResp;
}

export async function lookupBusiness(q: { name: string; hint?: string | null; phone?: string | null; email?: string | null }): Promise<{ info: WebInfo; usage: Usage }> {
  const usage: Usage = { searches: 0, input: 0, output: 0 };
  const tools = [
    // Χωρίς user_location: η Anthropic δεν δέχεται ακόμα «GR». Η περιοχή μπαίνει στο κείμενο της αναζήτησης.
    { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    RECORD_TOOL,
  ];
  const user = [
    `Επιχείρηση: ${q.name}`,
    q.hint ? `Πληροφορίες: ${q.hint}` : "",
    q.phone ? `Τηλέφωνο που ήδη ξέρουμε: ${q.phone}` : "",
    q.email ? `Email που ήδη ξέρουμε: ${q.email}` : "",
  ].filter(Boolean).join("\n");
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: user }];
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

  for (let turn = 0; turn < 4; turn++) {
    const forced = turn >= 2;
    const r = await call({
      model, max_tokens: 1500, system: SYSTEM, messages,
      tools, // η αναζήτηση μένει στη λίστα: το ιστορικό της συζήτησης την αναφέρει
      ...(forced ? { tool_choice: { type: "tool", name: "record" } } : {}),
    });
    usage.searches += r.usage?.server_tool_use?.web_search_requests ?? 0;
    usage.input += r.usage?.input_tokens ?? 0;
    usage.output += r.usage?.output_tokens ?? 0;
    const rec = r.content.find((b) => b.type === "tool_use" && b.name === "record");
    if (rec?.input) return { info: clean(rec.input as WebInfo), usage };
    // Η AI δεν τελείωσε (pause_turn) ή απάντησε με κείμενο: συνεχίζουμε / τη ζητάμε ρητά
    messages.push({ role: "assistant", content: r.content });
    if (r.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Κατέγραψε τώρα ό,τι βρήκες με το εργαλείο record." });
      turn = Math.max(turn, 1);
    }
  }
  return { info: { status: "not_found", official_name: null, category: null, phone: null, email: null, website: null, address: null, confidence: 0, note: "Η AI δεν έδωσε απάντηση.", sources: [] }, usage };
}

function clean(v: WebInfo): WebInfo {
  const str = (x: unknown) => (typeof x === "string" && x.trim() && !/^(null|n\/a|—|-)$/i.test(x.trim()) ? x.trim().slice(0, 300) : null);
  const email = str(v.email)?.toLowerCase() ?? null;
  return {
    status: (["found", "not_found", "closed"] as const).includes(v.status) ? v.status : "not_found",
    official_name: str(v.official_name),
    category: str(v.category)?.slice(0, 60) ?? null,
    phone: str(v.phone)?.replace(/[^\d+ ]/g, "").trim() || null,
    email: email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : null,
    website: str(v.website),
    address: str(v.address),
    confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
    note: str(v.note) ?? "",
    sources: Array.isArray(v.sources) ? v.sources.filter((s) => typeof s === "string" && /^https?:\/\//.test(s)).slice(0, 5) : [],
  };
}

const usable = (i: WebInfo) => i.status !== "not_found" && i.confidence >= 0.6;

// ---------- Lead ----------
export async function enrichLead(db: SupabaseClient, leadId: string) {
  const { data: l } = await db.from("leads").select("id, company_name, area, phone, email, notes").eq("id", leadId).maybeSingle();
  if (!l) return;
  const { info, usage } = await lookupBusiness({ name: l.company_name, hint: [l.area, l.notes?.slice(0, 200)].filter(Boolean).join(" · "), phone: l.phone, email: l.email });
  const ok = usable(info);
  await db.from("leads").update({
    ...(ok && !l.phone && info.phone ? { phone: info.phone } : {}),
    ...(ok && !l.email && info.email ? { email: info.email } : {}),
    ...(ok && !l.area && info.address ? { area: info.address.slice(0, 120) } : {}),
    category: ok ? info.category : null,
    website: ok ? info.website : null,
    address: ok ? info.address : null,
    web_status: info.status,
    web_checked_at: new Date().toISOString(),
    web_note: info.note,
    web_sources: info.sources,
  }).eq("id", leadId);
  await db.from("web_runs").insert({ kind: "lead", target_id: leadId, searches: usage.searches, input_tokens: usage.input, output_tokens: usage.output, status: info.status });
}

// ---------- Πελάτες (μαζικά) ----------
export async function enrichCustomer(db: SupabaseClient, c: { id: string; display_name: string; phone: string | null; email: string | null; category: string | null; agency: string | null; stations: string[] | null; last_period: string | null }) {
  const hint = [
    c.agency ? `διαφημίζεται μέσω του πρακτορείου ${c.agency}` : "τοπικός διαφημιζόμενος",
    c.last_period ? `τελευταία καμπάνια ${c.last_period}` : "",
    c.stations?.length ? `σταθμοί ${c.stations.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const { info, usage } = await lookupBusiness({ name: c.display_name, hint, phone: c.phone, email: c.email });
  const ok = usable(info);
  const needsReview = info.status === "closed" || !ok;
  await db.from("customers").update({
    ...(ok && !c.phone && info.phone ? { phone: info.phone } : {}),
    ...(ok && !c.email && info.email ? { email: info.email } : {}),
    ...(ok && !c.category && info.category ? { category: info.category } : {}),
    ...(ok ? { website: info.website, address: info.address } : {}),
    web_status: ok ? info.status : info.status === "closed" ? "closed" : "not_found",
    web_checked_at: new Date().toISOString(),
    web_note: info.note,
    web_sources: info.sources,
    web_confidence: info.confidence,
    web_reviewed_at: needsReview ? null : new Date().toISOString(),
  }).eq("id", c.id);
  await db.from("web_runs").insert({ kind: "customer", target_id: c.id, searches: usage.searches, input_tokens: usage.input, output_tokens: usage.output, status: info.status });
  return info.status;
}

// Επόμενοι πελάτες που δεν έχουν ελεγχθεί: πρώτα οι ενεργοί, μετά οι πιο πρόσφατοι της βάσης.
export async function enrichBatch(db: SupabaseClient, n: number) {
  const { data } = await db
    .from("customers")
    .select("id, display_name, phone, email, category, agency, stations, last_period, status")
    .is("web_checked_at", null).is("closed_at", null)
    .order("status", { ascending: true })            // 'active' < 'base'
    .order("last_period", { ascending: false, nullsFirst: false })
    .limit(n);
  const list = data ?? [];
  const out = { done: 0, found: 0, review: 0, errors: 0, stopped: null as string | null };
  // 3 παράλληλα για ταχύτητα, χωρίς να «φορτώνουμε» την AI
  for (let i = 0; i < list.length && !out.stopped; i += 3) {
    await Promise.all(list.slice(i, i + 3).map(async (c) => {
      try {
        const st = await enrichCustomer(db, c);
        out.done++;
        if (st === "found") out.found++; else out.review++;
      } catch (e) {
        if (e instanceof EnrichStop) out.stopped = e.message;
        else {
          out.errors++;
          await db.from("customers").update({ web_status: "error", web_checked_at: new Date().toISOString(), web_note: e instanceof Error ? e.message.slice(0, 200) : "σφάλμα" }).eq("id", c.id);
        }
      }
    }));
  }
  return out;
}
