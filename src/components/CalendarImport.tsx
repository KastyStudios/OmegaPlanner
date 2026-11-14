import { addDays, addMonths, addYears, startOfDay } from 'date-fns';
import { useMemo, useRef, useState } from 'react';
import { applyCalendarImport, saveCategory } from '../db/repo';
import type { Override } from '../db/schema';
import { parseIcs, planImport, type ImportPlan, type ParsedCalendar } from '../services/icsImport';
import { useApp } from './context';
import { Button, inputCls } from './ui';

type Since = '1w' | '3m' | '1y' | 'all';
const NEW_CATEGORY = '__new__';
const PALETTE = ['#0891b2', '#db2777', '#65a30d', '#7c3aed', '#d97706', '#0d9488', '#dc2626'];

interface LoadedFile {
  name: string;
  text: string;
}

function cutoffFor(since: Since): Date | undefined {
  const now = new Date();
  if (since === '1w') return startOfDay(addDays(now, -7));
  if (since === '3m') return addMonths(now, -3);
  if (since === '1y') return addYears(now, -1);
  return undefined;
}

export function CalendarImport() {
  const { data } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [since, setSince] = useState<Since>('1w');
  const [removeMissing, setRemoveMissing] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Parse whenever the files or the cutoff change.
  const parsed = useMemo(() => {
    const cutoff = cutoffFor(since);
    const out: { file: string; cal?: ParsedCalendar; error?: string }[] = [];
    for (const f of files) {
      try {
        out.push({ file: f.name, cal: parseIcs(f.text, f.name, { cutoff }) });
      } catch (e) {
        out.push({ file: f.name, error: (e as Error).message });
      }
    }
    return out;
  }, [files, since]);

  const overridesByItem = useMemo(() => {
    const m = new Map<string, Override[]>();
    for (const o of data.overrides) m.set(o.itemId, [...(m.get(o.itemId) ?? []), o]);
    return m;
  }, [data.overrides]);

  const plans = useMemo(
    () =>
      parsed.map((p) =>
        p.cal ? planImport(p.cal, data.items, (id) => overridesByItem.get(id) ?? [], { removeMissing }) : undefined,
      ),
    [parsed, data.items, overridesByItem, removeMissing],
  );

  function defaultCategory(calName: string): string {
    const match = data.categories.find((c) => c.name.toLowerCase() === calName.toLowerCase());
    if (match) return match.id;
    return calName.includes('@') ? '' : NEW_CATEGORY; // the main Google calendar is named after the email address
  }
  const chosenCategory = (calName: string) => categoryChoice[calName] ?? defaultCategory(calName);

  async function onPick(list: FileList | null) {
    setMsg(null);
    if (!list?.length) return;
    const picked = [...list];
    const zips = picked.filter((f) => /\.zip$/i.test(f.name));
    if (zips.length) {
      setMsg({ ok: false, text: 'Google exports a .zip file. Unzip it first (right-click → Extract All), then pick the .ics files inside.' });
    }
    const loaded = await Promise.all(picked.filter((f) => !/\.zip$/i.test(f.name)).map(async (f) => ({ name: f.name, text: await f.text() })));
    setFiles(loaded);
  }

  async function runImport() {
    setBusy(true);
    setMsg(null);
    try {
      const totals = { created: 0, updated: 0, removed: 0 };
      let colorIdx = data.categories.length;
      for (const plan of plans) {
        if (!plan) continue;
        let categoryId: string | undefined = chosenCategory(plan.calendar) || undefined;
        if (categoryId === NEW_CATEGORY) {
          categoryId = await saveCategory({ name: plan.calendar, color: PALETTE[colorIdx++ % PALETTE.length] });
        }
        const r = await applyCalendarImport(plan, categoryId);
        totals.created += r.created;
        totals.updated += r.updated;
        totals.removed += r.removed;
      }
      setFiles([]);
      setCategoryChoice({});
      setMsg({
        ok: true,
        text: `Done: ${totals.created} added, ${totals.updated} updated${totals.removed ? `, ${totals.removed} removed` : ''}.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: `Import failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const work = plans.reduce((n, p) => n + (p ? p.create.length + p.update.length + p.remove.length : 0), 0);

  return (
    <div className="space-y-4 text-sm">
      <details className="rounded-lg bg-slate-50 p-3 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-100">How to export from Google Calendar</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Open <span className="font-medium">calendar.google.com</span> on a computer.
          </li>
          <li>
            Click ⚙ <b>Settings</b> → <b>Import &amp; export</b> → <b>Export</b>. A .zip file downloads.
          </li>
          <li>
            Right-click the .zip → <b>Extract All</b>. It contains one .ics file per calendar.
          </li>
          <li>Pick one or more of those .ics files below.</li>
        </ol>
        <p className="mt-2">
          Importing again later updates events that were already imported instead of duplicating them. Edit imported events in Google and re-import:
          local changes to their times are overwritten by the next import. Your category, goal and done marks are kept.
        </p>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Import events from
          <select value={since} onChange={(e) => setSince(e.target.value as Since)} className={`${inputCls} !w-auto`}>
            <option value="1w">the last week onward</option>
            <option value="3m">the last 3 months onward</option>
            <option value="1y">the last year onward</option>
            <option value="all">all time</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="accent-indigo-600" />
          Remove events that were deleted in Google
        </label>
      </div>

      <div>
        <Button onClick={() => fileRef.current?.click()}>Choose .ics files…</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar,.zip"
          multiple
          hidden
          aria-label="Calendar files"
          onChange={(e) => {
            void onPick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {parsed.length > 0 && (
        <div className="space-y-3">
          {parsed.map((p, i) => (
            <CalendarPreview
              key={p.file}
              file={p.file}
              cal={p.cal}
              error={p.error}
              plan={plans[i]}
              category={p.cal ? chosenCategory(p.cal.name) : ''}
              onCategory={(v) => p.cal && setCategoryChoice((c) => ({ ...c, [p.cal!.name]: v }))}
            />
          ))}
          <div className="flex gap-2">
            <Button variant="primary" onClick={runImport} disabled={busy || work === 0}>
              {busy ? 'Importing…' : work === 0 ? 'Nothing to import' : `Import ${work} change${work === 1 ? '' : 's'}`}
            </Button>
            <Button onClick={() => setFiles([])} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {msg && <p className={msg.ok ? 'text-green-600' : 'text-red-600'}>{msg.text}</p>}
    </div>
  );
}

function CalendarPreview({
  file,
  cal,
  error,
  plan,
  category,
  onCategory,
}: {
  file: string;
  cal?: ParsedCalendar;
  error?: string;
  plan?: ImportPlan;
  category: string;
  onCategory: (v: string) => void;
}) {
  const { data } = useApp();
  if (!cal || !plan) {
    return <div className="rounded-lg border border-red-200 p-3 text-red-600 dark:border-red-900">{error ?? `Could not read ${file}.`}</div>;
  }
  const recurring = cal.events.filter((e) => e.rrule).length;
  const stats = [
    [plan.create.length, 'new'],
    [plan.update.length, 'updated'],
    [plan.unchanged, 'unchanged'],
    [plan.remove.length, 'to remove'],
    [cal.skippedPast, 'older (skipped)'],
  ].filter(([n]) => n) as [number, string][];

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{cal.name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {cal.events.length} event{cal.events.length === 1 ? '' : 's'}
            {recurring ? ` (${recurring} recurring)` : ''} · {stats.map(([n, l]) => `${n} ${l}`).join(' · ') || 'nothing to import'}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          Category for new events
          <select value={category} onChange={(e) => onCategory(e.target.value)} className={`${inputCls} !w-auto`} aria-label={`Category for ${cal.name}`}>
            <option value="">None</option>
            {!data.categories.some((c) => c.name.toLowerCase() === cal.name.toLowerCase()) && (
              <option value={NEW_CATEGORY}>New: “{cal.name}”</option>
            )}
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {cal.warnings.length > 0 && (
        <details className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          <summary className="cursor-pointer">{cal.warnings.length} warning{cal.warnings.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 list-disc pl-5">
            {cal.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
