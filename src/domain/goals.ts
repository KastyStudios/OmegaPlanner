import { addMonths, addWeeks, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import type { Completion, Goal, Item, Override } from '../db/schema';
import { local } from '../lib/zone';
import { expandOccurrences } from './recurrence';

export type GoalUnit = 'times' | 'hours' | 'tasks';

export interface GoalProgress {
  unit: GoalUnit;
  done: number;
  total: number;
  /** Hour goals: hours scheduled in the current period, done or not. */
  planned?: number;
  /** 0..1 */
  ratio: number;
  /** Habit goals: consecutive periods (ending with the current one if met) that hit the target. */
  streak?: number;
  periodLabel?: string;
}

export function periodBounds(period: 'week' | 'month', date: Date): { start: Date; end: Date } {
  const at = local(date);
  return period === 'week'
    ? { start: startOfWeek(at, { weekStartsOn: 1 }), end: endOfWeek(at, { weekStartsOn: 1 }) }
    : { start: startOfMonth(at), end: endOfMonth(at) };
}

/** Timestamps (ms) at which linked items were completed, keyed by occurrence time. */
function completionTimes(goal: Goal, items: Item[], completions: Completion[]): number[] {
  const linked = new Map(items.filter((i) => i.goalId === goal.id).map((i) => [i.id, i]));
  const times: number[] = [];
  for (const c of completions) if (linked.has(c.itemId)) times.push(Date.parse(c.occurrenceStart));
  for (const i of linked.values()) {
    if (i.rrule || !i.done) continue;
    const t = i.start ?? i.completedAt;
    if (t) times.push(Date.parse(t));
  }
  return times;
}

/** "3", "1.5" — at most one decimal. */
export function formatAmount(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** "2 / 3 this week", "4.5 / 10 h this week", "1 / 4 tasks done". */
export function progressText(p: GoalProgress): string {
  if (p.unit === 'hours') return `${formatAmount(p.done)} / ${formatAmount(p.total)} h ${p.periodLabel}`;
  if (p.unit === 'times') return `${p.done} / ${p.total} ${p.periodLabel}`;
  return `${p.done} / ${p.total} tasks done`;
}

const HOUR_MS = 3_600_000;

/**
 * Hours of linked, timed occurrences per period. All-day items have no meaningful length and
 * don't count. An occurrence belongs to the period its start falls in.
 */
function hoursByPeriod(
  goal: Goal,
  items: Item[],
  overrides: Override[],
  completions: Completion[],
  periods: { start: Date; end: Date }[],
): { done: number; planned: number }[] {
  const linked = items.filter((i) => i.goalId === goal.id);
  if (!linked.length || !periods.length) return periods.map(() => ({ done: 0, planned: 0 }));
  const from = periods.reduce((m, p) => (p.start < m ? p.start : m), periods[0].start);
  const to = periods.reduce((m, p) => (p.end > m ? p.end : m), periods[0].end);
  const ids = new Set(linked.map((i) => i.id));
  const occ = expandOccurrences(
    linked,
    overrides.filter((o) => ids.has(o.itemId)),
    completions.filter((c) => ids.has(c.itemId)),
    { start: from, end: new Date(to.getTime() + 1) },
  ).filter((o) => !o.allDay);
  return periods.map(({ start, end }) => {
    let done = 0;
    let planned = 0;
    for (const o of occ) {
      const s = Date.parse(o.start);
      if (s < start.getTime() || s > end.getTime()) continue;
      const h = (Date.parse(o.end) - s) / HOUR_MS;
      planned += h;
      if (o.done) done += h;
    }
    return { done, planned };
  });
}

export function goalProgress(
  goal: Goal,
  items: Item[],
  completions: Completion[],
  now: Date,
  overrides: Override[] = [],
): GoalProgress {
  if (goal.mode === 'habit' && goal.habitTarget) {
    const { count, period } = goal.habitTarget;
    const periodLabel = period === 'week' ? 'this week' : 'this month';
    const step = period === 'week' ? addWeeks : addMonths;

    if (goal.habitTarget.unit === 'hours') {
      const periods = Array.from({ length: 105 }, (_, i) => periodBounds(period, step(local(now), -i)));
      const hours = hoursByPeriod(goal, items, overrides, completions, periods);
      const current = hours[0];
      let streak = current.done >= count ? 1 : 0;
      for (let i = 1; i < hours.length && hours[i].done >= count; i++) streak++;
      return {
        unit: 'hours',
        done: current.done,
        total: count,
        planned: current.planned,
        ratio: count > 0 ? Math.min(1, current.done / count) : 0,
        streak,
        periodLabel,
      };
    }

    const times = completionTimes(goal, items, completions);
    const inPeriod = (b: { start: Date; end: Date }) =>
      times.filter((t) => t >= b.start.getTime() && t <= b.end.getTime()).length;

    const current = inPeriod(periodBounds(period, now));
    let streak = current >= count ? 1 : 0;
    for (let i = 1; i <= 104; i++) {
      if (inPeriod(periodBounds(period, step(local(now), -i))) >= count) streak++;
      else break;
    }
    return {
      unit: 'times',
      done: current,
      total: count,
      ratio: count > 0 ? Math.min(1, current / count) : 0,
      streak,
      periodLabel,
    };
  }

  // Milestone: share of linked one-off items that are done. Recurring items are habit-like
  // and don't count towards a milestone.
  const linked = items.filter((i) => i.goalId === goal.id && !i.rrule);
  const done = linked.filter((i) => i.done).length;
  return { unit: 'tasks', done, total: linked.length, ratio: linked.length ? done / linked.length : 0 };
}
