import type { Completion, Item, Override } from '../db/schema';
import { newId } from '../db/schema';
import {
  type Occurrence,
  ruleCount,
  ruleFor,
  toFloating,
  withCount,
  withUntilBefore,
} from './recurrence';

export type EditScope = 'this' | 'following' | 'all';

/** Fields the editor (or a drag) can change. `rrule: null` removes recurrence. */
export interface ItemChanges {
  kind?: Item['kind'];
  title?: string;
  notes?: string;
  categoryId?: string;
  goalId?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  rrule?: string | null;
  priority?: Item['priority'];
  reminders?: number[];
}

/** Rows to write/delete, applied atomically by the repository. */
export interface ChangeSet {
  putItems: Item[];
  deleteItems: string[];
  putOverrides: Override[];
  deleteOverrides: string[];
  putCompletions: Completion[];
  deleteCompletions: string[];
}

export const emptyChangeSet = (): ChangeSet => ({
  putItems: [],
  deleteItems: [],
  putOverrides: [],
  deleteOverrides: [],
  putCompletions: [],
  deleteCompletions: [],
});

export interface SeriesContext {
  item: Item;
  overrides: Override[]; // of this item
  completions: Completion[]; // of this item
}

const shiftIso = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const now = () => new Date().toISOString();

function applyItemFields(item: Item, ch: ItemChanges): Item {
  const next: Item = { ...item, updatedAt: now() };
  for (const k of ['kind', 'title', 'notes', 'categoryId', 'goalId', 'allDay', 'priority', 'reminders'] as const) {
    if (k in ch) (next as unknown as Record<string, unknown>)[k] = ch[k];
  }
  if ('rrule' in ch) next.rrule = ch.rrule ?? undefined;
  return next;
}

/** Number of series occurrences strictly before `iso` (used to split COUNT rules). */
function countBefore(item: Item, iso: string): number {
  const rule = ruleFor(item.rrule!, item.start!);
  return rule.between(toFloating(new Date(item.start!)), toFloating(new Date(iso)), true).filter(
    (d) => d.getTime() < toFloating(new Date(iso)).getTime(),
  ).length;
}

/**
 * Edit an occurrence of a recurring item. `occ` is the occurrence as currently
 * displayed; `ch.start`/`ch.end` are the new absolute times of that occurrence.
 */
export function editOccurrence(ctx: SeriesContext, occ: Occurrence, ch: ItemChanges, scope: EditScope): ChangeSet {
  const cs = emptyChangeSet();
  const { item } = ctx;
  const existingOv = ctx.overrides.find((o) => o.originalStart === occ.originalStart);

  if (scope === 'this') {
    const ov: Override = existingOv
      ? { ...existingOv }
      : { id: newId(), itemId: item.id, originalStart: occ.originalStart };
    if (ch.start !== undefined) ov.start = ch.start;
    if (ch.end !== undefined) ov.end = ch.end;
    if (ch.title !== undefined && ch.title !== item.title) ov.title = ch.title;
    else if (ch.title !== undefined) delete ov.title;
    if (ch.notes !== undefined && ch.notes !== item.notes) ov.notes = ch.notes;
    else if (ch.notes !== undefined) delete ov.notes;
    cs.putOverrides.push(ov);
    return cs;
  }

  const startChanged = ch.start !== undefined && ch.start !== occ.start;
  const delta = startChanged ? Date.parse(ch.start!) - Date.parse(occ.start) : 0;
  const newDuration =
    ch.start !== undefined && ch.end !== undefined
      ? Date.parse(ch.end) - Date.parse(ch.start)
      : Date.parse(occ.end) - Date.parse(occ.start);

  const isFirst = occ.originalStart === item.start;

  if (scope === 'all' || isFirst) {
    const next = applyItemFields(item, ch);
    const seriesStart = shiftIso(item.start!, delta);
    next.start = seriesStart;
    next.end = new Date(Date.parse(seriesStart) + newDuration).toISOString();
    next.exdates = item.exdates.map((d) => shiftIso(d, delta));
    cs.putItems.push(next);
    for (const ov of ctx.overrides) {
      if (ov.originalStart === occ.originalStart) {
        // The edited fields now live on the series. Keep a pure time move if the time wasn't touched.
        const rest: Override = { ...ov };
        if (ch.title !== undefined) delete rest.title;
        if (ch.notes !== undefined) delete rest.notes;
        if (startChanged || (rest.start === undefined && rest.title === undefined && rest.notes === undefined)) {
          cs.deleteOverrides.push(ov.id);
        } else {
          cs.putOverrides.push(rest);
        }
        continue;
      }
      if (delta) cs.putOverrides.push({ ...ov, originalStart: shiftIso(ov.originalStart, delta) });
    }
    if (delta) {
      for (const c of ctx.completions) {
        cs.putCompletions.push({ ...c, occurrenceStart: shiftIso(c.occurrenceStart, delta) });
      }
    }
    if (next.rrule === undefined) {
      // Recurrence removed: series collapses to a single item, drop per-occurrence data.
      cs.putOverrides = [];
      cs.deleteOverrides = ctx.overrides.map((o) => o.id);
      cs.putCompletions = [];
      cs.deleteCompletions = ctx.completions.map((c) => c.id);
      next.exdates = [];
    }
    return cs;
  }

  // scope === 'following': split the series at this occurrence.
  const split = occ.originalStart;
  const oldCount = ruleCount(item.rrule!);
  const before = oldCount !== undefined ? countBefore(item, split) : 0;

  const head: Item = { ...item, rrule: withUntilBefore(item.rrule!, split), updatedAt: now() };
  head.exdates = item.exdates.filter((d) => d < split);

  const tail = applyItemFields({ ...item, id: newId(), createdAt: now() }, ch);
  tail.start = shiftIso(split, delta);
  tail.end = new Date(Date.parse(tail.start) + newDuration).toISOString();
  if (tail.rrule) {
    if (!('rrule' in ch) && oldCount !== undefined) tail.rrule = withCount(tail.rrule, Math.max(1, oldCount - before));
  }
  tail.exdates = item.exdates.filter((d) => d > split).map((d) => shiftIso(d, delta));
  cs.putItems.push(head, tail);

  for (const ov of ctx.overrides) {
    if (ov.originalStart < split) continue;
    cs.deleteOverrides.push(ov.id);
    if (ov.originalStart === split || !tail.rrule) continue;
    cs.putOverrides.push({ ...ov, id: newId(), itemId: tail.id, originalStart: shiftIso(ov.originalStart, delta) });
  }
  for (const c of ctx.completions) {
    if (c.occurrenceStart < split) continue;
    cs.deleteCompletions.push(c.id);
    if (!tail.rrule && c.occurrenceStart !== split) continue;
    if (!tail.rrule) {
      tail.done = true;
      tail.completedAt = c.completedAt;
      continue;
    }
    cs.putCompletions.push({ ...c, id: newId(), itemId: tail.id, occurrenceStart: shiftIso(c.occurrenceStart, delta) });
  }
  return cs;
}

/** Delete an occurrence (this), the rest of a series (following), or the whole series (all). */
export function deleteOccurrence(ctx: SeriesContext, occ: Occurrence, scope: EditScope): ChangeSet {
  const cs = emptyChangeSet();
  const { item } = ctx;
  const all = () => {
    cs.deleteItems.push(item.id);
    cs.deleteOverrides.push(...ctx.overrides.map((o) => o.id));
    cs.deleteCompletions.push(...ctx.completions.map((c) => c.id));
    return cs;
  };
  if (scope === 'all' || (scope === 'following' && occ.originalStart === item.start)) return all();

  if (scope === 'this') {
    cs.putItems.push({ ...item, exdates: [...item.exdates, occ.originalStart], updatedAt: now() });
    cs.deleteOverrides.push(...ctx.overrides.filter((o) => o.originalStart === occ.originalStart).map((o) => o.id));
    cs.deleteCompletions.push(
      ...ctx.completions.filter((c) => c.occurrenceStart === occ.originalStart).map((c) => c.id),
    );
    return cs;
  }

  const split = occ.originalStart;
  cs.putItems.push({
    ...item,
    rrule: withUntilBefore(item.rrule!, split),
    exdates: item.exdates.filter((d) => d < split),
    updatedAt: now(),
  });
  cs.deleteOverrides.push(...ctx.overrides.filter((o) => o.originalStart >= split).map((o) => o.id));
  cs.deleteCompletions.push(...ctx.completions.filter((c) => c.occurrenceStart >= split).map((c) => c.id));
  return cs;
}
