// Η AI διαβάζει αυτό που είπε (ή έγραψε) ο Account Executive μετά από μια επαφή
// και προτείνει: τι καταγράφεται, ποιο είναι το επόμενο βήμα και πότε. Δεν αλλάζει τίποτα μόνη της.

export type VoiceResult = {
  activity_type: "call" | "meeting" | "viber" | "email" | "note";
  summary: string;
  next_step: string | null;
  next_step_due: string | null; // YYYY-MM-DD
  next_step_time: string | null; // ΩΩ:ΛΛ, μόνο αν ειπώθηκε ώρα
  stage: "new" | "contacted" | "meeting" | "proposal" | "negotiation" | null;
  tasks: { title: string; due_date: string | null }[];
  unclear: string | null;
};

const SYSTEM = `Είσαι ο βοηθός πωλήσεων της Kartelias Media Group (ραδιόφωνα ΣΟΚ FM, DALKAS, ΜΠΛΕ, NRG στη Χαλκίδα).
Ένας Account Executive σου λέει προφορικά τι έγινε με έναν πελάτη. Το κείμενο είναι απομαγνητοφώνηση: μπορεί να έχει
λάθη, μισές λέξεις ή ονόματα γραμμένα λάθος. Κατάλαβε το νόημα και απάντησε ΠΑΝΤΑ με το εργαλείο note.

- activity_type: call (τηλέφωνο), meeting (ραντεβού/συνάντηση), viber (μήνυμα), email, ή note αν δεν έγινε επαφή με τον πελάτη.
- summary: τι έγινε, σε 1–2 καθαρές προτάσεις στα ελληνικά, σε τρίτο πρόσωπο, χωρίς φλυαρία. Κράτα ποσά, ονόματα, ημερομηνίες.
- next_step: η ΜΙΑ επόμενη κίνηση του Account Executive προς τον πελάτη (π.χ. «Αποστολή προσφοράς», «Τηλέφωνο για απάντηση»). null αν δεν ειπώθηκε και δεν προκύπτει.
- next_step_time: ώρα ΩΩ:ΛΛ (24ωρο) ΜΟΝΟ αν ειπώθηκε συγκεκριμένη ώρα («στις 11», «στις πεντέμισι το απόγευμα» → 17:30). Αλλιώς null.
- next_step_due: ημερομηνία YYYY-MM-DD για το επόμενο βήμα. Υπολόγισέ την από τη σημερινή ημερομηνία που σου δίνω («αύριο», «την Τρίτη», «σε δύο βδομάδες», «μετά τις γιορτές»). Αν δεν ειπώθηκε πότε, βάλε null — ΜΗΝ μαντέψεις.
- stage: βάλε νέο στάδιο ΜΟΝΟ αν προκύπτει καθαρά ότι το lead προχώρησε: contacted (έγινε πρώτη επαφή), meeting (κλείστηκε ή έγινε ραντεβού), proposal (στάλθηκε ή ζητήθηκε προσφορά), negotiation (συζητάνε τιμή/όρους). Αλλιώς null. Ποτέ πίσω από το τωρινό στάδιο.
- tasks: ΑΛΛΕΣ υποχρεώσεις πωλήσεων που ειπώθηκαν, πέρα από το επόμενο βήμα (έως 3). Συνήθως κενή λίστα.
- unclear: αν κάτι σημαντικό δεν βγαίνει (π.χ. δεν κατάλαβες ημερομηνία ή αν ο πελάτης είπε ναι ή όχι), γράψε το σε μία πρόταση. Αλλιώς null.
Αν ο πελάτης αρνήθηκε οριστικά ή έκλεισε η συμφωνία, ΜΗΝ αλλάξεις στάδιο: γράψ' το στο summary και στο unclear πες «Κλείσε το lead ως κερδισμένο/χαμένο από το Pipeline».`;

const TOOL = {
  name: "note",
  description: "Τι καταγράφεται στο CRM από αυτό που είπε ο Account Executive.",
  input_schema: {
    type: "object",
    properties: {
      activity_type: { type: "string", enum: ["call", "meeting", "viber", "email", "note"] },
      summary: { type: "string" },
      next_step: { type: ["string", "null"] },
      next_step_due: { type: ["string", "null"] },
      next_step_time: { type: ["string", "null"] },
      stage: { type: ["string", "null"], enum: ["new", "contacted", "meeting", "proposal", "negotiation", null] },
      tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, due_date: { type: ["string", "null"] } }, required: ["title"] } },
      unclear: { type: ["string", "null"] },
    },
    required: ["activity_type", "summary", "next_step", "next_step_due", "next_step_time", "stage", "tasks", "unclear"],
  },
};

const ORDER = ["new", "contacted", "meeting", "proposal", "negotiation"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export async function understandNote(input: { text: string; company: string; stage: string; nextStep: string | null; nextDue: string | null }): Promise<VoiceResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Λείπει το ANTHROPIC_API_KEY στη Vercel");
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
  const weekday = new Intl.DateTimeFormat("el-GR", { weekday: "long", timeZone: "Europe/Athens" }).format(now);
  const user = [
    `Σήμερα: ${weekday} ${today}`,
    `Πελάτης: ${input.company}`,
    `Τωρινό στάδιο: ${input.stage}`,
    input.nextStep ? `Τωρινό επόμενο βήμα: ${input.nextStep}${input.nextDue ? ` (${input.nextDue})` : ""}` : "",
    "",
    "Αυτό είπε ο Account Executive:",
    input.text.slice(0, 2500),
  ].filter((l) => l !== "").join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 900,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "note" },
      messages: [{ role: "user", content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}: ${raw.slice(0, 160)}`);
  const block = (JSON.parse(raw) as { content: { type: string; input?: unknown }[] }).content.find((c) => c.type === "tool_use");
  if (!block?.input) throw new Error("AI: κενή απάντηση");
  const v = block.input as Partial<VoiceResult>;
  // Καθάρισμα: δεν εμπιστευόμαστε τυφλά ό,τι γυρίσει η AI
  const stage = v.stage && ORDER.includes(v.stage) && ORDER.indexOf(v.stage) > ORDER.indexOf(input.stage) ? v.stage : null;
  const due = isDate(v.next_step_due) && v.next_step_due >= today ? v.next_step_due : null;
  return {
    activity_type: ["call", "meeting", "viber", "email", "note"].includes(v.activity_type ?? "") ? v.activity_type! : "note",
    summary: String(v.summary ?? "").trim().slice(0, 600),
    next_step: v.next_step ? String(v.next_step).trim().slice(0, 160) : null,
    next_step_due: due,
    next_step_time: due && typeof v.next_step_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.next_step_time) ? v.next_step_time : null,
    stage,
    tasks: (Array.isArray(v.tasks) ? v.tasks : []).filter((t) => t && t.title).slice(0, 3).map((t) => ({ title: String(t.title).slice(0, 160), due_date: isDate(t.due_date) ? t.due_date : null })),
    unclear: v.unclear ? String(v.unclear).slice(0, 300) : (v.next_step && !due ? "Δεν κατάλαβα πότε είναι το επόμενο βήμα. Βάλε ημερομηνία." : null),
  };
}

// ---------- Νέο lead με τη φωνή ----------
export type NewLeadFields = {
  company_name: string | null; contact_name: string | null; phone: string | null; email: string | null; area: string | null;
  source: "phone" | "site" | "facebook" | "seller" | "competition_watch" | null;
  interest: "radio" | "digital" | "both" | null; stations: string[];
  next_step: string | null; next_step_due: string | null; next_step_time: string | null; notes: string | null;
};

const LEAD_SYSTEM = `Είσαι ο βοηθός πωλήσεων της Kartelias Media Group (ραδιόφωνα ΣΟΚ FM, DALKAS, ΜΠΛΕ, NRG στη Χαλκίδα, lalala.gr, social/digital).
Ένας Account Executive περιγράφει προφορικά ένα ΝΕΟ lead. Το κείμενο είναι απομαγνητοφώνηση και μπορεί να έχει λάθη. Απάντησε ΠΑΝΤΑ με το εργαλείο lead.
Συμπλήρωσε ΜΟΝΟ ό,τι ειπώθηκε· ό,τι δεν ειπώθηκε μένει null. Μη μαντεύεις τηλέφωνα, email ή ονόματα.
- company_name: η εμπορική ονομασία της επιχείρησης, καθαρά γραμμένη.
- contact_name: ο άνθρωπος με τον οποίο μιλάμε. phone: μόνο ψηφία, όπως ειπώθηκαν. email: μόνο αν ειπώθηκε ολόκληρο.
- area: περιοχή/διεύθυνση αν ειπώθηκε.
- source: phone (μας πήρε τηλέφωνο), site (φόρμα/ιστοσελίδα), facebook (Facebook/Instagram), seller (το βρήκε ο ίδιος ο Account Executive: πέρασε, τον γνώρισε, του το σύστησαν), competition_watch (ακούστηκε να διαφημίζεται σε άλλον σταθμό). null αν δεν φαίνεται.
- interest: radio, digital ή both, αν ειπώθηκε τι θέλει. stations: όσα από «ΣΟΚ FM», «DALKAS», «ΜΠΛΕ», «NRG», «lalala.gr», «Social» ειπώθηκαν.
- next_step: η επόμενη κίνηση προς τον πελάτη. next_step_due: YYYY-MM-DD από τη σημερινή ημερομηνία που σου δίνω· null αν δεν ειπώθηκε πότε. next_step_time: ώρα ΩΩ:ΛΛ (24ωρο) μόνο αν ειπώθηκε συγκεκριμένη ώρα, αλλιώς null.
- notes: ό,τι άλλο χρήσιμο ειπώθηκε (τι θέλει, μπάτζετ, πότε, γιατί), σε 1–2 προτάσεις. Όχι επανάληψη των παραπάνω πεδίων.`;

const LEAD_TOOL = {
  name: "lead",
  description: "Τα στοιχεία του νέου lead όπως ειπώθηκαν.",
  input_schema: {
    type: "object",
    properties: {
      company_name: { type: ["string", "null"] }, contact_name: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, email: { type: ["string", "null"] }, area: { type: ["string", "null"] },
      source: { type: ["string", "null"], enum: ["phone", "site", "facebook", "seller", "competition_watch", null] },
      interest: { type: ["string", "null"], enum: ["radio", "digital", "both", null] },
      stations: { type: "array", items: { type: "string" } },
      next_step: { type: ["string", "null"] }, next_step_due: { type: ["string", "null"] }, next_step_time: { type: ["string", "null"] }, notes: { type: ["string", "null"] },
    },
    required: ["company_name", "contact_name", "phone", "email", "area", "source", "interest", "stations", "next_step", "next_step_due", "next_step_time", "notes"],
  },
};
const STATION_SET = ["ΣΟΚ FM", "DALKAS", "ΜΠΛΕ", "NRG", "lalala.gr", "Social"];

export async function understandNewLead(text: string): Promise<NewLeadFields> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Λείπει το ANTHROPIC_API_KEY στη Vercel");
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
  const weekday = new Intl.DateTimeFormat("el-GR", { weekday: "long", timeZone: "Europe/Athens" }).format(now);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 900, system: LEAD_SYSTEM, tools: [LEAD_TOOL], tool_choice: { type: "tool", name: "lead" },
      messages: [{ role: "user", content: `Σήμερα: ${weekday} ${today}\n\nΑυτό είπε ο Account Executive:\n${text.slice(0, 2500)}` }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}: ${raw.slice(0, 160)}`);
  const block = (JSON.parse(raw) as { content: { type: string; input?: unknown }[] }).content.find((c) => c.type === "tool_use");
  if (!block?.input) throw new Error("AI: κενή απάντηση");
  const v = block.input as Partial<NewLeadFields>;
  const str = (x: unknown, n: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
  const email = str(v.email, 120);
  return {
    company_name: str(v.company_name, 120), contact_name: str(v.contact_name, 80),
    phone: str(v.phone, 30)?.replace(/[^0-9+ ]/g, "") || null,
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.toLowerCase() : null,
    area: str(v.area, 120),
    source: ["phone", "site", "facebook", "seller", "competition_watch"].includes(v.source ?? "") ? v.source! : null,
    interest: ["radio", "digital", "both"].includes(v.interest ?? "") ? v.interest! : null,
    stations: (Array.isArray(v.stations) ? v.stations : []).filter((x) => STATION_SET.includes(x)),
    next_step: str(v.next_step, 160),
    next_step_due: isDate(v.next_step_due) && v.next_step_due >= today ? v.next_step_due : null,
    next_step_time: typeof v.next_step_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.next_step_time) ? v.next_step_time : null,
    notes: str(v.notes, 500),
  };
}
