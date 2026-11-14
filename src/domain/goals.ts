import { addMonths, addWeeks, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import type { Completion, Goal, Item } from '../db/schema';

export interface GoalProgress {
  done: number;
  total: number;
  /** 0..1 */
  ratio: number;
  /** Habit goals: consecutive periods (ending with the current one if met) that hit the target. */
  streak?: number;
  periodLabel?: string;
}

export function periodBounds(period: 'week' | 'month', at: Date): { start: Date; end: Date } {
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

export function goalProgress(goal: Goal, items: Item[], completions: Completion[], now: Date): GoalProgress {
  if (goal.mode === 'habit' && goal.habitTarget) {
    const { count, period } = goal.habitTarget;
    const times = completionTimes(goal, items, completions);
    const inPeriod = (b: { start: Date; end: Date }) =>
      times.filter((t) => t >= b.start.getTime() && t <= b.end.getTime()).length;

    const current = inPeriod(periodBounds(period, now));
    let streak = current >= count ? 1 : 0;
    const step = period === 'week' ? addWeeks : addMonths;
    for (let i = 1; i <= 104; i++) {
      if (inPeriod(periodBounds(period, step(now, -i))) >= count) streak++;
      else break;
    }
    return {
      done: current,
      total: count,
      ratio: count > 0 ? Math.min(1, current / count) : 0,
      streak,
      periodLabel: period === 'week' ? 'this week' : 'this month',
    };
  }

  // Milestone: share of linked one-off items that are done. Recurring items are habit-like
  // and don't count towards a milestone.
  const linked = items.filter((i) => i.goalId === goal.id && !i.rrule);
  const done = linked.filter((i) => i.done).length;
  return { done, total: linked.length, ratio: linked.length ? done / linked.length : 0 };
}
