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

const NAV = [
  { to: '/', label: 'Today', icon: '☀' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/todos', label: 'To-dos', icon: '✓' },
  { to: '/goals', label: 'Goals', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Shell() {
  const { openEditor } = useApp();
  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 dark:border-slate-800 dark:bg-slate-900 md:w-52 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-3 md:py-4">
        <div className="mr-2 flex items-center gap-2 px-2 md:mb-5 md:mr-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 font-serif text-white">Ω</span>
          <span className="hidden font-semibold md:inline">OmegaPlanner</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`
            }
          >
            <span aria-hidden className="w-4 text-center">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <button
          onClick={() => openEditor()}
          className="hidden whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 md:mt-4 md:block"
          title="New item (N)"
        >
          + New
        </button>
      </nav>
      <button
        onClick={() => openEditor()}
        aria-label="New item"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-3xl leading-none text-white shadow-lg hover:bg-indigo-500 md:hidden"
      >
        +
      </button>
      <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  useEffect(() => startReminderService(), []);
  useEffect(() => watchSystemTheme(), []);
  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  );
}
