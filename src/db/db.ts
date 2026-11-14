import Dexie, { type Table } from 'dexie';
import type { Category, Completion, Goal, Item, Override } from './schema';
import { newId } from './schema';

export class PlannerDB extends Dexie {
  categories!: Table<Category, string>;
  items!: Table<Item, string>;
  overrides!: Table<Override, string>;
  completions!: Table<Completion, string>;
  goals!: Table<Goal, string>;

  constructor() {
    super('omegaplanner');
    this.version(1).stores({
      categories: 'id, name',
      items: 'id, kind, start, goalId, categoryId',
      overrides: 'id, itemId, [itemId+originalStart]',
      completions: 'id, itemId, [itemId+occurrenceStart]',
      goals: 'id',
    });
    this.version(2).stores({
      items: 'id, kind, start, goalId, categoryId, externalId, source',
    });
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ id: newId(), ...c })));
    });
  }
}

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Health', color: '#16a34a' },
  { name: 'Work', color: '#2563eb' },
  { name: 'Study', color: '#9333ea' },
  { name: 'Personal', color: '#ea580c' },
];

export const db = new PlannerDB();
