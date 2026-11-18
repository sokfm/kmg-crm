-- Ενώσεις πελατών και ενημέρωση στατιστικών από το ιστορικό.

-- Υπολογίζει ξανά τζίρο ανά έτος, σταθμούς, πρώτη/τελευταία περίοδο και
-- αν ο πελάτης είναι ενεργός (έπαιξε από το 2025 και μετά) ή στη βάση.
create or replace function refresh_customer_stats(p_customer uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  with agg as (
    select h.customer_id,
           min(h.period) filter (where not h.is_future) as first_period,
           max(h.period) filter (where not h.is_future) as last_period,
           coalesce(sum(h.amount) filter (where not h.is_future), 0) as lifetime,
           array_agg(distinct h.station) filter (where h.station is not null) as stations
    from history_lines h
    where h.customer_id is not null and h.source_scope = 'monthly_billing'
      and (p_customer is null or h.customer_id = p_customer)
    group by h.customer_id
  ), years as (
    select customer_id, jsonb_object_agg(billing_year::text, round(total, 2)) as by_year
    from (
      select customer_id, billing_year, sum(coalesce(amount, 0)) as total
      from history_lines
      where customer_id is not null and not is_future and source_scope = 'monthly_billing'
        and (p_customer is null or customer_id = p_customer)
      group by customer_id, billing_year
    ) t group by customer_id
  )
  update customers c set
    first_period = a.first_period,
    last_period = a.last_period,
    lifetime_revenue = a.lifetime,
    stations = coalesce(a.stations, '{}'),
    revenue_by_year = coalesce(y.by_year, '{}'::jsonb),
    status = case
      when c.owner_id is not null and a.last_period >= '2025-01' then 'active'::customer_status
      when a.last_period >= '2025-01' then 'active'::customer_status
      else c.status end
  from agg a left join years y on y.customer_id = a.customer_id
  where c.id = a.customer_id;
end $$;

-- Ένωση: κρατάει έναν πελάτη και μεταφέρει σε αυτόν ονομασίες, ιστορικό,
-- καμπάνιες, leads και δραστηριότητες των υπολοίπων. Μόνο Νίκος / Γιάννα.
create or replace function merge_customers(p_keep uuid, p_others uuid[], p_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  update customer_aliases set customer_id = p_keep where customer_id = any (p_others);
  update history_lines set customer_id = p_keep where customer_id = any (p_others);
  update leads set customer_id = p_keep where customer_id = any (p_others);
  update activities set customer_id = p_keep where customer_id = any (p_others);
  insert into campaigns (customer_id, name)
    select p_keep, name from campaigns where customer_id = any (p_others)
    on conflict do nothing;
  -- Ο υπεύθυνος: κρατάμε του πελάτη που κρατάμε· αλλιώς του πιο πρόσφατου
  update customers set owner_id = coalesce(customers.owner_id, (
      select o.owner_id from customers o where o.id = any (p_others) and o.owner_id is not null
      order by o.last_period desc nulls last limit 1))
  where id = p_keep;
  if p_name is not null then
    update customers set display_name = p_name where id = p_keep;
  end if;
  delete from customers where id = any (p_others);
  perform refresh_customer_stats(p_keep);
end $$;

-- Απόφαση σε μια ομάδα από την οθόνη ενώσεων
create or replace function decide_merge(p_group uuid, p_same boolean, p_keep_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g merge_candidates;
  ids uuid[];
  keep uuid;
begin
  if not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  select * into g from merge_candidates where id = p_group for update;
  if g.decision <> 'pending' then
    raise exception 'Η ομάδα έχει ήδη απόφαση';
  end if;
  if p_same then
    select array_agg(a.customer_id order by c.lifetime_revenue desc)
      into ids
      from (select distinct customer_id from customer_aliases where source_customer_id = any (g.source_customer_ids)) a
      join customers c on c.id = a.customer_id;
    keep := ids[1];
    if array_length(ids, 1) > 1 then
      perform merge_customers(keep, ids[2:], coalesce(p_keep_name, g.keep_name));
    elsif p_keep_name is not null then
      update customers set display_name = p_keep_name where id = keep;
    end if;
  end if;
  update merge_candidates
     set decision = case when p_same then 'same'::merge_decision else 'different'::merge_decision end,
         keep_name = coalesce(p_keep_name, keep_name),
         decided_by = auth.uid(), decided_at = now()
   where id = p_group;
end $$;

grant execute on function decide_merge(uuid, boolean, text) to authenticated;
revoke execute on function merge_customers(uuid, uuid[], text) from authenticated;
revoke execute on function refresh_customer_stats(uuid) from authenticated;
