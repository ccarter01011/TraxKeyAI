import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HomeModernIcon, CalendarIcon, BoltIcon, ArrowPathIcon, TruckIcon, BanknotesIcon,
  ClipboardDocumentCheckIcon, ChartBarIcon, BuildingOffice2Icon, UsersIcon, KeyIcon,
  DocumentTextIcon, ChartPieIcon, ChatBubbleLeftRightIcon, CurrencyDollarIcon,
  WrenchScrewdriverIcon, ArchiveBoxIcon, LinkIcon, Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../lib/AuthContext.jsx';
import { apiRequest } from '../lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';

// Desktop-only persistent sidebar + animated content pane, replacing the
// old pattern of every dashboard tile opening in a new tab. Below the
// lg breakpoint this renders nothing but <Outlet/> - each page still has
// its own header/back-link/ThemeToggle for mobile (see the `lg:hidden`
// wrapper added to each page's own header), so nothing regresses there.
//
// Why a real sidebar instead of just closing the target="_blank" gap:
// the tiles already work as buttons: this is the part that makes moving
// between pages feel like one app instead of twenty separate ones opening
// tabs, which was the actual complaint. Physics-based transitions (spring,
// not a fixed-duration ease) are the ask that made this worth a real build
// instead of a CSS-only pass - framer-motion is already a bundled cost the
// rest of the app doesn't pay elsewhere, so it's scoped to this one file.

const NAV = [
  {
    label: 'Start here', items: [
      { to: '/onboarding', label: 'Onboard a property', icon: HomeModernIcon, hint: 'Capture a property’s details and inventory so the AI can answer residents directly.' },
    ]
  },
  {
    label: 'Daily operations', items: [
      { to: '/calendar', label: 'Calendar', icon: CalendarIcon, hint: 'Every unit on one timeline: guest bookings, owner blocks, leases, and turn deadlines together.' },
      { to: '/activity', label: 'AI Activity', icon: BoltIcon, badgeKey: 'needsYou', tone: 'urgent', hint: 'Every request and every step the AI Coordinator took on it. Flagged items need your decision.' },
      { to: '/turns', label: 'Turns', icon: ArrowPathIcon, badgeKey: 'turns', tone: 'attention', hint: 'Vacant-to-ready tracking for move-out turnovers and cleaning turns.' },
      { to: '/orders', label: 'Purchase Orders', icon: TruckIcon, hint: 'Parts and materials a job is waiting on. Flagged when late, and when late means a turn will slip.' },
      { to: '/invoices', label: 'Invoices', icon: BanknotesIcon, hint: 'What you’re owed, how overdue it is, and reminders sent for you until someone answers.' },
      { to: '/inspections', label: 'Inspections', icon: ClipboardDocumentCheckIcon, badgeKey: 'openInspections', tone: 'attention', hint: 'Move-in and move-out condition records, and what changed between them.' },
    ]
  },
  {
    label: 'Portfolio records', items: [
      { to: '/insights', label: 'Insights', icon: ChartBarIcon, hint: 'Patterns in your own data: vendors slowing down, units that keep breaking, rents below your average.' },
      { to: '/properties', label: 'Properties & units', icon: BuildingOffice2Icon, hint: 'Your properties and units, what TraxKey AI’s agents monitor and act on.' },
      { to: '/residents', label: 'Residents & guests', icon: UsersIcon, hint: 'Invite each resident or short-term guest with their own reporting link.' },
      { to: '/owners', label: 'Owners', icon: KeyIcon, hint: 'If you manage for other people, give them a read-only view of their own properties.' },
      { to: '/leases', label: 'Leases', icon: DocumentTextIcon, badgeKey: 'expiring', tone: 'attention', hint: 'Terms, rent, and renewal dates. Flagged 90 days before they end.' },
    ]
  },
  {
    label: 'Analytics & reporting', items: [
      { to: '/analytics', label: 'Occupancy & financials', icon: ChartPieIcon, hint: 'Occupancy trend, rental activity rollups, spend by property and vendor, and owner statements.' },
      { to: '/ask', label: 'Ask about your portfolio', icon: ChatBubbleLeftRightIcon, hint: 'Plain-language questions across long-term and short-term together: what earns least, what costs most, whether a lease is worth renewing.' },
      { to: '/pricing', label: 'Direct booking & pricing', icon: CurrencyDollarIcon, hint: 'A reservation system outside Airbnb and Vrbo, with nightly rate suggestions. Prototype: no revenue-management vendor is connected yet.' },
    ]
  },
  {
    label: 'Setup', items: [
      { to: '/vendors', label: 'Vendors', icon: WrenchScrewdriverIcon, hint: 'The network the AI dispatches to, ranked by their real job history.' },
      { to: '/str-ops', label: 'Supplies & damage', icon: ArchiveBoxIcon, hint: 'Consumables per unit with reorder levels, and checkout damage tied to the stay it happened during.' },
      { to: '/calendars', label: 'Connect Airbnb & Vrbo', icon: LinkIcon, hint: 'Paste a calendar link once. This is setup, not the day-to-day calendar.' },
      { to: '/business-memory', label: 'Business Memory', icon: Cog6ToothIcon, hint: 'Rules the AI follows: approval limits, quiet hours, preferred vendors.' },
    ]
  },
];

// A tiny hover affordance next to a nav label explaining what the page is,
// separate from FlowHelp (which documents a page's internal logic once
// you're already on it) since this needs to sit inline in a cramped sidebar
// row and only ever shows one line of prose, not a numbered flow.
function NavHint({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block shrink-0" onClick={e => e.preventDefault()}>
      <span
        role="button"
        tabIndex={-1}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-white/20 text-slate-400 dark:text-slate-500 hover:border-teal-400 hover:text-teal-500 dark:hover:text-teal-400 text-[9px] font-bold transition inline-flex items-center justify-center leading-none"
      >
        ?
      </span>
      {open && (
        <span
          role="tooltip"
          className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg p-3 shadow-xl text-left block text-[11px] leading-snug font-normal text-slate-600 dark:text-slate-300 normal-case tracking-normal"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function NavLink({ item, active, badgeText }) {
  return (
    <Link
      to={item.to}
      className="relative block px-3 py-2 rounded-lg text-sm transition-colors"
    >
      {active && (
        <motion.div
          layoutId="sidebar-active-pill"
          className="absolute inset-0 bg-teal-500/15 border border-teal-400/30 rounded-lg"
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      )}
      <span className={`relative z-10 flex items-center justify-between gap-2 ${active
        ? 'text-teal-700 dark:text-teal-300 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
        <span className="flex items-center gap-2 min-w-0">
          {item.icon && <item.icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 dark:text-slate-500'}`} strokeWidth={1.75} />}
          <span className="truncate">{item.label}</span>
          {item.hint && <NavHint text={item.hint} />}
        </span>
        {badgeText && (
          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            item.tone === 'urgent' ? 'bg-red-500/15 text-red-600 dark:text-red-400'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
            {badgeText}
          </span>
        )}
      </span>
    </Link>
  );
}

export default function DashboardShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [counts, setCounts] = useState({});

  useEffect(() => {
    apiRequest('my-profile', { method: 'POST' }).then(j => setCompanyName(j.companyName || '')).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      apiRequest('traxkey-get-turns').catch(() => []),
      apiRequest('traxkey-get-leases').catch(() => []),
      apiRequest('traxkey-get-inspections').catch(() => []),
      apiRequest('traxkey-get-activity').catch(() => []),
    ]).then(([turns, leases, inspections, activity]) => {
      const openTurns = (turns || []).filter(t => t.id && t.status !== 'occupied');
      const expiring = (leases || []).filter(l => {
        if (!l.id || l.status !== 'active' || !l.end_date) return false;
        const days = Math.round((new Date(`${String(l.end_date).slice(0, 10)}T00:00:00`) - new Date()) / 86400000);
        return Number.isFinite(days) && days <= 90;
      });
      const openInspections = (inspections || []).filter(i => i.id && i.status === 'in_progress');
      const needsYou = (activity || []).filter(r => r.id && ['awaiting_approval', 'needs_vendor', 'needs_human_review'].includes(r.status));
      setCounts({
        needsYou: needsYou.length || null,
        turns: openTurns.length || null,
        expiring: expiring.length || null,
        openInspections: openInspections.length || null,
      });
    }).catch(() => {});
  }, []);

  function badgeFor(item) {
    if (!item.badgeKey) return null;
    const n = counts[item.badgeKey];
    return n ? String(n) : null;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Sidebar: desktop only. Mobile keeps each page's own header/back-link. */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 border-r border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/40 overflow-y-auto">
        <Link to="/" className="block p-5 border-b border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/5 transition">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1 truncate">
            {companyName || 'TraxKey AI'}
          </p>
          <p className="text-sm font-bold truncate">Welcome, {user?.name || 'there'}</p>
        </Link>

        <nav className="flex-1 px-3 py-4 space-y-5">
          {NAV.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wide px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavLink
                    key={item.to}
                    item={item}
                    active={location.pathname === item.to}
                    badgeText={badgeFor(item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Link to="/profile" className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-2 py-1.5 rounded-lg transition">Profile</Link>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-2 py-1.5 rounded-lg transition">Log out</button>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Content pane. lg:ml-64 makes room for the fixed sidebar; below that
          breakpoint this is just the normal full-width page, unchanged. */}
      <div className="lg:ml-64">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
