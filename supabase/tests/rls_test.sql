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

-- 11. Email: ο Κώστας δεν βλέπει τα email του Νίκου ούτε το κλειδί Outlook
insert into mail_accounts (user_id, ms_email, refresh_token) values ('00000000-0000-0000-0000-000000000001','nikos@sokfm.gr','SECRET');
insert into email_messages (user_id, graph_id, direction, counterpart_email, subject, occurred_at, status)
values ('00000000-0000-0000-0000-000000000001','g1','in','a@b.gr','Τιμές διαφήμισης',now(),'review');
select as_user(3);
do $$ begin
  assert (select count(*) from email_messages) = 0, 'ο Κώστας βλέπει email του Νίκου';
  assert (select count(*) from my_mail_account) = 0, 'ο Κώστας βλέπει σύνδεση Outlook του Νίκου';
  begin
    perform refresh_token from mail_accounts;
    raise exception 'ο Κώστας διάβασε το κλειδί Outlook';
  exception when insufficient_privilege then null;
  end;
end $$;
select as_user(1);
do $$ begin
  assert (select count(*) from email_messages) = 1, 'ο Νίκος δεν βλέπει τα email του';
  assert (select count(*) from my_mail_account) = 1, 'ο Νίκος δεν βλέπει τη σύνδεσή του';
  begin
    perform refresh_token from mail_accounts;
    raise exception 'ο Νίκος διάβασε το κλειδί Outlook από την εφαρμογή';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 12. Εργασίες: ο Νίκος αναθέτει στον Κώστα → ειδοποίηση· ο Κώστας βλέπει μόνο τις δικές του
insert into tasks (title, owner_id, due_date) values ('Πρόταση στον ΠΑΛΟΚΑ','00000000-0000-0000-0000-000000000003','2026-11-25');
insert into tasks (title, owner_id) values ('Δική μου εργασία','00000000-0000-0000-0000-000000000001');
select as_user(3);
do $$ begin
  assert (select count(*) from tasks) = 1, 'ο Κώστας βλέπει λάθος εργασίες';
  assert exists (select 1 from notifications where kind='task_assigned'), 'καμία ειδοποίηση εργασίας';
  begin
    insert into tasks (title, owner_id) values ('Για τη Μαρία','00000000-0000-0000-0000-000000000004');
    raise exception 'ο Κώστας ανέθεσε σε άλλον';
  exception when insufficient_privilege then null;
  end;
end $$;
update tasks set status = 'done';
reset role;
do $$ begin
  assert (select done_at from tasks where title='Πρόταση στον ΠΑΛΟΚΑ') is not null, 'δεν μπήκε ώρα ολοκλήρωσης';
end $$;

-- 13. Πρακτορεία: η επικοινωνία πάει στην καρτέλα του πρακτορείου, την βλέπουν admin + ο καταγράφων
reset role;
insert into agencies (id, name, domains) values ('30000000-0000-0000-0000-000000000001','TEST AGENCY','{@test-agency.gr}');
select as_user(1);
insert into activities (agency_id, type, summary) values ('30000000-0000-0000-0000-000000000001','email','📥 Πρόγραμμα σποτ');
select as_user(3);
do $$ begin
  assert (select count(*) from activities where agency_id is not null) = 0, 'πωλητής βλέπει επικοινωνία πρακτορείου άλλου';
  assert (select count(*) from agencies where name='TEST AGENCY') = 1, 'πωλητής δεν βλέπει τα ονόματα πρακτορείων';
end $$;
do $$ begin
  begin
    update agencies set domains = '{@x.gr}' where name='TEST AGENCY';
    assert not found, 'πωλητής άλλαξε πρακτορείο';
  end;
end $$;
select as_user(2);
do $$ begin
  assert (select count(*) from activities where agency_id is not null) = 1, 'η Γιάννα δεν βλέπει επικοινωνία πρακτορείου';
  assert agency_canonical('Frank and Fame ΑΕ') = 'FRANK & FAME' and agency_canonical('NAN') is null, 'λάθος ενιαίο όνομα πρακτορείου';
end $$;
reset role;

-- 14. Μερική ένωση: τα ατσέκαρα (2+) μένουν στη λίστα, το όνομα έρχεται από τα τσεκαρισμένα
reset role;
insert into customers (id, display_name, lifetime_revenue) values
 ('40000000-0000-0000-0000-000000000001','ΚΤΗΜΑ ΑΛΦΑ',900),
 ('40000000-0000-0000-0000-000000000002','ΚΤΗΜΑ ΒΗΤΑ',500),
 ('40000000-0000-0000-0000-000000000003','ΚΤΗΜΑ ΒΗΤΑ ΧΟΡΗΓΙΑ',100),
 ('40000000-0000-0000-0000-000000000004','ΚΤΗΜΑ ΓΑΜΜΑ',50);
insert into customer_aliases (source_customer_id, customer_id, source_name) values
 ('T14A','40000000-0000-0000-0000-000000000001','Α'),('T14B','40000000-0000-0000-0000-000000000002','Β'),
 ('T14C','40000000-0000-0000-0000-000000000003','Γ'),('T14D','40000000-0000-0000-0000-000000000004','Δ');
insert into merge_candidates (id, group_key, source_customer_ids, names) values
 ('40000000-0000-0000-0000-0000000000aa','t14','{T14A,T14B,T14C,T14D}','{x}');
select as_user(1);
select merge_selected('40000000-0000-0000-0000-0000000000aa',
  array['40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003']::uuid[], null);
do $$ begin
  assert (select display_name from customers where id='40000000-0000-0000-0000-000000000002') = 'ΚΤΗΜΑ ΒΗΤΑ', 'λάθος όνομα μετά την ένωση';
  assert (select decision from merge_candidates where group_key='t14') = 'pending', 'η ομάδα έκλεισε ενώ έμειναν 2 ατσέκαρα';
  assert (select source_customer_ids from merge_candidates where group_key='t14') @> '{T14A,T14D}'
     and not (select source_customer_ids from merge_candidates where group_key='t14') && '{T14B,T14C}', 'λάθος ονόματα που έμειναν';
end $$;
select merge_selected('40000000-0000-0000-0000-0000000000aa', '{}'::uuid[], null);
do $$ begin
  assert (select decision from merge_candidates where group_key='t14') = 'different', 'δεν έκλεισε ως διαφορετικοί';
end $$;
select rename_customer('40000000-0000-0000-0000-000000000002','κτημα μπουρελη',
  (select version from customers where id='40000000-0000-0000-0000-000000000002'));
do $$ begin
  assert (select display_name from customers where id='40000000-0000-0000-0000-000000000002') = 'ΚΤΗΜΑ ΜΠΟΥΡΕΛΗ', 'δεν έγινε μετονομασία';
end $$;
select as_user(3);
do $$ begin
  begin
    perform rename_customer('40000000-0000-0000-0000-000000000002','Χ',99);
    assert false, 'πωλητής μετονόμασε πελάτη';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 15. Dashboard τζίρου: μόνο ceo / sales manager
select as_user(3);
do $$ begin
  assert (select count(*) from revenue_monthly) = 0 and (select count(*) from revenue_yearly) = 0, 'πωλητής βλέπει τζίρο dashboard';
end $$;
reset role;

-- 16. Ένωση με το χέρι: μεταφέρονται email επαφών, εργασίες, κατάσταση, όνομα
reset role;
insert into customers (id, display_name, lifetime_revenue, status, owner_id) values
 ('60000000-0000-0000-0000-000000000001','ΦΟΥΡΝΟΣ ΠΑΠΑΣ',300,'base',null),
 ('60000000-0000-0000-0000-000000000002','ΑΡΤΟΠΟΙΕΙΟ ΠΑΠΑ',100,'active','00000000-0000-0000-0000-000000000003');
insert into contacts (email, customer_id) values ('info@papas.gr','60000000-0000-0000-0000-000000000002');
insert into tasks (title, owner_id, customer_id) values ('Κλήση Παπά','00000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000002');
select as_user(4);
insert into base_claims (customer_id) values ('60000000-0000-0000-0000-000000000001');
select as_user(3);
do $$ begin
  begin
    perform merge_customers_manual(array['60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002']::uuid[]);
    assert false, 'πωλητής ένωσε πελάτες';
  exception when insufficient_privilege then null;
  end;
end $$;
select as_user(1);
select merge_customers_manual(array['60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002']::uuid[],
  '60000000-0000-0000-0000-000000000002', null);
reset role;
do $$ begin
  assert (select count(*) from customers where id::text like '60000000%') = 1, 'δεν ενώθηκαν';
  assert (select display_name from customers where id='60000000-0000-0000-0000-000000000001') = 'ΑΡΤΟΠΟΙΕΙΟ ΠΑΠΑ', 'λάθος όνομα';
  assert (select status from customers where id='60000000-0000-0000-0000-000000000001') = 'active', 'δεν έμεινε ενεργός';
  assert (select owner_id from customers where id='60000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-000000000003', 'χάθηκε ο υπεύθυνος';
  assert (select customer_id from contacts where email='info@papas.gr') = '60000000-0000-0000-0000-000000000001', 'χάθηκε η διεύθυνση email';
  assert (select customer_id from tasks where title='Κλήση Παπά') = '60000000-0000-0000-0000-000000000001', 'χάθηκε η εργασία';
end $$;

-- 17. Παλιοί πελάτες (12+ μήνες χωρίς καμπάνια) επιστρέφουν στη βάση· όσοι έχουν ανοιχτό lead μένουν
reset role;
insert into customers (id, display_name, owner_id, status, last_period, served_by) values
 ('70000000-0000-0000-0000-000000000001','ΠΑΛΙΟΣ ΠΕΛΑΤΗΣ','00000000-0000-0000-0000-000000000003','active','2020-03','Κώστας Σταμουλάκης'),
 ('70000000-0000-0000-0000-000000000002','ΠΑΛΙΟΣ ΜΕ LEAD','00000000-0000-0000-0000-000000000003','active','2020-03',null),
 ('70000000-0000-0000-0000-000000000003','ΠΡΟΣΦΑΤΟΣ','00000000-0000-0000-0000-000000000003','active',to_char(now() - interval '2 months','YYYY-MM'),null);
insert into leads (company_name, owner_id, customer_id, next_step, next_step_due) values
 ('ΠΑΛΙΟΣ ΜΕ LEAD','00000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000002','Κλήση', current_date);
select release_stale_owners();
do $$ begin
  assert (select owner_id from customers where id='70000000-0000-0000-0000-000000000001') is null, 'ο παλιός πελάτης δεν επέστρεψε στη βάση';
  assert (select served_by from customers where id='70000000-0000-0000-0000-000000000001') = 'Κώστας Σταμουλάκης', 'χάθηκε ποιος τον εξυπηρετούσε';
  assert (select owner_id from customers where id='70000000-0000-0000-0000-000000000002') is not null, 'πελάτης με ανοιχτό lead έφυγε από τον AE';
  assert (select owner_id from customers where id='70000000-0000-0000-0000-000000000003') is not null, 'πρόσφατος πελάτης έφυγε από τον AE';
end $$;

-- 18. Πρόσωπα: όνομα/θέση χωρίς email, επεξεργασία, διαγραφή· πωλητής δεν πειράζει πρόσωπα πελάτη άλλου
reset role;
insert into customers (id, display_name, owner_id, status) values ('80000000-0000-0000-0000-000000000001','ΤΕΣΤ ΠΡΟΣΩΠΑ','00000000-0000-0000-0000-000000000001','active');
select as_user(1);
insert into contacts (customer_id, name, title, roles, mobile) values ('80000000-0000-0000-0000-000000000001','Γιώργος','Ιδιοκτήτης','{owner,decision}','6900000000');
insert into contacts (customer_id, name, title, email, roles) values ('80000000-0000-0000-0000-000000000001','Λογιστήριο','Λογιστήριο','acc@test.gr','{billing}');
update contacts set title = 'Ιδιοκτήτης & CEO' where name = 'Γιώργος';
select as_user(3);
do $$ begin
  assert (select count(*) from contacts where customer_id = '80000000-0000-0000-0000-000000000001') = 0, 'πωλητής βλέπει πρόσωπα πελάτη άλλου';
end $$;
select as_user(1);
delete from contacts where name = 'Λογιστήριο';
do $$ begin
  assert (select count(*) from contacts where customer_id = '80000000-0000-0000-0000-000000000001') = 1, 'δεν διαγράφηκε το πρόσωπο';
  assert (select version from contacts where name = 'Γιώργος') = 2, 'δεν ανέβηκε η έκδοση';
end $$;
reset role;

-- 19. Groups: brands κάτω από Group, ένα επίπεδο, μόνο admin
reset role;
insert into customers (id, display_name, lifetime_revenue) values
 ('90000000-0000-0000-0000-000000000001','SMART MARKET',1000),('90000000-0000-0000-0000-000000000002','KGREEN',500);
select as_user(3);
do $$ begin
  begin perform set_group(array['90000000-0000-0000-0000-000000000001']::uuid[], null, 'X'); assert false, 'πωλητής έφτιαξε Group';
  exception when insufficient_privilege then null; end;
end $$;
select as_user(1);
select set_group(array['90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002']::uuid[], null, 'κριματογλου');
reset role;
do $$ declare g uuid; begin
  select id into g from customers where display_name = 'ΚΡΙΜΑΤΟΓΛΟΥ' and is_group;
  assert g is not null, 'δεν φτιάχτηκε Group';
  assert (select count(*) from customers where parent_id = g) = 2, 'τα brands δεν μπήκαν στο Group';
  begin update customers set parent_id = '90000000-0000-0000-0000-000000000001' where id = '90000000-0000-0000-0000-000000000002';
    assert false, 'brand μπήκε κάτω από brand';
  exception when raise_exception then null; end;
end $$;

-- 20. Τιμοκατάλογος: όλοι βλέπουν, μόνο admin αλλάζει
select as_user(3);
do $$ begin
  assert (select count(*) from price_packages) >= 12, 'πωλητής δεν βλέπει τα πακέτα';
end $$;
update price_packages set price = 1 where name = 'Πακέτο 6';
do $$ begin
  assert (select price from price_packages where name = 'Πακέτο 6') = 700, 'πωλητής άλλαξε τιμή';
end $$;
select as_user(1);
update price_packages set price = 710 where name = 'Πακέτο 6';
do $$ begin
  assert (select price from price_packages where name = 'Πακέτο 6') = 710, 'admin δεν άλλαξε τιμή';
  assert (select version from price_packages where name = 'Πακέτο 6') = 2, 'δεν ανέβηκε η έκδοση';
end $$;
reset role;

-- 21. Τιμές ανά δευτερόλεπτο: όλοι βλέπουν, μόνο admin αλλάζει
select as_user(3);
update station_rates set media_shop_sec = 0.01 where station = 'ΣΟΚ FM';
do $$ begin
  assert (select media_shop_sec from station_rates where station = 'ΣΟΚ FM') = 0.35, 'πωλητής άλλαξε τιμή σταθμού';
end $$;
select as_user(1);
update station_rates set media_shop_sec = 0.36 where station = 'ΣΟΚ FM';
do $$ begin
  assert (select media_shop_sec from station_rates where station = 'ΣΟΚ FM') = 0.36, 'admin δεν άλλαξε τιμή σταθμού';
end $$;
reset role;

-- 22. Ακροατές ανά μισάωρο: 37 μισάωρα ανά σταθμό, όλοι βλέπουν, μόνο admin αλλάζει
select as_user(3);
update station_slots set listeners_k = 99 where station = 'ΣΟΚ FM' and slot = '08:30';
do $$ begin
  assert (select count(*) from station_slots where station = 'ΣΟΚ FM') = 37, 'λείπουν μισάωρα';
  assert (select listeners_k from station_slots where station = 'ΣΟΚ FM' and slot = '08:30') = 12, 'πωλητής άλλαξε ακροατές';
  -- Έλεγχος με το Excel: 6 σποτ/ημέρα στα μισάωρα του πλάνου ΣΟΚ, 30 μέρες, τοπική τιμή = 783 €
  assert (select round(sum(listeners_k) * 0.015 * 30 * 30, 2) from station_slots
          where station = 'ΣΟΚ FM' and slot in ('08:30','10:30','12:30','14:30','16:30','18:30')) = 783, 'η κοστολόγηση δεν βγάζει 783 €';
end $$;
reset role;

-- 23. Οι δικές μας διευθύνσεις δεν γίνονται στοιχεία πελάτη
reset role;
insert into customers (id, display_name, email) values ('a0000000-0000-0000-0000-000000000001','ΤΕΣΤ ΦΟΡΜΑ','Info@KarteliasMediaGroup.gr');
insert into contacts (customer_id, name, email) values ('a0000000-0000-0000-0000-000000000001','Κάποιος','x@sokfm.gr');
insert into contacts (customer_id, name, email) values ('a0000000-0000-0000-0000-000000000001','Πελάτης','niki@gmail.com');
do $$ begin
  assert (select email from customers where id = 'a0000000-0000-0000-0000-000000000001') is null, 'δικό μας email έμεινε σε πελάτη';
  assert (select email from contacts where name = 'Κάποιος') is null, 'δικό μας email έμεινε σε πρόσωπο';
  assert (select email from contacts where name = 'Πελάτης') = 'niki@gmail.com', 'χάθηκε email πελάτη';
  assert not is_own_email('info@notsokfm.gr'), 'ξένο domain θεωρήθηκε δικό μας';
end $$;

-- 24. Πρόταση: τη βλέπει όποιος βλέπει το lead· ακροατές αλλάζει μόνο admin
reset role;
insert into leads (id, company_name, owner_id, next_step, next_step_due) values ('b0000000-0000-0000-0000-000000000001','ΤΕΣΤ ΠΡΟΤΑΣΗ','00000000-0000-0000-0000-000000000003','x', current_date + 1);
select as_user(3);
insert into proposals (id, lead_id, client_type) values ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','local');
insert into proposal_items (proposal_id, station, kind, title, monthly_amount, months) values ('b1000000-0000-0000-0000-000000000001','DALKAS','package','Πακέτο 6+1',400,3);
do $$ begin
  assert (select count(*) from proposal_items) = 1, 'ο πωλητής δεν βλέπει την πρότασή του';
  begin perform set_station_slots('ΣΟΚ FM', '{"08:30": 50}'::jsonb); assert false, 'πωλητής άλλαξε ακροατές';
  exception when insufficient_privilege then null; end;
end $$;
select as_user(4);
do $$ begin
  assert (select count(*) from proposals where lead_id = 'b0000000-0000-0000-0000-000000000001') = 0, 'άλλος πωλητής βλέπει ξένη πρόταση';
end $$;
select as_user(1);
select set_station_slots('ΣΟΚ FM', '{"08:30": {"l": 0.2, "d": 0.4}}'::jsonb);
do $$ begin
  assert (select local_sec from station_slots where station = 'ΣΟΚ FM' and slot = '08:30') = 0.2, 'ο Νίκος δεν άλλαξε τιμή break';
end $$;
reset role;

-- 25. Τιμές break μόνο ο Νίκος (ούτε η Γιάννα)· πολλές προτάσεις, η κύρια γράφει την αξία του lead
select as_user(2);
do $$ begin
  begin perform set_station_slots('ΣΟΚ FM', '{"10:30": {"l": 9}}'::jsonb); assert false, 'η Γιάννα άλλαξε τιμή break';
  exception when insufficient_privilege then null; end;
end $$;
update station_rates set media_shop_sec = 9 where station = 'DALKAS';
update price_packages set price = 720 where name = 'Πακέτο 6';
reset role;
do $$ begin
  assert (select media_shop_sec from station_rates where station = 'DALKAS') = 0.25, 'η Γιάννα άλλαξε τιμή ανά δευτερόλεπτο';
  assert (select price from price_packages where name = 'Πακέτο 6') = 720, 'η Γιάννα δεν άλλαξε τιμή πακέτου';
  assert (select expected_value from leads where id = 'b0000000-0000-0000-0000-000000000001') = 1200, 'η κύρια πρόταση δεν έγραψε την αξία (400 x 3)';
end $$;
select as_user(3);
insert into proposals (id, lead_id, client_type, title) values ('b1000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','local','Ανανέωση');
insert into proposal_items (proposal_id, station, kind, title, monthly_amount, long_months, long_amount, months) values ('b1000000-0000-0000-0000-000000000002','DALKAS','package','Πακέτο 6+1',400,3,350,3);
reset role;
do $$ begin
  assert (select expected_value from leads where id = 'b0000000-0000-0000-0000-000000000001') = 1200, 'δεύτερη πρόταση άλλαξε την αξία χωρίς να είναι κύρια';
end $$;
select as_user(3);
select set_main_proposal('b1000000-0000-0000-0000-000000000002');
reset role;
do $$ begin
  assert (select expected_value from leads where id = 'b0000000-0000-0000-0000-000000000001') = 1050, 'η νέα κύρια δεν έγραψε την αξία με bonus (350 x 3)';
  assert (select count(*) from proposals where lead_id = 'b0000000-0000-0000-0000-000000000001' and is_main) = 1, 'πάνω από μία κύρια';
end $$;

-- 26. Radio + Digital: ο υπεύθυνος digital παίρνει ειδοποίηση και εργασία, και βλέπει το lead
select as_user(1);
insert into leads (id, company_name, owner_id, next_step, next_step_due) values ('c0000000-0000-0000-0000-000000000001','ΤΕΣΤ DIGITAL','00000000-0000-0000-0000-000000000003','x', current_date + 1);
select as_user(3);
update leads set interests = '{radio,digital}' where id = 'c0000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
  assert (select count(*) from notifications where kind = 'lead_wants_digital' and link = '/leads/c0000000-0000-0000-0000-000000000001') = 1, 'δεν έφυγε ειδοποίηση digital';
  assert (select count(*) from tasks where lead_id = 'c0000000-0000-0000-0000-000000000001' and owner_id = '00000000-0000-0000-0000-000000000004') = 1, 'δεν φτιάχτηκε εργασία digital';
end $$;
select as_user(4);
do $$ begin
  assert (select count(*) from leads where id = 'c0000000-0000-0000-0000-000000000001') = 1, 'η υπεύθυνη digital δεν βλέπει το lead';
end $$;
reset role;

-- 27. Εκπτώσεις: 8% combo + 10% προπληρωμή by the book· ειδική τιμή μόνο με έγκριση admin
select as_user(1);
insert into leads (id, company_name, owner_id, next_step, next_step_due) values ('d0000000-0000-0000-0000-000000000001','ΤΕΣΤ ΕΚΠΤΩΣΗ','00000000-0000-0000-0000-000000000003','x', current_date + 1);
select as_user(3);
insert into proposals (id, lead_id, client_type) values ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','local');
insert into proposal_items (proposal_id, station, kind, title, monthly_amount, months) values
 ('d1000000-0000-0000-0000-000000000001','ΣΟΚ FM','plan','Πλάνο',1000,1),('d1000000-0000-0000-0000-000000000001','DALKAS','package','Πακέτο',400,1);
do $$ begin
  assert (select book_total from proposal_totals where proposal_id = 'd1000000-0000-0000-0000-000000000001') = 1288, 'combo 8%: 1400 -> 1288';
end $$;
update proposals set prepay = true where id = 'd1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select book_total from proposal_totals where proposal_id = 'd1000000-0000-0000-0000-000000000001') = 1159.20, 'combo + προπληρωμή: 1159,20';
  begin update proposals set req_status = 'approved', req_amount = 500 where id = 'd1000000-0000-0000-0000-000000000001'; assert false, 'πωλητής ενέκρινε μόνος του';
  exception when insufficient_privilege then null; end;
  begin perform decide_discount('d1000000-0000-0000-0000-000000000001', true); assert false, 'πωλητής κάλεσε έγκριση';
  exception when insufficient_privilege then null; end;
  assert request_discount('d1000000-0000-0000-0000-000000000001', 1100, 'Ο πελάτης θέλει 1100 για να κλείσει') = 'pending', 'το αίτημα δεν μπήκε σε αναμονή';
end $$;
reset role;
do $$ begin
  assert (select expected_value from leads where id = 'd0000000-0000-0000-0000-000000000001') = 1159.20, 'αίτημα σε αναμονή άλλαξε την αξία';
  assert (select count(*) from notifications where kind = 'discount_request') = 2, 'δεν ειδοποιήθηκαν Νίκος και Γιάννα';
end $$;
select as_user(2);
select decide_discount('d1000000-0000-0000-0000-000000000001', true, 'οκ');
reset role;
do $$ begin
  assert (select final_total from proposal_totals where proposal_id = 'd1000000-0000-0000-0000-000000000001') = 1100, 'η εγκεκριμένη τιμή δεν ισχύει';
  assert (select expected_value from leads where id = 'd0000000-0000-0000-0000-000000000001') = 1100, 'η εγκεκριμένη τιμή δεν πήγε στο lead';
  assert (select count(*) from notifications where kind = 'discount_decided' and user_id = '00000000-0000-0000-0000-000000000003') = 1, 'ο πωλητής δεν ειδοποιήθηκε';
end $$;
select as_user(3);
update proposal_items set months = 2 where proposal_id = 'd1000000-0000-0000-0000-000000000001' and station = 'DALKAS';
reset role;
do $$ begin
  assert (select req_status from proposals where id = 'd1000000-0000-0000-0000-000000000001') is null, 'άλλαξε η πρόταση αλλά έμεινε η έγκριση';
  assert (select expected_value from leads where id = 'd0000000-0000-0000-0000-000000000001') = 1490.40, 'μετά την αλλαγή: 1800 x 0,92 x 0,9 = 1490,40';
end $$;

-- 28. Προσφορά: δεν εκδίδεται με αίτημα σε αναμονή· η αλλαγή κειμένου δεν ακυρώνει έγκριση
select as_user(3);
select request_discount('d1000000-0000-0000-0000-000000000001', 1400, 'τεστ');
do $$ begin
  begin insert into proposal_offers (proposal_id, lead_id, snapshot, final_total, valid_until) values ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','{}',1,current_date);
    assert false, 'βγήκε προσφορά με αίτημα σε αναμονή';
  exception when insufficient_privilege then null; end;
end $$;
select as_user(1);
select decide_discount('d1000000-0000-0000-0000-000000000001', true);
select as_user(3);
update proposal_items set offer_text = '100 FREE SPOT' where proposal_id = 'd1000000-0000-0000-0000-000000000001' and station = 'DALKAS';
insert into proposal_offers (proposal_id, lead_id, snapshot, final_total, valid_until) values ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','{}',1400,current_date + 15);
reset role;
do $$ begin
  assert (select req_status from proposals where id = 'd1000000-0000-0000-0000-000000000001') = 'approved', 'η αλλαγή κειμένου ακύρωσε την έγκριση';
  assert (select count(*) from proposal_offers) = 1, 'δεν αποθηκεύτηκε η προσφορά';
end $$;

-- 29. Κωδικός και κλείδωμα πρότασης
select as_user(3);
insert into proposals (id, lead_id, client_type, title) values ('e1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','local','Κλείδωμα');
insert into proposal_items (id, proposal_id, station, kind, title, monthly_amount, months) values ('e2000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','NRG','package','Πακέτο',350,1);
do $$ declare c text; begin
  select code into c from proposals where id = 'e1000000-0000-0000-0000-000000000001';
  assert c ~ '^KMG-[0-9]{4}-[0-9]{4}$', 'λάθος μορφή κωδικού: ' || coalesce(c, 'null');
  assert (select count(distinct code) from proposals) = (select count(*) from proposals), 'διπλός κωδικός';
  begin update proposals set sent_at = now() where id = 'e1000000-0000-0000-0000-000000000001'; assert false, 'κλείδωσε χωρίς έκδοση';
  exception when insufficient_privilege then null; end;
  perform lock_proposal('e1000000-0000-0000-0000-000000000001');
  begin update proposal_items set months = 5 where id = 'e2000000-0000-0000-0000-000000000001'; assert false, 'άλλαξε γραμμή κλειδωμένης';
  exception when insufficient_privilege then null; end;
  begin insert into proposal_items (proposal_id, station, kind, title, monthly_amount) values ('e1000000-0000-0000-0000-000000000001','ΣΟΚ FM','package','x',1); assert false, 'μπήκε γραμμή σε κλειδωμένη';
  exception when insufficient_privilege then null; end;
  begin update proposals set prepay = true where id = 'e1000000-0000-0000-0000-000000000001'; assert false, 'άλλαξε προπληρωμή σε κλειδωμένη';
  exception when insufficient_privilege then null; end;
  begin update proposals set sent_at = null where id = 'e1000000-0000-0000-0000-000000000001'; assert false, 'ξεκλείδωσε';
  exception when insufficient_privilege then null; end;
  update proposals set title = 'Κλείδωμα (σταλμένη)' where id = 'e1000000-0000-0000-0000-000000000001';
end $$;
select as_user(1);
do $$ begin
  begin update proposal_items set months = 5 where id = 'e2000000-0000-0000-0000-000000000001'; assert false, 'ο Νίκος άλλαξε κλειδωμένη';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 30. Υπενθυμίσεις: ανάθεση μόνο από Νίκο/Γιάννα, ειδοποίηση μία φορά, μόνο ο server τις παράγει
select as_user(3);
insert into tasks (id, title, due_date, due_time, owner_id) values ('f0000000-0000-0000-0000-000000000001', 'Να πάρω τον πελάτη',
  (now() at time zone 'Europe/Athens')::date, ((now() at time zone 'Europe/Athens') + interval '5 minutes')::time, '00000000-0000-0000-0000-000000000003');
do $$ begin
  begin insert into tasks (title, owner_id) values ('για άλλον', '00000000-0000-0000-0000-000000000004'); assert false, 'ο Κώστας ανέθεσε σε άλλον';
  exception when insufficient_privilege then null; end;
  begin perform make_reminders(); assert false, 'χρήστης έτρεξε τις υπενθυμίσεις';
  exception when insufficient_privilege then null; end;
  begin perform 1 from app_secrets; assert false, 'χρήστης διάβασε κλειδιά συστήματος';
  exception when insufficient_privilege then null; end;
end $$;
select as_user(2);
insert into tasks (title, owner_id) values ('από τη Γιάννα', '00000000-0000-0000-0000-000000000003');
reset role;
do $$ declare a int; b int; begin
  -- κοντά στα μεσάνυχτα η ώρα +5' πέφτει στην επόμενη μέρα· τότε απλώς δεν ελέγχεται η ώρα
  if (now() at time zone 'Europe/Athens')::time < time '23:50' then
    perform make_reminders();
    select count(*) into a from notifications where kind = 'reminder' and user_id = '00000000-0000-0000-0000-000000000003' and title like '⏰ %Να πάρω τον πελάτη%';
    assert a = 1, 'δεν βγήκε υπενθύμιση εργασίας: ' || a;
    perform make_reminders();
    select count(*) into b from notifications where kind = 'reminder' and user_id = '00000000-0000-0000-0000-000000000003';
    assert b = a, 'η υπενθύμιση βγήκε δεύτερη φορά';
  end if;
end $$;

-- 31. Έναρξη καμπάνιας σε κλειδωμένη πρόταση: αλλάζει, αλλά τίποτα άλλο
select as_user(3);
do $$ begin
  update proposal_items set start_date = date '2026-11-15' where id = 'e2000000-0000-0000-0000-000000000001';
  assert (select start_date from proposal_items where id = 'e2000000-0000-0000-0000-000000000001') = date '2026-11-15', 'δεν άλλαξε η έναρξη σε κλειδωμένη';
  begin update proposal_items set start_date = date '2026-12-01', months = 3 where id = 'e2000000-0000-0000-0000-000000000001'; assert false, 'άλλαξε διάρκεια μαζί με την έναρξη';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL TESTS PASSED' as result;
