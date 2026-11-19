-- Ένωση μόνο των επιλεγμένων ονομάτων μιας ομάδας (π.χ. 3 από τα 4 «ΝΕΡΟ ΔΙΟΣ»).
-- Όσα δεν επιλέγονται μένουν ξεχωριστοί πελάτες.
create or replace function merge_selected(p_group uuid, p_ids uuid[], p_keep_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g merge_candidates;
  allowed uuid[];
  keep uuid;
  others uuid[];
begin
  if not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  select * into g from merge_candidates where id = p_group for update;
  if g.decision <> 'pending' then
    raise exception 'Η ομάδα έχει ήδη απόφαση';
  end if;
  -- Μόνο πελάτες που ανήκουν πράγματι σε αυτή την ομάδα
  select array_agg(distinct customer_id) into allowed
    from customer_aliases where source_customer_id = any (g.source_customer_ids);
  if exists (select 1 from unnest(coalesce(p_ids, '{}')) x where not x = any (allowed)) then
    raise exception 'Λάθος επιλογή πελατών';
  end if;

  if coalesce(array_length(p_ids, 1), 0) >= 2 then
    select array_agg(c.id order by c.lifetime_revenue desc) into others
      from customers c where c.id = any (p_ids);
    keep := others[1];
    perform merge_customers(keep, others[2:], p_keep_name);
  end if;

  update merge_candidates
     set decision = case when coalesce(array_length(p_ids, 1), 0) >= 2 then 'same'::merge_decision else 'different'::merge_decision end,
         keep_name = coalesce(p_keep_name, keep_name),
         decided_by = auth.uid(), decided_at = now()
   where id = p_group;
end $$;

grant execute on function merge_selected(uuid, uuid[], text) to authenticated;
