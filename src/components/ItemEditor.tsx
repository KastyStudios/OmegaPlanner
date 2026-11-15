import { addDays, addHours } from 'date-fns';
import { useState } from 'react';
import type { ItemKind, Priority } from '../db/schema';
import { createItem, deleteItem, deleteOccurrenceScoped, editOccurrenceScoped, setOccurrenceDone, updateItem } from '../db/repo';
import { buildRRule, parseRRule, type RecurrenceForm } from '../domain/recurrence';
import { reminderLabel } from '../domain/reminders';
import type { ItemChanges } from '../domain/seriesEdit';
import { fromInputs, nextFullHour, toDateInput, toTimeInput } from '../lib/dates';
import { ColorPicker } from './ColorPicker';
import { useApp, type EditorRequest } from './context';
import { RecurrenceEditor } from './RecurrenceEditor';
import { Button, Field, inputCls, Modal } from './ui';

const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];
const KINDS: { value: ItemKind; label: string; hint: string }[] = [
  { value: 'event', label: 'Event', hint: 'Something at a set time' },
  { value: 'task', label: 'Task', hint: 'Something to do, scheduled or not' },
  { value: 'deadline', label: 'Deadline', hint: 'Something due by a date' },
];

interface FormState {
  kind: ItemKind;
  title: string;
  notes: string;
  categoryId: string;
  goalId: string;
  priority: '' | '1' | '2' | '3';
  color: string; // '' = default
  reminders: number[];
  scheduled: boolean;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: boolean;
  rec: RecurrenceForm;
}

const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // Monday = 0

/** Change the start and move the end along with it, keeping the duration. */
function moveStart(p: FormState, date: string, time: string): FormState {
  const oldStart = fromInputs(p.startDate, p.allDay ? '00:00' : p.startTime);
  const oldEnd = fromInputs(p.endDate || p.startDate, p.allDay ? '00:00' : p.endTime);
  const dur = Math.max(0, oldEnd.getTime() - oldStart.getTime());
  const newStart = fromInputs(date, p.allDay ? '00:00' : time);
  const newEnd = new Date(newStart.getTime() + dur);
  // The weekly repeat day defaults to the start's weekday; keep following it until the user picks days.
  const rec =
    p.rec.weekdays.length === 1 && p.rec.weekdays[0] === weekdayIndex(oldStart)
      ? { ...p.rec, weekdays: [weekdayIndex(newStart)] }
      : p.rec;
  return {
    ...p,
    rec,
    startDate: date,
    startTime: time,
    endDate: toDateInput(newEnd),
    endTime: p.allDay ? p.endTime : toTimeInput(newEnd),
  };
}

function initialState({ item, occurrence, defaults = {} }: EditorRequest): FormState {
  const kind = item?.kind ?? defaults.kind ?? (defaults.start ? 'event' : 'task');
  const startIso = occurrence?.start ?? item?.start;
  const endIso = occurrence?.end ?? item?.end;
  const allDay = item?.allDay ?? defaults.allDay ?? false;
  const start = startIso ? new Date(startIso) : defaults.start ?? nextFullHour();
  let end = endIso ? new Date(endIso) : defaults.end ?? (allDay ? addDays(start, 1) : addHours(start, 1));
  if (allDay) end = addDays(end, -1); // the form shows an inclusive end date
  if (end < start) end = start;

  return {
    kind,
    title: occurrence?.title ?? item?.title ?? '',
    notes: occurrence?.notes ?? item?.notes ?? '',
    categoryId: item?.categoryId ?? defaults.categoryId ?? '',
    goalId: item?.goalId ?? defaults.goalId ?? '',
    priority: item?.priority ? (String(item.priority) as FormState['priority']) : '',
    color: item?.color ?? '',
    reminders: item?.reminders ?? [],
    scheduled: item ? !!item.start : defaults.scheduled ?? (kind !== 'task' || !!defaults.start),
    allDay,
    startDate: toDateInput(start),
    startTime: toTimeInput(start),
    endDate: toDateInput(end),
    endTime: toTimeInput(end),
    repeat: !!item?.rrule,
    rec: item?.rrule ? parseRRule(item.rrule) : { freq: 'weekly', interval: 1, weekdays: [weekdayIndex(start)], endMode: 'never' },
  };
}

export function ItemEditor({ request, onClose }: { request: EditorRequest; onClose: () => void }) {
  const { data, askScope } = useApp();
  const { item, occurrence } = request;
  const [f, setF] = useState<FormState>(() => initialState(request));
  const [error, setError] = useState('');
  const set = (p: Partial<FormState>) => setF((prev) => ({ ...prev, ...p }));

  const isScheduled = f.kind !== 'task' || f.scheduled;
  const isDeadline = f.kind === 'deadline';

  function computeTimes(): { start?: string; end?: string } | null {
    if (!isScheduled) return {};
    if (!f.startDate) return null;
    if (f.allDay) {
      const s = fromInputs(f.startDate);
      if (isDeadline) return { start: s.toISOString(), end: undefined };
      const lastDay = f.endDate ? fromInputs(f.endDate) : s;
      return { start: s.toISOString(), end: addDays(lastDay < s ? s : lastDay, 1).toISOString() };
    }
    const s = fromInputs(f.startDate, f.startTime);
    if (isDeadline) return { start: s.toISOString(), end: undefined };
    let e = fromInputs(f.endDate || f.startDate, f.endTime);
    if (e <= s) e = addHours(s, 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }

  async function save() {
    if (!f.title.trim()) return setError('Please enter a title.');
    if (isScheduled && f.repeat && f.rec.freq === 'weekly' && f.rec.weekdays.length === 0)
      return setError('Pick at least one weekday.');
    const times = computeTimes();
    if (!times) return setError('Please pick a date.');

    const rrule = isScheduled && f.repeat ? buildRRule(f.rec) : null;
    const fields: ItemChanges = {
      kind: f.kind,
      title: f.title.trim(),
      notes: f.notes.trim() || undefined,
      categoryId: f.categoryId || undefined,
      goalId: f.goalId || undefined,
      priority: f.priority ? (Number(f.priority) as Priority) : undefined,
      reminders: isScheduled ? f.reminders : [],
      color: f.color || undefined,
      allDay: f.allDay,
      start: times.start,
      end: times.end,
      rrule,
    };

    try {
      if (!item) {
        await createItem({ ...fields, title: fields.title!, kind: f.kind, allDay: f.allDay, rrule: rrule ?? undefined } as Parameters<typeof createItem>[0]);
      } else if (occurrence?.recurring) {
        const seriesChanged =
          f.kind !== item.kind ||
          (f.categoryId || undefined) !== item.categoryId ||
          (f.goalId || undefined) !== item.goalId ||
          (fields.priority ?? undefined) !== item.priority ||
          f.allDay !== item.allDay ||
          (f.color || undefined) !== item.color ||
          JSON.stringify([...f.reminders].sort()) !== JSON.stringify([...item.reminders].sort());
        const ruleChanged = rrule !== (item.rrule ? buildRRule(parseRRule(item.rrule)) : null);
        const scope = await askScope('edit', !seriesChanged && !ruleChanged);
        if (!scope) return;
        const changes: ItemChanges = { ...fields };
        if (!ruleChanged) delete changes.rrule;
        await editOccurrenceScoped(occurrence, changes, scope);
      } else {
        await updateItem(item.id, fields);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!item) return;
    if (occurrence?.recurring) {
      const scope = await askScope('delete', true);
      if (!scope) return;
      await deleteOccurrenceScoped(occurrence, scope);
    } else {
      if (!confirm(`Delete "${item.title}"?`)) return;
      await deleteItem(item.id);
    }
    onClose();
  }

  const toggleReminder = (m: number) =>
    set({ reminders: f.reminders.includes(m) ? f.reminders.filter((x) => x !== m) : [...f.reminders, m].sort((a, b) => a - b) });

  const title = item ? `Edit ${f.kind}` : `New ${f.kind}`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {item && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label="Type">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={f.kind === k.value}
              title={k.hint}
              onClick={() => set({ kind: k.value })}
              className={`rounded-md py-1.5 text-sm font-medium transition ${
                f.kind === k.value ? 'bg-white text-indigo-700 shadow dark:bg-slate-700 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <Field label="Title">
          <input autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} placeholder="e.g. Gym" />
        </Field>

        {f.kind === 'task' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.scheduled} onChange={(e) => set({ scheduled: e.target.checked })} className="accent-indigo-600" />
            Schedule on the calendar
          </label>
        )}

        {isScheduled && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="accent-indigo-600" />
              All day
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isDeadline ? 'Due date' : 'Start'}>
                <input type="date" value={f.startDate} onChange={(e) => e.target.value && setF((p) => moveStart(p, e.target.value, p.startTime))} className={inputCls} />
              </Field>
              {!f.allDay && (
                <Field label={isDeadline ? 'Due time' : 'Start time'}>
                  <input type="time" value={f.startTime} onChange={(e) => e.target.value && setF((p) => moveStart(p, p.startDate, e.target.value))} className={inputCls} />
                </Field>
              )}
              {!isDeadline && (
                <>
                  <Field label="End">
                    <input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} className={inputCls} />
                  </Field>
                  {!f.allDay && (
                    <Field label="End time">
                      <input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} className={inputCls} />
                    </Field>
                  )}
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.repeat} onChange={(e) => set({ repeat: e.target.checked })} className="accent-indigo-600" />
              Repeat
            </label>
            {f.repeat && <RecurrenceEditor value={f.rec} onChange={(rec) => set({ rec })} />}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className={inputCls}>
              <option value="">None</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Goal">
            <select value={f.goalId} onChange={(e) => set({ goalId: e.target.value })} className={inputCls}>
              <option value="">None</option>
              {data.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
          {f.kind !== 'event' && (
            <Field label="Priority">
              <select value={f.priority} onChange={(e) => set({ priority: e.target.value as FormState['priority'] })} className={inputCls}>
                <option value="">None</option>
                <option value="1">High</option>
                <option value="2">Medium</option>
                <option value="3">Low</option>
              </select>
            </Field>
          )}
        </div>

        <Field label="Background color" group>
          <ColorPicker value={f.color} onChange={(color) => set({ color })} />
        </Field>

        {isScheduled && (
          <Field label="Reminders" group>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_OPTIONS.map((m) => {
                const on = f.reminders.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleReminder(m)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {reminderLabel(m)}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Notes">
          <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} className={inputCls} />
        </Field>

        {occurrence && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              defaultChecked={occurrence.done}
              onChange={(e) => setOccurrenceDone(occurrence, e.target.checked)}
              className="accent-indigo-600"
            />
            Done{occurrence.recurring ? ' (this occurrence)' : ''}
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
