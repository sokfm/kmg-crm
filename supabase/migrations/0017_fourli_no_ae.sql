-- FOURLI: απόφαση Νίκου 19/11/2026 — οι πελάτες του μένουν χωρίς agent / Account Executive
create or replace function served_by_label(acc text, agent text) returns text
language sql stable set search_path = public as $$
  select case
    when acc is null or trim(acc) = '' then null
    when upper(trim(acc)) = 'FOURLI' or upper(trim(coalesce(agent, ''))) = 'FOURLI' then null
    when upper(acc) like 'STAMOULAKIS%' then 'Stamoulakis'
    when upper(acc) like 'MEDIA SHOP%' then 'Media shop' || coalesce(' · ' || nullif(agency_canonical(replace(upper(agent), 'U NEDIA', 'U MEDIA')), ''), '')
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'DRAKIDOU%' then 'Drakidou'
    when upper(acc) like 'KARTELIAS%' and upper(coalesce(agent, '')) like 'BOUTSIKA%' then 'Boutsika'
    when upper(acc) like 'KARTELIAS%' and (trim(coalesce(agent, '')) = '' or upper(trim(agent)) in ('NIKOS', 'ΝΙΚΟΣ', 'KARTELIAS', 'ΚΑΡΤΕΛΙΑΣ', 'BARTER')) then 'Nikos'
    when upper(acc) like 'KARTELIAS%' and is_agency_name(agent) then 'Media shop · ' || agency_canonical(agent)
    when upper(acc) like 'KARTELIAS%' then initcap(lower(agent))
    when is_agency_name(acc) then 'Media shop · ' || agency_canonical(replace(upper(acc), 'U NEDIA', 'U MEDIA'))
    else initcap(lower(acc))
  end
$$;

update customers set served_by = null, served_by_period = null where served_by = 'Fourli';

select 'FOURLI OK' as result, count(*) as left_with_fourli from customers where served_by = 'Fourli';
