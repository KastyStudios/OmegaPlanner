import { useMemo, useState } from 'react';
import { useApp } from '../components/context';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../components/Rows';
import { EmptyState, inputCls, Section } from '../components/ui';
import type { Item } from '../db/schema';

const byPriorityThenTitle = (a: Item, b: Item) => (a.priority ?? 9) - (b.priority ?? 9) || a.title.localeCompare(b.title);

export function TodosPage() {
  const { data } = useApp();
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [showDone, setShowDone] = useState(false);

  const tasks = useMemo(
    () =>
      data.items.filter(
        (i) =>
          i.kind === 'task' &&
          !i.rrule &&
          (showDone || !i.done) &&
          (!category || i.categoryId === category) &&
          (!priority || String(i.priority ?? '') === priority),
      ),
    [data.items, category, priority, showDone],
  );
  const unscheduled = tasks.filter((t) => !t.start).sort(byPriorityThenTitle);
  const scheduled = tasks.filter((t) => t.start).sort((a, b) => a.start!.localeCompare(b.start!));
  const recurring = data.items.filter((i) => i.kind === 'task' && i.rrule && (!category || i.categoryId === category));

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="mb-5 text-2xl font-semibold">To-dos</h1>
      <div className="mb-6">
        <QuickAdd />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} !w-auto`} aria-label="Filter by category">
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={`${inputCls} !w-auto`} aria-label="Filter by priority">
          <option value="">Any priority</option>
          <option value="1">High</option>
          <option value="2">Medium</option>
          <option value="3">Low</option>
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-indigo-600" />
          Show completed
        </label>
      </div>

      <Section title={`Unscheduled (${unscheduled.length})`}>
        {unscheduled.length ? (
          <div className="space-y-1.5">
            {unscheduled.map((t) => (
              <TaskRow key={t.id} item={t} />
            ))}
          </div>
        ) : (
          <EmptyState>No unscheduled to-dos.</EmptyState>
        )}
      </Section>

      <Section title={`Scheduled (${scheduled.length})`}>
        {scheduled.length ? (
          <div className="space-y-1.5">
            {scheduled.map((t) => (
              <TaskRow key={t.id} item={t} />
            ))}
          </div>
        ) : (
          <EmptyState>No scheduled to-dos.</EmptyState>
        )}
      </Section>

      {recurring.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {recurring.length} recurring task{recurring.length > 1 ? 's are' : ' is'} shown on the Today page and in the calendar.
        </p>
      )}
    </div>
  );
}
