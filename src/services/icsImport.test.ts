import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Item, Override } from '../db/schema';
import { expandOccurrences } from '../domain/recurrence';
import { convertRRule, htmlToText, importedFields, parseIcs, planImport, type ImportedEvent } from './icsImport';

// TZ is Europe/Amsterdam (vitest.config.ts); the fixture is a Google-style export.
const text = fs.readFileSync(path.join(__dirname, '__fixtures__', 'google-sample.ics'), 'utf8');
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const hhmm = (s: string) => {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Turn imported events into items/overrides the way applyCalendarImport does. */
function materialize(events: ImportedEvent[]) {
  const items: Item[] = [];
  const overrides: Override[] = [];
  for (const ev of events) {
    items.push({ ...importedFields(ev), id: ev.uid, kind: 'event', externalId: ev.uid, source: 'Personal', createdAt: '', updatedAt: '' });
    if (ev.rrule) overrides.push(...ev.overrides.map((o, i) => ({ ...o, id: `${ev.uid}-${i}`, itemId: ev.uid })));
  }
  return { items, overrides };
}

describe('parseIcs', () => {
  const cal = parseIcs(text, 'personal.ics');

  it('reads the calendar name and all events', () => {
    expect(cal.name).toBe('Personal');
    expect(cal.events.map((e) => e.title).sort()).toEqual(['Ancient event', 'Gym', "Mom's birthday", 'Thesis meeting', 'Weekend trip']);
    expect(cal.warnings).toEqual([]);
  });

  it('maps a recurring Google event with exceptions onto the recurrence model', () => {
    const gym = cal.events.find((e) => e.title === 'Gym')!;
    expect(gym.notes).toBe('📍 Basic-Fit Eindhoven\n\nLeg day, then cardio');
    expect(gym.reminders).toEqual([30]);
    const { items, overrides } = materialize([gym]);
    const occ = expandOccurrences(items, overrides, [], { start: new Date(local(2026, 10, 19)), end: new Date(local(2026, 11, 3)) });
    expect(occ.map((o) => `${hhmm(o.start)} ${o.title}`)).toEqual([
      '10/19 18:00 Gym',
      '10/21 18:00 Gym',
      // 10/23 removed by EXDATE
      '10/26 18:00 Gym', // after DST change, still 18:00
      '10/29 07:00 Gym (morning)', // Wed moved to Thu morning
      // 10/30 cancelled
      '11/2 18:00 Gym',
    ]);
  });

  it('respects the series UNTIL in local time', () => {
    const gym = cal.events.find((e) => e.title === 'Gym')!;
    const { items } = materialize([gym]);
    const occ = expandOccurrences(items, [], [], { start: new Date(local(2026, 12, 28)), end: new Date(local(2027, 1, 10)) });
    expect(occ.map((o) => hhmm(o.start))).toEqual(['12/28 18:00', '12/30 18:00']); // UNTIL = 31 Dec 23:59:59 local
  });

  it('imports all-day, UTC and yearly events', () => {
    const { items } = materialize(cal.events);
    const occ = expandOccurrences(items, [], [], { start: new Date(local(2026, 11, 16)), end: new Date(local(2026, 11, 23)) });
    const trip = occ.find((o) => o.title === 'Weekend trip')!;
    expect(trip.allDay).toBe(true);
    expect([trip.start, trip.end]).toEqual([local(2026, 11, 20), local(2026, 11, 22)]);
    expect(hhmm(occ.find((o) => o.title === 'Thesis meeting')!.start)).toBe('11/16 14:00');
    const bday = expandOccurrences(items, [], [], { start: new Date(local(2027, 3, 1)), end: new Date(local(2027, 4, 1)) });
    expect(bday.map((o) => [o.title, o.start, o.allDay])).toEqual([["Mom's birthday", local(2027, 3, 15), true]]);
  });

  it('skips events that ended before the cutoff but remembers their UIDs', () => {
    const c = parseIcs(text, 'personal.ics', { cutoff: new Date(local(2026, 11, 1)) });
    expect(c.events.map((e) => e.title).sort()).toEqual(['Gym', "Mom's birthday", 'Thesis meeting', 'Weekend trip']);
    expect(c.skippedPast).toBe(1);
    expect(c.seenUids).toContain('old@google.com');
  });

  it('trims a series that started before the cutoff so no older occurrences appear', () => {
    const c = parseIcs(text, 'personal.ics', { cutoff: new Date(local(2026, 11, 1)) });
    const gym = c.events.find((e) => e.title === 'Gym')!;
    expect([gym.start, gym.end]).toEqual([local(2026, 11, 2, 18), local(2026, 11, 2, 19)]);
    expect(gym.exdates).toEqual([]);
    const { items, overrides } = materialize(c.events);
    const occ = expandOccurrences(items, overrides, [], { start: new Date(local(2026, 10, 1)), end: new Date(local(2026, 11, 8)) });
    expect(occ.filter((o) => o.title === 'Gym').map((o) => hhmm(o.start))).toEqual(['11/2 18:00', '11/4 18:00', '11/6 18:00']);
    const bday = c.events.find((e) => e.title === "Mom's birthday")!;
    expect([bday.start, bday.end]).toEqual([local(2027, 3, 15), local(2027, 3, 16)]);
  });

  it('reduces COUNT when trimming a counted series', () => {
    const counted = text.replace('RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261231T225959Z;BYDAY=MO,WE,FR', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10');
    const c = parseIcs(counted, 'personal.ics', { cutoff: new Date(local(2026, 11, 1)) });
    const { items } = materialize(c.events);
    const occ = expandOccurrences(items, [], [], { start: new Date(local(2026, 10, 1)), end: new Date(local(2027, 1, 1)) });
    // 10 sessions from 19 Oct: 6 before 1 Nov, so 4 remain (2, 4, 6, 9 Nov).
    expect(occ.filter((o) => o.title === 'Gym').map((o) => hhmm(o.start))).toEqual(['11/2 18:00', '11/4 18:00', '11/6 18:00', '11/9 18:00']);
  });

  it('rejects files that are not calendars', () => {
    expect(() => parseIcs('hello', 'notes.txt')).toThrow(/not a valid .ics/);
  });
});

describe('planImport', () => {
  const cal = parseIcs(text, 'personal.ics', { cutoff: new Date(local(2026, 11, 1)) });
  const none = () => [];

  it('creates everything on first import', () => {
    const p = planImport(cal, [], none, { removeMissing: true });
    expect(p.create).toHaveLength(4);
    expect(p.update).toHaveLength(0);
  });

  it('updates instead of duplicating on re-import and keeps user fields', () => {
    const { items, overrides } = materialize(cal.events);
    const meeting = items.find((i) => i.title === 'Thesis meeting')!;
    meeting.categoryId = 'work';
    const moved = { ...meeting, start: local(2026, 11, 16, 9) };
    const others = items.filter((i) => i !== meeting);
    const p = planImport(cal, [...others, moved], (id) => overrides.filter((o) => o.itemId === id), { removeMissing: false });
    expect(p.create).toHaveLength(0);
    expect(p.update.map((u) => u.item.title)).toEqual(['Thesis meeting']);
    expect(p.unchanged).toBe(3);
    expect(p.update.find((u) => u.item.title === 'Thesis meeting')!.item.categoryId).toBe('work');
  });

  it('removes items deleted from the calendar, but not ones skipped by the cutoff', () => {
    const { items } = materialize(parseIcs(text, 'personal.ics').events);
    const deleted: Item = { ...items[0], id: 'x', externalId: 'gone@google.com', title: 'Deleted in Google' };
    const p = planImport(cal, [...items, deleted], none, { removeMissing: true });
    expect(p.remove.map((i) => i.title)).toEqual(['Deleted in Google']);
  });
});

describe('re-import with a moving cutoff', () => {
  it('does not push an imported series forward', () => {
    const first = parseIcs(text, 'personal.ics', { cutoff: new Date(local(2026, 11, 1)) });
    const { items, overrides } = materialize(first.events);
    const later = parseIcs(text, 'personal.ics', { cutoff: new Date(local(2026, 11, 20)) });
    const p = planImport(later, items, (id) => overrides.filter((o) => o.itemId === id), { removeMissing: true });
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
  });
});

describe('planImport with edited occurrences', () => {
  it('only reports a series as changed when its edited occurrences differ', () => {
    const full = parseIcs(text, 'personal.ics');
    const { items, overrides } = materialize(full.events);
    const ovFor = (id: string) => overrides.filter((o) => o.itemId === id);
    expect(planImport(full, items, ovFor, { removeMissing: false }).update).toHaveLength(0);
    const fewer = (id: string) => ovFor(id).slice(1);
    expect(planImport(full, items, fewer, { removeMissing: false }).update.map((u) => u.item.title)).toEqual(['Gym']);
  });
});

describe('helpers', () => {
  it('converts UNTIL to floating local time', () => {
    expect(convertRRule('RRULE:FREQ=WEEKLY;UNTIL=20261231T225959Z;BYDAY=MO')).toBe('FREQ=WEEKLY;UNTIL=20261231T235959Z;BYDAY=MO');
    expect(convertRRule('FREQ=DAILY;UNTIL=20261231')).toBe('FREQ=DAILY;UNTIL=20261231T235959Z');
  });
  it('strips Google HTML from descriptions', () => {
    expect(htmlToText('Agenda:<br><ul><li>Intro</li><li>Q&amp;A</li></ul><a href="x">link</a>')).toBe('Agenda:\n• Intro\n• Q&A\nlink');
  });
});
