import { format } from 'date-fns';
import type { Item } from '../db/schema';
import { setItemDone, setOccurrenceDone } from '../db/repo';
import type { Occurrence } from '../domain/recurrence';
import { describeRRule } from '../domain/recurrence';
import { friendlyDay, timeLabel } from '../lib/dates';
import { useApp } from './context';
import { CategoryBadge, Checkbox, Icon } from './ui';

const PRIORITY: Record<number, { label: string; cls: string }> = {
  1: { label: 'High', cls: 'text-red-700 dark:text-red-300' },
  2: { label: 'Medium', cls: 'text-amber-700 dark:text-amber-300' },
  3: { label: 'Low', cls: 'text-slate-500 dark:text-slate-400' },
};

export function PriorityTag({ p }: { p?: number }) {
  if (!p) return null;
  return <span className={`shrink-0 text-xs font-semibold ${PRIORITY[p].cls}`}>{PRIORITY[p].label}</span>;
}

const rowCls =
  'group flex cursor-pointer items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-white dark:hover:bg-slate-900';

/** A row for one calendar occurrence (Today page, goal details). */
export function OccurrenceRow({ occ, showDay = false }: { occ: Occurrence; showDay?: boolean }) {
  const { data, openEditor } = useApp();
  const cat = data.categoryById.get(occ.item.categoryId ?? '');
  const color = cat?.color ?? '#64748b';
  return (
    <div className={rowCls} role="button" tabIndex={0} onClick={() => openEditor({ item: occ.item, occurrence: occ })} onKeyDown={(e) => e.key === 'Enter' && openEditor({ item: occ.item, occurrence: occ })}>
      <Checkbox checked={occ.done} onChange={(v) => setOccurrenceDone(occ, v)} color={color} label={`Mark ${occ.title} done`} />
      <div className="w-[5.5rem] shrink-0 text-[13px] tabular-nums text-slate-600 dark:text-slate-400">
        {showDay && <div className="font-semibold text-slate-900 dark:text-slate-100">{friendlyDay(new Date(occ.start))}</div>}
        {timeLabel(occ.start, occ.end, occ.allDay, occ.item.kind)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-1.5 truncate text-[15px] font-semibold ${occ.done ? 'text-slate-400 line-through' : ''}`}>
          {occ.item.kind === 'deadline' && <Icon name="flag" className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />}
          <span className="truncate">{occ.title}</span>
        </div>
        {occ.recurring && (
          <div className="flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
            <Icon name="repeat" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{describeRRule(occ.item.rrule!)}</span>
          </div>
        )}
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
        <div className={`truncate text-[15px] font-semibold ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.title}</div>
        <div className="flex flex-wrap gap-x-3 text-xs text-slate-500 empty:hidden dark:text-slate-400">
          {item.start && (
            <span className={overdue ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {friendlyDay(new Date(item.start))}
              {!item.allDay && ` ${format(new Date(item.start), 'HH:mm')}`}
              {overdue && ', overdue'}
            </span>
          )}
          {goal && <span>For “{goal.title}”</span>}
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
