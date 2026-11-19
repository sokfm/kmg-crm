-- Τιμοκατάλογος: έτοιμα πακέτα, χορηγίες εκπομπών και αναφορές ανά σταθμό
-- Πηγή: email Γιάννας «ΤΙΜΟΚΑΤΑΛΟΓΟΙ ΓΙΑ CRM» 19/11/2026. Τιμές χωρίς ΦΠΑ.
-- Κανόνας Νίκου: η βασική τιμή είναι για 1 μήνα· από 3 μήνες και πάνω ισχύει το bonus
-- (με προπληρωμή· χωρίς προπληρωμή η διαφορά αφαιρείται στον τελευταίο μήνα).

create table price_packages (
  id uuid primary key default gen_random_uuid(),
  station text not null check (station in ('ΣΟΚ FM', 'DALKAS', 'ΜΠΛΕ', 'NRG')),
  kind text not null check (kind in ('spots', 'sponsorship', 'mention')),
  client_type text not null default 'local' check (client_type in ('local', 'media', 'all')),
  name text not null,
  description text,
  spots_per_day integer check (spots_per_day >= 0),
  bonus_spots integer not null default 0 check (bonus_spots >= 0),
  max_sec integer check (max_sec > 0),
  price numeric(10, 2) not null check (price >= 0),
  unit text not null default 'month' check (unit in ('month', 'mention')),
  long_months integer check (long_months > 1),
  long_bonus_spots integer check (long_bonus_spots >= 0),
  long_price numeric(10, 2) check (long_price >= 0),
  notes text,
  needs_check boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create index on price_packages (station, sort);
create trigger price_packages_version before update on price_packages for each row execute function trg_versioning();

alter table price_packages enable row level security;
create policy price_read on price_packages for select to authenticated using (true);
create policy price_insert on price_packages for insert to authenticated with check (is_admin());
create policy price_update on price_packages for update to authenticated using (is_admin()) with check (is_admin());
create policy price_delete on price_packages for delete to authenticated using (is_admin());
grant select, insert, update, delete on price_packages to authenticated;

insert into price_packages (station, kind, client_type, name, description, spots_per_day, bonus_spots, max_sec, price, unit, long_months, long_bonus_spots, long_price, notes, needs_check, sort) values
 ('ΣΟΚ FM', 'spots', 'local', 'Πακέτο 6', '6 σποτ την ημέρα', 6, 0, 30, 700, 'month', 3, 1, 650, null, false, 10),
 ('ΣΟΚ FM', 'sponsorship', 'local', 'Χορηγία Morning Show', '2–3 αναφορές + 4–6 σποτ την ημέρα', null, 0, 30, 1200, 'month', 4, null, 1000,
    'Στο Excel: 1.200 € μήνες 1–4, 1.000 € μήνες 5–8, 800 € από τον 9ο. Το email λέει 1.000–1.200 €.', true, 20),
 ('ΣΟΚ FM', 'sponsorship', 'local', 'Χορηγία ΣΟΚ Απογεύματα', '2 αναφορές + 2 σποτ, 17:00–20:00, Δευτέρα–Παρασκευή', null, 0, 30, 500, 'month', null, null, null, null, false, 30),
 ('ΣΟΚ FM', 'mention', 'local', 'Αναφορά Morning Show', null, null, 0, null, 30, 'mention', null, null, null, null, false, 40),
 ('ΣΟΚ FM', 'mention', 'local', 'Αναφορά ΣΟΚ Απογεύματα', null, null, 0, null, 20, 'mention', null, null, null, null, false, 41),
 ('ΣΟΚ FM', 'mention', 'media', 'Αναφορά (media shop)', null, null, 0, null, 50, 'mention', null, null, null, null, false, 42),
 ('DALKAS', 'spots', 'local', 'Πακέτο 6+1', '6 σποτ + 1 δώρο την ημέρα', 6, 1, 30, 400, 'month', 3, 2, 350, null, false, 10),
 ('DALKAS', 'sponsorship', 'local', 'Χορηγία πρωινής εκπομπής', '3 αναφορές (Δευτέρα–Παρασκευή) + 4 σποτ την ημέρα', null, 0, 30, 600, 'month', 4, null, 500,
    'Στο Excel: 600 € μήνες 1–3, 500 € από τον 4ο· ετήσια 6.000 € (το άθροισμα βγαίνει 6.300 €).', true, 20),
 ('DALKAS', 'mention', 'media', 'Αναφορά (media shop)', null, null, 0, null, 30, 'mention', null, null, null, null, false, 42),
 ('NRG', 'spots', 'local', 'Πακέτο 6+1', '6 σποτ + 1 δώρο την ημέρα', 6, 1, 30, 350, 'month', 3, 2, 300, null, false, 10),
 ('NRG', 'mention', 'media', 'Αναφορά (media shop)', null, null, 0, null, 40, 'mention', null, null, null, null, false, 42),
 ('ΜΠΛΕ', 'spots', 'local', 'Πακέτο 6+1', '6 σποτ + 1 δώρο την ημέρα', 6, 1, 30, 350, 'month', 3, 2, 300, null, false, 10),
 ('ΜΠΛΕ', 'mention', 'media', 'Αναφορά (media shop)', null, null, 0, null, 30, 'mention', null, null, null, null, false, 42);

select 'PACKAGES OK' as result, count(*) as packages from price_packages;
