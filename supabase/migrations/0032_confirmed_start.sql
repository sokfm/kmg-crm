-- Απόφαση Νίκου 20/11/2026: η έναρξη της προσφοράς (π.χ. 15/11) συνήθως ΔΕΝ είναι η πραγματική (π.χ. 25/11).
-- Κρατάμε και τις δύο: start_date = ό,τι γράφτηκε στην προσφορά, confirmed_start = η έναρξη που επιβεβαίωσε ο πελάτης.
-- Ο τζίρος ανά μήνα πατάει στην επιβεβαιωμένη όταν υπάρχει.
alter table proposal_items add column confirmed_start date;

-- Σε κλειδωμένη πρόταση η έναρξη της προσφοράς ξαναπαγώνει (είναι ό,τι στάλθηκε)· αλλάζει μόνο η επιβεβαιωμένη.
create or replace function trg_proposal_items_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select code into c from proposals where id = coalesce(new.proposal_id, old.proposal_id) and sent_at is not null;
  if c is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'confirmed_start' - 'version' - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'confirmed_start' - 'version' - 'updated_at' - 'updated_by') then
    return new;
  end if;
  raise exception 'Η πρόταση % έχει σταλεί και είναι κλειδωμένη. Φτιάξε καινούργια (Αντίγραφο).', c using errcode = '42501';
end $$;

select 'CONFIRMED OK' as result;
