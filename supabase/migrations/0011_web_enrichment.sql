-- Στοιχεία από το ίντερνετ (η AI ψάχνει την επιχείρηση): τηλέφωνο, email, site, διεύθυνση, κατηγορία.
-- Όσοι πελάτες δεν βρίσκονται ή φαίνονται κλειστοί μπαίνουν σε λίστα ελέγχου για τον Νίκο/Γιάννα.

create type web_status as enum ('found', 'not_found', 'closed', 'error');

alter table customers
  add column website text,
  add column address text,
  add column web_status web_status,
  add column web_checked_at timestamptz,
  add column web_note text,
  add column web_sources text[] not null default '{}',
  add column web_confidence numeric(3, 2),
  add column closed_at timestamptz,          -- επιβεβαιωμένα κλειστή επιχείρηση (κρύβεται από τη βάση)
  add column web_reviewed_at timestamptz;    -- ο Νίκος/Γιάννα το είδε («υπάρχει» ή «έκλεισε»)

alter table leads
  add column category text,
  add column website text,
  add column address text,
  add column web_status web_status,
  add column web_checked_at timestamptz,
  add column web_note text,
  add column web_sources text[] not null default '{}';

create index on customers (web_status) where web_reviewed_at is null;
create index on customers (web_checked_at);

-- Ρυθμίσεις εφαρμογής (π.χ. αυτόματο ψάξιμο πελατών ανοιχτό/κλειστό)
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create policy settings_read on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for insert to authenticated with check (is_admin());
create policy settings_update on app_settings for update to authenticated using (is_admin()) with check (is_admin());
grant select, insert, update on app_settings to authenticated;
grant all on app_settings to service_role;

-- Ημερολόγιο κόστους: πόσες αναζητήσεις έγιναν, για να ξέρουμε τι πληρώνουμε
create table web_runs (
  id bigserial primary key,
  kind text not null,                 -- 'lead' / 'customer'
  target_id uuid,
  searches int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  status web_status,
  created_at timestamptz not null default now()
);
alter table web_runs enable row level security;
create policy web_runs_admin on web_runs for select to authenticated using (is_admin());
grant select on web_runs to authenticated;
grant all on web_runs to service_role;
grant usage, select on sequence web_runs_id_seq to service_role;

-- Απόφαση από τη λίστα ελέγχου
create or replace function decide_web_review(p_id uuid, p_closed boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  update customers
     set web_reviewed_at = now(),
         closed_at = case when p_closed then now() else null end,
         web_status = case when p_closed then 'closed'::web_status else web_status end,
         version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;
grant execute on function decide_web_review(uuid, boolean) to authenticated;
