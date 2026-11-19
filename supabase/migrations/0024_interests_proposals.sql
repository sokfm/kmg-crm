-- 1. «Ενδιαφέρεται για»: ραδιόφωνο, digital ή και τα δύο
alter table leads add column interests text[] not null default '{radio}'
  check (interests <@ array['radio', 'digital'] and cardinality(interests) >= 1);
alter table leads disable trigger user;
update leads set interests = array[product_line::text];
alter table leads enable trigger user;

-- Ασφάλεια: lead που γράφεται ως digital χωρίς «ενδιαφέρεται για» παίρνει digital
create or replace function trg_lead_interests() returns trigger
language plpgsql as $$
begin
  if new.product_line = 'digital' and not ('digital' = any (new.interests)) then new.interests := '{digital}'; end if;
  return new;
end $$;
create trigger leads_interests before insert or update of product_line, interests on leads for each row execute function trg_lead_interests();

-- Η υπεύθυνη digital βλέπει και τα leads που θέλουν ΚΑΙ digital
create or replace function can_see_lead(l_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from leads l
    where l.id = l_id
      and (l.owner_id = auth.uid()
           or l.created_by = auth.uid()
           or ((l.product_line = 'digital' or 'digital' = any (l.interests)) and (sees_digital() or app_role() = 'digital_intake')))
  )
$$;

-- 2. Πρόταση μέσα στο lead: ένα ή περισσότερα μέσα, το καθένα με πακέτο ή κοστολόγηση πλάνου.
-- Εσωτερικό εργαλείο: δεν στέλνεται στον πελάτη. Τιμές χωρίς ΦΠΑ, χωρίς εκπτώσεις (θα οριστούν αργότερα).
create table proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads (id) on delete cascade,
  client_type text check (client_type in ('local', 'media', 'direct', 'government')),
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create trigger proposals_version before update on proposals for each row execute function trg_versioning();

create table proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals (id) on delete cascade,
  station text not null check (station in ('ΣΟΚ FM', 'DALKAS', 'ΜΠΛΕ', 'NRG')),
  kind text not null check (kind in ('package', 'plan')),
  package_id uuid references price_packages (id) on delete set null,
  title text not null,
  detail text,
  monthly_amount numeric(10, 2) not null check (monthly_amount >= 0), -- κόστος ενός μήνα (30 ημερών)
  long_months integer,            -- πακέτο: από πόσους μήνες ισχύει το bonus
  long_amount numeric(10, 2),     -- πακέτο: κόστος μήνα με το bonus
  long_detail text,
  qty integer not null default 1 check (qty between 1 and 2000),       -- αναφορές τον μήνα
  months integer not null default 1 check (months between 1 and 24),
  spots integer,                  -- πλάνο: σποτ τον μήνα
  sec integer,                    -- πλάνο: διάρκεια σποτ
  start_date date,
  plan jsonb,                     -- πλάνο: μισάωρο → σποτ ανά ημέρα (30 ημέρες)
  created_at timestamptz not null default now(),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create index on proposal_items (proposal_id);
create trigger proposal_items_version before update on proposal_items for each row execute function trg_versioning();

alter table proposals enable row level security;
alter table proposal_items enable row level security;
create policy proposals_all on proposals for all to authenticated using (can_see_lead(lead_id)) with check (can_see_lead(lead_id));
create policy proposal_items_all on proposal_items for all to authenticated
  using (exists (select 1 from proposals p where p.id = proposal_id and can_see_lead(p.lead_id)))
  with check (exists (select 1 from proposals p where p.id = proposal_id and can_see_lead(p.lead_id)));
grant select, insert, update, delete on proposals, proposal_items to authenticated;

-- Ακροατές ανά break: η αλλαγή όλων μαζί από τις Ρυθμίσεις (μόνο Νίκος / Γιάννα)
create or replace function set_station_slots(p_station text, p_values jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_admin() then raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  update station_slots s set listeners_k = (v.value)::numeric, version = s.version + 1, updated_at = now(), updated_by = auth.uid()
    from jsonb_each_text(p_values) v
   where s.station = p_station and s.slot = v.key and (v.value)::numeric >= 0 and s.listeners_k is distinct from (v.value)::numeric;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function set_station_slots(text, jsonb) to authenticated;

select 'PROPOSALS OK' as result, (select count(*) from leads where interests = '{digital}') as digital_leads;
