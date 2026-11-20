-- Απόφαση Νίκου 20/11/2026:
--  * Κάθε Account Executive ΒΛΕΠΕΙ ότι υπάρχουν όλοι οι πελάτες (όνομα, κατηγορία, κατάσταση, ποιος τους έχει, πότε έπαιξαν).
--  * Ο ΤΖΙΡΟΣ φαίνεται μόνο σε πελάτες που έχει τρέξει ο ίδιος (είναι δικοί του τώρα ή τους εξυπηρέτησε τελευταίος).
--    Όχι στη βάση, όχι σε πελάτες άλλων.
--  * Για οτιδήποτε άλλο ζητάει πρόσβαση με λόγο· την εγκρίνει ΜΟΝΟ ο Νίκος και κρατάει 7 ημέρες.
--    Με την έγκριση ανοίγει όλη η καρτέλα: ιστορικό, προτάσεις, επαφές, τζίρος.
--  * Dashboard: μόνο Νίκος και Γιάννα (όπως ήταν).

create table customer_access (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  decided_note text,
  expires_at timestamptz
);
create unique index customer_access_one_pending on customer_access (customer_id, user_id) where status = 'pending';
create index on customer_access (user_id, customer_id, status);
alter table customer_access enable row level security;
revoke all on customer_access from authenticated, anon;
grant select on customer_access to authenticated;
create policy access_read on customer_access for select to authenticated using (user_id = auth.uid() or is_admin());
-- εγγραφές και αποφάσεις μόνο μέσα από τις συναρτήσεις παρακάτω

create or replace function has_customer_access(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from customer_access a
                  where a.customer_id = c_id and a.user_id = auth.uid() and a.status = 'approved' and a.expires_at > now())
$$;

-- Ποιος βλέπει ΤΖΙΡΟ: διαχείριση· Account Executive για πελάτες που έχει τρέξει ο ίδιος ή με έγκριση σε ισχύ
create or replace function can_see_revenue(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (app_role() = 'account_exec' and exists (
    select 1 from customers c
     where c.id = c_id
       and (c.owner_id = auth.uid()
            or coalesce(c.served_by = (select p.full_name from profiles p where p.id = auth.uid()), false)
            or has_customer_access(c_id))))
$$;

-- Ποιος βλέπει την ΚΑΡΤΕΛΑ (επαφές, ιστορικό επαφών, προτάσεις): όπως πριν (δικοί του + βάση) και όσοι έχουν έγκριση
create or replace function can_see_customer(c_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from customers c
    where c.id = c_id
      and app_role() = 'account_exec'
      and (c.owner_id = auth.uid() or c.status = 'base' or has_customer_access(c_id))
  )
$$;

-- Οι γραμμές τιμολόγησης είναι τζίρος
drop policy history_read on history_lines;
create policy history_read on history_lines for select to authenticated
  using (customer_id is not null and can_see_revenue(customer_id));

-- Κατάλογος πελατών: ΟΛΟΙ οι πελάτες, με ό,τι δεν επιτρέπεται να φαίνεται κενό.
-- Η εφαρμογή διαβάζει πελάτες με τζίρο ΜΟΝΟ από εδώ· οι στήλες τζίρου του πίνακα κλειδώνουν παρακάτω.
-- Αν προστεθεί στήλη στον πίνακα customers και χρειάζεται εδώ, η όψη ξαναφτιάχνεται.
create view customers_x as
with me as (
  select auth.uid() as uid, is_admin() as adm, app_role() as role,
         (select p.full_name from profiles p where p.id = auth.uid()) as label
)
select c.id, c.display_name, c.category, c.market, c.channel, c.agency, c.agency_id, c.owner_id, c.status, c.stations,
       c.first_period, c.last_period, c.version, c.created_at, c.closed_at, c.served_by, c.served_by_period,
       c.is_group, c.parent_id, c.name_key,
       o.full_name as owner_name, par.display_name as parent_name,
       x.detail_ok, x.rev_ok,
       case when x.detail_ok then c.legal_name end as legal_name,
       case when x.detail_ok then c.afm end as afm,
       case when x.detail_ok then c.doy end as doy,
       case when x.detail_ok then c.phone end as phone,
       case when x.detail_ok then c.email end as email,
       case when x.detail_ok then c.address end as address,
       case when x.detail_ok then c.website end as website,
       case when x.detail_ok then c.facebook end as facebook,
       case when x.detail_ok then c.instagram end as instagram,
       case when x.detail_ok then c.notes end as notes,
       case when x.detail_ok then c.web_status end as web_status,
       case when x.detail_ok then c.web_checked_at end as web_checked_at,
       case when x.detail_ok then c.web_note end as web_note,
       case when x.detail_ok then c.web_sources end as web_sources,
       case when x.detail_ok then c.web_confidence end as web_confidence,
       case when x.detail_ok then c.web_reviewed_at end as web_reviewed_at,
       case when x.detail_ok then c.updated_at end as updated_at,
       case when x.rev_ok then c.lifetime_revenue end as lifetime_revenue,
       case when x.rev_ok then c.revenue_by_year end as revenue_by_year
  from customers c
  cross join me
  left join profiles o on o.id = c.owner_id
  left join customers par on par.id = c.parent_id
  left join lateral (
    select 1 as ok from customer_access a
     where a.customer_id = c.id and a.user_id = me.uid and a.status = 'approved' and a.expires_at > now() limit 1
  ) g on true
  cross join lateral (
    select coalesce(me.adm or (me.role = 'account_exec' and (c.owner_id = me.uid or c.status = 'base' or g.ok is not null)), false) as detail_ok,
           coalesce(me.adm or (me.role = 'account_exec' and (c.owner_id = me.uid or c.served_by = me.label or g.ok is not null)), false) as rev_ok
  ) x
 where coalesce(me.adm or me.role = 'account_exec', false);
grant select on customers_x to authenticated;

-- Αίτημα πρόσβασης από Account Executive
create or replace function request_customer_access(p_customer uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_who text;
begin
  if app_role() is distinct from 'account_exec' then raise exception 'Μόνο Account Executive ζητάει πρόσβαση' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Γράψε γιατί τη χρειάζεσαι'; end if;
  select display_name into v_name from customers where id = p_customer;
  if v_name is null then raise exception 'Ο πελάτης δεν βρέθηκε'; end if;
  if can_see_customer(p_customer) and can_see_revenue(p_customer) then raise exception 'Έχεις ήδη πρόσβαση σε αυτόν τον πελάτη'; end if;
  select id into v_id from customer_access where customer_id = p_customer and user_id = auth.uid() and status = 'pending';
  if v_id is not null then return v_id; end if;
  insert into customer_access (customer_id, user_id, reason) values (p_customer, auth.uid(), left(btrim(p_reason), 400)) returning id into v_id;
  select full_name into v_who from profiles where id = auth.uid();
  insert into notifications (user_id, kind, title, link)
  select p.id, 'access_request', '🔑 ' || v_who || ' ζητάει πρόσβαση: ' || v_name, '/access' from profiles p where p.role = 'ceo' and p.active;
  return v_id;
end $$;
grant execute on function request_customer_access(uuid, text) to authenticated;

-- Απόφαση: μόνο ο Νίκος. Η έγκριση κρατάει 7 ημέρες.
create or replace function decide_customer_access(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r customer_access; v_name text;
begin
  if not is_ceo() then raise exception 'Την πρόσβαση τη δίνει μόνο ο Νίκος' using errcode = '42501'; end if;
  select * into r from customer_access where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'Το αίτημα έχει ήδη απαντηθεί'; end if;
  update customer_access set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decided_note = nullif(btrim(coalesce(p_note, '')), ''),
         expires_at = case when p_approve then now() + interval '7 days' end
   where id = p_id;
  select display_name into v_name from customers where id = r.customer_id;
  insert into notifications (user_id, kind, title, link)
  values (r.user_id, 'access_decided',
          case when p_approve then '✓ Πήρες πρόσβαση για 7 ημέρες: ' || v_name else '✗ Δεν εγκρίθηκε η πρόσβαση: ' || v_name end,
          '/customers/' || r.customer_id);
end $$;
grant execute on function decide_customer_access(uuid, boolean, text) to authenticated;

-- Κλείδωμα στη βάση: οι δύο στήλες τζίρου του πίνακα customers δεν διαβάζονται απευθείας από κανέναν χρήστη.
-- Μόνο μέσα από την όψη customers_x (που ελέγχει ποιος ρωτάει) και από τις συναρτήσεις του συστήματος.
-- ΠΡΟΣΟΧΗ: κάθε νέα στήλη στον πίνακα customers θέλει μετά «select regrant_customer_columns();».
create or replace function regrant_customer_columns() returns void
language plpgsql security definer set search_path = public as $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'customers' and column_name not in ('lifetime_revenue', 'revenue_by_year');
  execute 'revoke select on customers from authenticated, anon';
  execute format('grant select (%s) on customers to authenticated', cols);
end $$;
revoke execute on function regrant_customer_columns() from public, authenticated, anon;
select regrant_customer_columns();

select 'ACCESS OK' as result;
