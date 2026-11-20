-- Απόφαση Νίκου 20/11/2026: ένα «όχι» δεν ξεχνιέται.
--  1. Όταν έρθει η μέρα «ξαναχτυπάμε την πόρτα», ανοίγει μόνη της εργασία στον Account Executive (και ειδοποίηση στο κινητό).
--  2. Στο «Όχι ποτέ» δεν ανοίγει τίποτα.
--  3. «Πήγε σε άλλον σταθμό»: αν ξέρουμε πότε λήγει η καμπάνια του εκεί, ξαναχτυπάμε 14 ημέρες πριν· αλλιώς σε 90 ημέρες.
--  4. Dashboard: «γιατί χάνουμε» (στον κώδικα, από τα ίδια πεδία).
alter table leads add column reknock_on date, add column competitor_until date;

-- Η ημερομηνία επανάληψης ορίζεται ΣΤΗ ΒΑΣΗ, από όπου κι αν γίνει «Χάθηκε» το lead (pipeline, καρτέλα, οτιδήποτε μελλοντικό).
create or replace function trg_lead_reknock() returns trigger
language plpgsql security definer set search_path = public as $$
declare td date := (now() at time zone 'Europe/Athens')::date;
begin
  if new.status = 'lost' then
    if new.lost_kind = 'never' then
      new.reknock_on := null;
    elsif tg_op = 'INSERT' or old.status is distinct from 'lost' or new.lost_kind is distinct from old.lost_kind
          or new.competitor_until is distinct from old.competitor_until then
      -- η εφαρμογή μπορεί να έχει δώσει ρητά ημερομηνία· αλλιώς τη βγάζουμε εδώ.
      -- (Δεν πατάμε στο next_step_due: εκεί μένει το παλιό επόμενο βήμα από όταν το lead ήταν ανοιχτό.)
      if new.reknock_on is null or (tg_op = 'UPDATE' and new.reknock_on is not distinct from old.reknock_on) then
        new.reknock_on := case
          when new.lost_kind = 'competitor' and new.competitor_until is not null then greatest(new.competitor_until - 14, td + 1)
          else td + 90 end;
      end if;
    end if;
  else
    new.reknock_on := null; new.competitor_until := null;
    -- ξανάνοιξε: η εργασία «ξαναχτύπα» δεν χρειάζεται πια
    if tg_op = 'UPDATE' and old.status = 'lost' then
      update tasks set status = 'done', done_at = now() where lead_id = new.id and source = 'reknock' and status = 'open';
    end if;
  end if;
  return new;
end $$;
create trigger leads_reknock before insert or update on leads for each row execute function trg_lead_reknock();

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
  return n;
end $$;
revoke execute on function make_reminders() from public, authenticated, anon;
grant execute on function make_reminders() to service_role;

select 'REKNOCK OK' as result;
