import { db } from './db';
import type { Category, Goal, Item, Override } from './schema';
import { importedFields, type ImportedEvent, type ImportPlan } from '../services/icsImport';
import { newId } from './schema';
import type { Occurrence } from '../domain/recurrence';
import {
  deleteOccurrence,
  editOccurrence,
  type ChangeSet,
  type EditScope,
  type ItemChanges,
} from '../domain/seriesEdit';

const nowIso = () => new Date().toISOString();
const ALL_TABLES = () => [db.items, db.overrides, db.completions, db.categories, db.goals];

export async function applyChangeSet(cs: ChangeSet): Promise<void> {
  await db.transaction('rw', db.items, db.overrides, db.completions, async () => {
    if (cs.deleteItems.length) await db.items.bulkDelete(cs.deleteItems);
    if (cs.deleteOverrides.length) await db.overrides.bulkDelete(cs.deleteOverrides);
    if (cs.deleteCompletions.length) await db.completions.bulkDelete(cs.deleteCompletions);
    if (cs.putItems.length) await db.items.bulkPut(cs.putItems);
    if (cs.putOverrides.length) await db.overrides.bulkPut(cs.putOverrides);
    if (cs.putCompletions.length) await db.completions.bulkPut(cs.putCompletions);
  });
}

/* ---------------- items ---------------- */

export type NewItem = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'exdates' | 'reminders'> &
  Partial<Pick<Item, 'exdates' | 'reminders'>>;

export async function createItem(data: NewItem): Promise<string> {
  const t = nowIso();
  const item: Item = { exdates: [], reminders: [], ...data, id: newId(), createdAt: t, updatedAt: t };
  await db.items.add(item);
  return item.id;
}

/** Update a one-off item (or a recurring item's series fields directly). */
export async function updateItem(id: string, changes: ItemChanges & { done?: boolean }): Promise<void> {
  const item = await db.items.get(id);
  if (!item) return;
  const next: Item = { ...item, updatedAt: nowIso() };
  for (const [k, v] of Object.entries(changes)) {
    (next as unknown as Record<string, unknown>)[k] = v === null ? undefined : v;
  }
  if (!next.start) {
    next.end = undefined;
    next.rrule = undefined;
  }
  if (!next.rrule && item.rrule) {
    // Recurrence removed: per-occurrence data is meaningless now.
    next.exdates = [];
    await db.overrides.where('itemId').equals(id).delete();
    await db.completions.where('itemId').equals(id).delete();
  }
  await db.items.put(next);
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.overrides, db.completions, async () => {
    await db.items.delete(id);
    await db.overrides.where('itemId').equals(id).delete();
    await db.completions.where('itemId').equals(id).delete();
  });
}

async function seriesContext(itemId: string) {
  const [item, overrides, completions] = await Promise.all([
    db.items.get(itemId),
    db.overrides.where('itemId').equals(itemId).toArray(),
    db.completions.where('itemId').equals(itemId).toArray(),
  ]);
  if (!item) throw new Error(`Item ${itemId} not found`);
  return { item, overrides, completions };
}

export async function editOccurrenceScoped(occ: Occurrence, changes: ItemChanges, scope: EditScope) {
  if (!occ.recurring) return updateItem(occ.item.id, changes);
  await applyChangeSet(editOccurrence(await seriesContext(occ.item.id), occ, changes, scope));
}

export async function deleteOccurrenceScoped(occ: Occurrence, scope: EditScope) {
  if (!occ.recurring) return deleteItem(occ.item.id);
  await applyChangeSet(deleteOccurrence(await seriesContext(occ.item.id), occ, scope));
}

export async function setOccurrenceDone(occ: Occurrence, done: boolean): Promise<void> {
  if (!occ.recurring) return setItemDone(occ.item.id, done);
  const existing = await db.completions
    .where('[itemId+occurrenceStart]')
    .equals([occ.item.id, occ.originalStart])
    .first();
  if (done && !existing) {
    await db.completions.add({
      id: newId(),
      itemId: occ.item.id,
      occurrenceStart: occ.originalStart,
      completedAt: nowIso(),
    });
  } else if (!done && existing) {
    await db.completions.delete(existing.id);
  }
}

export async function setItemDone(id: string, done: boolean): Promise<void> {
  await db.items.update(id, { done, completedAt: done ? nowIso() : undefined, updatedAt: nowIso() });
}

/* ---------------- categories ---------------- */

export async function saveCategory(c: Omit<Category, 'id'> & { id?: string }): Promise<string> {
  const id = c.id ?? newId();
  await db.categories.put({ ...c, id });
  return id;
}

export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.items, db.goals, async () => {
    await db.categories.delete(id);
    await db.items.where('categoryId').equals(id).modify({ categoryId: undefined });
    await db.goals.filter((g) => g.categoryId === id).modify({ categoryId: undefined });
  });
}

/* ---------------- goals ---------------- */

export async function saveGoal(g: Omit<Goal, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
  const goal: Goal = { ...g, id: g.id ?? newId(), createdAt: g.createdAt ?? nowIso() };
  await db.goals.put(goal);
  return goal.id;
}

export async function deleteGoal(id: string): Promise<void> {
  await db.transaction('rw', db.goals, db.items, async () => {
    await db.goals.delete(id);
    await db.items.where('goalId').equals(id).modify({ goalId: undefined });
  });
}

/* ---------------- maintenance ---------------- */

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', ALL_TABLES(), async () => {
    // Delete row by row (not clear()) so deletions are tracked and reach synced devices.
    for (const t of ALL_TABLES()) await t.toCollection().delete();
  });
}

/* ---------------- calendar import ---------------- */

export interface ImportResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Apply an import plan. New items get `categoryId`; updated items keep the user's own fields
 * (category, goal, priority, done) and get the calendar's times, rule and edited occurrences.
 */
export async function applyCalendarImport(plan: ImportPlan, categoryId: string | undefined): Promise<ImportResult> {
  const t = nowIso();
  const toOverrides = (itemId: string, ev: ImportedEvent): Override[] =>
    ev.rrule ? ev.overrides.map((o) => ({ ...o, id: newId(), itemId })) : [];

  await db.transaction('rw', db.items, db.overrides, db.completions, async () => {
    const items: Item[] = [];
    const overrides: Override[] = [];
    for (const ev of plan.create) {
      const id = newId();
      items.push({
        ...importedFields(ev),
        id,
        kind: 'event',
        categoryId,
        externalId: ev.uid,
        source: plan.calendar,
        createdAt: t,
        updatedAt: t,
      });
      overrides.push(...toOverrides(id, ev));
    }
    for (const { item, ev } of plan.update) {
      items.push({ ...item, ...importedFields(ev), source: plan.calendar, updatedAt: t });
      await db.overrides.where('itemId').equals(item.id).delete();
      overrides.push(...toOverrides(item.id, ev));
    }
    await db.items.bulkPut(items);
    await db.overrides.bulkAdd(overrides);
    for (const item of plan.remove) {
      await db.items.delete(item.id);
      await db.overrides.where('itemId').equals(item.id).delete();
      await db.completions.where('itemId').equals(item.id).delete();
    }
  });
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}
