import ICAL from 'ical.js';
import { RRule } from 'rrule';
import type { Item, Override } from '../db/schema';
import { fromFloating, ruleCount, ruleFor, stripRulePrefix, toFloating, withCount } from '../domain/recurrence';

/*
 * Import of iCalendar (.ics) files, e.g. a Google Calendar export
 * (Google Calendar → Settings → Import & export → Export, then unzip).
 * Parsing and planning are pure; the repository applies the plan.
 */

export interface ImportedOverride {
  originalStart: string;
  start?: string;
  end?: string;
  title?: string;
  notes?: string;
  cancelled?: boolean;
}

export interface ImportedEvent {
  uid: string;
  title: string;
  notes?: string;
  allDay: boolean;
  start: string;
  end?: string;
  /** Rule body in OmegaPlanner's convention (UNTIL in floating local time). */
  rrule?: string;
  exdates: string[];
  reminders: number[];
  overrides: ImportedOverride[];
  /** Series as in the file, before its start was moved to the cutoff. */
  untrimmed?: Pick<ImportedEvent, 'start' | 'end' | 'rrule' | 'exdates' | 'allDay'>;
}

export interface ParsedCalendar {
  fileName: string;
  name: string;
  events: ImportedEvent[];
  /** Events that ended before the cutoff and were left out. */
  skippedPast: number;
  warnings: string[];
  /** Every UID in the file, including skipped ones (so they aren't treated as deleted). */
  seenUids: string[];
}

export interface ParseOptions {
  /** Leave out events (and finished series) that ended before this instant. */
  cutoff?: Date;
}

const iso = (t: ICAL.Time) => t.toJSDate().toISOString();

/** Google descriptions may contain HTML; turn it into plain text. */
export function htmlToText(s: string): string {
  if (!/[<&]/.test(s)) return s.trim();
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function notesOf(v: ICAL.Component): string | undefined {
  const desc = v.getFirstPropertyValue('description');
  const loc = v.getFirstPropertyValue('location');
  const parts = [loc ? `📍 ${String(loc).trim()}` : '', desc ? htmlToText(String(desc)) : ''].filter(Boolean);
  return parts.length ? parts.join('\n\n') : undefined;
}

/**
 * Convert an RRULE from the file to OmegaPlanner's convention: rules are expanded in
 * floating local time, so an absolute (UTC) UNTIL becomes local wall-clock time and a
 * date-only UNTIL becomes the end of that day.
 */
export function convertRRule(raw: string): string {
  const body = stripRulePrefix(raw.trim());
  const untilRaw = /(?:^|;)UNTIL=([^;]+)/i.exec(body)?.[1];
  const opts = RRule.parseString(body);
  if (untilRaw && opts.until) {
    if (/^\d{8}$/.test(untilRaw)) {
      const u = opts.until;
      opts.until = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 23, 59, 59));
    } else if (/Z$/i.test(untilRaw)) {
      opts.until = toFloating(opts.until);
    }
  }
  return stripRulePrefix(RRule.optionsToString(opts));
}

/**
 * Move the start of a series that began before `cutoff` to its first occurrence on or after
 * the cutoff, so older occurrences don't appear in the calendar. COUNT is reduced accordingly.
 */
function trimSeriesStart(
  ev: Pick<ImportedEvent, 'start' | 'end' | 'rrule' | 'exdates' | 'allDay'> & { untrimmed?: ImportedEvent['untrimmed'] },
  cutoff: Date,
): void {
  if (Date.parse(ev.start) >= cutoff.getTime()) return;
  ev.untrimmed ??= { start: ev.start, end: ev.end, rrule: ev.rrule, exdates: [...ev.exdates], allDay: ev.allDay };
  const rule = ruleFor(ev.rrule!, ev.start);
  const firstF = rule.after(toFloating(cutoff), true);
  if (!firstF) return;
  const count = ruleCount(ev.rrule!);
  if (count !== undefined) {
    const before = rule.between(toFloating(new Date(ev.start)), firstF, true).filter((d) => d < firstF).length;
    ev.rrule = withCount(ev.rrule!, Math.max(1, count - before));
  }
  const first = fromFloating(firstF);
  const shift = first.getTime() - Date.parse(ev.start);
  if (ev.end) {
    if (ev.allDay) {
      const days = Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 864e5);
      const end = new Date(first);
      end.setDate(end.getDate() + days);
      ev.end = end.toISOString();
    } else {
      ev.end = new Date(Date.parse(ev.end) + shift).toISOString();
    }
  }
  ev.start = first.toISOString();
  ev.exdates = ev.exdates.filter((d) => d >= ev.start);
}

function remindersOf(v: ICAL.Component): number[] {
  const out = new Set<number>();
  for (const a of v.getAllSubcomponents('valarm')) {
    const trig = a.getFirstPropertyValue('trigger');
    // Only relative triggers (durations before the start) map onto our model.
    if (trig instanceof ICAL.Duration) {
      const secs = trig.toSeconds();
      if (secs <= 0) out.add(Math.round(-secs / 60));
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function parseIcs(text: string, fileName: string, opts: ParseOptions = {}): ParsedCalendar {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error(`"${fileName}" is not a valid .ics calendar file.`);
  }
  if (root.name !== 'vcalendar') throw new Error(`"${fileName}" is not a valid .ics calendar file.`);
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const name = String(root.getFirstPropertyValue('x-wr-calname') ?? '').trim() || fileName.replace(/\.ics$/i, '');
  const warnings: string[] = [];
  const masters = new Map<string, ImportedEvent>();
  const exceptions: { uid: string; v: ICAL.Component; e: ICAL.Event }[] = [];
  let skippedPast = 0;
  const cutoffMs = opts.cutoff?.getTime();
  const seenUids = new Set<string>();

  for (const v of root.getAllSubcomponents('vevent')) {
    let e: ICAL.Event;
    try {
      e = new ICAL.Event(v);
    } catch {
      warnings.push('Skipped an event that could not be read.');
      continue;
    }
    if (!e.uid || !e.startDate) {
      warnings.push(`Skipped "${e.summary ?? 'untitled'}": no start date.`);
      continue;
    }
    seenUids.add(e.uid);
    if (e.isRecurrenceException()) {
      exceptions.push({ uid: e.uid, v, e });
      continue;
    }
    if (String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue;

    const allDay = e.startDate.isDate;
    const start = iso(e.startDate);
    let end = e.endDate ? iso(e.endDate) : undefined;
    if (end && Date.parse(end) <= Date.parse(start)) end = undefined;

    const rruleProp = v.getFirstPropertyValue('rrule');
    let rrule: string | undefined;
    if (rruleProp) {
      try {
        rrule = convertRRule(String(rruleProp));
      } catch {
        warnings.push(`"${e.summary}": unsupported repeat rule, imported as a single event.`);
      }
      if (v.getAllProperties('rrule').length > 1) warnings.push(`"${e.summary}": only the first of several repeat rules was imported.`);
      if (v.getFirstProperty('rdate')) warnings.push(`"${e.summary}": extra dates (RDATE) were not imported.`);
    }

    const ev: ImportedEvent = {
      uid: e.uid,
      title: (e.summary ?? '').trim() || '(No title)',
      notes: notesOf(v),
      allDay,
      start,
      end,
      rrule,
      exdates: v
        .getAllProperties('exdate')
        .flatMap((p) => p.getValues())
        .map((t) => iso(t as ICAL.Time)),
      reminders: remindersOf(v),
      overrides: [],
    };

    if (cutoffMs !== undefined) {
      const past = rrule
        ? ruleFor(rrule, start).after(toFloating(new Date(cutoffMs)), true) === null
        : Date.parse(end ?? start) < cutoffMs;
      if (past) {
        skippedPast++;
        continue;
      }
      if (rrule) trimSeriesStart(ev, new Date(cutoffMs));
    }
    if (masters.has(e.uid)) warnings.push(`"${ev.title}" appeared twice; the last copy was used.`);
    masters.set(e.uid, ev);
  }

  // Attach edited / cancelled occurrences to their series.
  for (const { uid, v, e } of exceptions) {
    const originalStart = iso(e.recurrenceId!);
    const cancelled = String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
    const master = masters.get(uid);
    const endMs = Date.parse(e.endDate ? iso(e.endDate) : iso(e.startDate));
    if (!master || !master.rrule) {
      if (cutoffMs !== undefined && endMs < cutoffMs) continue;
      // Exception without its series in this file: keep it as a stand-alone event.
      seenUids.add(`${uid}#${originalStart}`);
      if (cancelled || master) continue;
      masters.set(`${uid}#${originalStart}`, {
        uid: `${uid}#${originalStart}`,
        title: (e.summary ?? '').trim() || '(No title)',
        notes: notesOf(v),
        allDay: e.startDate.isDate,
        start: iso(e.startDate),
        end: e.endDate ? iso(e.endDate) : undefined,
        exdates: [],
        reminders: remindersOf(v),
        overrides: [],
      });
      continue;
    }
    // Edits of occurrences before a trimmed series start are kept but never shown; keeping them makes
    // re-imports with a different cutoff compare equal.
    const ov: ImportedOverride = { originalStart };
    if (cancelled) ov.cancelled = true;
    else {
      ov.start = iso(e.startDate);
      if (e.endDate) ov.end = iso(e.endDate);
      const title = (e.summary ?? '').trim();
      if (title && title !== master.title) ov.title = title;
      const notes = notesOf(v);
      if (notes && notes !== master.notes) ov.notes = notes;
    }
    master.overrides = master.overrides.filter((o) => o.originalStart !== originalStart);
    master.overrides.push(ov);
  }

  return { fileName, name, events: [...masters.values()], skippedPast, warnings, seenUids: [...seenUids] };
}

/* ------------------------------------------------------------------ */

export interface ImportPlan {
  calendar: string;
  create: ImportedEvent[];
  update: { item: Item; ev: ImportedEvent }[];
  unchanged: number;
  /** Previously imported items from this calendar that are no longer in the file. */
  remove: Item[];
}

/**
 * A re-import with a later cutoff must not push an already-imported series forward (that would
 * drop its older occurrences and their done marks): keep the series' existing start instead.
 */
function keepEarlierStart(ev: ImportedEvent, item: Item): ImportedEvent {
  const u = ev.untrimmed;
  if (!u || !item.rrule || !item.start || item.start >= ev.start || item.start < u.start) return ev;
  const re = { ...u, exdates: [...u.exdates] };
  trimSeriesStart(re, new Date(item.start));
  return { ...ev, start: re.start, end: re.end, rrule: re.rrule, exdates: re.exdates };
}

/** Fields an import owns. User-owned fields (category, goal, priority, done…) are kept. */
export function importedFields(ev: ImportedEvent) {
  return {
    title: ev.title,
    notes: ev.notes,
    allDay: ev.allDay,
    start: ev.start,
    end: ev.end,
    rrule: ev.rrule,
    exdates: ev.exdates,
    reminders: ev.reminders,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Comparable form of a list of edited occurrences. */
function overrideKey(list: (ImportedOverride | Override)[]): string {
  return JSON.stringify(
    list
      .map((o) => [o.originalStart, o.start ?? null, o.end ?? null, o.title ?? null, o.notes ?? null, !!o.cancelled])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

export function planImport(
  cal: ParsedCalendar,
  existing: Item[],
  existingOverrides: (itemId: string) => Override[],
  opts: { removeMissing: boolean },
): ImportPlan {
  const byExt = new Map(existing.filter((i) => i.externalId).map((i) => [i.externalId!, i]));
  const plan: ImportPlan = { calendar: cal.name, create: [], update: [], unchanged: 0, remove: [] };
  for (const original of cal.events) {
    const item = byExt.get(original.uid);
    if (!item) {
      plan.create.push(original);
      continue;
    }
    const ev = keepEarlierStart(original, item);
    const f = importedFields(ev);
    const changed =
      (Object.keys(f) as (keyof typeof f)[]).some((k) => !sameJson(f[k] ?? null, item[k] ?? null)) ||
      overrideKey(ev.rrule ? ev.overrides : []) !== overrideKey(existingOverrides(item.id));
    if (changed) plan.update.push({ item, ev });
    else plan.unchanged++;
  }
  if (opts.removeMissing) {
    const uids = new Set(cal.seenUids);
    plan.remove = existing.filter((i) => i.source === cal.name && i.externalId && !uids.has(i.externalId));
  }
  return plan;
}
