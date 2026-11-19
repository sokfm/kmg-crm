"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Πλαϊνό μενού (υπολογιστής) και κάτω μενού με κουμπί + (κινητό).
// Το μενού μικραίνει σε στήλη εικονιδίων· η επιλογή θυμάται ανά browser.

type Counts = { late: number; tasks: number; review: number; notifications: number; web: number };
type Props = { name: string; role: string; isAdmin: boolean; counts: Counts; children: React.ReactNode };

const I = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  dash: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  pipe: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>,
  leads: <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />,
  tasks: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  clients: <><path d="M3 21V7l9-4 9 4v14" /><path d="M9 21v-6h6v6" /></>,
  shops: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  inbox: <path d="M4 4h16v12H5l-1 4z" />,
  merge: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8M8 6c5 0 8 2 8 6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  more: <path d="M4 6h16M4 12h16M4 18h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  price: <><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  collapse: <path d="M15 6l-6 6 6 6" />,
};
const Icon = ({ d, size = 18 }: { d: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export function Shell({ name, role, isAdmin, counts, children }: Props) {
  const path = usePathname();
  const router = useRouter();
  const [mini, setMini] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setMini(localStorage.getItem("kmg-mini") === "1"); } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (search.current) search.current.focus(); else router.push("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  const toggle = () => {
    setMini((m) => {
      try { localStorage.setItem("kmg-mini", m ? "0" : "1"); } catch {}
      return !m;
    });
  };

  const on = (href: string) => (href === "/today" ? path === "/today" : path.startsWith(href));
  const item = (href: string, label: string, icon: React.ReactNode, count?: number, hot?: boolean) => (
    <Link key={href} href={href} className={`nav-item ${on(href) ? "on" : ""}`} title={mini ? label : undefined}>
      <Icon d={icon} />
      <span className="nav-label">{label}</span>
      {!!count && <span className={`nav-count ${hot ? "hot" : ""}`}>{count}</span>}
    </Link>
  );
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const ROLE: Record<string, string> = { ceo: "CEO", sales_manager: "Sales Manager", account_exec: "Account Executive", digital_intake: "Digital" };

  return (
    <div className={`shell ${mini ? "mini" : ""}`}>
      <aside className="side" aria-label="Κύριο μενού">
        <div className="side-brand">
          <div className="logo">K</div>
          <div className="nav-label"><strong>KMG CRM</strong><span>Kartelias Media Group</span></div>
        </div>
        <form action="/search" className="side-search">
          <Icon d={I.search} size={16} />
          <input ref={search} name="q" placeholder="Αναζήτηση" aria-label="Αναζήτηση πελάτη, lead, media shop" />
          <kbd className="nav-label">Ctrl K</kbd>
        </form>
        <nav className="side-group">
          {item("/today", "Today", I.today, counts.late, true)}
          {isAdmin && item("/dashboard", "Dashboard", I.dash)}
          {item("/pipeline", "Pipeline", I.pipe)}
          {item("/leads", "Leads", I.leads)}
          {item("/tasks", "Tasks", I.tasks, counts.tasks)}
          {item("/customers", "Clients", I.clients)}
          {item("/agencies", "Media Shops", I.shops)}
          {item("/pricing", "Τιμοκατάλογος", I.price)}
        </nav>
        <nav className="side-group">
          <div className="side-title nav-label">ΔΙΑΧΕΙΡΙΣΗ</div>
          {!!counts.review && item("/inbox", "Προς έλεγχο", I.inbox, counts.review, true)}
          {isAdmin && item("/merges", "Merge", I.merge)}
          {item("/notifications", "Notifications", I.bell, counts.notifications, true)}
          {item("/settings", "Ρυθμίσεις", I.gear)}
        </nav>
        <Link href="/leads/new" className="side-new"><Icon d={I.plus} size={16} /><span className="nav-label">Νέο lead</span></Link>
        <div className="side-user">
          <div className="avatar">{initials}</div>
          <div className="nav-label grow"><strong>{name}</strong><span>{ROLE[role] ?? role}</span></div>
          <Link href="/settings" className="nav-label icon-btn" aria-label="Ρυθμίσεις"><Icon d={I.gear} /></Link>
          <button type="button" className="icon-btn collapse" onClick={toggle} aria-label={mini ? "Άνοιγμα μενού" : "Σμίκρυνση μενού"}><Icon d={I.collapse} /></button>
        </div>
      </aside>

      <div className="content">{children}</div>

      <Link href="/leads/new" className="fab" aria-label="Νέο lead"><Icon d={I.plus} size={24} /></Link>
      <nav className="bottom" aria-label="Κύριο μενού κινητού">
        {[
          ["/today", "Today", I.today, counts.late],
          ["/pipeline", "Pipeline", I.pipe, 0],
          ["/tasks", "Tasks", I.tasks, counts.tasks],
          ["/customers", "Clients", I.clients, 0],
          ["/more", "Περισσότερα", I.more, counts.review + counts.notifications],
        ].map(([href, label, icon, n]) => (
          <Link key={href as string} href={href as string} className={on(href as string) ? "on" : ""}>
            <span className="b-ico"><Icon d={icon as React.ReactNode} size={21} />{!!n && <i>{n as number}</i>}</span>
            {label as string}
          </Link>
        ))}
      </nav>
    </div>
  );
}
