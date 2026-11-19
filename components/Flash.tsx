const OK: Record<string, string> = {
  created: "Το lead καταχωρίστηκε.",
  saved: "Αποθηκεύτηκε.",
  activity: "Η επαφή καταγράφηκε.",
  assigned: "Έγινε ανάθεση.",
  requested: "Το αίτημα στάλθηκε στον Νίκο για έγκριση.",
  approved: "Εγκρίθηκε. Ο πωλητής έχει 10 μέρες για επαφή.",
  rejected: "Απορρίφθηκε.",
  task: "Η εργασία καταχωρίστηκε.",
  taskdone: "Μπράβο, ολοκληρώθηκε.",
  linked: "Το email μπήκε στην καρτέλα του πελάτη.",
  agency: "Το email μπήκε στην καρτέλα του πρακτορείου.",
  ignored: "Αγνοήθηκε.",
  outlook: "Το Outlook συνδέθηκε. Ο έλεγχος γίνεται αυτόματα κάθε 5 λεπτά.",
  disconnected: "Η σύνδεση με το Outlook καταργήθηκε.",
  sync: "Ο έλεγχος των email ολοκληρώθηκε.",
  "1": "Έγινε.",
};

export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.conflict)
    return (
      <div className="msg error">
        Κάποιος άλλος άλλαξε αυτό το lead ενώ το είχες ανοιχτό. Δεν σβήσαμε τίποτα. Δες τις νέες τιμές παρακάτω και ξαναπέρασε την αλλαγή σου.
      </div>
    );
  if (sp.error) return <div className="msg error">{sp.error}</div>;
  if (sp.ok) return <div className="msg ok">{OK[sp.ok] ?? "Έγινε."}</div>;
  return null;
}
