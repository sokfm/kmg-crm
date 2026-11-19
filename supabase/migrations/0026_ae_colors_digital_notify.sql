-- 1. Χρώμα ανά Account Executive στο Pipeline (ο Νίκος magenta)
alter table profiles add column color text check (color ~ '^#[0-9A-Fa-f]{6}$');
update profiles set color = case full_name
  when 'Nikos' then '#ED30D2'
  when 'Drakidou' then '#0D9488'
  when 'Stamoulakis' then '#2563EB'
  when 'Boutsika' then '#EA580C'
  when 'Tsalla' then '#7C3AED'
  else null end;

-- 2. Όταν σε ένα lead ραδιοφώνου ανάψει και το Digital: ειδοποίηση και εργασία στον υπεύθυνο digital.
-- (Τα σκέτα digital leads πάνε ήδη κατευθείαν σε αυτόν.)
create or replace function trg_lead_digital_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if 'digital' = any (new.interests) and 'radio' = any (new.interests)
     and (tg_op = 'INSERT' or not ('digital' = any (old.interests))) then
    for p in select id from profiles where sees_digital and active and id is distinct from new.owner_id and id is distinct from auth.uid() loop
      insert into notifications (user_id, kind, title, link)
      values (p.id, 'lead_wants_digital', 'Θέλει και digital: ' || new.company_name, '/leads/' || new.id);
      insert into tasks (title, details, due_date, owner_id, lead_id, source, created_by)
      values ('Ετοίμασε το digital κομμάτι: ' || new.company_name, 'Ο πελάτης ενδιαφέρεται για ραδιόφωνο και digital. Συνεννοήσου με τον Account Executive του lead.',
              current_date + 2, p.id, new.id, 'manual', auth.uid());
    end loop;
  end if;
  return null;
end $$;
create trigger leads_digital_notify after insert or update of interests on leads for each row execute function trg_lead_digital_notify();

-- 3. Προτάσεις που φτιάχτηκαν πριν μπει ο κανόνας: γράψε τώρα την αξία τους στο lead
do $$ declare r record; begin
  for r in select distinct lead_id from proposals where is_main loop perform sync_lead_value(r.lead_id); end loop;
end $$;

select 'COLORS OK' as result,
  (select string_agg(full_name || ' ' || coalesce(color, '-'), ', ' order by full_name) from profiles where active) as colors,
  (select string_agg(l.company_name || ' = ' || l.expected_value, ', ') from leads l join proposals p on p.lead_id = l.id and p.is_main) as lead_values;
