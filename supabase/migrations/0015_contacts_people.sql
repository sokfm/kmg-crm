-- Πρόσωπα μέσα σε κάθε επιχείρηση (όπως τα Contacts του Salesforce): όνομα, θέση, ρόλοι,
-- τηλέφωνα, email. Κάθε email προσώπου συνδέει αυτόματα τα email του Outlook με την καρτέλα.
-- Και επιπλέον στοιχεία επιχείρησης (ΔΟΥ, social).

alter table contacts alter column email drop not null;
alter table contacts drop constraint contact_email_lower;
alter table contacts add constraint contact_email_lower check (email is null or email = lower(email));
alter table contacts
  add column title text,                        -- Θέση: Ιδιοκτήτης, Λογιστήριο, Marketing...
  add column roles text[] not null default '{}', -- decision, billing, marketing, owner, other
  add column phone text,
  add column mobile text,
  add column birthday date,
  add column notes text,
  add column is_primary boolean not null default false,
  add column do_not_contact boolean not null default false,
  add column version integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references profiles (id);
alter table contacts add constraint contact_has_something
  check (coalesce(name, '') <> '' or email is not null or coalesce(phone, '') <> '' or coalesce(mobile, '') <> '');

create trigger contacts_version before update on contacts
  for each row execute function trg_versioning();

create policy contacts_update on contacts for update to authenticated
  using ((customer_id is not null and can_see_customer(customer_id)) or (lead_id is not null and can_see_lead(lead_id)))
  with check ((customer_id is not null and can_see_customer(customer_id)) or (lead_id is not null and can_see_lead(lead_id)));
create policy contacts_delete on contacts for delete to authenticated
  using ((customer_id is not null and can_see_customer(customer_id)) or (lead_id is not null and can_see_lead(lead_id)));
grant delete on contacts to authenticated;

alter table customers
  add column doy text,          -- ΔΟΥ
  add column facebook text,
  add column instagram text;

-- Όταν ένα lead συνδέεται με πελάτη, τα πρόσωπά του περνούν και στον πελάτη
create or replace function trg_lead_contacts_to_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and new.customer_id is distinct from old.customer_id then
    update contacts set customer_id = new.customer_id where lead_id = new.id and customer_id is null;
  end if;
  return new;
end $$;
create trigger leads_contacts_to_customer after update of customer_id on leads
  for each row execute function trg_lead_contacts_to_customer();
