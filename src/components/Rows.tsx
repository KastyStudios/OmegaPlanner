import { format } from 'date-fns';
import type { Item } from '../db/schema';
import { setItemDone, setOccurrenceDone } from '../db/repo';
import type { Occurrence } from '../domain/recurrence';
import { describeRRule } from '../domain/recurrence';
import { friendlyDay, timeLabel } from '../lib/dates';
import { useApp } from './context';
import { CategoryBadge, Checkbox } from './ui';

const PRIORITY: Record<number, { label: string; cls: string }> = {
  1: { label: 'High', cls: 'text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300' },
  2: { label: 'Med', cls: 'text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300' },
  3: { label: 'Low', cls: 'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400' },
};

export function PriorityTag({ p }: { p?: number }) {
  if (!p) return null;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY[p].cls}`}>{PRIORITY[p].label}</span>;
}

const rowCls =
  'group flex w-full items-center gap-3 rounded-lg bg-white px-3 py-2 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-indigo-700';

/** A row for one calendar occurrence (Today page, goal details). */
export function OccurrenceRow({ occ, showDay = false }: { occ: Occurrence; showDay?: boolean }) {
  const { data, openEditor } = useApp();
  const cat = data.categoryById.get(occ.item.categoryId ?? '');
  const color = cat?.color ?? '#64748b';
  return (
    <div className={rowCls} role="button" tabIndex={0} onClick={() => openEditor({ item: occ.item, occurrence: occ })} onKeyDown={(e) => e.key === 'Enter' && openEditor({ item: occ.item, occurrence: occ })}>
      <Checkbox checked={occ.done} onChange={(v) => setOccurrenceDone(occ, v)} color={color} label={`Mark ${occ.title} done`} />
      <div className="w-24 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {showDay && <div className="font-medium text-slate-700 dark:text-slate-300">{friendlyDay(new Date(occ.start))}</div>}
        {timeLabel(occ.start, occ.end, occ.allDay, occ.item.kind)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${occ.done ? 'text-slate-400 line-through' : ''}`}>
          {occ.item.kind === 'deadline' && <span className="mr-1 text-red-500">⚑</span>}
          {occ.title}
        </div>
        {occ.recurring && <div className="truncate text-xs text-slate-400">↻ {describeRRule(occ.item.rrule!)}</div>}
      </div>
      <PriorityTag p={occ.item.priority} />
      <span className="hidden sm:inline">
        <CategoryBadge category={cat} />
      </span>
    </div>
  );
}

/** A row for a one-off task (To-dos page). */
export function TaskRow({ item }: { item: Item }) {
  const { data, openEditor } = useApp();
  const cat = data.categoryById.get(item.categoryId ?? '');
  const goal = data.goalById.get(item.goalId ?? '');
  const overdue = !item.done && item.start && new Date(item.end ?? item.start) < new Date();
  return (
    <div className={rowCls} role="button" tabIndex={0} onClick={() => openEditor({ item })} onKeyDown={(e) => e.key === 'Enter' && openEditor({ item })}>
      <Checkbox checked={!!item.done} onChange={(v) => setItemDone(item.id, v)} color={cat?.color ?? '#64748b'} label={`Mark ${item.title} done`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.title}</div>
        <div className="flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
          {item.start && (
            <span className={overdue ? 'font-medium text-red-600' : ''}>
              {friendlyDay(new Date(item.start))}
              {!item.allDay && ` ${format(new Date(item.start), 'HH:mm')}`}
              {overdue && ' · overdue'}
            </span>
          )}
          {goal && <span>◎ {goal.title}</span>}
          {item.notes && <span className="truncate">{item.notes}</span>}
        </div>
      </div>
      <PriorityTag p={item.priority} />
      <span className="hidden sm:inline">
        <CategoryBadge category={cat} />
      </span>
    </div>
  );
}
