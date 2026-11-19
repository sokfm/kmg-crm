-- Pipeline: εκτιμώμενη αξία ανά deal και πότε έκλεισε (κέρδος/χαμένο).
-- Dashboard: μηνιαίος τζίρος από το αρχείο τιμολόγησης, ανά σταθμό / πωλητή / media shop.

alter table leads add column expected_value numeric(12, 2) check (expected_value is null or expected_value >= 0);
alter table leads add column closed_at timestamptz;

create or replace function set_lead_closed_at() returns trigger language plpgsql as $$
begin
  if new.status in ('won', 'lost') and (tg_op = 'INSERT' or old.status not in ('won', 'lost')) then
    new.closed_at := now();
  elsif new.status not in ('won', 'lost') then
    new.closed_at := null;
  end if;
  return new;
end $$;
create trigger trg_lead_closed_at before insert or update of status on leads
  for each row execute function set_lead_closed_at();

update leads set closed_at = updated_at where status in ('won', 'lost') and closed_at is null;

-- Μηνιαίος τζίρος. security_invoker: κάθε χρήστης βλέπει μόνο ό,τι επιτρέπουν τα δικαιώματά
-- του (ο πωλητής τους δικούς του πελάτες, ceo/sales manager τα πάντα).
create or replace view revenue_monthly with (security_invoker = true) as
select h.billing_year as year,
       h.billing_month as month,
       h.period,
       coalesce(h.station, '—') as station,
       c.owner_id,
       c.channel,
       c.agency_id,
       h.is_future,
       sum(coalesce(h.amount, 0)) as amount,
       count(distinct h.customer_id) as customers
  from history_lines h
  join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing'
 group by 1, 2, 3, 4, 5, 6, 7, 8;

grant select on revenue_monthly to authenticated;
grant select on revenue_monthly to service_role;

-- Σύνολο ανά έτος (για τη γραμμή «12 χρόνια»), μικρό για γρήγορο φόρτωμα
create or replace view revenue_yearly with (security_invoker = true) as
select h.billing_year as year, sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers
  from history_lines h
  join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing'
 group by 1;

grant select on revenue_yearly to authenticated, service_role;
