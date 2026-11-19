-- Απόφαση Νίκου 19/11/2026: ο DALKAS δεν έχει χορηγία στην πρωινή εκπομπή
delete from price_packages where station = 'DALKAS' and kind = 'sponsorship';
