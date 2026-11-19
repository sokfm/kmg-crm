-- Τιμές ανά δευτερόλεπτο ανά σταθμό (απόφαση Νίκου 20/11/2026). Χωρίς ΦΠΑ.
-- media_shop_sec: τιμή προς πρακτορεία (η επιστροφή τους είναι μέσα σε αυτή).
-- government_sec: κρατικές διαφημίσεις.
-- local_per_k / direct_per_k: κοστολόγηση πλάνου (Excel) — € ανά δευτερόλεπτο ανά 1.000 ακροατές της ώρας,
--   τοπικός πελάτης / μεγάλος πελάτης direct. Ακροατές Χαλκίδας - Εύβοιας.
create table station_rates (
  station text primary key check (station in ('ΣΟΚ FM', 'DALKAS', 'ΜΠΛΕ', 'NRG')),
  media_shop_sec numeric(8, 4) not null check (media_shop_sec >= 0),
  government_sec numeric(8, 4) not null check (government_sec >= 0),
  local_per_k numeric(8, 4) not null default 0.015 check (local_per_k >= 0),
  direct_per_k numeric(8, 4) not null default 0.03 check (direct_per_k >= 0),
  sort integer not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create trigger station_rates_version before update on station_rates for each row execute function trg_versioning();
alter table station_rates enable row level security;
create policy rates_read on station_rates for select to authenticated using (true);
create policy rates_update on station_rates for update to authenticated using (is_admin()) with check (is_admin());
grant select, update on station_rates to authenticated;

insert into station_rates (station, media_shop_sec, government_sec, sort) values
 ('ΣΟΚ FM', 0.35, 0.50, 1), ('DALKAS', 0.25, 0.50, 2), ('ΜΠΛΕ', 0.25, 0.40, 3), ('NRG', 0.30, 0.50, 4);

select 'RATES OK' as result, count(*) as stations from station_rates;
