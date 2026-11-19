-- 1) «Ποιος τον εξυπηρετούσε»: από το αρχείο τιμολόγησης (Account Executive / Agent της πιο πρόσφατης καμπάνιας).
-- 2) Πελάτες που δεν έχουν παίξει 12+ μήνες δεν μένουν «κλειδωμένοι» σε Account Executive: επιστρέφουν στη βάση,
--    αλλά κρατάμε ποιος τους εξυπηρετούσε.

create or replace function served_by_label(acc text, agent text) returns text
language sql immutable as $$
  select case
    when acc is null or trim(acc) = '' then null
    when upper(acc) like 'STAMOULAKIS%' then 'Κώστας Σταμουλάκης'
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'DRAKIDOU%' then 'Γιάννα Δρακίδου'
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'BOUTSIKA%' then 'Μαρία Μπούτσικα'
    when upper(acc) like 'KARTELIAS%' and trim(coalesce(agent, '')) = '' then 'Νίκος Καρτελιάς'
    when upper(acc) like 'KARTELIAS%' then initcap(lower(agent))
    when upper(acc) like 'MEDIA SHOP%' then 'Media shop' || coalesce(nullif(' · ' || upper(trim(agent)), ' · '), '')
    else initcap(lower(acc))
  end
$$;

alter table customers
  add column served_by text,
  add column served_by_period text;

-- Στατιστικά πελάτη + «ποιος τον εξυπηρετούσε». Η κατάσταση ακολουθεί τον Account Executive:
-- με Account Executive = 'active', χωρίς = 'base'.
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
    select distinct on (customer_id) customer_id, served_by_label(account_executive_raw, agent_raw) as label, period
    from history_lines
    where customer_id is not null and source_scope = 'monthly_billing' and not is_future
      and served_by_label(account_executive_raw, agent_raw) is not null
      and (p_customer is null or customer_id = p_customer)
    order by customer_id, period desc
  )
  update customers c set
    first_period = a.first_period,
    last_period = a.last_period,
    lifetime_revenue = a.lifetime,
    stations = coalesce(a.stations, '{}'),
    revenue_by_year = coalesce(y.by_year, '{}'::jsonb),
    served_by = coalesce(s.label, c.served_by),
    served_by_period = coalesce(s.period, c.served_by_period),
    status = case when c.owner_id is null then 'base'::customer_status else 'active'::customer_status end
  from agg a left join years y on y.customer_id = a.customer_id
             left join served s on s.customer_id = a.customer_id
  where c.id = a.customer_id;
end $$;
revoke execute on function refresh_customer_stats(uuid) from authenticated;

-- Επιστροφή στη βάση όσων δεν έχουν παίξει 12+ μήνες. ΔΕΝ επιστρέφουν όσοι έχουν:
-- κλεισμένη μελλοντική καμπάνια, ανοιχτό lead, πρόσφατη έγκριση από τη βάση, ή επαφή τους τελευταίους 90 μέρες.
create or replace function release_stale_owners() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    update customers c set owner_id = null, status = 'base', updated_at = now(), version = version + 1
     where c.owner_id is not null and c.closed_at is null
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

-- Τζίρος ανά μήνα με τον Account Executive της κάθε καμπάνιας (όπως στην τιμολόγηση), όχι τον σημερινό.
create or replace view revenue_monthly with (security_invoker = true) as
select h.billing_year as year, h.billing_month as month, h.period,
       coalesce(h.station, '—') as station, c.owner_id, c.channel, c.agency_id, h.is_future,
       sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers,
       coalesce(served_by_label(h.account_executive_raw, h.agent_raw), 'Νίκος Καρτελιάς') as ae
  from history_lines h join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1, 2, 3, 4, 5, 6, 7, 8, 11;

-- Εφαρμογή τώρα: «ποιος τον εξυπηρετούσε» για όλους, μετά επιστροφή των παλιών στη βάση
select refresh_customer_stats();
select release_stale_owners() as released;
select refresh_customer_stats();

-- Κάθε μέρα 06:20 UTC (μετά την επιστροφή αιτημάτων βάσης)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $x$select cron.schedule('release-stale-owners', '20 6 * * *', 'select release_stale_owners(); select refresh_customer_stats();')$x$;
  end if;
end $do$;
