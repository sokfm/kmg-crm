-- Ο τζίρος ακολουθεί το Excel τιμολόγησης (απόφαση Νίκου 20/11/2026).
-- Το Excel («ΤΙΜΟΛΟΓΗΣΗ 2026», «ΤΙΜΟΛΟΓΗΣΗ 2027», ένα φύλλο ανά μήνα) είναι η αλήθεια για τον πραγματικό τζίρο.
-- Κάθε βράδυ η εφαρμογή το διαβάζει και καλεί apply_billing_month για κάθε μήνα:
--   * ίδια γραμμή → μένει (ενημερώνονται ημερομηνίες, σημειώσεις κ.λπ.)
--   * νέα γραμμή → μπαίνει· ο πελάτης βρίσκεται από το όνομα, αλλιώς γίνεται ΕΡΩΤΗΣΗ (ποτέ νέος πελάτης μόνος του)
--   * γραμμή που έφυγε από το Excel → δεν σβήνεται, βγαίνει από τα αθροίσματα (source_scope = 'removed_from_file')
-- Ο αριθμός BICO ΔΕΝ είναι μοναδικός (ίδιος αριθμός σε δύο γραμμές ή δύο μήνες, γραμμές χωρίς αριθμό):
-- η σύγκριση γίνεται με μήνα + BICO + σταθμό + όνομα + ποσό, σαν «σακούλα» γραμμών.
-- Ετικέτα γραμμής: origin = 'lead' (ήρθε από κερδισμένο lead του CRM) ή 'direct' (εκτός CRM: εντολή πρακτορείου, ανανέωση).
-- Οι παλιές γραμμές (πριν από τον συγχρονισμό) μένουν χωρίς ετικέτα = εκτός CRM.

alter table history_lines
  add column name_key text generated always as (gr_key(customer_name_raw)) stored,
  add column origin text check (origin in ('lead', 'direct')),
  add column lead_id uuid references leads (id) on delete set null,
  add column lead_hint uuid references leads (id) on delete set null,
  add column added_at timestamptz,
  add column synced_at timestamptz,
  add column removed_at timestamptz;
create index on history_lines (name_key);
create index on history_lines (billing_year, billing_month);
create index on history_lines (lead_id) where lead_id is not null;

-- Ονόματα του Excel που έχουν απαντηθεί (ή περιμένουν απάντηση: customer_id κενό)
create table billing_names (
  name_key text primary key,
  source_name text not null,
  customer_id uuid references customers (id) on delete cascade,
  asked_at timestamptz not null default now(),
  decided_by uuid references profiles (id),
  decided_at timestamptz
);
alter table billing_names enable row level security;
revoke all on billing_names from authenticated, anon;
grant select on billing_names to authenticated;
create policy billing_names_read on billing_names for select to authenticated using (is_admin());

-- Τι έγινε σε κάθε ανάγνωση (για το «Τελευταία ενημέρωση» και για να φαίνεται αν κάτι δεν διαβάστηκε)
create table billing_sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  summary jsonb not null default '{}'::jsonb,
  error text
);
alter table billing_sync_log enable row level security;
revoke all on billing_sync_log from authenticated, anon;
grant select on billing_sync_log to authenticated;
create policy billing_log_read on billing_sync_log for select to authenticated using (is_admin());

-- Γραμμή χωρίς πελάτη (περιμένει απάντηση για το όνομα): τη βλέπει μόνο η διαχείριση, και μετράει στον τζίρο
drop policy history_read on history_lines;
create policy history_read on history_lines for select to authenticated
  using ((customer_id is not null and can_see_revenue(customer_id)) or (customer_id is null and is_admin()));

create or replace view revenue_monthly with (security_invoker = true) as
select h.billing_year as year, h.billing_month as month, h.period,
       coalesce(h.station, '—') as station, c.owner_id, coalesce(c.channel, 'kmg'::sales_channel) as channel, c.agency_id, h.is_future,
       sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers,
       coalesce(served_by_label(h.account_executive_raw, h.agent_raw), 'Nikos') as ae,
       coalesce(h.origin = 'lead', false) as from_lead
  from history_lines h left join customers c on c.id = h.customer_id
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1, 2, 3, 4, 5, 6, 7, 8, 11, 12;
grant select on revenue_monthly to authenticated, service_role;

create or replace view revenue_yearly with (security_invoker = true) as
select h.billing_year as year, sum(coalesce(h.amount, 0)) as amount, count(distinct h.customer_id) as customers
  from history_lines h
 where h.source_scope = 'monthly_billing' and is_admin()
 group by 1;

-- Ποιος πελάτης είναι αυτό το όνομα του Excel; Κενό = δεν ξέρουμε, γίνεται ερώτηση.
-- 1. ό,τι έχει απαντηθεί· 2. ο πελάτης που είχε την πιο πρόσφατη γραμμή με το ίδιο όνομα (ακολουθεί και τις ενώσεις)·
-- 3. ένας και μοναδικός πελάτης με ακριβώς αυτό το όνομα.
create or replace function billing_customer(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k text := gr_key(p_name); c uuid; n int;
begin
  if coalesce(k, '') = '' then return null; end if;
  select customer_id into c from billing_names where name_key = k;
  if found then return c; end if;
  select h.customer_id into c from history_lines h
   where h.name_key = k and h.customer_id is not null
   order by h.period desc, h.record_id limit 1;
  if c is null then
    select count(*), (array_agg(id))[1] into n, c from customers where name_key = k and closed_at is null and not is_group;
    if n <> 1 then c := null; end if;
  end if;
  insert into billing_names (name_key, source_name, customer_id, decided_at)
  values (k, btrim(p_name), c, case when c is not null then now() end)
  on conflict (name_key) do nothing;
  return c;
end $$;
revoke execute on function billing_customer(text) from public, authenticated, anon;

-- Ετικέτα στις νέες γραμμές ενός πελάτη: αν υπάρχει κερδισμένο lead κοντά στην έναρξη → ερώτηση (lead_hint), αλλιώς «εκτός CRM».
create or replace function billing_tag_lines(p_customer uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; l uuid;
begin
  for r in
    select h.record_id, h.name_key, coalesce(h.campaign_start, make_date(h.billing_year, h.billing_month, 1)) as d
      from history_lines h
     where h.customer_id = p_customer and h.added_at is not null and h.origin is null and h.lead_hint is null
       and h.source_scope = 'monthly_billing'
  loop
    select x.id into l from leads x
     where x.status = 'won' and x.closed_at is not null
       and (x.customer_id = p_customer or gr_key(x.company_name) = r.name_key)
       and x.closed_at::date between r.d - 120 and r.d + 45
     order by abs(x.closed_at::date - r.d) limit 1;
    if l is null then
      update history_lines set origin = 'direct' where record_id = r.record_id;
    else
      update history_lines set lead_hint = l where record_id = r.record_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function billing_tag_lines(uuid) from public, authenticated, anon;

-- Ένας μήνας του Excel. p_lines: [{name, station, bico, amount, amount_type, start, end, ae, agent, kef, status, sponsorship, notes, package, cost_sec}]
-- p_dry = true: μόνο μετράει, δεν αλλάζει τίποτα.
create or replace function apply_billing_month(p_year integer, p_month integer, p_lines jsonb, p_dry boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  per text := p_year || '-' || lpad(p_month::text, 2, '0');
  n_file int; n_db int; n_same int; n_changed int := 0; n_added int := 0; n_removed int := 0; n_names int := 0; n_leads int := 0;
  fut boolean := p_year > extract(year from now() at time zone 'Europe/Athens');
  r record; c uuid; touched uuid[] := '{}';
begin
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then raise exception 'Λάθος μήνας: %', per; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Περίμενα λίστα γραμμών'; end if;

  perform set_config('client_min_messages', 'warning', true);
  drop table if exists _f, _d;
  create temp table _f on commit drop as
  select t.idx::int as idx,
         btrim(t.j ->> 'name') as name, gr_key(t.j ->> 'name') as nkey,
         nullif(btrim(t.j ->> 'station'), '') as station,
         nullif(btrim(t.j ->> 'bico'), '') as bico,
         round((t.j ->> 'amount')::numeric, 2) as amount,
         coalesce(t.j ->> 'amount_type', 'missing') as amount_type,
         (t.j ->> 'start')::date as d_start, (t.j ->> 'end')::date as d_end,
         nullif(btrim(t.j ->> 'ae'), '') as ae, nullif(btrim(t.j ->> 'agent'), '') as agent,
         nullif(btrim(t.j ->> 'kef'), '') as kef, nullif(btrim(t.j ->> 'status'), '') as status,
         nullif(btrim(t.j ->> 'sponsorship'), '') as sponsorship, nullif(btrim(t.j ->> 'notes'), '') as notes,
         nullif(btrim(t.j ->> 'package'), '') as package, nullif(btrim(t.j ->> 'cost_sec'), '') as cost_sec,
         null::text as rid, 0 as pass
    from jsonb_array_elements(p_lines) with ordinality as t(j, idx)
   where coalesce(btrim(t.j ->> 'name'), '') <> '';

  create temp table _d on commit drop as
  select h.record_id, h.name_key as nkey, h.station, nullif(btrim(h.bico_raw), '') as bico, h.amount, h.amount_type, false as used
    from history_lines h
   where h.billing_year = p_year and h.billing_month = p_month and h.source_scope = 'monthly_billing';

  select count(*) into n_file from _f;
  select count(*) into n_db from _d;
  -- Δικλείδα: άδειο ή μισό φύλλο δεν «σβήνει» μήνα που είχε γραμμές
  if n_db > 0 and (n_file = 0 or (n_db >= 10 and n_file < n_db * 0.5)) then
    return jsonb_build_object('period', per, 'skipped', true, 'file', n_file, 'crm', n_db);
  end if;

  -- Τέσσερα περάσματα, από το πιο αυστηρό στο πιο χαλαρό. Κάθε γραμμή ταιριάζει το πολύ μία φορά.
  for r in select * from (values
      (1, 'coalesce(bico, '''') || ''|'' || coalesce(station, '''') || ''|'' || nkey || ''|'' || amount_type || ''|'' || coalesce(amount, 0)'),
      (2, 'bico || ''|'' || coalesce(station, '''') || ''|'' || nkey'),
      (3, 'coalesce(station, '''') || ''|'' || nkey || ''|'' || amount_type || ''|'' || coalesce(amount, 0)'),
      (4, 'coalesce(station, '''') || ''|'' || nkey')) as v(pass, k) order by 1
  loop
    execute format($q$
      with f as (select idx, %1$s as k, row_number() over (partition by %1$s order by idx) as rn from _f where rid is null),
           d as (select record_id, %1$s as k, row_number() over (partition by %1$s order by record_id) as rn from _d where not used)
      update _f set rid = d.record_id, pass = %2$s from f join d on d.k = f.k and d.rn = f.rn where _f.idx = f.idx
    $q$, r.k, r.pass);
    update _d set used = true where record_id in (select rid from _f where rid is not null);
  end loop;

  select count(*) filter (where pass = 1), count(*) filter (where pass > 1), count(*) filter (where rid is null)
    into n_same, n_changed, n_added from _f;
  select count(*) into n_removed from _d where not used;
  select count(distinct f.nkey) into n_names from _f f
   where f.rid is null
     and not exists (select 1 from billing_names b where b.name_key = f.nkey and b.customer_id is not null)
     and not exists (select 1 from history_lines h where h.name_key = f.nkey and h.customer_id is not null)
     and (select count(*) from customers cu where cu.name_key = f.nkey and cu.closed_at is null and not cu.is_group) <> 1;

  if p_dry then
    return jsonb_build_object('period', per, 'dry', true, 'file', n_file, 'crm', n_db, 'same', n_same, 'changed', n_changed,
      'added', n_added, 'removed', n_removed, 'names', n_names,
      'added_list', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'station', station, 'bico', bico, 'amount', coalesce(amount::text, amount_type)) order by idx), '[]'::jsonb) from _f where rid is null),
      'changed_list', (select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'station', f.station, 'bico', f.bico, 'amount', coalesce(f.amount::text, f.amount_type), 'was', coalesce(d.amount::text, d.amount_type), 'was_bico', d.bico) order by f.idx), '[]'::jsonb) from _f f join _d d on d.record_id = f.rid where f.pass > 1),
      'removed_list', (select coalesce(jsonb_agg(jsonb_build_object('name', h.customer_name_raw, 'station', h.station, 'bico', h.bico_raw, 'amount', coalesce(h.amount::text, h.amount_type))), '[]'::jsonb) from _d d join history_lines h using (record_id) where not d.used));
  end if;

  -- Υπάρχουσες γραμμές: ό,τι γράφει τώρα το Excel
  update history_lines h set
      customer_name_raw = f.name, station = f.station, bico_raw = f.bico, amount = f.amount, amount_type = f.amount_type,
      campaign_start = f.d_start, campaign_end = f.d_end, account_executive_raw = f.ae, agent_raw = f.agent,
      kef_raw = f.kef, status_raw = f.status, sponsorship_raw = f.sponsorship, notes_raw = f.notes,
      package_raw = f.package, cost_per_sec_raw = f.cost_sec, is_future = fut, synced_at = now()
    from _f f where f.rid = h.record_id;
  select touched || coalesce(array_agg(distinct h.customer_id) filter (where h.customer_id is not null), '{}') into touched
    from history_lines h join _f f on f.rid = h.record_id where f.pass > 1;

  -- Έφυγαν από το Excel: βγαίνουν από τα αθροίσματα, δεν σβήνονται
  select touched || coalesce(array_agg(distinct h.customer_id) filter (where h.customer_id is not null), '{}') into touched
    from history_lines h join _d d using (record_id) where not d.used;
  update history_lines h set source_scope = 'removed_from_file', removed_at = now()
    from _d d where d.record_id = h.record_id and not d.used;

  -- Νέες γραμμές
  for r in select * from _f where rid is null order by idx loop
    c := billing_customer(r.name);
    insert into history_lines (record_id, source_customer_id, customer_id, customer_name_raw, period, billing_year, billing_month,
        station, amount, amount_type, campaign_start, campaign_end, account_executive_raw, agent_raw, kef_raw, bico_raw,
        status_raw, sponsorship_raw, notes_raw, package_raw, cost_per_sec_raw, is_future, source_scope, added_at, synced_at)
    values ('BX_' || replace(gen_random_uuid()::text, '-', ''), 'BK_' || md5(r.nkey), c, r.name, per, p_year, p_month,
        r.station, r.amount, r.amount_type, r.d_start, r.d_end, r.ae, r.agent, r.kef, r.bico,
        r.status, r.sponsorship, r.notes, r.package, r.cost_sec, fut, 'monthly_billing', now(), now());
    if c is not null then touched := touched || c; end if;
  end loop;

  for c in select distinct unnest(touched) loop
    n_leads := n_leads + billing_tag_lines(c);
    perform refresh_customer_stats(c);
  end loop;

  return jsonb_build_object('period', per, 'file', n_file, 'crm', n_db, 'same', n_same, 'changed', n_changed,
    'added', n_added, 'removed', n_removed, 'names', n_names, 'leads', n_leads);
end $$;
revoke execute on function apply_billing_month(integer, integer, jsonb, boolean) from public, authenticated, anon;
grant execute on function apply_billing_month(integer, integer, jsonb, boolean) to service_role;

-- Τέλος ανάγνωσης: γράφει το ημερολόγιο και ειδοποιεί τον Νίκο αν κάτι θέλει απάντηση ή δεν διαβάστηκε.
-- (Στην αρχή απαντάει μόνο ο Νίκος· όταν το περάσει στη Γιάννα, αλλάζει εδώ ποιος ειδοποιείται.)
create or replace function finish_billing_sync(p_summary jsonb, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare q int; lq int; msg text;
begin
  -- Το «μέλλον» αλλάζει κάθε Πρωτοχρονιά
  update history_lines set is_future = (billing_year > extract(year from now() at time zone 'Europe/Athens'))
   where is_future <> (billing_year > extract(year from now() at time zone 'Europe/Athens'));
  insert into billing_sync_log (ok, summary, error) values (p_error is null, coalesce(p_summary, '{}'::jsonb), p_error);
  select count(*) into q from billing_names where customer_id is null;
  select count(distinct (customer_id, lead_hint)) into lq from history_lines where lead_hint is not null and origin is null and source_scope = 'monthly_billing';
  if p_error is not null then msg := 'Η τιμολόγηση δεν διαβάστηκε: ' || left(p_error, 120);
  elsif coalesce((p_summary ->> 'skipped')::int, 0) > 0 then msg := 'Τιμολόγηση: ' || (p_summary ->> 'skipped') || ' μήνας/ες δεν ενημερώθηκαν (το φύλλο φαίνεται άδειο ή μισό)';
  elsif q + lq > 0 and coalesce((p_summary ->> 'added')::int, 0) > 0 then msg := 'Τιμολόγηση: ' || (q + lq) || ' ερώτηση/εις περιμένουν απάντηση';
  end if;
  if msg is not null then
    insert into notifications (user_id, kind, title, link)
    select p.id, 'billing', msg, '/billing' from profiles p where p.role = 'ceo' and p.active;
  end if;
end $$;
revoke execute on function finish_billing_sync(jsonb, text) from public, authenticated, anon;
grant execute on function finish_billing_sync(jsonb, text) to service_role;

-- Προτάσεις «μήπως είναι αυτός;» για ένα όνομα που δεν βρέθηκε
create or replace function billing_name_suggestions(p_key text, p_search text default null)
returns table (id uuid, display_name text, last_period text, served_by text, score int)
language sql stable security definer set search_path = public as $$
  with w as (
    select distinct x as word from unnest(string_to_array(coalesce(nullif(gr_key(p_search), ''), p_key), ' ')) x where length(x) >= 4
  )
  select c.id, c.display_name, c.last_period, c.served_by, count(*)::int as score
    from customers c join w on c.name_key like '%' || w.word || '%'
   where is_admin() and c.closed_at is null
   group by c.id, c.display_name, c.last_period, c.served_by, c.lifetime_revenue
   order by count(*) desc, c.last_period desc nulls last, c.lifetime_revenue desc
   limit 8
$$;
grant execute on function billing_name_suggestions(text, text) to authenticated;

-- Απάντηση στο «ποιος πελάτης είναι;»: υπάρχων πελάτης ή νέος. Το θυμάται για πάντα.
create or replace function answer_billing_name(p_key text, p_customer uuid default null, p_new boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare b billing_names; c uuid := p_customer;
begin
  if not is_admin() then raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  select * into b from billing_names where name_key = p_key for update;
  if not found then raise exception 'Δεν βρέθηκε το όνομα'; end if;
  if b.customer_id is not null then raise exception 'Έχει ήδη απαντηθεί'; end if;
  if p_new then
    insert into customers (display_name, status) values (upper(b.source_name), 'base') returning id into c;
  elsif c is null or not exists (select 1 from customers where id = c) then
    raise exception 'Διάλεξε πελάτη ή «Νέος πελάτης»';
  end if;
  update billing_names set customer_id = c, decided_by = auth.uid(), decided_at = now() where name_key = p_key;
  update history_lines set customer_id = c where customer_id is null and name_key = p_key;
  perform billing_tag_lines(c);
  perform refresh_customer_stats(c);
  return c;
end $$;
grant execute on function answer_billing_name(text, uuid, boolean) to authenticated;

-- Απάντηση στο «ήρθε από αυτό το lead;»: μία φορά για όλες τις γραμμές της καμπάνιας
create or replace function answer_billing_lead(p_customer uuid, p_lead uuid, p_yes boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_admin() then raise exception 'Μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  update history_lines set origin = case when p_yes then 'lead' else 'direct' end,
                           lead_id = case when p_yes then p_lead end
   where customer_id = p_customer and lead_hint = p_lead and origin is null;
  get diagnostics n = row_count;
  if p_yes then
    update leads set customer_id = p_customer where id = p_lead and customer_id is null;
  end if;
  return n;
end $$;
grant execute on function answer_billing_lead(uuid, uuid, boolean) to authenticated;

-- Κερδισμένα leads που δεν φαίνονται στην τιμολόγηση: κλείστηκαν πάνω από 7 ημέρες πριν και από τον μήνα που κλείστηκαν
-- και μετά δεν υπάρχει καμία γραμμή για τον πελάτη (ούτε με το όνομά του).
create view won_not_billed with (security_invoker = true) as
select l.id, l.company_name, l.owner_id, l.closed_at, l.expected_value
  from leads l
 where is_admin() and l.status = 'won' and l.closed_at is not null and l.closed_at < now() - interval '7 days'
   and not exists (
     select 1 from history_lines h
      where h.source_scope = 'monthly_billing'
        and h.period >= to_char(l.closed_at at time zone 'Europe/Athens', 'YYYY-MM')
        and (h.customer_id = l.customer_id or h.lead_id = l.id or h.name_key = gr_key(l.company_name)));
grant select on won_not_billed to authenticated;

select 'BILLING SYNC OK' as result;
