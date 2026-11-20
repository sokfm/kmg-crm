-- Απόφαση Νίκου 20/11/2026: ο τζίρος μιας πρότασης σπάει ανά ημέρα προβολής στους μήνες που παίζει
-- (π.χ. 15/11–14/12, 1.500 € → 800 € Νοέμβριος, 700 € Δεκέμβριος). Γι' αυτό κάθε γραμμή θέλει ημερομηνία έναρξης.
-- Η στήλη start_date υπάρχει ήδη (τη γέμιζαν μόνο τα πλάνα)· τώρα τη γεμίζουν και τα πακέτα.
-- Η έναρξη δεν γράφεται στην προσφορά του πελάτη, άρα αλλάζει και σε κλειδωμένη πρόταση:
-- στα πακέτα ελεύθερα, στα πλάνα μόνο κατά ολόκληρες εβδομάδες (για να μη χαλάσουν οι ημέρες της εβδομάδας).
create or replace function trg_proposal_items_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select code into c from proposals where id = coalesce(new.proposal_id, old.proposal_id) and sent_at is not null;
  if c is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'start_date' - 'version' - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'start_date' - 'version' - 'updated_at' - 'updated_by') then
    if new.kind = 'plan' and (new.start_date is null or old.start_date is null or (new.start_date - old.start_date) % 7 <> 0) then
      raise exception 'Σε κλειδωμένο πλάνο η έναρξη μετακινείται μόνο κατά ολόκληρες εβδομάδες' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'Η πρόταση % έχει σταλεί και είναι κλειδωμένη. Φτιάξε καινούργια (Αντίγραφο).', c using errcode = '42501';
end $$;

select 'START OK' as result;
