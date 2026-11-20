// Η AI διαβάζει ένα email και λέει τι είναι: νέο lead, πελάτης, πρακτορείο ή άσχετο,
// και αν ζητάει κάτι να γίνει (εργασία). Χρειάζεται ANTHROPIC_API_KEY στη Vercel.

export type EmailVerdict = {
  kind: "new_lead" | "existing_customer" | "agency" | "supplier" | "personal" | "newsletter" | "other";
  confidence: number;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  summary: string;
  reason: string;
  tasks: { title: string; due_date: string | null }[];
  next_step: { text: string; due_date: string | null } | null;
};

const SYSTEM = `Είσαι ο βοηθός πωλήσεων της Kartelias Media Group (KMG), ραδιοφωνικού ομίλου στη Χαλκίδα
(ΣΟΚ FM 104.8, DALKAS 88.2, ΜΠΛΕ 99, NRG 95, lalala.gr, social/digital). Η KMG πουλάει ραδιοφωνική
διαφήμιση (σποτ, χορηγίες εκπομπών, πακέτα), digital και social. Πελάτες είναι τοπικές επιχειρήσεις
και διαφημιστικά πρακτορεία (U Media, Mave, GM, Red Lemon, MMS, Wavemaker, Initiative, Carat, Bold).

Διαβάζεις ένα email από το γραμματοκιβώτιο ενός στελέχους της KMG και απαντάς ΠΑΝΤΑ με το εργαλείο verdict.
summary: μία σύντομη πρόταση στα ελληνικά. reason: γιατί, σε μία πρόταση. company: εμπορική ονομασία.
email: το email του ΠΕΛΑΤΗ/ενδιαφερόμενου όπως γράφεται μέσα στο κείμενο (π.χ. στα πεδία μιας φόρμας επικοινωνίας
ή σε προωθημένο μήνυμα), αλλιώς null. ΠΟΤΕ διεύθυνση της KMG (@sokfm.gr, @karteliasmediagroup.gr, @lalala.gr).
Όταν το email είναι φόρμα επικοινωνίας του site ή προώθηση, company/contact_name/phone είναι του ενδιαφερόμενου
που συμπλήρωσε τη φόρμα — ποτέ της KMG ή του συναδέλφου που το προώθησε (αγνόησε τις υπογραφές της KMG).
tasks: τι πρέπει να κάνει το στέλεχος της KMG, με due_date σε μορφή YYYY-MM-DD ή null.

kind:
- new_lead: επιχείρηση που ενδιαφέρεται να διαφημιστεί / ζητά τιμές / προσφορά / χορηγία και δεν φαίνεται ήδη πελάτης.
- existing_customer: επιχείρηση που μοιάζει να είναι ήδη πελάτης (τρέχουσα καμπάνια, σποτ, τιμολόγιο, ανανέωση).
- agency: διαφημιστικό πρακτορείο για καμπάνια πελάτη (στο company βάλε τον πελάτη-διαφημιζόμενο αν φαίνεται).
- supplier: προμηθευτής/συνεργάτης της KMG (λογισμικό, τεχνικά, λογιστήριο, ενοίκια).
- personal: προσωπικό.
- newsletter: ενημερωτικό, μαζικό, διαφήμιση προς εμάς, ειδοποίηση συστήματος.
- other: τίποτα από τα παραπάνω.

confidence: πόσο σίγουρος είσαι για το kind. Για new_lead δώσε πάνω από 0.85 ΜΟΝΟ όταν το email
ζητά ξεκάθαρα διαφήμιση/τιμές/συνεργασία από επιχείρηση.

tasks: μόνο υποχρεώσεις ΠΩΛΗΣΕΩΝ που προκύπτουν για την KMG (π.χ. «Αποστολή πρότασης στον Χ»,
«Κλήση για ραντεβού», «Αποστολή τιμολογίου»). Όχι εργασίες για programming, social ή εσωτερικά — αυτά
πάνε αλλού. Όχι εργασίες για προγραμματισμό σποτ/traffic από πρακτορεία (τα χειρίζεται το traffic).
Αν δεν προκύπτει τίποτα, κενή λίστα. Ημερομηνίες μόνο αν αναφέρονται ή εννοούνται καθαρά.

next_step: το ΕΝΑ επόμενο βήμα πώλησης που προκύπτει από το email, σύντομα (π.χ. «Αποστολή πρότασης», «Κλείσιμο ραντεβού»,
«Follow-up στην προσφορά»), με due_date αν φαίνεται. null αν δεν προκύπτει κάτι καθαρό. Είναι ΠΡΟΤΑΣΗ: ο άνθρωπος θα πατήσει ΟΚ.`;

export async function judgeEmail(input: {
  direction: "in" | "out";
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  knownAs?: string | null;
}): Promise<EmailVerdict> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Λείπει το ANTHROPIC_API_KEY στη Vercel");
  const user = [
    `Κατεύθυνση: ${input.direction === "in" ? "εισερχόμενο" : "απεσταλμένο από την KMG"}`,
    `Από: ${input.from}`,
    `Προς: ${input.to}`,
    `Ημερομηνία: ${input.date}`,
    input.knownAs ? `Το CRM ξέρει ήδη αυτή τη διεύθυνση ως: ${input.knownAs}` : "",
    `Θέμα: ${input.subject}`,
    "",
    input.text.slice(0, 3000),
  ].join("\n");

  // Ζητάμε την απάντηση μέσω «εργαλείου» με αυστηρό σχήμα: η AI δεν μπορεί να γυρίσει
  // μισό ή χαλασμένο JSON.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 1500,
      system: SYSTEM,
      tools: [VERDICT_TOOL],
      tool_choice: { type: "tool", name: "verdict" },
      messages: [{ role: "user", content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`AI ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as { content: { type: string; input?: unknown }[] };
  const block = data.content.find((c) => c.type === "tool_use");
  if (!block?.input) throw new Error("AI: κενή απάντηση");
  const v = block.input as EmailVerdict;
  v.tasks = Array.isArray(v.tasks) ? v.tasks.filter((t) => t && t.title).slice(0, 3) : [];
  v.next_step = v.next_step && typeof v.next_step.text === "string" && v.next_step.text.trim() ? { text: v.next_step.text.trim().slice(0, 160), due_date: v.next_step.due_date ?? null } : null;
  v.confidence = Number(v.confidence) || 0;
  v.email = typeof v.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()) ? v.email.trim().toLowerCase() : null;
  v.summary = v.summary ?? "";
  v.reason = v.reason ?? "";
  return v;
}

const VERDICT_TOOL = {
  name: "verdict",
  description: "Η ταξινόμηση του email για το CRM της KMG.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["new_lead", "existing_customer", "agency", "supplier", "personal", "newsletter", "other"] },
      confidence: { type: "number" },
      company: { type: ["string", "null"] },
      contact_name: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      summary: { type: "string" },
      reason: { type: "string" },
      next_step: { type: ["object", "null"], properties: { text: { type: "string" }, due_date: { type: ["string", "null"] } }, required: ["text"] },
      tasks: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string" }, due_date: { type: ["string", "null"] } }, required: ["title"] },
      },
    },
    required: ["kind", "confidence", "summary", "reason", "tasks"],
  },
};
