-- Πρακτορεία ως κανονικές καρτέλες. Η επικοινωνία με ένα πρακτορείο (email, κλήσεις,
-- εργασίες) γράφεται στην καρτέλα του πρακτορείου, όχι στον πελάτη-διαφημιζόμενο.
-- Τα email αναγνωρίζονται από το domain του αποστολέα (π.χ. @umedia.gr → U MEDIA).

create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  domains text[] not null default '{}',     -- '@umedia.gr', πάντα πεζά με @ μπροστά
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

-- Ενιαία ονόματα από το ιστορικό (ίδιο πρακτορείο γραμμένο αλλιώς)
create or replace function agency_canonical(t text) returns text language sql immutable as $$
  select case
    when t is null or upper(trim(t)) in ('', 'NAN') then null
    when upper(trim(t)) = 'GM COMMUNICATIONS' then 'GM'
    when upper(trim(t)) like 'FRANK%FAME%' then 'FRANK & FAME'
    when upper(trim(t)) = 'ENZYM' then 'ENZYME'
    else upper(trim(t))
  end
$$;

insert into agencies (name)
select distinct agency_canonical(agency) from customers where agency_canonical(agency) is not null
on conflict do nothing;

update agencies set domains = array['@umedia.gr'] where name = 'U MEDIA';

alter table customers add column agency_id uuid references agencies (id) on delete set null;
update customers c set agency_id = a.id, agency = a.name
  from agencies a where a.name = agency_canonical(c.agency);
update customers set agency = null where agency is not null and agency_id is null;
create index on customers (agency_id);

alter table activities add column agency_id uuid references agencies (id) on delete cascade;
alter table activities drop constraint activity_has_target;
alter table activities add constraint activity_has_target
  check (lead_id is not null or customer_id is not null or agency_id is not null);
create index on activities (agency_id);

alter table email_messages add column agency_id uuid references agencies (id) on delete set null;
alter table tasks add column agency_id uuid references agencies (id) on delete set null;

-- Δικαιώματα: τα ονόματα πρακτορείων τα βλέπουν όλοι, αλλαγές μόνο ceo/sales manager.
-- Την επικοινωνία με πρακτορείο τη βλέπουν οι admin και όποιος την κατέγραψε.
alter table agencies enable row level security;
create policy agencies_read on agencies for select to authenticated using (true);
create policy agencies_write on agencies for insert to authenticated with check (is_admin());
create policy agencies_update on agencies for update to authenticated using (is_admin()) with check (is_admin());

drop policy activities_read on activities;
drop policy activities_insert on activities;
create policy activities_read on activities for select to authenticated
  using ((lead_id is not null and can_see_lead(lead_id))
      or (customer_id is not null and can_see_customer(customer_id))
      or (agency_id is not null and (is_admin() or user_id = auth.uid())));
create policy activities_insert on activities for insert to authenticated
  with check (user_id = auth.uid()
    and ((lead_id is not null and can_see_lead(lead_id))
      or (customer_id is not null and can_see_customer(customer_id))
      or (agency_id is not null)));

grant select, insert, update on agencies to authenticated;
grant all on agencies to service_role;
grant execute on function agency_canonical(text) to authenticated, service_role;

select 'AGENCIES OK' as result, (select count(*) from agencies) as agencies,
       (select count(*) from customers where agency_id is not null) as linked_customers;
