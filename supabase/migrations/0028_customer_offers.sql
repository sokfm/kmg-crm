-- Προσφορά προς τον πελάτη (PDF σε ταυτότητα KMG) από την πρόταση. Απόφαση Νίκου 20/11/2026.
alter table proposals add column offer_subtitle text;
alter table proposal_items add column offer_text text, add column spots_day integer, add column long_spots_day integer;
alter table proposal_items disable trigger user;
update proposal_items i set spots_day = k.spots_per_day + k.bonus_spots,
       long_spots_day = case when k.long_months is not null then k.spots_per_day + coalesce(k.long_bonus_spots, k.bonus_spots) end
  from price_packages k where k.id = i.package_id and k.spots_per_day is not null;
alter table proposal_items enable trigger user;

-- Η αλλαγή του κειμένου της προσφοράς δεν ακυρώνει εγκρίσεις: μόνο ό,τι αλλάζει το ποσό
drop trigger proposal_items_value on proposal_items;
create trigger proposal_items_value after insert or delete or update of monthly_amount, months, long_months, long_amount, qty, station, plan
  on proposal_items for each row execute function trg_proposal_value();

-- Στοιχεία του Account Executive που γράφονται στην προσφορά
alter table profiles add column offer_name text, add column offer_phone text;
update profiles set offer_name = 'Nikos Kartelias', offer_phone = '697 324 8414' where full_name = 'Nikos';
create or replace function set_my_offer_contact(p_name text, p_phone text) returns void
language sql security definer set search_path = public as $$
  update profiles set offer_name = nullif(trim(p_name), ''), offer_phone = nullif(trim(p_phone), '') where id = auth.uid()
$$;
grant execute on function set_my_offer_contact(text, text) to authenticated;

-- Λογότυπο πελάτη (μία εικόνα ανά πελάτη ή ανά lead που δεν έχει ακόμα καρτέλα πελάτη)
create table logos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid unique references customers (id) on delete cascade,
  lead_id uuid unique references leads (id) on delete cascade,
  data text not null check (data ~ '^data:image/(png|jpeg|webp);base64,' and length(data) < 1200000),
  created_by uuid references profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check ((customer_id is null) <> (lead_id is null))
);
alter table logos enable row level security;
create policy logos_all on logos for all to authenticated
  using ((lead_id is not null and can_see_lead(lead_id)) or (customer_id is not null and can_see_customer(customer_id)))
  with check ((lead_id is not null and can_see_lead(lead_id)) or (customer_id is not null and can_see_customer(customer_id)));
grant select, insert, update, delete on logos to authenticated;

-- Κάθε προσφορά που εκδίδεται κρατιέται όπως ακριβώς βγήκε (τι είδε ο πελάτης)
create table proposal_offers (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  snapshot jsonb not null,
  final_total numeric(10, 2) not null,
  valid_until date not null,
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on proposal_offers (proposal_id, created_at desc);
alter table proposal_offers enable row level security;
create policy offers_read on proposal_offers for select to authenticated using (can_see_lead(lead_id));
-- Δεν εκδίδεται προσφορά όσο εκκρεμεί αίτημα ειδικής τιμής
create policy offers_insert on proposal_offers for insert to authenticated
  with check (can_see_lead(lead_id)
    and exists (select 1 from proposals p where p.id = proposal_id and p.lead_id = proposal_offers.lead_id and p.req_status is distinct from 'pending'));
grant select, insert on proposal_offers to authenticated;

select 'OFFERS OK' as result, (select count(*) from proposal_items where spots_day is not null) as items_with_spots;
