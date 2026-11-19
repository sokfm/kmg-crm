-- Αποφάσεις Νίκου 20/11/2026:
-- 1. Η τιμή κάθε break ανά δευτερόλεπτο ορίζεται με το χέρι, ΜΟΝΟ από τον Νίκο (ceo).
--    Η Γιάννα αλλάζει μόνο τιμές πακέτων. Οι ακροατές μένουν ως πληροφορία.
-- 2. Πολλές προτάσεις ανά lead. Μία είναι η «κύρια»: αυτή γράφει την εκτιμώμενη αξία του lead.

-- 1. Τιμές break
alter table station_slots add column local_sec numeric(8, 4), add column direct_sec numeric(8, 4);
alter table station_slots disable trigger user;
update station_slots s set local_sec = round(s.listeners_k * r.local_per_k, 4), direct_sec = round(s.listeners_k * r.direct_per_k, 4)
  from station_rates r where r.station = s.station;
alter table station_slots enable trigger user;
alter table station_slots alter column local_sec set not null, alter column direct_sec set not null,
  add check (local_sec >= 0), add check (direct_sec >= 0);

drop policy slots_update on station_slots;
create policy slots_update on station_slots for update to authenticated using (is_ceo()) with check (is_ceo());
drop policy rates_update on station_rates;
create policy rates_update on station_rates for update to authenticated using (is_ceo()) with check (is_ceo());

-- p_values: { "08:30": { "l": 0.18, "d": 0.36, "k": 12 }, ... }
create or replace function set_station_slots(p_station text, p_values jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_ceo() then raise exception 'Τις τιμές των break τις αλλάζει μόνο ο Νίκος' using errcode = '42501'; end if;
  update station_slots s set
      local_sec = coalesce((v.value ->> 'l')::numeric, s.local_sec),
      direct_sec = coalesce((v.value ->> 'd')::numeric, s.direct_sec),
      listeners_k = coalesce((v.value ->> 'k')::numeric, s.listeners_k)
    from jsonb_each(p_values) v
   where s.station = p_station and s.slot = v.key
     and (s.local_sec is distinct from coalesce((v.value ->> 'l')::numeric, s.local_sec)
       or s.direct_sec is distinct from coalesce((v.value ->> 'd')::numeric, s.direct_sec)
       or s.listeners_k is distinct from coalesce((v.value ->> 'k')::numeric, s.listeners_k));
  get diagnostics n = row_count;
  return n;
end $$;

-- 2. Πολλές προτάσεις ανά lead
alter table proposals drop constraint proposals_lead_id_key;
alter table proposals add column title text not null default 'Πρόταση', add column is_main boolean not null default false;
create index on proposals (lead_id);
alter table proposals disable trigger user;
update proposals set is_main = true;
alter table proposals enable trigger user;
create unique index proposals_one_main on proposals (lead_id) where is_main;

-- Η πρώτη πρόταση ενός lead γίνεται μόνη της κύρια
create or replace function trg_first_proposal_main() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from proposals where lead_id = new.lead_id and is_main) then new.is_main := true; end if;
  return new;
end $$;
create trigger proposals_first_main before insert on proposals for each row execute function trg_first_proposal_main();

-- Η κύρια πρόταση γράφει την «Εκτιμώμενη αξία» του lead (μόνο σε ανοιχτά leads)
create or replace function sync_lead_value(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  select sum(i.months * case when i.long_months is not null and i.long_amount is not null and i.months >= i.long_months then i.long_amount else i.monthly_amount end)
    into v
    from proposals p join proposal_items i on i.proposal_id = p.id
   where p.lead_id = p_lead and p.is_main;
  if v is not null then
    update leads set expected_value = v where id = p_lead and status not in ('won', 'lost') and expected_value is distinct from v;
  end if;
end $$;
revoke execute on function sync_lead_value(uuid) from authenticated, anon;

create or replace function trg_proposal_value() returns trigger
language plpgsql security definer set search_path = public as $$
declare l uuid;
begin
  if tg_table_name = 'proposals' then
    l := coalesce(new.lead_id, old.lead_id);
  else
    select lead_id into l from proposals where id = coalesce(new.proposal_id, old.proposal_id);
  end if;
  if l is not null then perform sync_lead_value(l); end if;
  return null;
end $$;
create trigger proposal_items_value after insert or update or delete on proposal_items for each row execute function trg_proposal_value();
create trigger proposals_value after update of is_main on proposals for each row execute function trg_proposal_value();

-- Ορισμός κύριας πρότασης (μία ανά lead)
create or replace function set_main_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l uuid;
begin
  select lead_id into l from proposals where id = p_id;
  if l is null or not can_see_lead(l) then raise exception 'Η πρόταση δεν βρέθηκε' using errcode = '42501'; end if;
  update proposals set is_main = false where lead_id = l and is_main and id <> p_id;
  update proposals set is_main = true where id = p_id and not is_main;
  perform sync_lead_value(l);
end $$;
grant execute on function set_main_proposal(uuid) to authenticated;

select 'BREAK PRICES OK' as result,
  (select round(sum(local_sec) * 30 * 30, 2) from station_slots where station = 'ΣΟΚ FM' and slot in ('08:30','10:30','12:30','14:30','16:30','18:30')) as sok_check_783;
