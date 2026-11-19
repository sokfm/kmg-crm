-- Οι δικές μας διευθύνσεις (φόρμα του site, προωθήσεις) δεν είναι ποτέ στοιχεία πελάτη.
-- Η βάση τις καθαρίζει μόνη της από leads, πελάτες και πρόσωπα, ό,τι κι αν στείλει η εφαρμογή.
alter table email_messages add column ai_email text;

create or replace function is_own_email(e text) returns boolean
language sql immutable as $$
  select coalesce(lower(trim(e)) ~ '@([a-z0-9-]+\.)*(sokfm\.gr|karteliasmediagroup\.gr|lalala\.gr)$', false)
$$;

create or replace function trg_strip_own_email() returns trigger
language plpgsql as $$
begin
  if is_own_email(new.email) then new.email := null; end if;
  return new;
end $$;

create trigger leads_strip_own_email before insert or update of email on leads for each row execute function trg_strip_own_email();
create trigger customers_strip_own_email before insert or update of email on customers for each row execute function trg_strip_own_email();
create trigger contacts_strip_own_email before insert or update of email on contacts for each row execute function trg_strip_own_email();

-- Καθάρισμα όσων μπήκαν ήδη
delete from contacts where is_own_email(email) and coalesce(trim(name), '') in ('', 'Info kertelias Media Group');
alter table contacts disable trigger user;
update contacts set email = null where is_own_email(email);
alter table contacts enable trigger user;
alter table leads disable trigger user;
update leads set email = null where is_own_email(email);
alter table leads enable trigger user;
alter table customers disable trigger user;
update customers set email = null where is_own_email(email);
alter table customers enable trigger user;

select 'OWN EMAILS OK' as result,
  (select count(*) from leads where is_own_email(email)) as leads_left,
  (select count(*) from contacts where is_own_email(email)) as contacts_left;
