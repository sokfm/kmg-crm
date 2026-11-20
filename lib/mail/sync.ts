import type { SupabaseClient } from "@supabase/supabase-js";
import { graph, refreshAccess, type GraphMessage } from "./microsoft";
import { judgeEmail, type EmailVerdict } from "./ai";
import { isOwnEmail } from "../own";

// Συγχρονισμός ενός γραμματοκιβωτίου: διαβάζει τα νέα Εισερχόμενα και Απεσταλμένα,
// γράφει τα email γνωστών πελατών/leads στην καρτέλα τους και βάζει ό,τι αφορά πωλήσεις στη λίστα «Προς έλεγχο».
// ΔΕΝ ανοίγει leads, εργασίες ή επόμενα βήματα μόνο του (απόφαση 20/11/2026): τα προτείνει και ο κάτοχος πατάει ΟΚ.
// Το ίδιο email σε δύο γραμματοκιβώτια μετράει μία φορά· αν είναι για έλεγχο, πάει στον Νίκο.

const INTERNAL_DOMAINS = ["sokfm.gr"];
const ROBOT = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce|newsletter@)/i;
const PER_FOLDER = 20;

type Account = { user_id: string; ms_email: string; refresh_token: string; inbox_since: string; sent_since: string };
type Target = { customer_id: string | null; lead_id: string | null; agency_id?: string | null };
type Match = (Target & { label: string }) | null;
export type SyncResult = { user: string; logged: number; leads: number; review: number; tasks: number; skipped: number; error?: string };

const lower = (s?: string | null) => (s ?? "").trim().toLowerCase();
const domainOf = (email: string) => email.slice(email.indexOf("@"));
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const isDate = (d?: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");

export async function syncAccount(db: SupabaseClient, acc: Account): Promise<SyncResult> {
  const result: SyncResult = { user: acc.ms_email, logged: 0, leads: 0, review: 0, tasks: 0, skipped: 0 };
  try {
    const tok = await refreshAccess(acc.refresh_token);
    if (tok.refresh_token && tok.refresh_token !== acc.refresh_token) {
      await db.from("mail_accounts").update({ refresh_token: tok.refresh_token }).eq("user_id", acc.user_id);
    }
    const ignored = new Set(((await db.from("ignored_senders").select("pattern")).data ?? []).map((r) => lower(r.pattern)));
    // Πρακτορεία: domain → πρακτορείο. Ό,τι έρχεται από εκεί πάει στην καρτέλα του πρακτορείου.
    const agencyByDomain = new Map<string, { id: string; name: string }>();
    for (const a of ((await db.from("agencies").select("id, name, domains")).data ?? []) as { id: string; name: string; domains: string[] }[])
      for (const d of a.domains ?? []) agencyByDomain.set(lower(d), { id: a.id, name: a.name });
    const ceoIds = new Set(((await db.from("profiles").select("id").eq("role", "ceo").eq("active", true)).data ?? []).map((c) => c.id as string));
    const iAmCeo = ceoIds.has(acc.user_id);
    const own = lower(acc.ms_email);
    const internal = new Set([...INTERNAL_DOMAINS.map((d) => "@" + d), domainOf(own)]);

    for (const folder of ["inbox", "sentitems"] as const) {
      const isIn = folder === "inbox";
      const field = isIn ? "receivedDateTime" : "sentDateTime";
      const since = isIn ? acc.inbox_since : acc.sent_since;
      const path =
        `/me/mailFolders/${folder}/messages?$top=${PER_FOLDER}` +
        `&$select=id,subject,from,toRecipients,ccRecipients,${field},body,bodyPreview,webLink,isDraft,internetMessageId` +
        `&$filter=${field} gt ${new Date(since).toISOString()}&$orderby=${field} asc`;
      const { value } = await graph<{ value: GraphMessage[] }>(tok.access_token, path);
      let newest = since;

      const sinceField = isIn ? "inbox_since" : "sent_since";
      for (const m of value) {
        const when = (isIn ? m.receivedDateTime : m.sentDateTime) ?? new Date().toISOString();
        // Προχωράμε το «από πότε» μετά από ΚΑΘΕ email: αν κάτι σκάσει στη μέση,
        // δεν ξαναδιαβάζουμε (και δεν ξαναπληρώνουμε AI) όσα έγιναν ήδη.
        if (newest !== since) await db.from("mail_accounts").update({ [sinceField]: newest }).eq("user_id", acc.user_id);
        newest = when;
        if (m.isDraft) continue;

        // Ποιος είναι ο «άλλος» στη συζήτηση
        const people = isIn ? [m.from] : [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])];
        const other = people
          .map((p) => ({ email: lower(p?.emailAddress?.address), name: p?.emailAddress?.name ?? null }))
          .find((p) => p.email && p.email !== own && !internal.has(domainOf(p.email)));
        if (!other || ROBOT.test(other.email) || ignored.has(other.email) || ignored.has(domainOf(other.email))) {
          result.skipped++;
          continue;
        }
        const { data: seen } = await db.from("email_messages").select("id").eq("user_id", acc.user_id).eq("graph_id", m.id).maybeSingle();
        if (seen) continue;

        // Το ίδιο email υπάρχει ήδη από άλλο γραμματοκιβώτιο (κοινό inbox, cc): μετράει μία φορά, χωρίς δεύτερη AI.
        // Αν περιμένει έλεγχο σε άλλον και τώρα το βλέπει και ο Νίκος, περνάει στον Νίκο.
        if (m.internetMessageId) {
          const { data: twin } = await db.from("email_messages").select("id, user_id, status, ai_company, counterpart_email")
            .eq("internet_id", m.internetMessageId).neq("user_id", acc.user_id).limit(1).maybeSingle();
          if (twin) {
            if (twin.status === "review" && iAmCeo && !ceoIds.has(twin.user_id)) {
              await db.from("email_messages").update({ user_id: acc.user_id, graph_id: m.id, web_link: m.webLink ?? null }).eq("id", twin.id);
              await db.from("notifications").insert({ user_id: acc.user_id, kind: "inbox_new", title: `Για το ΟΚ σου (ήρθε σε πάνω από ένα email): ${twin.ai_company ?? twin.counterpart_email}`, link: "/inbox" });
            }
            result.skipped++;
            continue;
          }
        }

        // Δική μας διεύθυνση (φόρμα του site, προώθηση): ο αποστολέας ΔΕΝ είναι ο πελάτης.
        // Τα στοιχεία του πελάτη τα βρίσκει η AI μέσα στο κείμενο.
        const ownSender = isOwnEmail(other.email);
        const ag = ownSender ? undefined : agencyByDomain.get(domainOf(other.email));
        let match: Match = ag
          ? { customer_id: null, lead_id: null, agency_id: ag.id, label: `πρακτορείο ${ag.name}` }
          : ownSender ? null : await findMatch(db, other.email);
        let verdict: EmailVerdict;
        try {
          verdict = await judgeEmail({
            direction: isIn ? "in" : "out",
            from: isIn ? `${other.name ?? ""} <${other.email}>` : acc.ms_email,
            to: isIn ? acc.ms_email : `${other.name ?? ""} <${other.email}>`,
            subject: m.subject ?? "",
            date: when,
            text: m.body?.content ?? m.bodyPreview ?? "",
            knownAs: match?.label,
          });
        } catch (e) {
          // Αν η AI δεν απαντήσει, δεν χάνουμε το email: γνωστός πελάτης → καταγραφή,
          // άγνωστο εισερχόμενο → «Προς έλεγχο» για να αποφασίσεις εσύ.
          verdict = {
            kind: match ? "existing_customer" : isIn ? "new_lead" : "other",
            confidence: 0,
            company: null,
            contact_name: ownSender ? null : other.name,
            phone: null,
            email: null,
            summary: (m.bodyPreview ?? "").slice(0, 200),
            reason: `Η AI δεν απάντησε (${e instanceof Error ? e.message.slice(0, 80) : "σφάλμα"}) — έλεγξέ το εσύ.`,
            tasks: [],
            next_step: null,
          };
        }

        // Το πραγματικό email του πελάτη: του αποστολέα, εκτός αν ο αποστολέας είμαστε εμείς
        const realEmail = ownSender ? (verdict.email && !isOwnEmail(verdict.email) ? verdict.email : null) : other.email;
        const realName = ownSender ? verdict.contact_name : (verdict.contact_name ?? other.name);
        if (ownSender && realEmail) match = await findMatch(db, realEmail);

        const base = {
          user_id: acc.user_id,
          graph_id: m.id,
          internet_id: m.internetMessageId ?? null,
          ai_tasks: verdict.tasks.map((t) => ({ title: t.title, due_date: isDate(t.due_date) ? t.due_date : null })),
          ai_next_step: verdict.next_step?.text ?? null,
          ai_next_due: isDate(verdict.next_step?.due_date) ? verdict.next_step!.due_date : null,
          direction: isIn ? "in" : "out",
          counterpart_email: other.email,
          counterpart_name: other.name,
          subject: m.subject ?? "(χωρίς θέμα)",
          occurred_at: when,
          web_link: m.webLink ?? null,
          summary: verdict.summary,
          ai_kind: verdict.kind,
          ai_confidence: verdict.confidence,
          ai_reason: verdict.reason,
          ai_company: verdict.company,
          ai_contact_name: realName,
          ai_phone: verdict.phone,
          ai_email: realEmail,
        };

        // 1. Γνωστός πελάτης ή lead → η επαφή γράφεται στην καρτέλα του· εργασίες/επόμενο βήμα μένουν ΠΡΟΤΑΣΕΙΣ για ΟΚ
        if (match) {
          const hasIdeas = verdict.tasks.length > 0 || (!!match.lead_id && !!verdict.next_step);
          const { data: em } = await db
            .from("email_messages")
            .insert({ ...base, status: "logged", suggest: hasIdeas ? "pending" : "none", customer_id: match.customer_id, lead_id: match.lead_id, agency_id: match.agency_id ?? null, decided_at: new Date().toISOString() })
            .select("id")
            .single();
          await logActivity(db, acc.user_id, em!.id, isIn, base.subject, verdict.summary, when, match);
          if (hasIdeas) result.tasks += verdict.tasks.length;
          result.logged++;
          continue;
        }

        // 2. Σχετικό με πωλήσεις αλλά άγνωστος αποστολέας → «Προς έλεγχο». Lead γίνεται μόνο με ΟΚ.
        if (["new_lead", "existing_customer", "agency"].includes(verdict.kind)) {
          let hint: { id: string; label: string } | null = null;
          if (verdict.kind === "new_lead" && (verdict.company || verdict.phone)) {
            const { data: like } = await db.rpc("find_lead_like", { p_company: verdict.company, p_phone: verdict.phone });
            hint = ((like ?? []) as { id: string; label: string }[])[0] ?? null;
          }
          await db.from("email_messages").insert({ ...base, status: "review", lead_hint: hint?.id ?? null, lead_hint_label: hint?.label ?? null });
          if (isIn && verdict.kind === "new_lead") {
            const who = verdict.company || (ownSender ? realName || realEmail || base.subject : other.name || other.email);
            await db.from("notifications").insert({ user_id: acc.user_id, kind: "inbox_new", title: `Πιθανό νέο lead από email: ${who} — θέλει το ΟΚ σου`, link: "/inbox" });
            result.leads++;
          }
          result.review++;
          continue;
        }

        // 4. Άσχετο (προσωπικό, ενημερωτικό, προμηθευτής) → δεν κρατάμε τίποτα
        result.skipped++;
      }

      await db
        .from("mail_accounts")
        .update(isIn ? { inbox_since: newest } : { sent_since: newest })
        .eq("user_id", acc.user_id);
    }
    await db.from("mail_accounts").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("user_id", acc.user_id);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await db.from("mail_accounts").update({ last_sync_at: new Date().toISOString(), last_error: result.error.slice(0, 500) }).eq("user_id", acc.user_id);
  }
  return result;
}

async function findMatch(db: SupabaseClient, email: string): Promise<Match> {
  const { data: c } = await db.from("contacts").select("customer_id, lead_id, customers(display_name), leads(company_name)").eq("email", email).maybeSingle();
  if (c) {
    const row = c as unknown as { customer_id: string | null; lead_id: string | null; customers: { display_name: string } | null; leads: { company_name: string } | null };
    return { customer_id: row.customer_id, lead_id: row.lead_id, label: row.customers?.display_name ?? row.leads?.company_name ?? email };
  }
  const { data: l } = await db.from("leads").select("id, company_name, customer_id").ilike("email", likeExact(email)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (l) return { customer_id: l.customer_id, lead_id: l.id, label: l.company_name };
  const { data: cu } = await db.from("customers").select("id, display_name").ilike("email", likeExact(email)).limit(1).maybeSingle();
  if (cu) return { customer_id: cu.id, lead_id: null, label: cu.display_name };
  return null;
}

export async function logActivity(
  db: SupabaseClient,
  userId: string,
  emailId: string,
  isIn: boolean,
  subject: string,
  summary: string | null,
  when: string,
  target: Target,
) {
  await db.from("activities").insert({
    user_id: userId,
    lead_id: target.lead_id,
    customer_id: target.lead_id ? null : target.customer_id,
    agency_id: target.agency_id ?? null,
    type: "email",
    summary: `${isIn ? "📥" : "📤"} ${subject}${summary ? " — " + summary : ""}`,
    occurred_at: when,
    email_message_id: emailId,
  });
}

export async function syncAll(db: SupabaseClient, userId?: string) {
  let q = db.from("mail_accounts").select("user_id, ms_email, refresh_token, inbox_since, sent_since");
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const out: SyncResult[] = [];
  for (const acc of (data ?? []) as Account[]) out.push(await syncAccount(db, acc));
  return out;
}
