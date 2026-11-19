-- Απόφαση Νίκου 20/11/2026: Χορηγία Morning Show από 1.200 €· φθηνότερα μόνο με έγκριση Νίκου ή Γιάννας
update price_packages set price = 1200, long_months = null, long_price = null, long_bonus_spots = null, needs_check = false,
  notes = 'Χαμηλότερη τιμή μόνο με έγκριση από τον Νίκο ή τη Γιάννα.'
 where station = 'ΣΟΚ FM' and kind = 'sponsorship' and name = 'Χορηγία Morning Show';
