-- Τρέχει ΜΙΑ φορά, αφού προσκληθούν οι 5 χρήστες από
-- Supabase → Authentication → Users → Invite user.
-- Δίνει σε κάθε λογαριασμό όνομα και ρόλο.
insert into profiles (id, full_name, email, role, sees_digital, history_agent_codes)
select u.id, v.full_name, v.email, v.role::user_role, v.sees_digital, v.codes
from (values
  ('nikos@sokfm.gr',        'Νίκος Καρτελιάς',     'ceo',            false, '{}'::text[]),
  ('i.drakidou@sokfm.gr',   'Γιάννα Δρακίδου',     'sales_manager',  false, '{DRAKIDOU,ΔΡΑΚΙΔΟΥ}'::text[]),
  ('stamoulakis@sokfm.gr',  'Κώστας Σταμουλάκης',  'account_exec',   false, '{STAMOULAKIS,ΣΤΑΜΟΥΛΑΚΗΣ}'::text[]),
  ('m.boutsika@sokfm.gr',   'Μαρία Μπούτσικα',     'account_exec',   true,  '{BOUTSIKA,ΜΠΟΥΤΣΙΚΑ}'::text[]),
  ('v.tsalla@sokfm.gr',     'Βασιλική Τσάλλα',     'digital_intake', false, '{}'::text[])
) as v(email, full_name, role, sees_digital, codes)
join auth.users u on lower(u.email) = v.email
on conflict (id) do update
  set full_name = excluded.full_name, role = excluded.role, sees_digital = excluded.sees_digital;
