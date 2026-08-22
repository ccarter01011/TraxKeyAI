import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
      { to: '/onboarding', label: 'Onboard a property' },
    ]
  },
  {
    label: 'Daily operations', items: [
      { to: '/calendar', label: 'Calendar' },
      { to: '/activity', label: 'AI Activity', badgeKey: 'needsYou', tone: 'urgent' },
      { to: '/turns', label: 'Turns', badgeKey: 'turns', tone: 'attention' },
      { to: '/orders', label: 'Purchase Orders' },
      { to: '/invoices', label: 'Invoices' },
      { to: '/inspections', label: 'Inspections', badgeKey: 'openInspections', tone: 'attention' },
    ]
  },
  {
    label: 'Portfolio records', items: [
      { to: '/insights', label: 'Insights' },
      { to: '/properties', label: 'Properties & units' },
      { to: '/residents', label: 'Residents & guests' },
      { to: '/owners', label: 'Owners' },
      { to: '/leases', label: 'Leases', badgeKey: 'expiring', tone: 'attention' },
    ]
  },
  {
    label: 'Analytics & reporting', items: [
      { to: '/analytics', label: 'Occupancy & financials' },
      { to: '/ask', label: 'Ask about your portfolio' },
      { to: '/pricing', label: 'Direct booking & pricing' },
    ]
  },
  {
    label: 'Setup', items: [
      { to: '/vendors', label: 'Vendors' },
      { to: '/str-ops', label: 'Supplies & damage' },
      { to: '/calendars', label: 'Connect Airbnb & Vrbo' },
      { to: '/business-memory', label: 'Business Memory' },
    ]
  },
];

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
        {item.label}
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
        <div className="p-5 border-b border-slate-200 dark:border-white/5">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1 truncate">
            {companyName || 'TraxKey AI'}
          </p>
          <p className="text-sm font-bold truncate">Welcome, {user?.name || 'there'}</p>
        </div>

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
