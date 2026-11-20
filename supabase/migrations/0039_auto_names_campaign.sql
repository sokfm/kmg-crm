-- Απόφαση Νίκου 20/11/2026: οι προτάσεις και τα πλάνα παίρνουν ΜΟΝΑ ΤΟΥΣ κωδικό και όνομα,
-- και η πρόταση έχει προαιρετικό πεδίο «για ποια καμπάνια είναι».
--  * Πρόταση: κωδικός KMG-2026-0003 (υπήρχε). Όνομα αν δεν γραφτεί: «ΠΕΛΑΤΗΣ · Νοε 2026» ή «ΠΕΛΑΤΗΣ · καμπάνια».
--  * Πλάνο: κωδικός = κωδικός πρότασης + -P1, -P2… Όνομα αν δεν γραφτεί: «Πλάνο: ΣΟΚ FM 25'' · από 01/12».
alter table proposals add column campaign text;
alter table proposal_items add column code text, add column auto_title boolean not null default false;
create unique index proposal_items_code_key on proposal_items (code) where code is not null;

create or replace function trg_proposal_autoname() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; n int;
  mon text[] := array['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];
  td date := (now() at time zone 'Europe/Athens')::date;
begin
  new.campaign := nullif(btrim(coalesce(new.campaign, '')), '');
  if coalesce(btrim(new.title), '') in ('', 'Πρόταση') then
    select company_name into base from leads where id = new.lead_id;
    base := coalesce(base, 'Πρόταση') || ' · ' || coalesce(new.campaign, mon[extract(month from td)::int] || ' ' || extract(year from td)::int);
    select count(*) into n from proposals where lead_id = new.lead_id and (title = base or title like base || ' (%)');
    new.title := left(case when n = 0 then base else base || ' (' || (n + 1) || ')' end, 80);
  end if;
  return new;
end $$;
create trigger proposals_autoname before insert on proposals for each row execute function trg_proposal_autoname();

create or replace function trg_item_autoname() returns trigger
language plpgsql security definer set search_path = public as $$
declare pc text; n int;
begin
  if new.kind <> 'plan' then return new; end if;
  if tg_op = 'INSERT' and new.code is null then
    select code into pc from proposals where id = new.proposal_id;
    select coalesce(max(substring(code from '-P([0-9]+)$')::int), 0) + 1 into n from proposal_items where proposal_id = new.proposal_id and code is not null;
    new.code := pc || '-P' || n;
  end if;
  if coalesce(btrim(new.title), '') in ('', 'Πλάνο κοστολόγησης')
     or (new.auto_title and tg_op = 'UPDATE' and new.title is not distinct from old.title
         and (new.sec is distinct from old.sec or new.start_date is distinct from old.start_date or new.station is distinct from old.station)) then
    new.title := 'Πλάνο: ' || new.station || coalesce(' ' || new.sec || '''''', '') || coalesce(' · από ' || to_char(new.start_date, 'DD/MM'), '');
    new.auto_title := true;
  elsif tg_op = 'INSERT' or new.title is distinct from old.title then
    new.auto_title := false;
  end if;
  return new;
end $$;
create trigger proposal_items_autoname before insert or update on proposal_items for each row execute function trg_item_autoname();

-- Όσα υπάρχουν ήδη: κωδικοί στα πλάνα, όνομα σε όσες προτάσεις λέγονται σκέτο «Πρόταση»
alter table proposal_items disable trigger user;
with numbered as (
  select i.id, p.code || '-P' || row_number() over (partition by i.proposal_id order by i.created_at, i.id) as c
    from proposal_items i join proposals p on p.id = i.proposal_id where i.kind = 'plan' and i.code is null
)
update proposal_items i set code = n.c from numbered n where n.id = i.id;
alter table proposal_items enable trigger user;

alter table proposals disable trigger user;
update proposals p set title = left(l.company_name || ' · ' ||
       (array['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'])[extract(month from p.created_at at time zone 'Europe/Athens')::int]
       || ' ' || extract(year from p.created_at at time zone 'Europe/Athens')::int, 80)
  from leads l where l.id = p.lead_id and btrim(p.title) = 'Πρόταση'
   and not exists (select 1 from proposals o where o.lead_id = p.lead_id and o.id <> p.id and btrim(o.title) = 'Πρόταση');
alter table proposals enable trigger user;

select 'NAMES OK' as result;
