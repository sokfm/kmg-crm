-- Αναζήτηση που «ακούει» το όνομα: βρίσκει με ελληνικά, greeklish, τόνους ή χωρίς, και σε πελάτες και σε leads.
-- Κάθε όνομα γίνεται ένα απλό «κλειδί» με λατινικούς χαρακτήρες· το ίδιο γίνεται και σε ό,τι πληκτρολογείς.
-- Σκόπιμα χαλαρό (θ=τ, χ=ξ=h=ch, β=μπ=b, η=ι=υ=y, φ=f=β=v, ω=ο=w, διπλά γράμματα = μονά): καλύτερα ένα αποτέλεσμα παραπάνω παρά κανένα.
-- Η ίδια ακριβώς λογική υπάρχει στο lib/format.ts (searchKey). Αν αλλάξει η μία, αλλάζει και η άλλη.
create or replace function gr_key(t text) returns text
language plpgsql immutable parallel safe as $$
declare
  s text := gr_norm(t);
  gr text[] := array['ου','u', 'αι','e', 'ει','i', 'οι','i', 'υι','i', 'μπ','v', 'ντ','d', 'γκ','g', 'γγ','g', 'αυ','av', 'ευ','ev', 'ψ','ps'];
  la text[] := array['ch','x', 'th','t', 'ph','v', 'ks','x', 'ou','u', 'ai','e', 'ei','i', 'oi','i', 'mp','v', 'nt','d', 'gk','g'];
  i int;
begin
  for i in 1..array_length(gr, 1) by 2 loop s := replace(s, gr[i], gr[i + 1]); end loop;
  s := translate(s, 'αβγδεζηθικλμνξοπρστυφχω', 'avgdezitiklmnxoprstivxo');
  for i in 1..array_length(la, 1) by 2 loop s := replace(s, la[i], la[i + 1]); end loop;
  s := translate(s, 'bcqwyhf', 'vkkoixv');
  s := regexp_replace(s, '[^a-z0-9 ]', '', 'g');
  s := regexp_replace(s, '(.)\1+', '\1', 'g');
  return btrim(s);
end $$;

alter table customers drop column name_search;
alter table customers add column name_key text generated always as (gr_key(display_name)) stored;
alter table leads add column name_key text generated always as (gr_key(company_name || ' ' || coalesce(contact_name, ''))) stored;
alter table agencies add column name_key text generated always as (gr_key(name)) stored;

select 'KEY OK' as result, gr_key('Ματράκας') as a, gr_key('matrakas') as b, gr_key('Μπούτσικα') as c, gr_key('boutsika') as d, gr_key('Χαλκίδα') as e, gr_key('chalkida') as f;
