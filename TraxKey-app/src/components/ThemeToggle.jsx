import { useTheme } from '../lib/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 flex items-center justify-center hover:border-teal-400/50 transition shrink-0"
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="#0d9488" strokeWidth="2"/><path d="M12 2V4M12 20V22M4 12H2M22 12H20M19.07 4.93L17.66 6.34M6.34 17.66L4.93 19.07M19.07 19.07L17.66 17.66M6.34 6.34L4.93 4.93" stroke="#0d9488" strokeWidth="2" strokeLinecap="round"/></svg>
      )}
    </button>
  );
}
