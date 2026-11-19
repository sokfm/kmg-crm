-- Account Executive όπως στην τιμολόγηση:
--   KARTELIAS MEDIA GROUP χωρίς agent → Νίκος · με agent DRAKIDOU/BOUTSIKA → Γιάννα/Μαρία
--   STAMOULAKIS → Κώστας · MEDIA SHOP (ή όνομα πρακτορείου στη στήλη) → το media shop, χωρίς Account Executive.
-- Οι πελάτες media shop που παίζουν/έπαιξαν τους τελευταίους 12 μήνες δεν είναι «βάση» (δεν τους ζητούν πωλητές).

create or replace function is_agency_name(t text) returns boolean
language sql stable set search_path = public as $$
  select t is not null and trim(t) <> '' and (
    exists (select 1 from agencies a where a.name = agency_canonical(t))
    or upper(t) like '%MEDIA%' and upper(t) not like 'KARTELIAS%'
    or upper(t) like 'U NEDIA%')
$$;

create or replace function served_by_label(acc text, agent text) returns text
language sql stable set search_path = public as $$
  select case
    when acc is null or trim(acc) = '' then null
    when upper(acc) like 'STAMOULAKIS%' then 'Κώστας Σταμουλάκης'
    when upper(acc) like 'MEDIA SHOP%' then 'Media shop' || coalesce(' · ' || nullif(agency_canonical(replace(upper(agent), 'U NEDIA', 'U MEDIA')), ''), '')
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'DRAKIDOU%' then 'Γιάννα Δρακίδου'
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'BOUTSIKA%' then 'Μαρία Μπούτσικα'
    when upper(acc) like 'KARTELIAS%' and (trim(coalesce(agent, '')) = '' or upper(trim(agent)) in ('NIKOS', 'ΝΙΚΟΣ', 'KARTELIAS', 'ΚΑΡΤΕΛΙΑΣ', 'BARTER')) then 'Νίκος Καρτελιάς'
    when upper(acc) like 'KARTELIAS%' and is_agency_name(agent) then 'Media shop · ' || agency_canonical(agent)
    when upper(acc) like 'KARTELIAS%' then initcap(lower(agent))
    when is_agency_name(acc) then 'Media shop · ' || agency_canonical(replace(upper(acc), 'U NEDIA', 'U MEDIA'))
    else initcap(lower(acc))
  end
$$;

-- Ο χρήστης του CRM που αντιστοιχεί (null για media shop και παλιούς πωλητές)
create or replace function ae_owner(acc text, agent text) returns uuid
language sql stable set search_path = public as $$
  select case
    when upper(coalesce(acc, '')) like 'STAMOULAKIS%' then (select id from profiles where 'STAMOULAKIS' = any (history_agent_codes) and active limit 1)
    when upper(coalesce(acc, '')) like 'KARTELIAS%' and (trim(coalesce(agent, '')) = '' or upper(trim(agent)) in ('NIKOS', 'ΝΙΚΟΣ', 'KARTELIAS', 'ΚΑΡΤΕΛΙΑΣ', 'BARTER')) then (select id from profiles where role = 'ceo' and active limit 1)
    when upper(coalesce(acc, '')) like 'KARTELIAS%' then (select id from profiles where upper(trim(agent)) = any (history_agent_codes) and active limit 1)
    else null
  end
$$;

-- Τελευταία (όχι μελλοντική) γραμμή τιμολόγησης ανά πελάτη
create or replace view customer_last_line as
select distinct on (customer_id) customer_id, account_executive_raw as acc, agent_raw as agent, period
  from history_lines
 where customer_id is not null and source_scope = 'monthly_billing' and not is_future
   and coalesce(account_executive_raw, '') <> ''
 order by customer_id, period desc;
revoke all on customer_last_line from anon, authenticated;

-- Κατάσταση: με Account Executive = active· media shop με καμπάνια τους τελευταίους 12 μήνες = active (χωρίς AE)
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
      when s.label = 'Κώστας Σταμουλάκης' then 'stamoulakis'::sales_channel
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

-- Διόρθωση Account Executive για όσους παίζουν/έπαιξαν τους τελευταίους 12 μήνες, σύμφωνα με την τιμολόγηση.
-- Δεν αγγίζουμε όσους ζητήθηκαν από τη βάση τον τελευταίο χρόνο ή έχουν ανοιχτό lead.
update customers c set owner_id = ae_owner(l.acc, l.agent), version = version + 1, updated_at = now()
  from customer_last_line l
 where l.customer_id = c.id
   and c.closed_at is null
   and l.period >= to_char(date_trunc('month', now()) - interval '12 months', 'YYYY-MM')
   and c.owner_id is distinct from ae_owner(l.acc, l.agent)
   and not exists (select 1 from base_claims b where b.customer_id = c.id and b.status in ('pending', 'approved', 'converted') and b.created_at > now() - interval '12 months')
   and not exists (select 1 from leads ld where ld.customer_id = c.id and ld.status not in ('won', 'lost'));

select refresh_customer_stats();

-- Το λάθος όνομα της RED LEMON: στο Excel είναι «KRAFT» / «KRAFT & ΚΡΙΜΑΤΟΓΛΟΥ»
update customers set display_name = 'KRAFT' where display_name = 'ΚΡΙΜΑΤΟΓΛΟΥ' and channel = 'media_shop';
