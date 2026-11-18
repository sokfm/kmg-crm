"""Φτιάχνει το seed.sql για την πρώτη φόρτωση του CRM.

Χρήση:
    python3 scripts/build_seed.py <KMG_All_Years_CRM.xlsx> <LEADS_2026.xlsx> <out_dir> [--go-live YYYY-MM-DD]

Τι κάνει:
  * Ένας πελάτης ανά ονομασία πηγής (customer_id του αρχείου ιστορικού).
    Οι ενώσεις γίνονται μετά, από τον Νίκο ή τη Γιάννα, στην οθόνη ενώσεων.
  * Υπεύθυνος από την πιο πρόσφατη γραμμή τιμολόγησης:
      Account Executive = STAMOULAKIS       → Κώστας
      Account Executive = KMG, agent = ...  → Γιάννα / Μαρία / Νίκος (VASILIS → χωρίς)
      Account Executive = MEDIA SHOP        → Νίκος, δρόμος Media Shop, agency = agent
    Υπεύθυνο παίρνουν μόνο οι ενεργοί (έπαιξαν από 2025). Οι υπόλοιποι πάνε στη βάση.
  * Όλες οι γραμμές ιστορικού στο αρχείο history_lines, με τα αρχικά πεδία.
  * Ομάδες πιθανών ενώσεων για έγκριση.
  * Τα leads του LEADS_2026.
"""
import json
import re
import sys
import uuid
from pathlib import Path

import pandas as pd

NS = uuid.UUID("6b1f0d3e-6c1e-4f6e-9d1a-4b4d4b4d4b4d")

USERS = {
    "nikos": "nikos@sokfm.gr",
    "gianna": "i.drakidou@sokfm.gr",
    "kostas": "stamoulakis@sokfm.gr",
    "maria": "m.boutsika@sokfm.gr",
}
AGENT_TO_USER = {
    "DRAKIDOU": "gianna", "ΔΡΑΚΙΔΟΥ": "gianna",
    "BOUTSIKA": "maria", "MPOUTSIKA": "maria", "ΜΠΟΥΤΣΙΚΑ": "maria",
    "NIKOS": "nikos", "ΝΙΚΟΣ": "nikos",
    "STAMOULAKIS": "kostas", "ΣΤΑΜΟΥΛΑΚΗΣ": "kostas", "ΚΩΣΤΑΣ": "kostas",
}
STATION = {"ΣΟΚ FM": "ΣΟΚ", "Dalkas": "DALKAS", "NRG": "NRG", "ΜΠΛΕ": "ΜΠΛΕ"}
GENERIC = {
    "ΕΤΑΙΡΕΙΑ", "ΚΑΤΑΣΤΗΜΑ", "EVENT", "ΠΟΛΙΤΙΣΤΙΚΟΣ", "ΣΥΛΛΟΓΟΣ", "ΚΑΙ", "ΤΟΥ", "ΤΗΣ",
    "ΔΗΜΟΣ", "ΑΦΟΙ", "ΣΥΝΑΥΛΙΑ", "ΠΑΝΗΓΥΡΙ", "ΓΙΟΡΤΗ", "ΕΚΔΗΛΩΣΗ", "ΧΟΡΟΣ", "THE",
}
TODAY_YEAR = 2026


def uid(kind, key):
    return str(uuid.uuid5(NS, f"{kind}:{key}"))


def user_uuid(u):
    # Τα πραγματικά ids τα δίνει το Supabase Auth· το seed τα βρίσκει από το email.
    return f"(select id from profiles where email = '{USERS[u]}')"


def q(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or (v is pd.NaT):
        return "null"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return repr(round(float(v), 2)) if isinstance(v, float) else str(v)
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, pd.Timestamp):
        return f"'{v.date().isoformat()}'"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def norm(s):
    return re.sub(r"\s+", " ", str(s or "").strip().upper())


def group_key(name):
    n = norm(name)
    n = n.translate(str.maketrans("ΆΈΉΊΌΎΏΪΫ", "ΑΕΗΙΟΥΩΙΥ"))
    n = re.sub(r"[()\-.,&\"'/]", " ", n)
    words = [w for w in n.split() if len(w) > 2 and w not in GENERIC]
    return words[0] if words else n


def main():
    hist_path, leads_path, out_dir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    go_live = sys.argv[sys.argv.index("--go-live") + 1] if "--go-live" in sys.argv else "2026-12-01"
    out_dir.mkdir(parents=True, exist_ok=True)

    cust = pd.read_excel(hist_path, sheet_name="CUSTOMERS")
    bl = pd.read_excel(hist_path, sheet_name="BILLING_LINES")
    # Ποιο φύλλο πηγής: κύριο μηνιαίο ή συμπληρωματικό (δεν αθροίζεται)
    ss = pd.read_excel(hist_path, sheet_name="SOURCE_SHEETS", usecols=["source_id", "sheet", "scope"])
    raw = pd.read_excel(hist_path, sheet_name="RAW_ROWS", usecols=["source_id", "sheet", "record_id"])
    scope = raw.dropna(subset=["record_id"]).merge(ss, on=["source_id", "sheet"], how="left")
    bl = bl.merge(scope[["record_id", "scope"]], on="record_id", how="left")
    bl["scope"] = bl["scope"].fillna("monthly_billing")
    # Γραμμές χωρίς περίοδο (έργα): περίοδος από την ημερομηνία έναρξης
    start = pd.to_datetime(bl["campaign_start"], errors="coerce")
    miss = bl["period"].isna()
    bl.loc[miss, "period"] = bl.loc[miss, "billing_year"].astype(int).astype(str) + "-" + start[miss].dt.month.fillna(1).astype(int).map("{:02d}".format)
    bl["amt"] = pd.to_numeric(bl["net_or_amount_eur"], errors="coerce")
    bl["is_future"] = bl["period"] > "2026-12"
    bl["st"] = bl["station_brand"].map(STATION).fillna(bl["station_brand"])

    # Υπεύθυνος από την πιο πρόσφατη γραμμή κάθε πελάτη
    prim = bl[bl["scope"] == "monthly_billing"]
    last = prim[~prim["is_future"]].sort_values("period").groupby("customer_id").tail(1).set_index("customer_id")
    last_period = prim[~prim["is_future"]].groupby("customer_id")["period"].max()

    lines = []
    w = lines.append
    w("-- Δημιουργήθηκε από scripts/build_seed.py. Τρέχει μία φορά, με δικαιώματα συστήματος.")
    w("begin;")

    # Πελάτες
    rows = []
    for _, c in cust.iterrows():
        cid = c["customer_id"]
        lp = last_period.get(cid)
        active = bool(lp is not None and isinstance(lp, str) and lp >= "2025-01")
        ae = norm(last.loc[cid, "account_executive_raw"]) if cid in last.index else ""
        agent = norm(last.loc[cid, "agent_raw"]) if cid in last.index else ""
        channel, agency, owner = "kmg", None, None
        if ae == "STAMOULAKIS":
            channel, owner = "stamoulakis", "kostas"
        elif ae == "MEDIA SHOP":
            channel, agency, owner = "media_shop", (agent or None), "nikos"
        else:
            owner = AGENT_TO_USER.get(agent)
        owner_sql = user_uuid(owner) if (owner and active) else "null"
        status = "active" if active else "base"
        rows.append(
            f"({q(uid('cust', cid))},{q(c['display_name'])},'{channel}',{q(agency)},{owner_sql},'{status}')"
        )
    w("insert into customers (id, display_name, channel, agency, owner_id, status) values")
    w(",\n".join(rows) + ";")

    w("insert into customer_aliases (source_customer_id, customer_id, source_name) values")
    w(",\n".join(f"({q(c['customer_id'])},{q(uid('cust', c['customer_id']))},{q(c['display_name'])})"
                 for _, c in cust.iterrows()) + ";")

    # Ιστορικό, σε πακέτα των 1.000
    cols = ("record_id, source_customer_id, customer_id, customer_name_raw, period, billing_year, billing_month, "
            "station, amount, amount_type, campaign_start, campaign_end, account_executive_raw, agent_raw, "
            "kef_raw, bico_raw, status_raw, sponsorship_raw, notes_raw, package_raw, cost_per_sec_raw, is_future, source_scope")
    vals = []
    for _, r in bl.iterrows():
        def d(x):
            t = pd.to_datetime(x, errors="coerce")
            return None if pd.isna(t) else t
        vals.append("(" + ",".join([
            q(r["record_id"]), q(r["customer_id"]), q(uid("cust", r["customer_id"])), q(r["customer_name_raw"]),
            q(r["period"]), str(int(str(r["period"])[:4])), str(int(str(r["period"])[5:7])), q(r["st"]),
            q(None if pd.isna(r["amt"]) else float(r["amt"])), q(r["amount_type"]),
            q(d(r["campaign_start"])), q(d(r["campaign_end"])), q(r["account_executive_raw"]), q(r["agent_raw"]),
            q(r["kef_code_raw"]), q(r["bico_code_raw"]), q(r["status_raw"]), q(r["sponsorship_raw"]),
            q(r["notes_raw"]), q(r["package_raw"]), q(r["cost_per_sec_raw"]), q(bool(r["is_future"])), q(r["scope"]),
        ]) + ")")
    for i in range(0, len(vals), 1000):
        w(f"insert into history_lines ({cols}) values")
        w(",\n".join(vals[i:i + 1000]) + ";")

    w("select refresh_customer_stats();")

    # Ομάδες πιθανών ενώσεων
    cust["gk"] = cust["display_name"].map(group_key)
    rev = prim.groupby("customer_id")["amt"].sum()
    groups = cust.groupby("gk")
    mrows = []
    for gk, g in groups:
        if len(g) < 2 or len(g) > 25:
            continue
        ids = list(g["customer_id"])
        names = list(g["display_name"])
        total = float(rev.reindex(ids).fillna(0).sum())
        lp = max([last_period.get(i, "") or "" for i in ids])
        arr_ids = "array[" + ",".join(q(i) for i in ids) + "]"
        arr_names = "array[" + ",".join(q(n) for n in names) + "]"
        mrows.append(f"({q(gk)},{arr_ids},{arr_names},{round(total, 2)},{q(lp or None)})")
    if mrows:
        w("insert into merge_candidates (group_key, source_customer_ids, names, revenue_total, last_period) values")
        w(",\n".join(mrows) + ";")

    # Leads 2026
    leads = pd.read_excel(leads_path)
    leads = leads[leads["ΗΜ/ΝΙΑ"].notna() | leads["ΠΡΟΪΟΝ"].notna()]
    status_map = {"ΕΚΛΕΙΣΕ": "won", "ΌΧΙ": "lost", "OXI": "lost", "ΟΧΙ": "lost",
                  "ΡΑΝΤΕΒΟΥ": "meeting", "ΑΝΑΜΟΝΗ": "proposal"}
    lrows = []
    for i, r in leads.iterrows():
        st = status_map.get(norm(r.get("REACH")), "contacted")
        owner = AGENT_TO_USER.get(norm(r.get("ΥΠΕΥΘΥΝΟΣ ΛΟΓΑΡ.")))
        stations = [s for s in ["ΣΟΚ", "DALKAS", "NRG", "ΜΠΛΕ"] if s in norm(r.get("ΡΑΔΙΟΦΩΝΟ"))]
        if "ΟΛΑ" in norm(r.get("ΡΑΔΙΟΦΩΝΟ")).replace("Ό", "Ο"):
            stations = ["ΣΟΚ", "DALKAS", "NRG", "ΜΠΛΕ"]
        open_ = st not in ("won", "lost")
        created = pd.to_datetime(r.get("ΗΜ/ΝΙΑ"), errors="coerce")
        lrows.append("(" + ",".join([
            q(uid("lead", i)), q(r.get("ΠΡΟΪΟΝ")), q(r.get("ΕΠΑΦΗ")),
            q(None if pd.isna(r.get("ΤΗΛΕΦΩΝΟ")) else str(r.get("ΤΗΛΕΦΩΝΟ")).strip()),
            q(None if str(r.get("Email")).strip() in ("-", "nan") else r.get("Email")),
            q(r.get("ΠΕΡΙΟΧΗ")), "'excel_2026'",
            "array[" + ",".join(q(s) for s in stations) + "]::text[]",
            user_uuid(owner) if owner else "null",
            f"'{st}'",
            q("Ξεκαθάρισμα: επόμενο βήμα ή χαμένο" if open_ else None),
            q(go_live if open_ else None),
            "'not_now'" if st == "lost" else "null",
            q("Μεταφορά από το Excel χωρίς καταγεγραμμένο λόγο" if st == "lost" else None),
            q(r.get("ΠΑΡΑΤΗΡΗΣΕΙΣ")),
            q(created.isoformat() if not pd.isna(created) else None),
        ]) + ")")
    w("insert into leads (id, company_name, contact_name, phone, email, area, source, stations, owner_id, status, "
      "next_step, next_step_due, lost_kind, lost_reason, notes, created_at) values")
    w(",\n".join(lrows) + ";")

    w("commit;")
    (out_dir / "seed.sql").write_text("\n".join(lines), encoding="utf-8")

    summary = {
        "customers": int(len(cust)),
        "active_customers": int(sum(1 for c in cust["customer_id"] if (last_period.get(c) or "") >= "2025-01")),
        "history_lines": int(len(bl)),
        "merge_groups": len(mrows),
        "leads": len(lrows),
    }
    (out_dir / "seed_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
