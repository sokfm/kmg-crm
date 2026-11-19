-- Οι Account Executives εμφανίζονται με το όνομα της τιμολόγησης: Nikos, Drakidou, Boutsika, Stamoulakis.
-- Το μικρό όνομα (για τον χαιρετισμό «Καλησπέρα, Νίκο») κρατιέται χωριστά.

alter table profiles add column first_name text;
update profiles set first_name = split_part(full_name, ' ', 1) where first_name is null;
update profiles set full_name = case
    when 'DRAKIDOU' = any (history_agent_codes) then 'Drakidou'
    when 'BOUTSIKA' = any (history_agent_codes) then 'Boutsika'
    when 'STAMOULAKIS' = any (history_agent_codes) then 'Stamoulakis'
    when role = 'ceo' then 'Nikos'
    when email = 'v.tsalla@sokfm.gr' then 'Tsalla'
    else full_name end;

create or replace function served_by_label(acc text, agent text) returns text
language sql stable set search_path = public as $$
  select case
    when acc is null or trim(acc) = '' then null
    when upper(acc) like 'STAMOULAKIS%' then 'Stamoulakis'
    when upper(acc) like 'MEDIA SHOP%' then 'Media shop' || coalesce(' · ' || nullif(agency_canonical(replace(upper(agent), 'U NEDIA', 'U MEDIA')), ''), '')
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'DRAKIDOU%' then 'Drakidou'
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'BOUTSIKA%' then 'Boutsika'
    when upper(acc) like 'KARTELIAS%' and (trim(coalesce(agent, '')) = '' or upper(trim(agent)) in ('NIKOS', 'ΝΙΚΟΣ', 'KARTELIAS', 'ΚΑΡΤΕΛΙΑΣ', 'BARTER')) then 'Nikos'
    when upper(acc) like 'KARTELIAS%' and is_agency_name(agent) then 'Media shop · ' || agency_canonical(agent)
    when upper(acc) like 'KARTELIAS%' then initcap(lower(agent))
    when is_agency_name(acc) then 'Media shop · ' || agency_canonical(replace(upper(acc), 'U NEDIA', 'U MEDIA'))
    else initcap(lower(acc))
  end
$$;

-- Ο κώδικας κατάστασης συγκρίνει με το όνομα του Κώστα: ενημέρωση και εκεί
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
      when c.owner_id is not null then 'active'::customer_status
      when s.label like 'Media shop%' and a.last_period >= to_char(date_trunc('month', now()) - interval '12 months', 'YYYY-MM') then 'active'::customer_status
      else 'base'::customer_status end
  from agg a left join years y on y.customer_id = a.customer_id
             left join served s on s.customer_id = a.customer_id
  where c.id = a.customer_id;
end $$;
revoke execute on function refresh_customer_stats(uuid) from authenticated;

create or replace view revenue_monthly with (security_invoker = true) as
select h.billing_year as year, h.billing_month as month, h.period,
       coalesce(h.station, '—') as station, c.owner_id, c.channel, c.agency_id, h.is_future,
       sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers,
       coalesce(served_by_label(h.account_executive_raw, h.agent_raw), 'Nikos') as ae
  from history_lines h join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1, 2, 3, 4, 5, 6, 7, 8, 11;

select refresh_customer_stats();
select full_name, first_name, role from profiles order by role;
