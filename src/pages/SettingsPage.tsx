import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarImport } from '../components/CalendarImport';
import { useApp } from '../components/context';
import { Button, inputCls, Section } from '../components/ui';
import { clearAllData, deleteCategory, saveCategory } from '../db/repo';
import type { Category } from '../db/schema';
import { downloadBackup, exportBackup, importBackup, validateBackup } from '../services/backup';
import { checkReminders, notificationsSupported } from '../services/reminderService';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { ColorPicker } from '../components/ColorPicker';
import { itemColors, setDefaultItemColor, useDefaultItemColor } from '../lib/eventColors';

const card = 'rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800';

export function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <CategoriesSection />
      <AppearanceSection />
      <NotificationsSection />
      <div id="import">
        <Section title="Import from Google Calendar">
          <div className={card}>
            <CalendarImport />
          </div>
        </Section>
      </div>
      <BackupSection />
    </div>
  );
}

function CategoriesSection() {
  const { data } = useApp();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0891b2');

  return (
    <Section title="Categories">
      <div className={card}>
        <div className="space-y-2">
          {data.categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </div>
        <form
          className="mt-4 flex gap-2 border-t border-slate-200 pt-4 dark:border-slate-700"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await saveCategory({ name: name.trim(), color });
            setName('');
          }}
        >
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" aria-label="New category color" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" className={inputCls} aria-label="New category name" />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </div>
    </Section>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [name, setName] = useState(category.name);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={category.color}
        onChange={(e) => saveCategory({ ...category, color: e.target.value })}
        className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent"
        aria-label={`${category.name} color`}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== category.name && saveCategory({ ...category, name: name.trim() })}
        className={inputCls}
        aria-label="Category name"
      />
      <Button
        variant="ghost"
        aria-label={`Delete ${category.name}`}
        onClick={() => confirm(`Delete category "${category.name}"? Items keep existing without a category.`) && deleteCategory(category.id)}
      >
        ✕
      </Button>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const defaultColor = useDefaultItemColor();
  return (
    <Section title="Appearance">
      <div className={`${card} space-y-4 text-sm`}>
      <div className="flex gap-4">
        {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-2 capitalize">
            <input
              type="radio"
              checked={theme === t}
              onChange={() => {
                setTheme(t);
                setThemePref(t);
              }}
              className="accent-indigo-600"
            />
            {t}
          </label>
        ))}
      </div>
      <div>
        <p className="mb-1 font-medium">Default item color</p>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Background for calendar items that don't have their own color. The category shows as a line under the title.
        </p>
        <ColorPicker
          value={defaultColor ?? ''}
          onChange={(c) => setDefaultItemColor(c || null)}
          defaultLabel="Theme default"
          defaultSwatch={itemColors(undefined, null)}
        />
      </div>
      </div>
    </Section>
  );
}

function NotificationsSection() {
  const supported = notificationsSupported();
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied');
  return (
    <Section title="Reminders">
      <div className={`${card} space-y-3 text-sm`}>
        {!supported ? (
          <p>This browser doesn't support notifications.</p>
        ) : perm === 'granted' ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-green-600">✓ Notifications are on.</span>
            <Button
              onClick={() =>
                new Notification('OmegaPlanner', { body: 'Reminders are working.', icon: '/favicon.svg' })
              }
            >
              Send test notification
            </Button>
          </div>
        ) : perm === 'denied' ? (
          <p>Notifications are blocked. Allow them for this site in your browser settings to get reminders.</p>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              const p = await Notification.requestPermission();
              setPerm(p);
              if (p === 'granted') void checkReminders();
            }}
          >
            Enable notifications
          </Button>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reminders fire only while OmegaPlanner is open in a browser tab. A pinned tab works well.
        </p>
      </div>
    </Section>
  );
}

function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onImport(file: File) {
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      const n = backup.data.items.length;
      if (!confirm(`Replace ALL current data with this backup (${n} items, exported ${backup.exportedAt.slice(0, 10)})?`)) return;
      await importBackup(backup);
      setMsg({ ok: true, text: `Imported ${n} items.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? 'That file is not valid JSON.' : (e as Error).message });
    }
  }

  return (
    <Section title="Data">
      <div className={`${card} space-y-3 text-sm`}>
        <p className="text-slate-600 dark:text-slate-300">
          Everything is stored in this browser only. Export a backup now and then, and import it to restore or move to another computer.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={async () => downloadBackup(await exportBackup())}>
            Export backup
          </Button>
          <Button onClick={() => fileRef.current?.click()}>Import backup…</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Backup file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImport(f);
            }}
          />
          <Button
            variant="danger"
            className="sm:ml-auto"
            onClick={async () => {
              if (!confirm('Delete ALL items, goals and categories? This cannot be undone. Export a backup first.')) return;
              await clearAllData();
              setMsg({ ok: true, text: 'All data deleted.' });
            }}
          >
            Delete all data
          </Button>
        </div>
        {msg && <p className={msg.ok ? 'text-green-600' : 'text-red-600'}>{msg.text}</p>}
      </div>
    </Section>
  );
}
