-- KMG CRM — Σύνδεση Outlook και Εργασίες
-- Επαφές (email ↔ πελάτης/lead), email που κατέγραψε το CRM, λίστα «Προς έλεγχο»,
-- αποστολείς που αγνοούνται, εργασίες.

-- ---------------------------------------------------------------
-- Επαφές: ποια διεύθυνση email ανήκει σε ποιον πελάτη ή lead.
-- Μαθαίνει κάθε φορά που επιβεβαιώνεις ένα email στη λίστα «Προς έλεγχο».
-- ---------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  customer_id uuid references customers (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint contact_has_target check (customer_id is not null or lead_id is not null),
  constraint contact_email_lower check (email = lower(email))
);
create unique index contacts_email_unique on contacts (lower(email));
create index on contacts (customer_id);
create index on contacts (lead_id);

-- ---------------------------------------------------------------
-- Λογαριασμοί Outlook. Το κλειδί ανανέωσης το διαβάζει ΜΟΝΟ ο server
-- (service role)· κανένας χρήστης, ούτε ο ίδιος, δεν το βλέπει από την εφαρμογή.
-- ---------------------------------------------------------------
create table mail_accounts (
  user_id uuid primary key references profiles (id) on delete cascade,
  ms_email text not null,
  refresh_token text not null,
  inbox_since timestamptz not null default now() - interval '14 days',
  sent_since timestamptz not null default now() - interval '14 days',
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);

-- Ό,τι μπορεί να δει ο ίδιος ο χρήστης για τη σύνδεσή του (χωρίς το κλειδί)
create view my_mail_account with (security_invoker = false) as
select user_id, ms_email, connected_at, last_sync_at, last_error
from mail_accounts where user_id = auth.uid();

-- ---------------------------------------------------------------
-- Email που πέρασαν από το CRM. Κρατάμε μόνο θέμα, ημερομηνία,
-- σύντομη περίληψη και σύνδεσμο για άνοιγμα στο Outlook — όχι ολόκληρο το κείμενο.
-- ---------------------------------------------------------------
create type email_status as enum ('logged', 'review', 'lead_created', 'ignored');
create type email_direction as enum ('in', 'out');

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  graph_id text not null,
  direction email_direction not null,
  counterpart_email text not null,
  counterpart_name text,
  subject text,
  occurred_at timestamptz not null,
  web_link text,
  summary text,
  status email_status not null,
  customer_id uuid references customers (id) on delete set null,
  lead_id uuid references leads (id) on delete set null,
  ai_kind text,
  ai_confidence numeric(3, 2),
  ai_reason text,
  ai_company text,
  ai_contact_name text,
  ai_phone text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, graph_id)
);
create index on email_messages (user_id, status);
create index on email_messages (customer_id);
create index on email_messages (lead_id);

-- Αποστολείς ή ολόκληρα domain που αγνοούνται πάντα (π.χ. newsletters, προμηθευτές)
create table ignored_senders (
  pattern text primary key,          -- 'nea@site.gr' ή '@site.gr'
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

alter table activities add column email_message_id uuid references email_messages (id) on delete set null;

-- ---------------------------------------------------------------
-- Εργασίες (μόνο για πωλήσεις· τα υπόλοιπα μένουν στο Asana)
-- ---------------------------------------------------------------
create type task_status as enum ('open', 'done');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  due_date date,
  owner_id uuid not null references profiles (id) default auth.uid(),
  customer_id uuid references customers (id) on delete set null,
  lead_id uuid references leads (id) on delete set null,
  email_message_id uuid references email_messages (id) on delete set null,
  source text not null default 'manual',     -- manual / email
  status task_status not null default 'open',
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
create index on tasks (owner_id, status, due_date);
create index on tasks (customer_id);
create index on tasks (lead_id);

create trigger tasks_version before update on tasks for each row execute function trg_versioning();
create trigger tasks_audit after insert or update or delete on tasks for each row execute function trg_audit();

-- Νέα εργασία για άλλον → ειδοποίηση
create or replace function trg_task_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and new.owner_id is distinct from coalesce(auth.uid(), new.created_by) then
    insert into notifications (user_id, kind, title, link)
    values (new.owner_id, 'task_assigned', 'Νέα εργασία: ' || new.title, '/tasks');
  end if;
  if new.status = 'done' and new.done_at is null then
    new.done_at := now();
  end if;
  return new;
end $$;
create trigger tasks_notify before insert or update on tasks for each row execute function trg_task_notify();

-- ---------------------------------------------------------------
-- Δικαιώματα
-- ---------------------------------------------------------------
alter table contacts enable row level security;
alter table mail_accounts enable row level security;   -- καμία πολιτική: μόνο ο server
alter table email_messages enable row level security;
alter table ignored_senders enable row level security;
alter table tasks enable row level security;

create policy contacts_read on contacts for select to authenticated
  using ((customer_id is not null and can_see_customer(customer_id)) or (lead_id is not null and can_see_lead(lead_id)));
create policy contacts_write on contacts for insert to authenticated
  with check ((customer_id is not null and can_see_customer(customer_id)) or (lead_id is not null and can_see_lead(lead_id)));

-- Τα email τα βλέπει μόνο ο κάτοχος του γραμματοκιβωτίου. Στην καρτέλα πελάτη οι
-- άλλοι βλέπουν την επαφή (activity) με θέμα και περίληψη, όχι το ίδιο το email.
create policy emails_own on email_messages for select to authenticated using (user_id = auth.uid());
create policy emails_decide on email_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy ignored_read on ignored_senders for select to authenticated using (true);
create policy ignored_write on ignored_senders for insert to authenticated with check (app_role() is not null);

create policy tasks_read on tasks for select to authenticated
  using (is_admin() or owner_id = auth.uid() or created_by = auth.uid());
create policy tasks_insert on tasks for insert to authenticated
  with check (app_role() is not null and (is_admin() or owner_id = auth.uid()));
create policy tasks_update on tasks for update to authenticated
  using (is_admin() or owner_id = auth.uid())
  with check (is_admin() or owner_id = auth.uid());

revoke all on mail_accounts from authenticated, anon;
grant select on my_mail_account to authenticated;
grant select, insert, update on contacts, email_messages, ignored_senders, tasks to authenticated;
