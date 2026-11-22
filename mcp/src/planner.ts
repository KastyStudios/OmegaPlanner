/*
 * Planner operations on the sync snapshot, reusing the app's own domain logic so the MCP
 * server and the app agree on recurrence, series edits and goal progress.
 */
import { addDays, addMinutes, format, isSameDay, startOfDay } from 'date-fns';
import type { Category, Completion, Goal, Item, Override, Priority } from '../../src/db/schema';
import { newId } from '../../src/db/schema';
import type { SyncedTable } from '../../src/db/syncTables';
import { goalProgress, progressText } from '../../src/domain/goals';
import { describeRRule, expandOccurrences, type Occurrence } from '../../src/domain/recurrence';
import { deleteOccurrence, editOccurrence, type ChangeSet, type EditScope, type ItemChanges } from '../../src/domain/seriesEdit';
import { timeLabel } from '../../src/lib/dates';
import { isoOf, local, localDate } from '../../src/lib/zone';
import type { Row, Snapshot } from '../../src/sync/merge';

export interface Data {
  categories: Category[];
  items: Item[];
  overrides: Override[];
  completions: Completion[];
  goals: Goal[];
}

export const dataOf = (s: Snapshot): Data => s.tables as unknown as Data;

/**
 * Writes to a snapshot the way the app's change tracking does: every written row gets a fresh
 * `updatedAt`, every deletion leaves a tombstone, so the app's merge picks the changes up.
 */
export class Tx {
  readonly now = new Date().toISOString();
  constructor(readonly snap: Snapshot) {}

  put<T extends { id: string }>(table: SyncedTable, row: T): T {
    const stamped = { ...row, updatedAt: this.now };
    const rows = this.snap.tables[table];
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = stamped as unknown as Row;
    else rows.push(stamped as unknown as Row);
    this.snap.tombstones = this.snap.tombstones.filter((t) => t.key !== `${table}:${row.id}`);
    return stamped;
  }

  delete(table: SyncedTable, id: string): void {
    const rows = this.snap.tables[table];
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    rows.splice(i, 1);
    const key = `${table}:${id}`;
    this.snap.tombstones = [...this.snap.tombstones.filter((t) => t.key !== key), { key, table, id, deletedAt: this.now }];
  }

  apply(cs: ChangeSet): void {
    cs.deleteItems.forEach((id) => this.delete('items', id));
    cs.deleteOverrides.forEach((id) => this.delete('overrides', id));
    cs.deleteCompletions.forEach((id) => this.delete('completions', id));
    cs.putItems.forEach((r) => this.put('items', r));
    cs.putOverrides.forEach((r) => this.put('overrides', r));
    cs.putCompletions.forEach((r) => this.put('completions', r));
  }
}

/* ---------------- input parsing ---------------- */

/** Local time from 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (a full ISO string with a zone also works). */
export function parseLocal(s: string): { date: Date; hasTime: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(s.trim());
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return { date: localDate(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0), hasTime: h !== undefined };
  }
  const d = local(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Can't read the date "${s}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm (local time).`);
  return { date: d, hasTime: true };
}

const PRIORITY: Record<string, Priority> = { high: 1, medium: 2, low: 3 };
const PRIORITY_NAME: Record<number, string> = { 1: 'high', 2: 'medium', 3: 'low' };
export const priorityOf = (p?: string) => (p ? PRIORITY[p] : undefined);

export function categoryId(data: Data, name: string | undefined): string | undefined {
  if (name === undefined || name === '') return undefined;
  const c = data.categories.find((x) => x.name.toLowerCase() === name.trim().toLowerCase() || x.id === name);
  if (!c) throw new Error(`Unknown category "${name}". Categories: ${data.categories.map((x) => x.name).join(', ')}.`);
  return c.id;
}

export function goalId(data: Data, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const g = data.goals.find((x) => x.title.toLowerCase() === name.trim().toLowerCase() || x.id === name);
  if (!g) throw new Error(`Unknown goal "${name}". Goals: ${data.goals.map((x) => x.title).join(', ') || 'none'}.`);
  return g.id;
}

function findItem(data: Data, id: string): Item {
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error(`No item with id ${id}. Use get_agenda, list_todos or search to find ids.`);
  return item;
}

const iso = (s: string) => isoOf(parseLocal(s).date);

function findOccurrence(data: Data, item: Item, occurrenceStart: string): Occurrence {
  const at = Date.parse(iso(occurrenceStart));
  const occs = expandOccurrences([item], data.overrides, data.completions, {
    start: new Date(at - 366 * 864e5),
    end: new Date(at + 366 * 864e5),
  });
  const occ = occs.find((o) => Date.parse(o.originalStart) === at);
  if (!occ) throw new Error(`"${item.title}" has no occurrence starting at ${occurrenceStart}. Use the occurrence value from get_agenda.`);
  return occ;
}

/* ---------------- formatting ---------------- */

const catName = (data: Data, id?: string) => data.categories.find((c) => c.id === id)?.name;

function occLine(data: Data, o: Occurrence): string {
  const when = timeLabel(o.start, o.end, o.allDay, o.item.kind);
  const bits = [
    `${o.done ? '[x]' : '[ ]'} ${when.padEnd(13)} ${o.title}`,
    catName(data, o.item.categoryId) && `#${catName(data, o.item.categoryId)}`,
    o.item.kind !== 'event' && o.item.kind,
    o.recurring && `repeats: ${describeRRule(o.item.rrule!)}`,
    o.item.priority && `priority ${PRIORITY_NAME[o.item.priority]}`,
  ].filter(Boolean);
  const ids = o.recurring ? `id=${o.item.id} occurrence=${o.originalStart}` : `id=${o.item.id}`;
  return `${bits.join('  ·  ')}\n      ${ids}${o.notes ? `\n      notes: ${o.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
}

function itemLine(data: Data, i: Item): string {
  const bits = [
    `${i.done ? '[x]' : '[ ]'} ${i.title}`,
    i.start && (i.kind === 'deadline' ? `due ${format(local(i.start), i.allDay ? 'EEE d MMM yyyy' : 'EEE d MMM yyyy HH:mm')}` : format(local(i.start), i.allDay ? 'EEE d MMM yyyy' : 'EEE d MMM yyyy HH:mm')),
    catName(data, i.categoryId) && `#${catName(data, i.categoryId)}`,
    i.kind,
    i.rrule && `repeats: ${describeRRule(i.rrule)}`,
    i.priority && `priority ${PRIORITY_NAME[i.priority]}`,
  ].filter(Boolean);
  return `${bits.join('  ·  ')}\n      id=${i.id}${i.notes ? `\n      notes: ${i.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
}

/* ---------------- reads ---------------- */

export function agenda(data: Data, fromDate: Date, days: number, now = new Date()): string {
  const out: string[] = [];
  const first = startOfDay(local(fromDate));
  const occs = expandOccurrences(data.items, data.overrides, data.completions, { start: first, end: addDays(first, days) });
  for (let d = 0; d < days; d++) {
    const day = addDays(first, d);
    const lo = day.getTime();
    const hi = addDays(day, 1).getTime();
    const todays = occs
      .filter((o) => {
        const s = Date.parse(o.start);
        const e = Date.parse(o.end);
        return s === e ? s >= lo && s < hi : s < hi && e > lo;
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    out.push(`## ${format(day, 'EEEE d MMMM yyyy')}${isSameDay(day, local(now)) ? ' (today)' : ''}`);
    out.push(todays.length ? todays.map((o) => occLine(data, o)).join('\n') : '(nothing planned)');
    out.push('');
  }

  if (isSameDay(first, local(now))) {
    const overdue = data.items.filter((i) => !i.rrule && !i.done && i.start && i.kind !== 'event' && new Date(i.start) < startOfDay(local(now)));
    if (overdue.length) out.push('## Overdue', ...overdue.map((i) => itemLine(data, i)), '');
    const until = addDays(startOfDay(local(now)), 8);
    const soon =
      addDays(first, days) < until
        ? expandOccurrences(data.items, data.overrides, data.completions, { start: addDays(first, days), end: until }).filter(
            (o) => o.item.kind === 'deadline' && !o.done,
          )
        : [];
    if (soon.length) out.push('## Deadlines in the next 7 days', ...soon.map((o) => `${format(local(o.start), 'EEE d MMM')}  ${occLine(data, o)}`), '');
    const open = data.items.filter((i) => !i.start && !i.done).length;
    if (open) out.push(`(${open} unscheduled to-do${open > 1 ? 's' : ''}; see list_todos)`);
  }
  return out.join('\n').trim();
}

export function todos(data: Data, includeDone: boolean): string {
  const list = data.items
    .filter((i) => !i.start && (includeDone || !i.done))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.createdAt.localeCompare(b.createdAt));
  return list.length ? list.map((i) => itemLine(data, i)).join('\n') : 'No unscheduled to-dos.';
}

export function search(data: Data, query: string): string {
  const q = query.toLowerCase();
  const hits = data.items.filter((i) => i.title.toLowerCase().includes(q) || i.notes?.toLowerCase().includes(q));
  return hits.length ? hits.slice(0, 50).map((i) => itemLine(data, i)).join('\n') : `Nothing matches "${query}".`;
}

export function categories(data: Data): string {
  return data.categories.map((c) => `${c.name} (${c.color})`).join('\n') || 'No categories.';
}

export function goals(data: Data, now = new Date()): string {
  if (!data.goals.length) return 'No goals.';
  return data.goals
    .map((g) => {
      const p = goalProgress(g, data.items, data.completions, now, data.overrides);
      const linked = data.items.filter((i) => i.goalId === g.id).map((i) => i.title);
      return [
        `${g.title} (${g.mode})${catName(data, g.categoryId) ? `  #${catName(data, g.categoryId)}` : ''}${g.targetDate ? `  target ${g.targetDate}` : ''}`,
        `      ${progressText(p)}${p.streak ? `, streak ${p.streak}` : ''}`,
        linked.length ? `      linked: ${linked.join(', ')}` : '',
        `      id=${g.id}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

/** Free gaps of at least `minutes` between timed plans on one day, within working hours. */
export function freeTime(data: Data, day: Date, minutes: number, from = '08:00', to = '20:00'): string {
  const d = startOfDay(local(day));
  const at = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return localDate(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0);
  };
  const lo = at(from);
  const hi = at(to);
  const busy = expandOccurrences(data.items, data.overrides, data.completions, { start: lo, end: hi })
    .filter((o) => !o.allDay && o.start !== o.end)
    .map((o) => [Math.max(Date.parse(o.start), lo.getTime()), Math.min(Date.parse(o.end), hi.getTime())] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: string[] = [];
  let cursor = lo.getTime();
  for (const [s, e] of [...busy, [hi.getTime(), hi.getTime()] as const]) {
    if (s - cursor >= minutes * 60_000) gaps.push(`${format(local(cursor), 'HH:mm')}–${format(local(s), 'HH:mm')}`);
    cursor = Math.max(cursor, e);
  }
  return gaps.length
    ? `Free on ${format(d, 'EEE d MMM')} (at least ${minutes} min, ${from}–${to}): ${gaps.join(', ')}`
    : `No free slot of ${minutes} min on ${format(d, 'EEE d MMM')} between ${from} and ${to}.`;
}

/* ---------------- writes ---------------- */

export interface ItemInput {
  title?: string;
  kind?: Item['kind'];
  start?: string;
  end?: string;
  duration_minutes?: number;
  all_day?: boolean;
  category?: string;
  goal?: string;
  notes?: string;
  repeat?: string;
  priority?: 'high' | 'medium' | 'low';
  reminders_minutes?: number[];
}

/** start/end/allDay for an item, the way the app's editor stores them. */
function times(kind: Item['kind'], input: ItemInput, fallbackAllDay = false) {
  if (!input.start) return {};
  const s = parseLocal(input.start);
  const allDay = input.all_day ?? (s.hasTime ? false : fallbackAllDay || !s.hasTime);
  if (allDay) {
    const start = startOfDay(local(s.date));
    if (kind === 'deadline') return { start: isoOf(start), end: undefined, allDay };
    // End is exclusive (next midnight); `end` given as the last day, inclusive.
    const last = input.end ? startOfDay(local(parseLocal(input.end).date)) : start;
    return { start: isoOf(start), end: isoOf(addDays(last < start ? start : last, 1)), allDay };
  }
  if (kind === 'deadline') return { start: isoOf(s.date), end: undefined, allDay };
  const end = input.end ? parseLocal(input.end).date : addMinutes(s.date, input.duration_minutes ?? 60);
  if (end <= s.date) throw new Error('The end must be after the start.');
  return { start: isoOf(s.date), end: isoOf(end), allDay };
}

const cleanRule = (r?: string) => r?.trim().replace(/^RRULE:/i, '') || undefined;

export function createItem(data: Data, tx: Tx, input: ItemInput): string {
  const kind = input.kind ?? (input.start ? 'event' : 'task');
  const t = times(kind, input);
  if (input.repeat && !t.start) throw new Error('A repeating item needs a start.');
  const item: Item = {
    id: newId(),
    kind,
    title: input.title!.trim(),
    notes: input.notes?.trim() || undefined,
    categoryId: categoryId(data, input.category),
    goalId: goalId(data, input.goal),
    start: t.start,
    end: t.end,
    allDay: t.allDay ?? false,
    rrule: cleanRule(input.repeat),
    exdates: [],
    priority: priorityOf(input.priority),
    reminders: input.reminders_minutes ?? [],
    createdAt: tx.now,
    updatedAt: tx.now,
  };
  if (item.rrule) describeRRule(item.rrule); // throws on an invalid rule
  tx.put('items', item);
  const o = item.start ? expandOccurrences([item], [], [], { start: new Date(item.start), end: addDays(new Date(item.start), 1) })[0] : undefined;
  return `Created: ${o ? occLine(data, o) : itemLine(data, item)}`;
}

export function updateItem(data: Data, tx: Tx, id: string, input: ItemInput & { occurrence_start?: string; scope?: EditScope }): string {
  const item = findItem(data, id);
  const changes: ItemChanges = {};
  if (input.title !== undefined) changes.title = input.title.trim();
  if (input.notes !== undefined) changes.notes = input.notes.trim() || undefined;
  if (input.kind !== undefined) changes.kind = input.kind;
  if (input.category !== undefined) changes.categoryId = categoryId(data, input.category);
  if (input.goal !== undefined) changes.goalId = goalId(data, input.goal);
  if (input.priority !== undefined) changes.priority = priorityOf(input.priority);
  if (input.reminders_minutes !== undefined) changes.reminders = input.reminders_minutes;
  if (input.repeat !== undefined) changes.rrule = cleanRule(input.repeat) ?? null;
  const kind = changes.kind ?? item.kind;

  if (input.start !== undefined || input.end !== undefined || input.all_day !== undefined || input.duration_minutes !== undefined) {
    // Keep the current start/length when only part of the timing changes.
    const occ = item.rrule && input.occurrence_start ? findOccurrence(data, item, input.occurrence_start) : undefined;
    const curStart = occ?.start ?? item.start;
    const curEnd = occ?.end ?? item.end;
    const fmt = (s: string, allDay: boolean) => format(local(s), allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
    const allDay = input.all_day ?? item.allDay;
    const start = input.start ?? (curStart ? fmt(curStart, allDay) : undefined);
    if (!start) throw new Error('Give a start to schedule this item.');
    let end = input.end;
    if (!end && input.duration_minutes === undefined && curStart && curEnd && !allDay && input.all_day === undefined) {
      end = format(addMinutes(parseLocal(start).date, (Date.parse(curEnd) - Date.parse(curStart)) / 60_000), "yyyy-MM-dd'T'HH:mm");
    }
    const t = times(kind, { ...input, start, end, all_day: allDay }, allDay);
    Object.assign(changes, { start: t.start, end: t.end, allDay: t.allDay });
  }

  if (item.rrule && input.occurrence_start) {
    const occ = findOccurrence(data, item, input.occurrence_start);
    const ctx = { item, overrides: data.overrides.filter((o) => o.itemId === id), completions: data.completions.filter((c) => c.itemId === id) };
    tx.apply(editOccurrence(ctx, occ, changes, input.scope ?? 'this'));
    return `Updated ${input.scope === 'all' ? 'the whole series' : input.scope === 'following' ? 'this and following occurrences' : 'this occurrence'} of "${item.title}".`;
  }
  if (item.rrule && (changes.start || changes.end)) {
    throw new Error(`"${item.title}" repeats: pass occurrence_start (from get_agenda) and a scope (this, following or all) to move it.`);
  }

  // One-off item, or series-wide fields of a recurring item (same as the app's updateItem).
  const next: Item = { ...item };
  for (const [k, v] of Object.entries(changes)) (next as unknown as Record<string, unknown>)[k] = v === null ? undefined : v;
  if (!next.start) Object.assign(next, { end: undefined, rrule: undefined });
  if (!next.rrule && item.rrule) {
    next.exdates = [];
    data.overrides.filter((o) => o.itemId === id).forEach((o) => tx.delete('overrides', o.id));
    data.completions.filter((c) => c.itemId === id).forEach((c) => tx.delete('completions', c.id));
  }
  if (next.rrule) describeRRule(next.rrule);
  const saved = tx.put('items', next);
  return `Updated: ${itemLine(data, saved)}`;
}

export function deleteItem(data: Data, tx: Tx, id: string, occurrenceStart?: string, scope: EditScope = 'this'): string {
  const item = findItem(data, id);
  if (item.rrule && occurrenceStart) {
    const occ = findOccurrence(data, item, occurrenceStart);
    const ctx = { item, overrides: data.overrides.filter((o) => o.itemId === id), completions: data.completions.filter((c) => c.itemId === id) };
    tx.apply(deleteOccurrence(ctx, occ, scope));
    return `Deleted ${scope === 'all' ? 'the whole series' : scope === 'following' ? 'this and following occurrences' : 'this occurrence'} of "${item.title}".`;
  }
  tx.delete('items', id);
  data.overrides.filter((o) => o.itemId === id).forEach((o) => tx.delete('overrides', o.id));
  data.completions.filter((c) => c.itemId === id).forEach((c) => tx.delete('completions', c.id));
  return `Deleted "${item.title}"${item.rrule ? ' (the whole series)' : ''}.`;
}

export function setDone(data: Data, tx: Tx, id: string, done: boolean, occurrenceStart?: string): string {
  const item = findItem(data, id);
  if (item.rrule) {
    if (!occurrenceStart) throw new Error(`"${item.title}" repeats: pass occurrence_start (from get_agenda) to check off one occurrence.`);
    const occ = findOccurrence(data, item, occurrenceStart);
    const existing = data.completions.find((c) => c.itemId === id && c.occurrenceStart === occ.originalStart);
    if (done && !existing) tx.put('completions', { id: newId(), itemId: id, occurrenceStart: occ.originalStart, completedAt: tx.now });
    if (!done && existing) tx.delete('completions', existing.id);
  } else {
    tx.put('items', { ...item, done, completedAt: done ? tx.now : undefined });
  }
  return `${done ? 'Checked off' : 'Unchecked'} "${item.title}".`;
}
