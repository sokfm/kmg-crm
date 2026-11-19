-- Groups (όπως το Parent Account του Salesforce): μια εταιρεία-ομπρέλα με brands από κάτω.
-- Π.χ. Group «ΚΡΙΜΑΤΟΓΛΟΥ» → SMART MARKET, KGREEN, ΜΟΝΩΣΕΙΣ. Ένα επίπεδο μόνο (Group → brands).
-- Τα brands κρατούν δικό τους ιστορικό τιμολόγησης και Account Executive· το Group δείχνει το σύνολο.

alter table customers
  add column is_group boolean not null default false,
  add column parent_id uuid references customers (id) on delete set null;
create index on customers (parent_id);
alter table customers add constraint not_own_parent check (parent_id is null or parent_id <> id);

create or replace function trg_group_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_group and new.parent_id is not null then
    raise exception 'Ένα Group δεν μπαίνει μέσα σε άλλο Group';
  end if;
  if new.parent_id is not null and not exists (select 1 from customers where id = new.parent_id and is_group) then
    raise exception 'Ο πελάτης μπαίνει μόνο σε Group';
  end if;
  return new;
end $$;
create trigger customers_group_rules before insert or update of parent_id, is_group on customers
  for each row execute function trg_group_rules();

-- Group: δεν «επιστρέφει» στη βάση, δεν το ζητούν οι Account Executives
create or replace function release_stale_owners() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    update customers c set owner_id = null, status = 'base', updated_at = now(), version = version + 1
     where c.owner_id is not null and c.closed_at is null and not c.is_group
       and coalesce(c.last_period, '0000-00') < to_char(date_trunc('month', now()) - interval '12 months', 'YYYY-MM')
       and not exists (select 1 from history_lines h where h.customer_id = c.id and h.is_future)
       and not exists (select 1 from leads l where l.customer_id = c.id and l.status not in ('won', 'lost'))
       and not exists (select 1 from base_claims b where b.customer_id = c.id
                         and ((b.status = 'pending') or (b.status in ('approved', 'converted') and b.decided_at > now() - interval '12 months')))
       and not exists (select 1 from activities a where a.customer_id = c.id and a.counts_as_contact and a.occurred_at > now() - interval '90 days')
    returning c.id
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke execute on function release_stale_owners() from authenticated, anon;

-- Βάζει πελάτες σε Group (υπάρχον ή νέο). Μόνο Νίκος / Γιάννα.
create or replace function set_group(p_ids uuid[], p_group uuid default null, p_new_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid := p_group;
begin
  if not is_admin() then
    raise exception 'Groups φτιάχνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  if g is null then
    if coalesce(trim(p_new_name), '') = '' then raise exception 'Γράψε όνομα για το Group'; end if;
    insert into customers (display_name, is_group, status, channel)
    values (upper(trim(p_new_name)), true, 'active',
            coalesce((select channel from customers where id = any (p_ids) order by lifetime_revenue desc limit 1), 'kmg'))
    returning id into g;
  elsif not exists (select 1 from customers where id = g and is_group) then
    raise exception 'Δεν είναι Group';
  end if;
  update customers set parent_id = g where id = any (p_ids) and not is_group and id <> g;
  return g;
end $$;
grant execute on function set_group(uuid[], uuid, text) to authenticated;

create or replace function leave_group(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  update customers set parent_id = null where id = p_id;
end $$;
grant execute on function leave_group(uuid) to authenticated;

-- Ένα υπάρχον brand γίνεται το ίδιο Group (π.χ. ISOMAT με τα ISOMAT CHROMA, AK22 από κάτω)
create or replace function make_group(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  update customers set is_group = true, parent_id = null, status = 'active' where id = p_id;
end $$;
grant execute on function make_group(uuid) to authenticated;

-- Ένα Group δεν πέφτει ποτέ στη βάση
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
  ), served as (
    select customer_id, served_by_label(acc, agent) as label, period from customer_last_line
     where (p_customer is null or customer_id = p_customer)
  )
  update customers c set
    first_period = a.first_period,
    last_period = a.last_period,
    lifetime_revenue = a.lifetime,
    stations = coalesce(a.stations, '{}'),
    revenue_by_year = coalesce(y.by_year, '{}'::jsonb),
    served_by = coalesce(s.label, c.served_by),
    served_by_period = coalesce(s.period, c.served_by_period),
    channel = case
      when s.label is null then c.channel
      when s.label like 'Media shop%' then 'media_shop'::sales_channel
      when s.label = 'Stamoulakis' then 'stamoulakis'::sales_channel
      else 'kmg'::sales_channel end,
    status = case
      when c.is_group or c.owner_id is not null then 'active'::customer_status
      when s.label like 'Media shop%' and a.last_period >= to_char(date_trunc('month', now()) - interval '12 months', 'YYYY-MM') then 'active'::customer_status
      else 'base'::customer_status end
  from agg a left join years y on y.customer_id = a.customer_id
             left join served s on s.customer_id = a.customer_id
  where c.id = a.customer_id;
end $$;
revoke execute on function refresh_customer_stats(uuid) from authenticated;
