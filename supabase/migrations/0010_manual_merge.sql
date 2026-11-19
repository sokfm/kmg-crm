-- Ένωση πελατών με το χέρι από τη λίστα πελατών (ό,τι δεν έπιασαν οι αυτόματες ομάδες).
-- Και διόρθωση της ένωσης: μεταφέρονται ΚΑΙ οι διευθύνσεις email, εργασίες, email, αιτήματα βάσης
-- και η σύνδεση με media shop (πριν χάνονταν ή αποσυνδέονταν).

create or replace function merge_customers(p_keep uuid, p_others uuid[], p_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  if p_others is null or array_length(p_others, 1) is null then
    if p_name is not null then update customers set display_name = p_name where id = p_keep; end if;
    return;
  end if;
  update customer_aliases set customer_id = p_keep where customer_id = any (p_others);
  update history_lines set customer_id = p_keep where customer_id = any (p_others);
  update leads set customer_id = p_keep where customer_id = any (p_others);
  update activities set customer_id = p_keep where customer_id = any (p_others);
  update contacts set customer_id = p_keep where customer_id = any (p_others);
  update tasks set customer_id = p_keep where customer_id = any (p_others);
  update email_messages set customer_id = p_keep where customer_id = any (p_others);
  -- Ένα μόνο ανοιχτό αίτημα βάσης ανά πελάτη: τα περιττά κλείνουν
  update base_claims b set status = 'rejected', decided_at = now(), note = coalesce(b.note || ' · ', '') || 'έκλεισε λόγω ένωσης πελατών'
   where b.customer_id = any (p_others) and b.status in ('pending', 'approved')
     and (exists (select 1 from base_claims k where k.customer_id = p_keep and k.status in ('pending', 'approved'))
          or b.id <> (select o.id from base_claims o where o.customer_id = any (p_others) and o.status in ('pending', 'approved') order by o.created_at limit 1));
  update base_claims set customer_id = p_keep where customer_id = any (p_others);
  insert into campaigns (customer_id, name)
    select p_keep, name from campaigns where customer_id = any (p_others)
    on conflict do nothing;
  -- Υπεύθυνος, media shop, στοιχεία επικοινωνίας: κρατάμε του πελάτη που μένει· αλλιώς του πιο πρόσφατου
  update customers k set
    owner_id = coalesce(k.owner_id, (select o.owner_id from customers o where o.id = any (p_others) and o.owner_id is not null order by o.last_period desc nulls last limit 1)),
    agency_id = coalesce(k.agency_id, (select o.agency_id from customers o where o.id = any (p_others) and o.agency_id is not null order by o.last_period desc nulls last limit 1)),
    agency = coalesce(k.agency, (select o.agency from customers o where o.id = any (p_others) and o.agency is not null order by o.last_period desc nulls last limit 1)),
    phone = coalesce(k.phone, (select o.phone from customers o where o.id = any (p_others) and o.phone is not null limit 1)),
    email = coalesce(k.email, (select o.email from customers o where o.id = any (p_others) and o.email is not null limit 1)),
    afm = coalesce(k.afm, (select o.afm from customers o where o.id = any (p_others) and o.afm is not null limit 1)),
    status = case when k.status = 'active' or exists (select 1 from customers o where o.id = any (p_others) and o.status = 'active')
                  then 'active'::customer_status else k.status end
  where k.id = p_keep;
  if p_name is not null then
    update customers set display_name = p_name where id = p_keep;
  end if;
  delete from customers where id = any (p_others);
  perform refresh_customer_stats(p_keep);
end $$;
revoke execute on function merge_customers(uuid, uuid[], text) from authenticated;

-- Από την οθόνη: διαλέγεις 2+ πελάτες και ποιο όνομα κρατάμε.
create or replace function merge_customers_manual(p_ids uuid[], p_keep uuid default null, p_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  keep uuid;
  others uuid[];
  n int;
begin
  if not is_admin() then
    raise exception 'Ενώσεις πελατών κάνουν μόνο ο Νίκος ή η Γιάννα' using errcode = '42501';
  end if;
  select count(*) into n from customers where id = any (p_ids);
  if n < 2 then
    raise exception 'Διάλεξε τουλάχιστον 2 πελάτες';
  end if;
  -- Μένει ο πελάτης με τον μεγαλύτερο τζίρο (κρατά ιστορικό, υπεύθυνο κ.λπ.)
  select array_agg(id order by lifetime_revenue desc, last_period desc nulls last) into others from customers where id = any (p_ids);
  keep := others[1];
  others := others[2:];
  perform merge_customers(keep, others,
    coalesce(nullif(upper(trim(p_name)), ''), (select display_name from customers where id = p_keep and id = any (p_ids))));

  -- Αυτόματες ομάδες που πλέον έχουν έναν μόνο πελάτη: κλείνουν ως «ίδιος»
  update merge_candidates m set decision = 'same', decided_by = auth.uid(), decided_at = now()
   where m.decision = 'pending'
     and (select count(distinct a.customer_id) from customer_aliases a where a.source_customer_id = any (m.source_customer_ids)) < 2;
  return keep;
end $$;
grant execute on function merge_customers_manual(uuid[], uuid, text) to authenticated;
