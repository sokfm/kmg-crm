// Η AI διαβάζει ένα email και λέει τι είναι: νέο lead, πελάτης, πρακτορείο ή άσχετο,
// και αν ζητάει κάτι να γίνει (εργασία). Χρειάζεται ANTHROPIC_API_KEY στη Vercel.

export type EmailVerdict = {
  kind: "new_lead" | "existing_customer" | "agency" | "supplier" | "personal" | "newsletter" | "other";
  confidence: number;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  summary: string;
  reason: string;
  tasks: { title: string; due_date: string | null }[];
};

const SYSTEM = `Είσαι ο βοηθός πωλήσεων της Kartelias Media Group (KMG), ραδιοφωνικού ομίλου στη Χαλκίδα
(ΣΟΚ FM 104.8, DALKAS 88.2, ΜΠΛΕ 99, NRG 95, lalala.gr, social/digital). Η KMG πουλάει ραδιοφωνική
διαφήμιση (σποτ, χορηγίες εκπομπών, πακέτα), digital και social. Πελάτες είναι τοπικές επιχειρήσεις
και διαφημιστικά πρακτορεία (U Media, Mave, GM, Red Lemon, MMS, Wavemaker, Initiative, Carat, Bold).

Διαβάζεις ένα email από το γραμματοκιβώτιο ενός στελέχους της KMG και απαντάς ΜΟΝΟ με JSON:
{"kind": "...", "confidence": 0-1, "company": "εμπορική ονομασία ή null", "contact_name": "... ή null",
 "phone": "... ή null", "summary": "μία πρόταση στα ελληνικά", "reason": "γιατί, σε μία πρόταση",
 "tasks": [{"title": "τι πρέπει να κάνει το στέλεχος της KMG", "due_date": "YYYY-MM-DD ή null"}]}

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
Αν δεν προκύπτει τίποτα, κενή λίστα. Ημερομηνίες μόνο αν αναφέρονται ή εννοούνται καθαρά.`;

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "{}";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const v = JSON.parse(json) as EmailVerdict;
  v.tasks = Array.isArray(v.tasks) ? v.tasks.filter((t) => t && t.title).slice(0, 3) : [];
  v.confidence = Number(v.confidence) || 0;
  return v;
}
