-- Δοκιμές δικαιωμάτων και κανόνων. Τρέχει με psql -v ON_ERROR_STOP=1.
\set QUIET on
set client_min_messages = warning;

-- Χρήστες
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','nikos@sokfm.gr'),
 ('00000000-0000-0000-0000-000000000002','i.drakidou@sokfm.gr'),
 ('00000000-0000-0000-0000-000000000003','stamoulakis@sokfm.gr'),
 ('00000000-0000-0000-0000-000000000004','m.boutsika@sokfm.gr'),
 ('00000000-0000-0000-0000-000000000005','vasiliki@sokfm.gr');
insert into profiles (id, full_name, email, role, sees_digital) values
 ('00000000-0000-0000-0000-000000000001','Νίκος','nikos@sokfm.gr','ceo',false),
 ('00000000-0000-0000-0000-000000000002','Γιάννα Δρακίδου','i.drakidou@sokfm.gr','sales_manager',false),
 ('00000000-0000-0000-0000-000000000003','Κώστας Σταμουλάκης','stamoulakis@sokfm.gr','account_exec',false),
 ('00000000-0000-0000-0000-000000000004','Μαρία Μπούτσικα','m.boutsika@sokfm.gr','account_exec',true),
 ('00000000-0000-0000-0000-000000000005','Βασιλική Τσάλλα','vasiliki@sokfm.gr','digital_intake',false);

insert into customers (id, display_name, owner_id, status, phone) values
 ('10000000-0000-0000-0000-000000000001','ΠΑΛΟΚΑ','00000000-0000-0000-0000-000000000003','active','2221000001'),
 ('10000000-0000-0000-0000-000000000002','ΤΗΝΙΑΚΟΣ','00000000-0000-0000-0000-000000000004','active',null),
 ('10000000-0000-0000-0000-000000000003','RAVENNA',null,'base',null);

create or replace function as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || n, false);
  execute 'set role authenticated';
end $$;
grant execute on function as_user(int) to authenticated;

-- 1. Ο Κώστας βλέπει τον δικό του και τη βάση, όχι της Μαρίας
select as_user(3);
do $$ begin
  assert (select count(*) from customers) = 2, 'Κώστας: λάθος ορατοί πελάτες';
  assert not exists (select 1 from customers where display_name = 'ΤΗΝΙΑΚΟΣ'), 'Κώστας βλέπει πελάτη της Μαρίας';
end $$;

-- 2. Lead χωρίς επόμενο βήμα απορρίπτεται
do $$ begin
  begin
    insert into leads (company_name, source) values ('Χωρίς βήμα', 'phone');
    raise exception 'έπρεπε να απορριφθεί';
  exception when check_violation then null;
  end;
end $$;

-- 3. Lead από τηλέφωνο: χωρίς υπεύθυνο + ειδοποίηση στον Νίκο
insert into leads (id, company_name, source, next_step, next_step_due)
values ('20000000-0000-0000-0000-000000000001','Viomprel','phone','Κλήση','2026-11-20');
-- lead που βρήκε μόνος του: μένει δικό του
insert into leads (id, company_name, source, next_step, next_step_due)
values ('20000000-0000-0000-0000-000000000002','Νέο καφέ','seller','Ραντεβού','2026-11-21');
reset role;
do $$ begin
  assert (select owner_id from leads where company_name='Viomprel') is null, 'lead τηλεφώνου πήρε υπεύθυνο';
  assert (select owner_id from leads where company_name='Νέο καφέ') = '00000000-0000-0000-0000-000000000003', 'lead πωλητή δεν έμεινε σε αυτόν';
  assert exists (select 1 from notifications where kind='lead_to_assign' and user_id='00000000-0000-0000-0000-000000000001'), 'καμία ειδοποίηση στον Νίκο';
end $$;

-- 4. Ο Κώστας δεν αλλάζει υπεύθυνο
select as_user(3);
do $$ begin
  begin
    update leads set owner_id='00000000-0000-0000-0000-000000000004' where company_name='Νέο καφέ';
    raise exception 'έπρεπε να απορριφθεί';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5. Σύγκρουση: αποθήκευση με παλιό version δεν περνάει
do $$ declare n int; begin
  update leads set next_step='Κλήση ξανά' where company_name='Νέο καφέ' and version=1;
  get diagnostics n = row_count; assert n = 1, 'πρώτη αποθήκευση απέτυχε';
  update leads set next_step='Παλιά οθόνη' where company_name='Νέο καφέ' and version=1;
  get diagnostics n = row_count; assert n = 0, 'η αποθήκευση με παλιό version πέρασε';
end $$;

-- 6. Βασιλική: digital lead πάει στη Μαρία· δεν βλέπει ραδιόφωνο ούτε πελάτες
select as_user(5);
insert into leads (company_name, source, product_line, next_step, next_step_due)
values ('Γυμναστήριο social','phone','digital','Κλήση Μαρίας','2026-11-20');
do $$ begin
  assert (select count(*) from customers) = 0, 'Βασιλική βλέπει πελάτες';
  assert not exists (select 1 from leads where product_line='radio'), 'Βασιλική βλέπει radio leads';
  begin
    insert into leads (company_name, source, product_line, next_step, next_step_due)
    values ('Radio lead','phone','radio','x','2026-11-20');
    raise exception 'έπρεπε να απορριφθεί';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select owner_id from leads where company_name='Γυμναστήριο social') = '00000000-0000-0000-0000-000000000004', 'digital lead δεν πήγε στη Μαρία';
end $$;

-- 7. Βάση πελατών: αίτημα Κώστα → μόνο ο Νίκος εγκρίνει
select as_user(3);
insert into base_claims (customer_id) values ('10000000-0000-0000-0000-000000000003');
reset role;
select as_user(2);
do $$ begin
  begin
    update base_claims set status='approved' where customer_id='10000000-0000-0000-0000-000000000003';
    raise exception 'έπρεπε να απορριφθεί';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select as_user(1);
update base_claims set status='approved' where customer_id='10000000-0000-0000-0000-000000000003';
reset role;
do $$ begin
  assert (select owner_id from customers where display_name='RAVENNA') = '00000000-0000-0000-0000-000000000003', 'η έγκριση δεν έδωσε τον πελάτη';
  assert (select contact_deadline::date - decided_at::date from base_claims where status='approved') = 10, 'λάθος προθεσμία';
end $$;

-- 8. Χωρίς επαφή σε 10 μέρες → πίσω στη βάση (μια σημείωση δεν μετράει)
select as_user(3);
insert into activities (customer_id, type, summary) values ('10000000-0000-0000-0000-000000000003','note','θα τον πάρω');
reset role;
update base_claims set contact_deadline = now() - interval '1 day';
do $$ begin
  assert return_stale_claims() = 1, 'δεν επέστρεψε';
  assert (select status from customers where display_name='RAVENNA') = 'base', 'ο πελάτης δεν γύρισε στη βάση';
end $$;

-- 9. Ιστορικό αλλαγών: γράφεται, και το βλέπουν μόνο Νίκος/Γιάννα
do $$ begin assert (select count(*) from audit_log) > 0, 'κενό audit'; end $$;
select as_user(3);
do $$ begin assert (select count(*) from audit_log) = 0, 'ο Κώστας βλέπει audit'; end $$;

-- 10. Διπλοεγγραφή: δείχνει μόνο σε ποιον ανήκει
do $$ begin
  assert (select owner_name from find_duplicate('Τηνιακός') limit 1) = 'Μαρία Μπούτσικα', 'δεν βρήκε διπλό';
end $$;
reset role;

select 'ALL TESTS PASSED' as result;
