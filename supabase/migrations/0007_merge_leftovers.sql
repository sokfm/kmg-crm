-- Ενώσεις: όσα ΔΕΝ τσεκάρεις μένουν στη λίστα (αν είναι 2+), για να ενωθούν μεταξύ τους αργότερα.
-- Αν δεν δοθεί όνομα, ο ενωμένος πελάτης κρατά το όνομα του μεγαλύτερου (σε τζίρο) ΤΣΕΚΑΡΙΣΜΕΝΟΥ.

create or replace function merge_selected(p_group uuid, p_ids uuid[], p_keep_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g merge_candidates;
  allowed uuid[];
  keep uuid;
  others uuid[];
  left_ids uuid[];
  left_src text[];
begin
  if not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  select * into g from merge_candidates where id = p_group for update;
  if g.decision <> 'pending' then
    raise exception 'Η ομάδα έχει ήδη απόφαση';
  end if;
  select array_agg(distinct customer_id) into allowed
    from customer_aliases where source_customer_id = any (g.source_customer_ids);
  if exists (select 1 from unnest(coalesce(p_ids, '{}')) x where not x = any (allowed)) then
    raise exception 'Λάθος επιλογή πελατών';
  end if;

  -- Όσα έμειναν ατσέκαρα (υπολογίζεται πριν την ένωση)
  select array_agg(x) into left_ids from unnest(allowed) x where not x = any (coalesce(p_ids, '{}'));

  if coalesce(array_length(p_ids, 1), 0) >= 2 then
    select array_agg(c.id order by c.lifetime_revenue desc) into others
      from customers c where c.id = any (p_ids);
    keep := others[1];
    perform merge_customers(keep, others[2:], nullif(trim(p_keep_name), ''));
  end if;

  if coalesce(array_length(p_ids, 1), 0) >= 2 and coalesce(array_length(left_ids, 1), 0) >= 2 then
    -- Η ομάδα μένει ανοιχτή μόνο με τα ατσέκαρα
    select array_agg(source_customer_id) into left_src
      from customer_aliases where customer_id = any (left_ids) and source_customer_id = any (g.source_customer_ids);
    update merge_candidates m
       set source_customer_ids = left_src,
           names = (select array_agg(c.display_name order by c.lifetime_revenue desc) from customers c where c.id = any (left_ids)),
           revenue_total = (select coalesce(sum(c.lifetime_revenue), 0) from customers c where c.id = any (left_ids)),
           last_period = (select max(c.last_period) from customers c where c.id = any (left_ids))
     where m.id = p_group;
  else
    update merge_candidates
       set decision = case when coalesce(array_length(p_ids, 1), 0) >= 2 then 'same'::merge_decision else 'different'::merge_decision end,
           keep_name = coalesce(nullif(trim(p_keep_name), ''), keep_name),
           decided_by = auth.uid(), decided_at = now()
     where id = p_group;
  end if;
end $$;

grant execute on function merge_selected(uuid, uuid[], text) to authenticated, service_role;

-- Μετονομασία πελάτη (μόνο ceo / sales manager), με έλεγχο ταυτόχρονης αλλαγής
create or replace function rename_customer(p_id uuid, p_name text, p_version int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Μετονομασία κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Γράψε όνομα';
  end if;
  update customers set display_name = upper(trim(p_name)), version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_id and version = p_version;
  if not found then
    raise exception 'conflict: Κάποιος άλλος άλλαξε τον πελάτη στο μεταξύ. Ανανέωσε τη σελίδα.';
  end if;
end $$;
grant execute on function rename_customer(uuid, text, int) to authenticated;

-- Διόρθωση όσων ενώθηκαν με την παλιά λογική: όσα ονόματα έμειναν ατσέκαρα (2+) ξαναμπαίνουν στη λίστα.
-- «Ατσέκαρο» = πελάτης με μόνο ένα όνομα της ομάδας· ο ενωμένος έχει 2+.
do $$
declare g record; left_ids uuid[];
begin
  for g in select * from merge_candidates where decision = 'same' loop
    select array_agg(customer_id) into left_ids from (
      select customer_id from customer_aliases
       where source_customer_id = any (g.source_customer_ids)
       group by customer_id having count(*) = 1) t;
    if coalesce(array_length(left_ids, 1), 0) >= 2
       and (select count(distinct customer_id) from customer_aliases where source_customer_id = any (g.source_customer_ids)) > array_length(left_ids, 1) then
      update merge_candidates m
         set decision = 'pending', decided_at = null, decided_by = null, keep_name = null,
             source_customer_ids = (select array_agg(source_customer_id) from customer_aliases
                                     where customer_id = any (left_ids) and source_customer_id = any (g.source_customer_ids)),
             names = (select array_agg(c.display_name order by c.lifetime_revenue desc) from customers c where c.id = any (left_ids)),
             revenue_total = (select coalesce(sum(c.lifetime_revenue), 0) from customers c where c.id = any (left_ids)),
             last_period = (select max(c.last_period) from customers c where c.id = any (left_ids))
       where m.id = g.id;
    end if;
  end loop;
end $$;
