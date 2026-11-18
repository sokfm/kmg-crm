# KMG CRM

CRM της Kartelias Media Group. Next.js (Vercel) + Supabase (Frankfurt).

## Στήσιμο (μία φορά, από υπολογιστή)

1. **Supabase → SQL Editor**: τρέξε με τη σειρά
   `supabase/migrations/0001_core.sql` και `supabase/migrations/0002_merge_and_stats.sql`.
2. **Supabase → Authentication → Users → Invite user**: πρόσκληση στα 5 email
   (nikos@, i.drakidou@, stamoulakis@, m.boutsika@, v.tsalla@ sokfm.gr).
3. **SQL Editor**: τρέξε `supabase/setup_users.sql` (δίνει ρόλους).
4. Φόρτωση ιστορικού: `data/seed.sql` (4 MB, μέσω `psql`, όχι από τον browser).
5. **Vercel → New Project → Import** από το GitHub, με δύο μεταβλητές:
   `NEXT_PUBLIC_SUPABASE_URL` και `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Supabase → Project Settings → API).
6. **Supabase → Authentication → URL Configuration**: Site URL = η διεύθυνση της Vercel,
   Redirect URL = `<διεύθυνση>/auth/callback`.

Τα `data/` και `.env` δεν ανεβαίνουν ποτέ στο GitHub (περιέχουν πελάτες και κλειδιά).

## Έλεγχοι
- `npm run typecheck` / `npm run build`
- Κανόνες δικαιωμάτων: `supabase/tests/rls_test.sql` (πρέπει να γράφει ALL TESTS PASSED)
