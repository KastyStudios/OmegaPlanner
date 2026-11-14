import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import type { Category, Completion, Goal, Item, Override } from '../db/schema';
import { expandOccurrences, type Occurrence } from '../domain/recurrence';

export interface PlannerData {
  items: Item[];
  overrides: Override[];
  completions: Completion[];
  categories: Category[];
  goals: Goal[];
  categoryById: Map<string, Category>;
  goalById: Map<string, Goal>;
}

/** All planner data, live-updating whenever IndexedDB changes. `undefined` while loading. */
export function usePlannerData(): PlannerData | undefined {
  const raw = useLiveQuery(async () => {
    const [items, overrides, completions, categories, goals] = await Promise.all([
      db.items.toArray(),
      db.overrides.toArray(),
      db.completions.toArray(),
      db.categories.toArray(),
      db.goals.toArray(),
    ]);
    return { items, overrides, completions, categories, goals };
  });
  return useMemo(() => {
    if (!raw) return undefined;
    categoriesSort(raw.categories);
    return {
      ...raw,
      categoryById: new Map(raw.categories.map((c) => [c.id, c])),
      goalById: new Map(raw.goals.map((g) => [g.id, g])),
    };
  }, [raw]);
}

function categoriesSort(c: Category[]) {
  c.sort((a, b) => a.name.localeCompare(b.name));
}

/** Occurrences overlapping [start, end). */
export function useOccurrences(data: PlannerData | undefined, start: Date, end: Date): Occurrence[] {
  const s = start.getTime();
  const e = end.getTime();
  return useMemo(
    () =>
      data ? expandOccurrences(data.items, data.overrides, data.completions, { start: new Date(s), end: new Date(e) }) : [],
    [data, s, e],
  );
}
