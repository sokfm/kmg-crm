-- Το dashboard τζίρου το βλέπουν μόνο ο Νίκος και η Γιάννα (ceo / sales manager).
-- Το κλειδώνουμε και στη βάση, όχι μόνο στην οθόνη.
create or replace view revenue_monthly with (security_invoker = true) as
select h.billing_year as year, h.billing_month as month, h.period,
       coalesce(h.station, '—') as station, c.owner_id, c.channel, c.agency_id, h.is_future,
       sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers
  from history_lines h join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1, 2, 3, 4, 5, 6, 7, 8;

create or replace view revenue_yearly with (security_invoker = true) as
select h.billing_year as year, sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers
  from history_lines h join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1;
