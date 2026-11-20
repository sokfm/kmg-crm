-- Απόφαση Νίκου 20/11/2026: το αυτόματο όνομα πρότασης ακολουθεί το δικό του στιλ:
-- «ΠΕΛΑΤΗΣ 201126» (ημέρα-μήνας-έτος της δημιουργίας) και, αν γραφτεί καμπάνια, «ΠΕΛΑΤΗΣ 201126 · καμπάνια».
-- Ίδιο όνομα στο ίδιο lead την ίδια μέρα → (2), (3)… Όνομα που έγραψε ο χρήστης δεν αγγίζεται.
create or replace function trg_proposal_autoname() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; n int;
  td date := (now() at time zone 'Europe/Athens')::date;
begin
  new.campaign := nullif(btrim(coalesce(new.campaign, '')), '');
  if coalesce(btrim(new.title), '') in ('', 'Πρόταση') then
    select company_name into base from leads where id = new.lead_id;
    base := coalesce(base, 'Πρόταση') || ' ' || to_char(td, 'DDMMYY') || coalesce(' · ' || new.campaign, '');
    select count(*) into n from proposals where lead_id = new.lead_id and (title = base or title like base || ' (%)');
    new.title := left(case when n = 0 then base else base || ' (' || (n + 1) || ')' end, 80);
  end if;
  return new;
end $$;

-- Όσες είχαν πάρει το προηγούμενο αυτόματο όνομα («ΠΕΛΑΤΗΣ · Νοε 2026») περνάνε στο νέο στιλ
alter table proposals disable trigger user;
update proposals p set title = left(l.company_name || ' ' || to_char(p.created_at at time zone 'Europe/Athens', 'DDMMYY'), 80)
  from leads l where l.id = p.lead_id
   and p.title = l.company_name || ' · ' ||
       (array['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'])[extract(month from p.created_at at time zone 'Europe/Athens')::int]
       || ' ' || extract(year from p.created_at at time zone 'Europe/Athens')::int;
alter table proposals enable trigger user;

select 'NAME STYLE OK' as result;
