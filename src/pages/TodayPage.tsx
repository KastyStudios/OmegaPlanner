import { addDays, format, startOfDay } from 'date-fns';
import { useMemo } from 'react';
import { useApp } from '../components/context';
import { QuickAdd } from '../components/QuickAdd';
import { OccurrenceRow, TaskRow } from '../components/Rows';
import { Button, EmptyState, ProgressBar, Section } from '../components/ui';
import { goalProgress } from '../domain/goals';
import { useOccurrences } from '../hooks/usePlanner';

export function TodayPage() {
  const { data, openEditor } = useApp();
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const todays = useOccurrences(data, today, tomorrow);
  const lookback = useOccurrences(data, addDays(today, -14), today);
  const upcoming = useOccurrences(data, tomorrow, addDays(today, 8));

  const overdue = useMemo(() => {
    // Recurring tasks/deadlines missed in the last 2 weeks, plus any older one-off ones.
    const recent = lookback.filter((o) => o.item.kind !== 'event' && !o.done && o.recurring);
    const oneOff = data.items
      .filter((i) => i.kind !== 'event' && !i.rrule && !i.done && i.start && Date.parse(i.start) < today.getTime())
      .sort((a, b) => a.start!.localeCompare(b.start!));
    return { recent, oneOff };
  }, [lookback, data.items, today]);

  const deadlines = upcoming.filter((o) => o.item.kind === 'deadline' && !o.done);
  const unscheduled = data.items.filter((i) => i.kind === 'task' && !i.start && !i.done).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const doneToday = todays.filter((o) => o.done).length;
  const overdueCount = overdue.recent.length + overdue.oneOff.length;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <header className="mb-6">
        <p className="text-sm text-slate-500 dark:text-slate-400">{format(now, 'EEEE d MMMM yyyy')}</p>
        <h1 className="text-2xl font-semibold">{greeting(now)}</h1>
        {todays.length > 0 && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {doneToday} of {todays.length} things done today
          </p>
        )}
      </header>

      <Section title="Quick add">
        <QuickAdd />
      </Section>

      {overdueCount > 0 && (
        <Section title={`Overdue (${overdueCount})`}>
          <div className="space-y-1.5">
            {overdue.oneOff.map((i) => (
              <TaskRow key={i.id} item={i} />
            ))}
            {overdue.recent.map((o) => (
              <OccurrenceRow key={o.key} occ={o} showDay />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Today"
        action={
          <Button variant="ghost" onClick={() => openEditor({ defaults: { kind: 'event', start: nextHourToday(now) } })}>
            + Add
          </Button>
        }
      >
        {todays.length ? (
          <div className="space-y-1.5">
            {todays.map((o) => (
              <OccurrenceRow key={o.key} occ={o} />
            ))}
          </div>
        ) : (
          <EmptyState>Nothing planned today. Press N to add something.</EmptyState>
        )}
      </Section>

      <Section title="Deadlines in the next 7 days">
        {deadlines.length ? (
          <div className="space-y-1.5">
            {deadlines.map((o) => (
              <OccurrenceRow key={o.key} occ={o} showDay />
            ))}
          </div>
        ) : (
          <EmptyState>No deadlines coming up.</EmptyState>
        )}
      </Section>

      {data.goals.length > 0 && (
        <Section title="Goals">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.goals.map((g) => {
              const p = goalProgress(g, data.items, data.completions, now);
              const color = data.categoryById.get(g.categoryId ?? '')?.color;
              return (
                <div key={g.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{g.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {p.done}/{p.total} {p.periodLabel ?? ''}
                    </span>
                  </div>
                  <ProgressBar ratio={p.ratio} color={color} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title={`To-do (${unscheduled.length})`}>
        {unscheduled.length ? (
          <div className="space-y-1.5">
            {unscheduled.slice(0, 8).map((i) => (
              <TaskRow key={i.id} item={i} />
            ))}
          </div>
        ) : (
          <EmptyState>Your to-do list is empty.</EmptyState>
        )}
      </Section>
    </div>
  );
}

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function nextHourToday(now: Date) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.min(23, d.getHours() + 1));
  return d;
}
