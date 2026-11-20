-- Απόφαση Νίκου 20/11/2026: το email ΔΕΝ ανοίγει τίποτα μόνο του.
--  * Πιθανό νέο lead → πάντα «Προς έλεγχο»· γίνεται lead μόνο με ΟΚ του κατόχου του γραμματοκιβωτίου.
--  * Εργασίες και επόμενο βήμα που βγάζει η AI από email γνωστού πελάτη/lead → ΠΡΟΤΑΣΕΙΣ (suggest = pending), γράφονται με ΟΚ.
--    Η ίδια η επαφή «Email» συνεχίζει να γράφεται μόνη της στην καρτέλα (είναι γεγονός, όχι κρίση).
--  * Το ίδιο email σε δύο γραμματοκιβώτια (κοινά inbox, cc) μετράει ΜΙΑ φορά (internet_id)· αν είναι για έλεγχο, πάει στον Νίκο.
--  * Πριν προταθεί νέο lead, ελέγχεται αν υπάρχει ήδη lead με ίδιο όνομα ή τηλέφωνο (lead_hint).
--  * Ό,τι μένει στο «Προς έλεγχο» πάνω από 24 ώρες → υπενθύμιση (09:00–20:00).
alter table email_messages
  add column internet_id text,
  add column ai_tasks jsonb not null default '[]'::jsonb,
  add column ai_next_step text,
  add column ai_next_due date,
  add column lead_hint uuid references leads (id) on delete set null,
  add column lead_hint_label text,
  add column suggest text not null default 'none' check (suggest in ('none', 'pending', 'done', 'dismissed'));
create index email_messages_internet_id on email_messages (internet_id) where internet_id is not null;
create index email_messages_suggest on email_messages (user_id) where suggest = 'pending';

-- Υπάρχει ήδη lead που μοιάζει; (ίδιο «κλειδί» ονόματος ή ίδιο τηλέφωνο). Ανοιχτά πρώτα, μετά τα πιο πρόσφατα.
create or replace function find_lead_like(p_company text, p_phone text) returns table (id uuid, label text)
language sql stable security definer set search_path = public as $$
  with ph as (select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as d),
       k as (select gr_key(coalesce(p_company, '')) as v)
  select l.id,
         l.company_name
           || case l.status when 'won' then ' · κερδισμένο' when 'lost' then ' · χαμένο' else ' · ανοιχτό' end
           || coalesce(' · ' || p.full_name, ' · χωρίς υπεύθυνο')
    from leads l left join profiles p on p.id = l.owner_id, ph, k
   where (length(k.v) >= 3 and gr_key(l.company_name) = k.v)
      or (length(ph.d) = 10 and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = ph.d)
   order by (l.status not in ('won', 'lost')) desc, l.created_at desc
   limit 1;
$$;
revoke all on function find_lead_like(text, text) from public, anon, authenticated;
grant execute on function find_lead_like(text, text) to service_role;

-- «Είναι το ίδιο»: ο κάτοχος του email το δένει στο lead που υπάρχει ήδη, ακόμα κι αν το lead είναι άλλου
-- (γράφεται μόνο η επαφή με θέμα και περίληψη· δεν αποκτά πρόσβαση στην καρτέλα).
create or replace function link_email_to_hint(p_email uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e email_messages;
begin
  select * into e from email_messages where id = p_email and user_id = auth.uid() and status = 'review' for update;
  if e.id is null then raise exception 'Το email δεν βρέθηκε ή έχει ήδη απαντηθεί'; end if;
  if e.lead_hint is null then raise exception 'Δεν υπάρχει lead για σύνδεση'; end if;
  update email_messages set status = 'logged', lead_id = e.lead_hint, decided_at = now() where id = e.id;
  insert into activities (user_id, lead_id, type, summary, occurred_at, email_message_id)
  values (auth.uid(), e.lead_hint, 'email',
          case when e.direction = 'in' then '📥 ' else '📤 ' end || coalesce(e.subject, '') || coalesce(' — ' || nullif(e.summary, ''), ''),
          e.occurred_at, e.id);
  return e.lead_hint;
end $$;
revoke all on function link_email_to_hint(uuid) from public, anon;
grant execute on function link_email_to_hint(uuid) to authenticated;

-- Υπενθύμιση για ό,τι περιμένει πάνω από μία μέρα στο «Προς έλεγχο» (μία φορά ανά email).
create or replace function make_inbox_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; h int := extract(hour from now() at time zone 'Europe/Athens');
begin
  if h < 9 or h >= 20 then return 0; end if;
  with due as (
    select id, user_id, coalesce(ai_company, counterpart_name, counterpart_email) as who,
           (created_at at time zone 'Europe/Athens') + interval '24 hours' as due_at
      from email_messages where status = 'review' and created_at < now() - interval '24 hours'
  ), fresh as (
    insert into reminder_log (kind, ref_id, due_at) select 'inbox', id, due_at from due on conflict do nothing returning ref_id
  )
  insert into notifications (user_id, kind, title, link)
  select d.user_id, 'inbox_waiting', 'Περιμένει πάνω από μία μέρα το ΟΚ σου: ' || d.who, '/inbox'
    from due d join fresh f on f.ref_id = d.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function make_inbox_reminders() from public, anon, authenticated;
grant execute on function make_inbox_reminders() to service_role;

-- Όσα περιμένουν ήδη πάνω από μέρα: σημειώνονται ως «υπενθυμισμένα» για να μη χτυπήσουν όλα μαζί
insert into reminder_log (kind, ref_id, due_at)
select 'inbox', id, (created_at at time zone 'Europe/Athens') + interval '24 hours' from email_messages
 where status = 'review' and created_at < now() - interval '24 hours' on conflict do nothing;

select 'EMAIL OK FIRST' as result;
