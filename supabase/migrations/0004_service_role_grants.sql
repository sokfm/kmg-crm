-- Ο server (service role) χρειάζεται πρόσβαση στους πίνακες για τον συγχρονισμό email.
-- Το project δημιουργήθηκε χωρίς αυτόματες άδειες σε νέους πίνακες, οπότε τις δίνουμε ρητά.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
