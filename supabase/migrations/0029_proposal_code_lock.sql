-- Απόφαση Νίκου 20/11/2026: κάθε πρόταση έχει μοναδικό κωδικό. Όταν εκδοθεί για αποστολή στον πελάτη, κλειδώνει:
-- δεν αλλάζει τίποτα που επηρεάζει ποσά ή κείμενα. Για αλλαγή φτιάχνεται καινούργια πρόταση (αντίγραφο, με νέο κωδικό).
create sequence proposal_code_seq;
alter table proposals add column code text, add column sent_at timestamptz, add column sent_by uuid references profiles (id);
alter table proposals disable trigger user;
update proposals p set code = 'KMG-' || to_char(p.created_at, 'YYYY') || '-' || lpad(nextval('proposal_code_seq')::text, 4, '0')
  from (select id from proposals order by created_at) o where o.id = p.id;
alter table proposals enable trigger user;
alter table proposals alter column code set not null, add constraint proposals_code_key unique (code);

create or replace function trg_proposal_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.code := 'KMG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('proposal_code_seq')::text, 4, '0');
  new.sent_at := null; new.sent_by := null;
  return new;
end $$;
create trigger proposals_code before insert on proposals for each row execute function trg_proposal_code();

-- Κλειδωμένη πρόταση: δεν αλλάζει είδος πελάτη, προπληρωμή, ειδική τιμή, κείμενα προσφοράς, κωδικός, ούτε ξεκλειδώνει
create or replace function trg_proposal_lock() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code then raise exception 'Ο κωδικός της πρότασης δεν αλλάζει' using errcode = '42501'; end if;
  if old.sent_at is not null then
    if (new.sent_at, new.sent_by, new.client_type, new.prepay, new.offer_subtitle, new.req_status, new.req_amount, new.lead_id)
       is distinct from (old.sent_at, old.sent_by, old.client_type, old.prepay, old.offer_subtitle, old.req_status, old.req_amount, old.lead_id) then
      raise exception 'Η πρόταση % έχει σταλεί και είναι κλειδωμένη. Φτιάξε καινούργια (Αντίγραφο).', old.code using errcode = '42501';
    end if;
  elsif new.sent_at is not null and coalesce(current_setting('kmg.lock', true), '') <> '1' then
    raise exception 'Η πρόταση κλειδώνει μόνο με την έκδοση για αποστολή' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger proposals_lock before update on proposals for each row execute function trg_proposal_lock();

create or replace function trg_proposal_items_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select code into c from proposals where id = coalesce(new.proposal_id, old.proposal_id) and sent_at is not null;
  if c is not null then
    raise exception 'Η πρόταση % έχει σταλεί και είναι κλειδωμένη. Φτιάξε καινούργια (Αντίγραφο).', c using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger proposal_items_lock before insert or update or delete on proposal_items for each row execute function trg_proposal_items_lock();

-- Κλείδωμα: γίνεται τη στιγμή που εκδίδεται η προσφορά για αποστολή
create or replace function lock_proposal(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r proposals;
begin
  select * into r from proposals where id = p_id;
  if r.id is null or not can_see_lead(r.lead_id) then raise exception 'Η πρόταση δεν βρέθηκε' using errcode = '42501'; end if;
  if r.sent_at is not null then return r.code; end if;
  if r.req_status = 'pending' then raise exception 'Υπάρχει αίτημα ειδικής τιμής σε αναμονή'; end if;
  if not exists (select 1 from proposal_items where proposal_id = p_id) then raise exception 'Η πρόταση είναι άδεια'; end if;
  perform set_config('kmg.lock', '1', true);
  update proposals set sent_at = now(), sent_by = auth.uid() where id = p_id;
  perform set_config('kmg.lock', '', true);
  return r.code;
end $$;
grant execute on function lock_proposal(uuid) to authenticated;

select 'CODES OK' as result, (select string_agg(code || ' ' || title, ', ' order by code) from proposals) as codes;
