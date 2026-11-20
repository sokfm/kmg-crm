-- Αναζήτηση πελατών την ώρα που γράφεις: να βρίσκει ανεξάρτητα από τόνους, κεφαλαία και τελικό σίγμα
-- («ματρακας», «Ματράκας», «ΜΑΤΡΑΚΑΣ» → ίδιο αποτέλεσμα).
create or replace function gr_norm(t text) returns text
language sql immutable parallel safe as $$
  select translate(lower(coalesce(t, '')),
                   'άέήίόύώϊϋΐΰςΆΈΉΊΌΎΏΪΫ',
                   'αεηιουωιυιυσαεηιουωιυ')
$$;
alter table customers add column name_search text generated always as (gr_norm(display_name)) stored;

select 'SEARCH OK' as result, gr_norm('Ματράκας ΆΛΦΑ') as sample;
