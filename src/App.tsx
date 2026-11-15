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
import { startSyncService } from './sync/syncService';

const NAV = [
  { to: '/', label: 'Today', icon: '☀' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/todos', label: 'To-dos', icon: '✓' },
  { to: '/goals', label: 'Goals', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Shell() {
  const { openEditor } = useApp();
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
      isActive
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
    }`;
  const tabCls = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
      isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
    }`;
  const logo = (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 font-serif text-white">Ω</span>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      {/* Phone: compact header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <div className="flex items-center gap-2">
          {logo}
          <span className="font-semibold">OmegaPlanner</span>
        </div>
        <SyncIndicator />
      </header>

      {/* Desktop/tablet: sidebar */}
      <nav className="hidden w-52 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2">
          {logo}
          <span className="font-semibold">OmegaPlanner</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={navCls}>
            <span aria-hidden className="w-4 text-center">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
        <button
          onClick={() => openEditor()}
          className="mt-4 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
          title="New item (N)"
        >
          + New
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
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-3xl leading-none text-white shadow-lg hover:bg-indigo-500 md:hidden"
      >
        +
      </button>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden"
      >
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={tabCls}>
            <span aria-hidden className="text-lg leading-none">
              {n.icon}
            </span>
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
