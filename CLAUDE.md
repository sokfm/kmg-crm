# KMG CRM — οδηγίες για όποιον (άνθρωπο ή Claude) αλλάζει τον κώδικα

CRM της Kartelias Media Group (ΣΟΚ FM, DALKAS, ΜΠΛΕ, NRG, lalala.gr). Ιδιοκτήτης: Νίκος (nikos@sokfm.gr).
Όλο το περιβάλλον χρήσης είναι στα ελληνικά. Ο Νίκος δεν γράφει κώδικα: εξηγούμε απλά, χωρίς ορολογία.

## Στοίβα
- Next.js 15 (App Router, server components + server actions), TypeScript 5.9 (όχι 7: σπάει το Next 15)
- Supabase (Postgres, Auth χωρίς κωδικό, RLS), project `rgovnxcmtxvqmhluohqj`, περιοχή eu-west-1
- Vercel (ομάδα KMG, Pro) — κάθε push στο `main` ανεβαίνει αυτόματα στο https://kmg-crm.vercel.app
- Repo: github.com/sokfm/kmg-crm (ιδιωτικό)

## Κανόνες που δεν αλλάζουν χωρίς τον Νίκο
- Δικαιώματα ζουν στη βάση (RLS + triggers), όχι μόνο στις οθόνες. Πωλητής βλέπει μόνο δικά του + βάση πελατών.
- Ανοιχτό lead = πάντα επόμενο βήμα + ημερομηνία. Χαμένο lead = πάντα είδος «όχι».
- Επαφή μετράει μόνο κλήση/ραντεβού/Viber/email — η σημείωση όχι.
- Leads αναθέτει ο Νίκος (ceo). Digital leads → Μαρία. Αιτήματα από τη βάση εγκρίνει μόνο ο Νίκος· 10 μέρες για επαφή, αλλιώς επιστροφή (pg_cron 08:00).
- Ταυτόχρονη επεξεργασία: στήλη `version` — update με `.eq('version', v)`, 0 γραμμές = σύγκρουση → προειδοποίηση, ποτέ σιωπηλή αντικατάσταση.
- Δεδομένα πελατών (data/, seed) και κλειδιά ΠΟΤΕ στο git.

## Αλλαγές στη βάση
- Νέο αρχείο `supabase/migrations/000N_περιγραφή.sql`, ποτέ αλλαγή παλιού.
- Δοκιμή τοπικά: `supabase/tests/auth_stub.sql` + migrations + `supabase/tests/rls_test.sql` → «ALL TESTS PASSED».
- Εφαρμογή στο Supabase: SQL Editor του dashboard.

## Έλεγχος πριν από κάθε push
`npx tsc --noEmit` και `npm run build` (με ψεύτικα NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).

## Ανοιχτά
- Email: Resend (domain sokfm.gr, eu-west-1) → Supabase SMTP, πρότυπο με 6ψήφιο κωδικό. DNS στο easy.gr μέσω Denis (Offgrid).
- Επόμενα κομμάτια: Β (pipeline, AI sales manager, chatbot, φωνητικά) και Γ (τιμοκατάλογος, συμβόλαια, τιμολόγηση, dashboard).
