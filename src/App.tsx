import { useEffect } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './components/AppProvider';
import { useApp } from './components/context';
import { watchSystemTheme } from './lib/theme';
import { CalendarPage } from './pages/CalendarPage';
import { GoalsPage } from './pages/GoalsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { TodosPage } from './pages/TodosPage';
import { startReminderService } from './services/reminderService';
import { SyncIndicator } from './components/SyncIndicator';
import { Icon, type IconName } from './components/ui';
import { startSyncService } from './sync/syncService';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'today' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/todos', label: 'To-dos', icon: 'todos' },
  { to: '/goals', label: 'Goals', icon: 'goals' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function Shell() {
  const { openEditor } = useApp();
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[15px] transition-colors ${
      isActive
        ? 'bg-white font-semibold text-slate-900 shadow-[0_1px_0_rgb(18_22_32/0.06)] dark:bg-slate-900 dark:text-white'
        : 'font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
    }`;
  const tabCls = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] ${
      isActive ? 'font-semibold text-slate-900 dark:text-white' : 'font-medium text-slate-500 dark:text-slate-400'
    }`;
  const logo = (
    <span className="flex items-baseline gap-1 text-[19px] font-extrabold tracking-[-0.03em]">
      <span className="text-indigo-600 dark:text-indigo-300">Ω</span>OmegaPlanner
    </span>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      {/* Phone: compact header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))] dark:border-slate-800 md:hidden">
        {logo}
        <SyncIndicator />
      </header>

      {/* Desktop/tablet: sidebar */}
      <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-slate-200 px-4 py-6 dark:border-slate-800 md:flex">
        <div className="mb-6 px-2.5">{logo}</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={navCls}>
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <button
          onClick={() => openEditor()}
          className="mt-5 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-300 dark:text-slate-950 dark:hover:bg-indigo-200"
          title="New item (N)"
        >
          <Icon name="plus" className="h-4 w-4" />
          New item
        </button>
        <div className="mt-auto">
          <SyncIndicator />
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto pb-24 md:pb-0">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>

      {/* Phone: floating "new" button and bottom tabs */}
      <button
        onClick={() => openEditor()}
        aria-label="New item"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-[0_10px_24px_-8px_rgb(35_64_200/0.6)] hover:bg-indigo-700 dark:bg-indigo-300 dark:text-slate-950 md:hidden"
      >
        <Icon name="plus" className="h-6 w-6" />
      </button>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-slate-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
      >
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={tabCls}>
            <Icon name={n.icon} className="h-[22px] w-[22px]" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  useEffect(() => startReminderService(), []);
  useEffect(() => watchSystemTheme(), []);
  useEffect(() => startSyncService(), []);
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  );
}
