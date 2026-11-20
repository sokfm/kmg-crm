// Η AI διαβάζει αυτό που είπε (ή έγραψε) ο Account Executive μετά από μια επαφή
// και προτείνει: τι καταγράφεται, ποιο είναι το επόμενο βήμα και πότε. Δεν αλλάζει τίποτα μόνη της.

export type VoiceResult = {
  activity_type: "call" | "meeting" | "viber" | "email" | "note";
  summary: string;
  next_step: string | null;
  next_step_due: string | null; // YYYY-MM-DD
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
      stage: { type: ["string", "null"], enum: ["new", "contacted", "meeting", "proposal", "negotiation", null] },
      tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, due_date: { type: ["string", "null"] } }, required: ["title"] } },
      unclear: { type: ["string", "null"] },
    },
    required: ["activity_type", "summary", "next_step", "next_step_due", "stage", "tasks", "unclear"],
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
    stage,
    tasks: (Array.isArray(v.tasks) ? v.tasks : []).filter((t) => t && t.title).slice(0, 3).map((t) => ({ title: String(t.title).slice(0, 160), due_date: isDate(t.due_date) ? t.due_date : null })),
    unclear: v.unclear ? String(v.unclear).slice(0, 300) : (v.next_step && !due ? "Δεν κατάλαβα πότε είναι το επόμενο βήμα. Βάλε ημερομηνία." : null),
  };
}
