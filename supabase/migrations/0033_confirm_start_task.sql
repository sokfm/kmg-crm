-- Απόφαση Νίκου 20/11/2026: lead που κερδίζεται χωρίς επιβεβαιωμένη έναρξη ανοίγει μόνο του εργασία
-- στον Account Executive «Επιβεβαίωσε έναρξη με τον πελάτη» (για αύριο). Κλείνει μόνη της όταν μπει η ημερομηνία.
create or replace function trg_lead_won_confirm_start() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid := coalesce(new.owner_id, auth.uid());
begin
  if new.status = 'won' and old.status is distinct from 'won' and who is not null
     and exists (select 1 from proposals p join proposal_items i on i.proposal_id = p.id
                  where p.lead_id = new.id and p.is_main and i.confirmed_start is null)
     and not exists (select 1 from tasks t where t.lead_id = new.id and t.source = 'confirm_start' and t.status = 'open') then
    insert into tasks (title, details, due_date, owner_id, lead_id, source, created_by)
    values ('Επιβεβαίωσε έναρξη με τον πελάτη',
            'Κλείστηκε χωρίς επιβεβαιωμένη έναρξη. Βάλ'' τη μέσα στην πρόταση, για να μπει ο τζίρος στους σωστούς μήνες.',
            (now() at time zone 'Europe/Athens')::date + 1, who, new.id, 'confirm_start', coalesce(auth.uid(), who));
  end if;
  return new;
end $$;
create trigger leads_won_confirm_start after update of status on leads for each row execute function trg_lead_won_confirm_start();

-- Μόλις όλες οι γραμμές της κύριας πρότασης πάρουν επιβεβαιωμένη έναρξη, η εργασία κλείνει μόνη της
create or replace function trg_confirm_start_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare l uuid;
begin
  if new.confirmed_start is null then return new; end if;
  select p.lead_id into l from proposals p where p.id = new.proposal_id and p.is_main;
  if l is not null and not exists (select 1 from proposal_items i where i.proposal_id = new.proposal_id and i.confirmed_start is null) then
    update tasks set status = 'done', done_at = now() where lead_id = l and source = 'confirm_start' and status = 'open';
  end if;
  return new;
end $$;
create trigger proposal_items_confirm_done after update of confirmed_start on proposal_items for each row execute function trg_confirm_start_done();

select 'CONFIRM TASK OK' as result;
