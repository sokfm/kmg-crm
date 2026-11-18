-- KMG CRM — Κομμάτι Α: βασικό σχήμα
-- Ρόλοι, πελάτες, βάση πελατών, leads, δραστηριότητες, αρχείο ιστορικού,
-- ιστορικό αλλαγών (audit) και έλεγχος συγκρούσεων (version).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Τύποι
-- ---------------------------------------------------------------
create type user_role as enum ('ceo', 'sales_manager', 'account_exec', 'digital_intake');
create type sales_channel as enum ('kmg', 'stamoulakis', 'media_shop');
create type market as enum ('chalkida', 'athens');
create type product_line as enum ('radio', 'digital');
create type customer_status as enum ('active', 'base');
create type lead_status as enum ('new', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost');
create type lost_kind as enum ('not_now', 'no_budget', 'competitor', 'never');
create type activity_type as enum ('call', 'meeting', 'viber', 'email', 'note');
create type claim_status as enum ('pending', 'approved', 'rejected', 'returned', 'converted');
create type merge_decision as enum ('pending', 'same', 'different');

-- ---------------------------------------------------------------
-- Χρήστες
-- ---------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role user_role not null,
  sees_digital boolean not null default false,   -- Μαρία: βλέπει όλο το digital
  history_agent_codes text[] not null default '{}', -- π.χ. {DRAKIDOU,ΔΡΑΚΙΔΟΥ} για την εισαγωγή ιστορικού
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('ceo', 'sales_manager'), false)
$$;

create or replace function is_ceo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'ceo', false)
$$;

create or replace function sees_digital() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sees_digital from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------
-- Πελάτες
-- ---------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,             -- εμπορική ονομασία
  legal_name text,                        -- εταιρική επωνυμία
  afm text,
  category text,                          -- για αποκλειστικότητα κατηγορίας (αργότερα)
  market market not null default 'chalkida',
  channel sales_channel not null default 'kmg',
  agency text,                            -- U MEDIA, MAVE, ... όταν channel = media_shop
  owner_id uuid references profiles (id),
  status customer_status not null default 'base',
  phone text,
  email text,
  stations text[] not null default '{}',
  first_period text,                      -- 'YYYY-MM'
  last_period text,
  revenue_by_year jsonb not null default '{}'::jsonb,  -- {"2024": 1234.5, ...}
  lifetime_revenue numeric(12, 2) not null default 0,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create index on customers (owner_id);
create index on customers (status);
create index on customers using gin (to_tsvector('simple', display_name));

-- Ονομασίες από τα αρχεία τιμολόγησης που ανήκουν σε έναν πελάτη
create table customer_aliases (
  source_customer_id text primary key,    -- CU_... από το αρχείο ιστορικού
  customer_id uuid not null references customers (id) on delete cascade,
  source_name text not null
);
create index on customer_aliases (customer_id);

-- Καμπάνιες ως ετικέτες κάτω από τον πελάτη (LIDL → TACTICAL κ.λπ.)
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  name text not null,
  unique (customer_id, name)
);

-- Προτάσεις ενώσεων για έγκριση από Νίκο / Γιάννα
create table merge_candidates (
  id uuid primary key default gen_random_uuid(),
  group_key text not null unique,
  source_customer_ids text[] not null,
  names text[] not null,
  revenue_total numeric(12, 2) not null default 0,
  last_period text,
  decision merge_decision not null default 'pending',
  keep_name text,
  decided_by uuid references profiles (id),
  decided_at timestamptz
);

-- ---------------------------------------------------------------
-- Αρχείο ιστορικού (13.910 γραμμές). Δεν εμφανίζεται στις λίστες.
-- ---------------------------------------------------------------
create table history_lines (
  record_id text primary key,
  source_customer_id text not null,
  customer_id uuid references customers (id),
  customer_name_raw text,
  period text not null,
  billing_year integer not null,
  billing_month integer not null,
  station text,
  amount numeric(12, 2),
  amount_type text,                       -- numeric / FREE / missing
  campaign_start date,
  campaign_end date,
  account_executive_raw text,
  agent_raw text,
  kef_raw text,
  bico_raw text,
  status_raw text,                        -- εσωτερικός κωδικός KMG, όπως είναι
  sponsorship_raw text,
  notes_raw text,
  package_raw text,
  cost_per_sec_raw text,
  is_future boolean not null default false,
  -- monthly_billing = κύριες μηνιαίες γραμμές· supplemental_archive / project_or_other
  -- κρατιούνται για αναφορά αλλά δεν αθροίζονται (θα μετρούσαν διπλά)
  source_scope text not null default 'monthly_billing'
);
create index on history_lines (customer_id, billing_year);
create index on history_lines (source_customer_id);

-- ---------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  area text,
  market market not null default 'chalkida',
  source text not null default 'phone',   -- phone / site / facebook / seller / base / competition_watch
  product_line product_line not null default 'radio',
  stations text[] not null default '{}',
  customer_id uuid references customers (id),
  owner_id uuid references profiles (id),
  created_by uuid references profiles (id) default auth.uid(),
  status lead_status not null default 'new',
  next_step text,
  next_step_due date,
  lost_kind lost_kind,
  lost_reason text,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  -- Κανόνας 1: κανένα ανοιχτό lead χωρίς επόμενο βήμα και ημερομηνία
  constraint open_lead_needs_next_step check (
    status in ('won', 'lost') or (coalesce(btrim(next_step), '') <> '' and next_step_due is not null)
  ),
  -- Κάθε «όχι» θέλει είδος
  constraint lost_needs_kind check (status <> 'lost' or lost_kind is not null)
);
create index on leads (owner_id, next_step_due);
create index on leads (status);

-- ---------------------------------------------------------------
-- Δραστηριότητες
-- ---------------------------------------------------------------
create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  user_id uuid not null references profiles (id) default auth.uid(),
  type activity_type not null,
  summary text not null,
  occurred_at timestamptz not null default now(),
  -- μόνο κλήση, ραντεβού, Viber ή email μετράνε ως επαφή
  counts_as_contact boolean generated always as (type <> 'note') stored,
  created_at timestamptz not null default now(),
  constraint activity_has_target check (lead_id is not null or customer_id is not null)
);
create index on activities (lead_id);
create index on activities (customer_id);

-- ---------------------------------------------------------------
-- Βάση πελατών: αιτήματα πωλητών
-- ---------------------------------------------------------------
create table base_claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  requested_by uuid not null references profiles (id) default auth.uid(),
  for_user uuid not null references profiles (id) default auth.uid(),
  status claim_status not null default 'pending',
  note text,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  contact_deadline timestamptz,           -- έγκριση + 10 μέρες
  created_at timestamptz not null default now()
);
create unique index one_open_claim_per_customer
  on base_claims (customer_id) where status in ('pending', 'approved');

-- ---------------------------------------------------------------
-- Ειδοποιήσεις
-- ---------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  link text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at);

-- ---------------------------------------------------------------
-- Ιστορικό αλλαγών
-- ---------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  action text not null,
  actor uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on audit_log (table_name, row_id);

create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, action, actor, before, after)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- Κάθε αποθήκευση ανεβάζει το version. Η εφαρμογή στέλνει το version που
-- είχε ανοιχτό· αν άλλαξε στο μεταξύ, η αποθήκευση δεν περνάει και ο χρήστης
-- ειδοποιείται πριν σβήσει την αλλαγή άλλου.
create or replace function trg_versioning() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger customers_version before update on customers for each row execute function trg_versioning();
create trigger leads_version before update on leads for each row execute function trg_versioning();

create trigger customers_audit after insert or update or delete on customers for each row execute function trg_audit();
create trigger leads_audit after insert or update or delete on leads for each row execute function trg_audit();
create trigger claims_audit after insert or update or delete on base_claims for each row execute function trg_audit();
create trigger merges_audit after update on merge_candidates for each row execute function trg_audit();

-- ---------------------------------------------------------------
-- Κανόνες ανάθεσης
-- ---------------------------------------------------------------
create or replace function trg_lead_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  maria uuid;
begin
  -- Εισαγωγή δεδομένων από το σύστημα (χωρίς χρήστη): χωρίς κανόνες ανάθεσης
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Τα digital leads πάνε κατευθείαν στην υπεύθυνη digital
    if new.product_line = 'digital' and new.owner_id is null then
      select id into maria from profiles where sees_digital and role = 'account_exec' and active limit 1;
      new.owner_id := maria;
    end if;
    -- Οι πωλητές δεν αναθέτουν leads σε άλλους. Ένα lead που βρήκαν μόνοι τους
    -- μένει σε αυτούς· όλα τα άλλα περιμένουν ανάθεση από τον Νίκο.
    if not is_admin() and new.product_line = 'radio' then
      if new.source = 'seller' then
        new.owner_id := auth.uid();
      else
        new.owner_id := null;
      end if;
    end if;
    -- Νέο lead χωρίς υπεύθυνο → ειδοποίηση στον Νίκο για ανάθεση
    if new.owner_id is null then
      insert into notifications (user_id, kind, title, link)
      select id, 'lead_to_assign', 'Νέο lead για ανάθεση: ' || new.company_name, '/leads/' || new.id
      from profiles where role = 'ceo' and active;
    end if;
    return new;
  end if;

  -- UPDATE: αλλαγή υπευθύνου μόνο από Νίκο / Γιάννα
  if new.owner_id is distinct from old.owner_id and not is_admin() then
    raise exception 'Μόνο ο Νίκος ή η Γιάννα αλλάζουν υπεύθυνο lead' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id and new.owner_id is not null then
    insert into notifications (user_id, kind, title, link)
    values (new.owner_id, 'lead_assigned', 'Σου ανατέθηκε: ' || new.company_name, '/leads/' || new.id);
  end if;
  return new;
end $$;

create trigger leads_rules before insert or update on leads for each row execute function trg_lead_rules();

-- Αίτημα από τη βάση → ειδοποίηση στον Νίκο. Έγκριση μόνο από τον Νίκο.
create or replace function trg_claim_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cname text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select display_name into cname from customers where id = new.customer_id;
  if tg_op = 'INSERT' then
    if (select status from customers where id = new.customer_id) <> 'base' then
      raise exception 'Ο πελάτης δεν είναι στη βάση' using errcode = '23514';
    end if;
    if not is_admin() and new.for_user <> auth.uid() then
      raise exception 'Ο πωλητής ζητάει πελάτες μόνο για τον εαυτό του' using errcode = '42501';
    end if;
    -- Ανάθεση από Νίκο ή Γιάννα: εγκρίνεται αμέσως
    if is_admin() then
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
    else
      insert into notifications (user_id, kind, title, link)
      select id, 'claim_to_approve', 'Αίτημα για πελάτη της βάσης: ' || cname, '/base?claim=' || new.id
      from profiles where role = 'ceo' and active;
    end if;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if not is_ceo() then
      raise exception 'Τα αιτήματα από τη βάση τα εγκρίνει ο Νίκος' using errcode = '42501';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;

  if new.status = 'approved' and new.contact_deadline is null then
    new.contact_deadline := now() + interval '10 days';
    update customers set owner_id = new.for_user, status = 'active' where id = new.customer_id;
    insert into notifications (user_id, kind, title, link)
    values (new.for_user, 'claim_approved', 'Σου ανατέθηκε από τη βάση: ' || cname || ' — επαφή μέσα σε 10 μέρες', '/customers/' || new.customer_id);
  end if;
  return new;
end $$;

create trigger claims_rules before insert or update on base_claims for each row execute function trg_claim_rules();

-- Τρέχει κάθε μέρα (pg_cron): όποιος πελάτης από τη βάση δεν είχε
-- καταγεγραμμένη επαφή μέσα σε 10 μέρες γυρίζει στη βάση.
create or replace function return_stale_claims() returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  c record;
begin
  for c in
    select bc.* from base_claims bc
    where bc.status = 'approved' and bc.contact_deadline < now()
      and not exists (
        select 1 from activities a
        where a.counts_as_contact
          and a.occurred_at >= bc.decided_at
          and (a.customer_id = bc.customer_id
               or a.lead_id in (select id from leads where customer_id = bc.customer_id))
      )
  loop
    update base_claims set status = 'returned' where id = c.id;
    update customers set owner_id = null, status = 'base' where id = c.customer_id;
    insert into notifications (user_id, kind, title, link)
    select id, 'claim_returned', 'Επέστρεψε στη βάση χωρίς επαφή: ' || (select display_name from customers where id = c.customer_id), '/base'
    from profiles where role in ('ceo', 'sales_manager') and active;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function similarity_key(t text) returns text
language sql immutable as $$
  select regexp_replace(
           translate(upper(coalesce(t, '')), 'ΆΈΉΊΌΎΏΪΫ', 'ΑΕΗΙΟΥΩΙΥ'),
           '[^A-ZΑ-Ω0-9]', '', 'g')
$$;

-- Έλεγχος διπλοεγγραφής όταν περνάει νέο lead. Επιστρέφει μόνο σε ποιον
-- ανήκει ο πελάτης, όχι στοιχεία του.
create or replace function find_duplicate(p_name text, p_phone text default null)
returns table (kind text, ref_id uuid, display_name text, owner_name text)
language sql stable security definer set search_path = public as $$
  select 'customer', c.id, c.display_name, coalesce(p.full_name, 'Βάση πελατών')
  from customers c left join profiles p on p.id = c.owner_id
  where similarity_key(c.display_name) = similarity_key(p_name)
     or (p_phone is not null and c.phone = p_phone)
  union all
  select 'lead', l.id, l.company_name, coalesce(p.full_name, 'Χωρίς ανάθεση')
  from leads l left join profiles p on p.id = l.owner_id
  where l.status not in ('won', 'lost')
    and (similarity_key(l.company_name) = similarity_key(p_name)
         or (p_phone is not null and l.phone = p_phone))
  limit 5
$$;



-- ---------------------------------------------------------------
-- Δικαιώματα (Row Level Security)
-- ---------------------------------------------------------------
alter table profiles enable row level security;
alter table customers enable row level security;
alter table customer_aliases enable row level security;
alter table campaigns enable row level security;
alter table merge_candidates enable row level security;
alter table history_lines enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table base_claims enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

create or replace function can_see_customer(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from customers c
    where c.id = c_id
      and app_role() = 'account_exec'
      and (c.owner_id = auth.uid() or c.status = 'base')
  )
$$;

create or replace function can_see_lead(l_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from leads l
    where l.id = l_id
      and (l.owner_id = auth.uid()
           or l.created_by = auth.uid()
           or (l.product_line = 'digital' and (sees_digital() or app_role() = 'digital_intake')))
  )
$$;

-- profiles: όλοι βλέπουν ονόματα συναδέλφων· αλλαγές μόνο από τον Νίκο
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_admin on profiles for all to authenticated using (is_ceo()) with check (is_ceo());

-- customers: διαχείριση όλα· πωλητής τους δικούς του και τη βάση· υποδοχή digital τίποτα
create policy customers_read on customers for select to authenticated using (can_see_customer(id));
create policy customers_insert on customers for insert to authenticated
  with check (is_admin() or (app_role() = 'account_exec' and owner_id = auth.uid()));
create policy customers_update on customers for update to authenticated
  using (is_admin() or owner_id = auth.uid())
  with check (is_admin() or owner_id = auth.uid());

create policy aliases_read on customer_aliases for select to authenticated using (can_see_customer(customer_id));
create policy campaigns_read on campaigns for select to authenticated using (can_see_customer(customer_id));
create policy campaigns_write on campaigns for all to authenticated
  using (is_admin() or exists (select 1 from customers c where c.id = customer_id and c.owner_id = auth.uid()))
  with check (is_admin() or exists (select 1 from customers c where c.id = customer_id and c.owner_id = auth.uid()));

create policy merges_admin on merge_candidates for all to authenticated using (is_admin()) with check (is_admin());

create policy history_read on history_lines for select to authenticated
  using (customer_id is not null and can_see_customer(customer_id));

-- leads
create policy leads_read on leads for select to authenticated using (can_see_lead(id));
create policy leads_insert on leads for insert to authenticated
  with check (app_role() is not null and (app_role() <> 'digital_intake' or product_line = 'digital'));
create policy leads_update on leads for update to authenticated
  using (is_admin() or owner_id = auth.uid())
  with check (is_admin() or owner_id = auth.uid());

-- activities
create policy activities_read on activities for select to authenticated
  using ((lead_id is not null and can_see_lead(lead_id)) or (customer_id is not null and can_see_customer(customer_id)));
create policy activities_insert on activities for insert to authenticated
  with check (user_id = auth.uid()
    and ((lead_id is not null and can_see_lead(lead_id)) or (customer_id is not null and can_see_customer(customer_id))));

-- base_claims
create policy claims_read on base_claims for select to authenticated
  using (is_admin() or requested_by = auth.uid() or for_user = auth.uid());
create policy claims_insert on base_claims for insert to authenticated
  with check (is_admin() or (app_role() = 'account_exec' and for_user = auth.uid()));
create policy claims_update on base_claims for update to authenticated using (is_admin()) with check (is_admin());

-- notifications: μόνο τις δικές σου
create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit: μόνο Νίκος και Γιάννα
create policy audit_read on audit_log for select to authenticated using (is_admin());

-- ---------------------------------------------------------------
-- Προβολές για τις οθόνες
-- ---------------------------------------------------------------
-- Λίστα «Σήμερα»: ανοιχτά leads του χρήστη, με καθυστερημένα πρώτα.
create or replace view my_today with (security_invoker = true) as
select l.*,
       (l.next_step_due < current_date) as is_overdue,
       (l.next_step_due = current_date) as is_today,
       (select max(a.occurred_at) from activities a where a.lead_id = l.id and a.counts_as_contact) as last_contact_at
from leads l
where l.status not in ('won', 'lost')
  and l.owner_id = auth.uid()
  and l.next_step_due <= current_date + 1;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant select on my_today to authenticated;
grant execute on all functions in schema public to authenticated;
