export type ItemKind = 'event' | 'task' | 'deadline';
export type Priority = 1 | 2 | 3; // 1 = high, 3 = low

export interface Category {
  id: string;
  name: string;
  color: string; // hex
}

/**
 * Anything that can appear in the planner. A task without `start` is an
 * unscheduled to-do. All timestamps are ISO strings (UTC). For all-day items,
 * `start` is local midnight and `end` is the exclusive end (next local midnight).
 */
export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  notes?: string;
  categoryId?: string;
  goalId?: string;
  start?: string;
  end?: string;
  allDay: boolean;
  /** RFC 5545 rule body without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR". */
  rrule?: string;
  /** Original starts (ISO) of occurrences deleted from the series. */
  exdates: string[];
  /** Only used for items that don't recur. */
  done?: boolean;
  completedAt?: string;
  priority?: Priority;
  /** Background color on the calendar (hex). Falls back to the default item color. */
  color?: string;
  /** Minutes before start at which to notify. */
  reminders: number[];
  createdAt: string;
  updatedAt: string;
  /** UID from an imported calendar (.ics); used to update instead of duplicate on re-import. */
  externalId?: string;
  /** Name of the calendar the item was imported from. */
  source?: string;
}

/** Changes to a single occurrence of a recurring item. */
export interface Override {
  id: string;
  itemId: string;
  originalStart: string;
  start?: string;
  end?: string;
  title?: string;
  notes?: string;
  cancelled?: boolean;
}

/** One checked-off occurrence of a recurring item. */
export interface Completion {
  id: string;
  itemId: string;
  occurrenceStart: string; // original start of the occurrence
  completedAt: string;
}

export type GoalMode = 'milestone' | 'habit';

export interface Goal {
  id: string;
  title: string;
  description?: string;
  categoryId?: string;
  targetDate?: string; // YYYY-MM-DD
  mode: GoalMode;
  /** `count` is a number of times, or of hours when `unit` is 'hours' (may be fractional). */
  habitTarget?: { count: number; period: 'week' | 'month'; unit?: 'times' | 'hours' };
  createdAt: string;
}

export const newId = (): string => crypto.randomUUID();
