-- Απόφαση Νίκου 20/11/2026: χαμένο lead που δεν το ξανατρέχει ο υπεύθυνός του γίνεται διαθέσιμο.
--  * Στις 90 ημέρες (reknock_on) ο υπεύθυνος παίρνει την εργασία «Ξαναχτύπα» (0037).
--  * Απαντάει: «Το ξανατρέχω» (ξανανοίγει) ή «Το αφήνω». Αν δεν απαντήσει σε 10 ημέρες, αφήνεται μόνο του.
--  * Αφημένο = μένει χαμένο, χωρίς υπεύθυνο, στη λίστα «Διαθέσιμα χαμένα» που βλέπουν όλοι οι Account Executives
--    (όνομα, τι «όχι», λόγος, πότε χάθηκε, ποιος το είχε· ΟΧΙ τηλέφωνα και ιστορικό).
--  * Όποιος το θέλει το ΖΗΤΑΕΙ· εγκρίνει ο Νίκος ή η Γιάννα. Με την έγκριση ξανανοίγει στο όνομά του.
--  * «Όχι ποτέ»: ούτε υπενθύμιση ούτε διαθέσιμο.
--  * Τα χαμένα που υπήρχαν ήδη: οι 90 ημέρες μετράνε από σήμερα.
alter table leads add column released_at timestamptz, add column released_from uuid references profiles (id);

create or replace function trg_lead_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  maria uuid;
begin
  -- Εισαγωγή δεδομένων από το σύστημα (χωρίς χρήστη): χωρίς κανόνες ανάθεσης
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Τα digital leads πάνε κατευθείαν στην υπεύθυνη digital
    if new.product_line = 'digital' and new.owner_id is null then
      select id into maria from profiles where sees_digital and role = 'account_exec' and active limit 1;
      new.owner_id := maria;
    end if;
    -- Οι πωλητές δεν αναθέτουν leads σε άλλους. Ένα lead που βρήκαν μόνοι τους
    -- μένει σε αυτούς· όλα τα άλλα περιμένουν ανάθεση από τον Νίκο.
    if not is_admin() and new.product_line = 'radio' then
      if new.source = 'seller' then
        new.owner_id := auth.uid();
      else
        new.owner_id := null;
      end if;
    end if;
    -- Νέο lead χωρίς υπεύθυνο → ειδοποίηση στον Νίκο για ανάθεση
    if new.owner_id is null then
      insert into notifications (user_id, kind, title, link)
      select id, 'lead_to_assign', 'Νέο lead για ανάθεση: ' || new.company_name, '/leads/' || new.id
      from profiles where role = 'ceo' and active;
    end if;
    return new;
  end if;

  -- UPDATE: αλλαγή υπευθύνου μόνο από Νίκο / Γιάννα
  -- Εξαίρεση: χαμένο lead που ο ίδιος ο Account Executive αφήνει στα «διαθέσιμα» (συνάρτηση release_lost_lead)
  if new.owner_id is distinct from old.owner_id and not is_admin()
     and not (coalesce(current_setting('kmg.release', true), '') = '1' and new.owner_id is null and new.status = 'lost') then
    raise exception 'Μόνο ο Νίκος ή η Γιάννα αλλάζουν υπεύθυνο lead' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id and new.owner_id is not null then
    insert into notifications (user_id, kind, title, link)
    values (new.owner_id, 'lead_assigned', 'Σου ανατέθηκε: ' || new.company_name, '/leads/' || new.id);
  end if;
  return new;
end $$;

create table lead_claims (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles (id),
  decided_at timestamptz
);
create unique index lead_claims_one_pending on lead_claims (lead_id, user_id) where status = 'pending';
alter table lead_claims enable row level security;
revoke all on lead_claims from authenticated, anon;
grant select on lead_claims to authenticated;
create policy lead_claims_read on lead_claims for select to authenticated using (user_id = auth.uid() or is_admin());

-- Εσωτερικό: αφήνει ένα χαμένο lead στα διαθέσιμα
create or replace function _release_lost(p_id uuid, p_how text) returns void
language plpgsql security definer set search_path = public as $$
declare r leads;
begin
  select * into r from leads where id = p_id for update;
  if r.id is null or r.status <> 'lost' or r.owner_id is null then return; end if;
  perform set_config('kmg.release', '1', true);
  update leads set released_from = owner_id, released_at = now(), owner_id = null where id = p_id;
  perform set_config('kmg.release', '', true);
  update tasks set status = 'done', done_at = now() where lead_id = p_id and source = 'reknock' and status = 'open';
  if p_how = 'auto' then
    insert into notifications (user_id, kind, title, link)
    values (r.owner_id, 'lead_released', 'Το χαμένο lead ' || r.company_name || ' πέρασε στα διαθέσιμα (δεν απαντήθηκε σε 10 ημέρες)', '/leads/pool');
  end if;
end $$;
revoke execute on function _release_lost(uuid, text) from public, authenticated, anon;

-- «Το αφήνω»: ο υπεύθυνος (ή η διαχείριση) αφήνει το χαμένο lead
create or replace function release_lost_lead(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r leads;
begin
  select * into r from leads where id = p_id;
  if r.id is null or not (is_admin() or r.owner_id = auth.uid()) then raise exception 'Το lead δεν βρέθηκε' using errcode = '42501'; end if;
  if r.status <> 'lost' then raise exception 'Μόνο χαμένο lead αφήνεται στα διαθέσιμα'; end if;
  if r.lost_kind = 'never' then raise exception 'Το «Όχι ποτέ» δεν μπαίνει στα διαθέσιμα'; end if;
  perform _release_lost(p_id, 'self');
end $$;
grant execute on function release_lost_lead(uuid) to authenticated;

-- Η λίστα «Διαθέσιμα χαμένα»: τη βλέπουν διαχείριση και Account Executives, με τα ελάχιστα στοιχεία
create view lost_pool as
select l.id, l.company_name, l.area, l.lost_kind, l.lost_reason, l.closed_at, l.released_at, l.interests, l.stations,
       f.full_name as had_it,
       (select c.status from lead_claims c where c.lead_id = l.id and c.user_id = auth.uid() order by c.requested_at desc limit 1) as my_request,
       (select count(*) from lead_claims c where c.lead_id = l.id and c.status = 'pending') as pending_requests
  from leads l left join profiles f on f.id = l.released_from
 where l.status = 'lost' and l.owner_id is null and l.lost_kind <> 'never'
   and coalesce(is_admin() or app_role() = 'account_exec', false);
grant select on lost_pool to authenticated;

-- Account Executive: «το θέλω»
create or replace function request_lost_lead(p_lead uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; r leads; v_who text;
begin
  if app_role() is distinct from 'account_exec' then raise exception 'Μόνο Account Executive ζητάει lead' using errcode = '42501'; end if;
  select * into r from leads where id = p_lead;
  if r.id is null or r.status <> 'lost' or r.owner_id is not null or r.lost_kind = 'never' then raise exception 'Το lead δεν είναι πια διαθέσιμο'; end if;
  select id into v_id from lead_claims where lead_id = p_lead and user_id = auth.uid() and status = 'pending';
  if v_id is not null then return v_id; end if;
  insert into lead_claims (lead_id, user_id, note) values (p_lead, auth.uid(), nullif(left(btrim(coalesce(p_note, '')), 300), '')) returning id into v_id;
  select full_name into v_who from profiles where id = auth.uid();
  insert into notifications (user_id, kind, title, link)
  select p.id, 'lead_claim', '🙋 ' || v_who || ' ζητάει το χαμένο lead: ' || r.company_name, '/leads/pool' from profiles p where p.role in ('ceo', 'sales_manager') and p.active;
  return v_id;
end $$;
grant execute on function request_lost_lead(uuid, text) to authenticated;

-- Νίκος ή Γιάννα: ΟΚ ή όχι. Με το ΟΚ το lead ξανανοίγει στο όνομα αυτού που το ζήτησε.
create or replace function decide_lead_claim(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c lead_claims; r leads; td date := (now() at time zone 'Europe/Athens')::date;
begin
  if not is_admin() then raise exception 'Το ΟΚ το δίνει ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  select * into c from lead_claims where id = p_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'Το αίτημα έχει ήδη απαντηθεί'; end if;
  select * into r from leads where id = c.lead_id for update;
  if p_approve then
    if r.status <> 'lost' or r.owner_id is not null then raise exception 'Το lead δεν είναι πια διαθέσιμο'; end if;
    update leads set owner_id = c.user_id, status = 'contacted', lost_kind = null, lost_reason = null, released_at = null, released_from = null,
           next_step = 'Ξαναχτυπάμε την πόρτα (πήρες το lead από τα διαθέσιμα)', next_step_due = td + 3, next_step_time = null
     where id = c.lead_id;
    update lead_claims set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
    insert into notifications (user_id, kind, title, link)
    select o.user_id, 'lead_claim_no', 'Το lead ' || r.company_name || ' δόθηκε σε άλλον', '/leads/pool'
      from lead_claims o where o.lead_id = c.lead_id and o.status = 'pending' and o.id <> p_id;
    update lead_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now() where lead_id = c.lead_id and status = 'pending' and id <> p_id;
  else
    update lead_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    insert into notifications (user_id, kind, title, link) values (c.user_id, 'lead_claim_no', '✗ Δεν σου δόθηκε το lead: ' || r.company_name, '/leads/pool');
  end if;
end $$;
grant execute on function decide_lead_claim(uuid, boolean) to authenticated;

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

  -- 4. Χαμένα leads: όταν έρθει η μέρα που είπαμε «ξαναχτυπάμε την πόρτα», ανοίγει εργασία στον Account Executive.
  --    Όχι για «Όχι ποτέ». Μόνο σε ώρες δουλειάς, για να μη χτυπάει το κινητό τα μεσάνυχτα.
  if now_l::time >= time '09:00' and now_l::time < time '20:00' then
    with due as (
      select l.id, l.owner_id, l.reknock_on, l.company_name, l.lost_reason,
             case l.lost_kind when 'not_now' then 'Όχι τώρα' when 'no_budget' then 'Όχι budget' when 'competitor' then 'Πήγε σε άλλον σταθμό' end as said
      from leads l
      where l.status = 'lost' and l.lost_kind <> 'never' and l.owner_id is not null
        and l.reknock_on is not null and l.reknock_on <= d and l.reknock_on > d - 30
    ), ins as (
      insert into reminder_log (kind, ref_id, due_at) select 'reknock', id, reknock_on::timestamp from due on conflict do nothing returning ref_id
    ), tk as (
      insert into tasks (title, details, due_date, owner_id, lead_id, source, created_by)
      select 'Ξαναχτύπα: ' || due.company_name || ' · είχε πει «' || due.said || '»',
             nullif(coalesce('Τότε είχε γραφτεί: ' || due.lost_reason, ''), ''), d, due.owner_id, due.id, 'reknock', due.owner_id
      from due join ins on ins.ref_id = due.id
      returning lead_id
    )
    insert into notifications (user_id, kind, title, link)
    select due.owner_id, 'reknock', '🚪 Ώρα να ξαναχτυπήσεις: ' || due.company_name || ' (είχε πει «' || due.said || '»)', '/leads/' || due.id
    from due join tk on tk.lead_id = due.id;
    get diagnostics k = row_count; n := n + k;
  end if;

  -- 5. Χαμένο lead που ο υπεύθυνος δεν απάντησε 10 ημέρες μετά το «ξαναχτύπα»: περνά στα διαθέσιμα χαμένα
  if now_l::time >= time '09:00' and now_l::time < time '20:00' then
    perform _release_lost(l.id, 'auto') from leads l
     where l.status = 'lost' and l.lost_kind <> 'never' and l.owner_id is not null
       and l.reknock_on is not null and l.reknock_on <= d - 10;
  end if;
  return n;
end $$;
revoke execute on function make_reminders() from public, authenticated, anon;
grant execute on function make_reminders() to service_role;

-- Τα χαμένα που υπήρχαν ήδη: 90 ημέρες από σήμερα (όχι από τότε που χάθηκαν)
alter table leads disable trigger user;
update leads set reknock_on = (now() at time zone 'Europe/Athens')::date + 90
 where status = 'lost' and lost_kind <> 'never' and reknock_on is null and owner_id is not null;
alter table leads enable trigger user;

select 'POOL OK' as result,
       (select count(*) from leads where status = 'lost' and reknock_on is not null) as with_reminder,
       (select count(*) from leads where status = 'lost' and owner_id is null and lost_kind <> 'never') as in_pool_now;
