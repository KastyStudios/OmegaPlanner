import { addDays, format, startOfDay } from 'date-fns';
import { useMemo } from 'react';
import { useApp } from '../components/context';
import { QuickAdd } from '../components/QuickAdd';
import { OccurrenceRow, TaskRow } from '../components/Rows';
import { DayStrip } from '../components/DayStrip';
import { Button, EmptyState, List, ProgressBar, Section } from '../components/ui';
import { goalProgress, progressText } from '../domain/goals';
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
  const next = todays.find((o) => !o.done && !o.allDay && Date.parse(o.end) > now.getTime());

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-8 sm:pt-12">
      <header className="mb-7">
        <h1 className="text-[clamp(2.1rem,6vw,3.25rem)] font-extrabold leading-[0.95] tracking-[-0.035em]">
          {format(now, 'EEEE')}
          <br />
          <span className="text-slate-400 dark:text-slate-500">{format(now, 'd MMMM')}</span>
        </h1>
        <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">{summary(todays.length, doneToday, next && `${next.title} at ${format(new Date(next.start), 'HH:mm')}`)}</p>
      </header>

      <DayStrip day={today} occurrences={todays} />

      <div className="mb-9">
        <QuickAdd />
      </div>

      {overdueCount > 0 && (
        <Section title={`Overdue (${overdueCount})`}>
          <List>
            {overdue.oneOff.map((i) => (
              <TaskRow key={i.id} item={i} />
            ))}
            {overdue.recent.map((o) => (
              <OccurrenceRow key={o.key} occ={o} showDay />
            ))}
          </List>
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
          <List>
            {todays.map((o) => (
              <OccurrenceRow key={o.key} occ={o} />
            ))}
          </List>
        ) : (
          <EmptyState>Nothing planned today. Press N to add something.</EmptyState>
        )}
      </Section>

      <Section title="Deadlines in the next 7 days">
        {deadlines.length ? (
          <List>
            {deadlines.map((o) => (
              <OccurrenceRow key={o.key} occ={o} showDay />
            ))}
          </List>
        ) : (
          <EmptyState>No deadlines coming up.</EmptyState>
        )}
      </Section>

      {data.goals.length > 0 && (
        <Section title="Goals">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {data.goals.map((g) => {
              const p = goalProgress(g, data.items, data.completions, now, data.overrides);
              const color = data.categoryById.get(g.categoryId ?? '')?.color;
              return (
                <div key={g.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold">{g.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {progressText(p)}
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
          <List>
            {unscheduled.slice(0, 8).map((i) => (
              <TaskRow key={i.id} item={i} />
            ))}
          </List>
        ) : (
          <EmptyState>Your to-do list is empty.</EmptyState>
        )}
      </Section>
    </div>
  );
}

function summary(total: number, done: number, next?: string) {
  if (!total) return 'Nothing planned yet.';
  const left = total - done;
  const count = left === 0 ? `All ${total} done for today.` : `${left} of ${total} still to do.`;
  return next ? `${count} Next: ${next}.` : count;
}

function nextHourToday(now: Date) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.min(23, d.getHours() + 1));
  return d;
}
