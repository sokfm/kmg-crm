-- Εκπτώσεις στην πρόταση (απόφαση Νίκου 20/11/2026):
--   8% combo όταν η πρόταση έχει πάνω από ένα ραδιόφωνο, 10% προπληρωμή — «by the book», χωρίς έγκριση.
--   Οτιδήποτε καλύτερο: ο Account Executive ζητάει ειδική τιμή με αιτιολογία και την εγκρίνει ο Νίκος ή η Γιάννα.
alter table proposals
  add column prepay boolean not null default false,
  add column req_amount numeric(10, 2) check (req_amount > 0),
  add column req_reason text,
  add column req_status text check (req_status in ('pending', 'approved', 'rejected')),
  add column req_by uuid references profiles (id),
  add column req_at timestamptz,
  add column decided_by uuid references profiles (id),
  add column decided_at timestamptz,
  add column decided_note text;

-- Τα ποσά κάθε πρότασης, υπολογισμένα σε ένα σημείο
create view proposal_totals with (security_invoker = true) as
with it as (
  select proposal_id,
         sum(months * case when long_months is not null and long_amount is not null and months >= long_months then long_amount else monthly_amount end) as list_total,
         count(distinct station) as n_stations
    from proposal_items group by proposal_id
), b as (
  select p.id as proposal_id, p.lead_id, coalesce(it.list_total, 0) as list_total, coalesce(it.n_stations, 0) as n_stations,
         case when coalesce(it.n_stations, 0) > 1 then 8 else 0 end as combo_pct,
         case when p.prepay then 10 else 0 end as prepay_pct,
         p.req_status, p.req_amount
    from proposals p left join it on it.proposal_id = p.id
)
select proposal_id, lead_id, list_total, n_stations, combo_pct, prepay_pct,
       round(list_total * (100 - combo_pct) / 100.0 * (100 - prepay_pct) / 100.0, 2) as book_total,
       case when req_status = 'approved' then req_amount
            else round(list_total * (100 - combo_pct) / 100.0 * (100 - prepay_pct) / 100.0, 2) end as final_total
  from b;
grant select on proposal_totals to authenticated;

-- Η αξία του lead = τελική τιμή της κύριας πρότασης
create or replace function sync_lead_value(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  select t.final_total into v from proposals p join proposal_totals t on t.proposal_id = p.id
   where p.lead_id = p_lead and p.is_main and t.list_total > 0;
  if v is not null then
    update leads set expected_value = v where id = p_lead and status not in ('won', 'lost') and expected_value is distinct from v;
  end if;
end $$;

-- Τα πεδία της ειδικής τιμής αλλάζουν μόνο μέσα από τις συναρτήσεις παρακάτω.
-- Αν αλλάξει η προπληρωμή, το αίτημα ακυρώνεται (άλλαξε η βάση του).
create or replace function trg_proposal_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('kmg.discount', true), '') <> '1' then
    if new.prepay is distinct from old.prepay and old.req_status is not null then
      new.req_status := null; new.req_amount := null; new.decided_by := null; new.decided_at := null; new.decided_note := null;
    elsif (new.req_status, new.req_amount, new.decided_by, new.decided_at) is distinct from (old.req_status, old.req_amount, old.decided_by, old.decided_at) then
      raise exception 'Η ειδική τιμή αλλάζει μόνο με αίτημα και έγκριση' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger proposals_guard before update on proposals for each row execute function trg_proposal_guard();

-- Αν αλλάξουν οι γραμμές της πρότασης, το αίτημα ειδικής τιμής ακυρώνεται και ξαναγράφεται η αξία του lead
create or replace function trg_proposal_value() returns trigger
language plpgsql security definer set search_path = public as $$
declare l uuid; pid uuid;
begin
  if tg_table_name = 'proposals' then
    l := coalesce(new.lead_id, old.lead_id);
  else
    pid := coalesce(new.proposal_id, old.proposal_id);
    select lead_id into l from proposals where id = pid;
    perform set_config('kmg.discount', '1', true);
    update proposals set req_status = null, req_amount = null, decided_by = null, decided_at = null, decided_note = null
     where id = pid and req_status is not null;
    perform set_config('kmg.discount', '', true);
  end if;
  if l is not null then perform sync_lead_value(l); end if;
  return null;
end $$;
drop trigger proposals_value on proposals;
create trigger proposals_value after update of is_main, prepay, req_status on proposals for each row execute function trg_proposal_value();

-- Αίτημα ειδικής τιμής. Αν το κάνει ο Νίκος ή η Γιάννα, εγκρίνεται αμέσως.
create or replace function request_discount(p_id uuid, p_amount numeric, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare l uuid; book numeric; company text; who text; st text;
begin
  select p.lead_id, t.book_total into l, book from proposals p join proposal_totals t on t.proposal_id = p.id where p.id = p_id;
  if l is null or not can_see_lead(l) then raise exception 'Η πρόταση δεν βρέθηκε' using errcode = '42501'; end if;
  if book <= 0 then raise exception 'Η πρόταση είναι άδεια'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= book then raise exception 'Η ειδική τιμή πρέπει να είναι κάτω από την τιμή by the book'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Γράψε τον λόγο'; end if;
  st := case when is_admin() then 'approved' else 'pending' end;
  perform set_config('kmg.discount', '1', true);
  update proposals set req_amount = round(p_amount, 2), req_reason = trim(p_reason), req_status = st, req_by = auth.uid(), req_at = now(),
         decided_by = case when st = 'approved' then auth.uid() end, decided_at = case when st = 'approved' then now() end, decided_note = null
   where id = p_id;
  perform set_config('kmg.discount', '', true);
  if st = 'pending' then
    select company_name into company from leads where id = l;
    select full_name into who from profiles where id = auth.uid();
    insert into notifications (user_id, kind, title, link)
    select id, 'discount_request', coalesce(who, 'Account Executive') || ' ζητάει ειδική τιμή: ' || company || ' ' || round(p_amount) || ' € αντί ' || round(book) || ' €', '/leads/' || l || '/proposal/' || p_id
      from profiles where role in ('ceo', 'sales_manager') and active and id is distinct from auth.uid();
  end if;
  return st;
end $$;
grant execute on function request_discount(uuid, numeric, text) to authenticated;

create or replace function decide_discount(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r proposals; company text;
begin
  if not is_admin() then raise exception 'Εγκρίνει μόνο ο Νίκος ή η Γιάννα' using errcode = '42501'; end if;
  select * into r from proposals where id = p_id;
  if r.id is null or r.req_status is distinct from 'pending' then raise exception 'Δεν υπάρχει αίτημα σε αναμονή'; end if;
  perform set_config('kmg.discount', '1', true);
  update proposals set req_status = case when p_ok then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decided_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
  perform set_config('kmg.discount', '', true);
  select company_name into company from leads where id = r.lead_id;
  if r.req_by is not null and r.req_by is distinct from auth.uid() then
    insert into notifications (user_id, kind, title, link)
    values (r.req_by, 'discount_decided', case when p_ok then 'Εγκρίθηκε' else 'Δεν εγκρίθηκε' end || ' η ειδική τιμή: ' || company || ' ' || round(r.req_amount) || ' €', '/leads/' || r.lead_id || '/proposal/' || p_id);
  end if;
end $$;
grant execute on function decide_discount(uuid, boolean, text) to authenticated;

select 'DISCOUNTS OK' as result, (select count(*) from proposal_totals) as proposals;
