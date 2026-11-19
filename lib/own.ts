// Οι δικές μας διευθύνσεις (φόρμα επικοινωνίας του site, προωθήσεις συναδέλφων).
// Δεν είναι ποτέ στοιχεία πελάτη: δεν μπαίνουν σε lead ή σε πρόσωπο.
export const OWN_DOMAINS = ["sokfm.gr", "karteliasmediagroup.gr", "lalala.gr"];
export const isOwnEmail = (email?: string | null) => {
  const e = (email ?? "").trim().toLowerCase();
  const d = e.slice(e.lastIndexOf("@") + 1);
  return !!e && OWN_DOMAINS.some((o) => d === o || d.endsWith("." + o));
};
