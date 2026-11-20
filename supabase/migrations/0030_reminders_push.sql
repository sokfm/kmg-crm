-- Απόφαση Νίκου 20/11/2026: υπενθυμίσεις στο κινητό (push) και μέσα στο CRM.
-- Δεν φτιάχνεται τρίτη λίστα: υπενθύμιση = επόμενο βήμα lead (αυτόματη) ή εργασία (χειροκίνητη). Προαιρετική ώρα.
alter table tasks add column due_time time;
alter table leads add column next_step_time time;

-- Συσκευές που δέχονται ειδοποιήσεις. Γράφονται μόνο από τον server.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);
create index on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy push_own_read on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_delete on push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Κλειδιά του συστήματος (π.χ. ζεύγος κλειδιών ειδοποιήσεων). Καμία πρόσβαση από την εφαρμογή, μόνο ο server.
create table app_secrets (key text primary key, value text not null, created_at timestamptz not null default now());
alter table app_secrets enable row level security;
revoke all on app_secrets from authenticated, anon;

alter table notifications add column pushed_at timestamptz;
update notifications set pushed_at = now();   -- οι παλιές δεν στέλνονται στο κινητό

-- Τι έχει ήδη υπενθυμιστεί (ώστε να μη στέλνεται δεύτερη φορά). Ξεχωριστός πίνακας: δεν αγγίζει leads/εργασίες,
-- άρα δεν ανεβάζει το version τους και δεν προκαλεί ψεύτικες «συγκρούσεις».
create table reminder_log (
  kind text not null, ref_id uuid not null, due_at timestamp not null, created_at timestamptz not null default now(),
  primary key (kind, ref_id, due_at)
);
alter table reminder_log enable row level security;
revoke all on reminder_log from authenticated, anon;

-- Τρέχει κάθε 5 λεπτά από τον server. Ώρα Ελλάδας.
create or replace function make_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; k integer;
  now_l timestamp := now() at time zone 'Europe/Athens';
  d date := (now() at time zone 'Europe/Athens')::date;
begin
  -- 1. Εργασίες με ώρα: 10 λεπτά πριν
  with due as (
    select t.id, t.owner_id, (t.due_date + t.due_time) as due_at, t.title, t.due_time, t.lead_id, t.customer_id,
           coalesce(l.company_name, c.display_name) as who
    from tasks t left join leads l on l.id = t.lead_id left join customers c on c.id = t.customer_id
    where t.status = 'open' and t.due_date is not null and t.due_time is not null
      and (t.due_date + t.due_time) between now_l - interval '3 hours' and now_l + interval '10 minutes'
  ), ins as (
    insert into reminder_log (kind, ref_id, due_at) select 'task', id, due_at from due on conflict do nothing returning ref_id
  )
  insert into notifications (user_id, kind, title, link)
  select due.owner_id, 'reminder', '⏰ ' || to_char(due.due_time, 'HH24:MI') || ' ' || due.title || coalesce(' · ' || due.who, ''),
         case when due.lead_id is not null then '/leads/' || due.lead_id when due.customer_id is not null then '/customers/' || due.customer_id else '/tasks' end
  from due join ins on ins.ref_id = due.id;
  get diagnostics k = row_count; n := n + k;

  -- 2. Επόμενο βήμα lead με ώρα: 10 λεπτά πριν
  with due as (
    select l.id, l.owner_id, (l.next_step_due + l.next_step_time) as due_at, l.next_step, l.next_step_time, l.company_name
    from leads l
    where l.status not in ('won', 'lost') and l.owner_id is not null and l.next_step_due is not null and l.next_step_time is not null
      and (l.next_step_due + l.next_step_time) between now_l - interval '3 hours' and now_l + interval '10 minutes'
  ), ins as (
    insert into reminder_log (kind, ref_id, due_at) select 'lead', id, due_at from due on conflict do nothing returning ref_id
  )
  insert into notifications (user_id, kind, title, link)
  select due.owner_id, 'reminder', '⏰ ' || to_char(due.next_step_time, 'HH24:MI') || ' ' || due.company_name || ': ' || due.next_step, '/leads/' || due.id
  from due join ins on ins.ref_id = due.id;
  get diagnostics k = row_count; n := n + k;

  -- 3. Πρωινή σύνοψη 09:00 (Δευτέρα–Σάββατο): τι έχει ο καθένας σήμερα και τι έχει μείνει πίσω
  if now_l::time >= time '09:00' and now_l::time < time '13:00' and extract(dow from now_l) <> 0 then
    with mine as (
      select p.id,
        (select count(*) from leads l where l.owner_id = p.id and l.status not in ('won', 'lost') and l.next_step_due = d) as steps,
        (select count(*) from tasks t where t.owner_id = p.id and t.status = 'open' and t.due_date = d) as todo,
        (select count(*) from leads l where l.owner_id = p.id and l.status not in ('won', 'lost') and l.next_step_due < d)
          + (select count(*) from tasks t where t.owner_id = p.id and t.status = 'open' and t.due_date < d) as late
      from profiles p where p.active
    ), ins as (
      insert into reminder_log (kind, ref_id, due_at) select 'daily', id, d::timestamp from mine where steps + todo + late > 0
      on conflict do nothing returning ref_id
    )
    insert into notifications (user_id, kind, title, link)
    select m.id, 'daily', 'Σήμερα: ' || concat_ws(' · ',
             case when m.steps = 1 then '1 επόμενο βήμα' when m.steps > 1 then m.steps || ' επόμενα βήματα' end,
             case when m.todo = 1 then '1 εργασία' when m.todo > 1 then m.todo || ' εργασίες' end,
             case when m.late = 1 then '1 καθυστερημένο' when m.late > 1 then m.late || ' καθυστερημένα' end), '/today'
    from mine m join ins on ins.ref_id = m.id;
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;
revoke execute on function make_reminders() from public, authenticated, anon;
grant execute on function make_reminders() to service_role;

select 'REMINDERS OK' as result;
