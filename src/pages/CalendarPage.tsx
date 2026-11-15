import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable, type DropArg, type EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { addDays, addHours, endOfMonth, startOfMonth } from 'date-fns';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../components/context';
import { CategoryBadge, EmptyState } from '../components/ui';
import { editOccurrenceScoped, setOccurrenceDone, updateItem } from '../db/repo';
import type { Occurrence } from '../domain/recurrence';
import type { ItemChanges } from '../domain/seriesEdit';
import { useOccurrences } from '../hooks/usePlanner';
import { itemColors, useDefaultItemColor } from '../lib/eventColors';

const VIEW_KEY = 'omegaplanner.calendarView';
const DEFAULT_COLOR = '#64748b';
const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGrid3Day', 'timeGridDay', 'listWeek'];
const PHONE_QUERY = '(max-width: 640px)';
const isPhone = () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;

function storedView(): string {
  const fallback = isPhone() ? 'timeGrid3Day' : 'timeGridWeek';
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (!v || !VIEWS.includes(v)) return fallback;
    // A week doesn't fit on a phone: use 3 days there instead.
    return isPhone() && v === 'timeGridWeek' ? 'timeGrid3Day' : v;
  } catch {
    return fallback;
  }
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export function CalendarPage() {
  const { data, openEditor, askScope } = useApp();
  const calRef = useRef<FullCalendar>(null);
  const phone = usePhone();
  const todoPanelRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState(() => ({ start: addDays(startOfMonth(new Date()), -7), end: addDays(endOfMonth(new Date()), 7) }));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const occurrences = useOccurrences(data, range.start, range.end);
  const defaultColor = useDefaultItemColor();

  const unscheduled = useMemo(
    () => data.items.filter((i) => i.kind === 'task' && !i.start && !i.done).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)),
    [data.items],
  );

  const events = useMemo<EventInput[]>(
    () =>
      occurrences
        .filter((o) => !hidden.has(o.item.categoryId ?? ''))
        .map((o) => {
          const categoryColor = data.categoryById.get(o.item.categoryId ?? '')?.color;
          const c = itemColors(o.item.color, defaultColor);
          const zero = o.end === o.start;
          return {
            id: o.key,
            title: o.title,
            start: o.start,
            end: zero ? undefined : o.end,
            allDay: o.allDay,
            backgroundColor: c.bg,
            borderColor: c.border,
            textColor: c.fg,
            classNames: o.done ? ['op-done'] : [],
            durationEditable: o.item.kind !== 'deadline',
            extendedProps: { occ: o, categoryColor },
          };
        }),
    [occurrences, hidden, data.categoryById, defaultColor],
  );

  // Make unscheduled to-dos draggable onto the calendar.
  useEffect(() => {
    if (!todoPanelRef.current) return;
    const d = new Draggable(todoPanelRef.current, {
      itemSelector: '[data-todo-id]',
      eventData: (el) => ({ title: el.dataset.title, duration: '01:00', create: false }),
    });
    return () => d.destroy();
  }, []);

  const onDatesSet = (arg: DatesSetArg) => {
    setRange((r) => (r.start.getTime() === arg.start.getTime() && r.end.getTime() === arg.end.getTime() ? r : { start: arg.start, end: arg.end }));
    try {
      localStorage.setItem(VIEW_KEY, arg.view.type);
    } catch {
      /* ignore */
    }
  };

  async function onMove(info: EventDropArg | EventResizeDoneArg) {
    const occ = info.event.extendedProps.occ as Occurrence;
    const start = info.event.start!;
    const allDay = info.event.allDay;
    const isDeadline = occ.item.kind === 'deadline';
    let end = info.event.end;
    if (!end && !isDeadline) {
      const prevDur = Date.parse(occ.end) - Date.parse(occ.start);
      end = allDay ? addDays(start, Math.max(1, Math.round(prevDur / 864e5))) : allDay !== occ.allDay ? addHours(start, 1) : new Date(start.getTime() + prevDur);
    }
    const changes: ItemChanges = { start: start.toISOString(), end: isDeadline ? undefined : end!.toISOString(), allDay };
    if (occ.recurring) {
      const scope = await askScope('edit', allDay === occ.allDay);
      if (!scope) return info.revert();
      await editOccurrenceScoped(occ, changes, scope);
    } else {
      await updateItem(occ.item.id, changes);
    }
  }

  function onEventClick(info: EventClickArg) {
    const occ = info.event.extendedProps.occ as Occurrence;
    if ((info.jsEvent.target as HTMLElement).closest('[data-toggle-done]')) {
      void setOccurrenceDone(occ, !occ.done);
      return;
    }
    openEditor({ item: occ.item, occurrence: occ });
  }

  function onDrop(info: DropArg) {
    const id = info.draggedEl.dataset.todoId;
    if (!id) return;
    const start = info.date;
    const end = info.allDay ? addDays(start, 1) : addHours(start, 1);
    void updateItem(id, { start: start.toISOString(), end: end.toISOString(), allDay: info.allDay });
  }

  const toggleCategory = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex h-full flex-col gap-4 p-3 sm:p-5 lg:flex-row">
      <div className="flex min-h-[600px] flex-1 flex-col rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgb(18_22_32/0.06),0_8px_24px_-12px_rgb(18_22_32/0.12)] dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-800 sm:p-4">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={storedView()}
          headerToolbar={
            phone
              ? { left: 'prev,next today', center: '', right: 'title' }
              : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }
          }
          footerToolbar={phone ? { center: 'dayGridMonth,timeGrid3Day,timeGridDay,listWeek' } : undefined}
          views={{ timeGrid3Day: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 days' } }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
          titleFormat={phone ? { month: 'short', day: 'numeric' } : undefined}
          dayHeaderFormat={phone ? { weekday: 'short', day: 'numeric' } : undefined}
          eventLongPressDelay={350}
          selectLongPressDelay={350}
          firstDay={1}
          height="100%"
          nowIndicator
          scrollTime="07:00:00"
          eventDisplay="block"
          dayMaxEvents={4}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={events}
          editable
          selectable
          selectMirror
          droppable
          datesSet={onDatesSet}
          select={(s) => {
            openEditor({ defaults: { start: s.start, end: s.end, allDay: s.allDay, kind: 'event' } });
            calRef.current?.getApi().unselect();
          }}
          eventClick={onEventClick}
          eventDrop={onMove}
          eventResize={onMove}
          drop={onDrop}
          eventContent={renderEvent}
        />
      </div>

      <aside className="w-full shrink-0 space-y-8 px-1 pb-6 lg:w-64 lg:pt-2">
        <div>
          <h2 className="mb-0.5 text-[15px] font-bold tracking-tight">Unscheduled to-dos</h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Drag one onto the calendar to schedule it.</p>
          <div ref={todoPanelRef} className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {unscheduled.map((t) => (
              <div
                key={t.id}
                data-todo-id={t.id}
                data-title={t.title}
                onClick={() => openEditor({ item: t })}
                className="flex cursor-grab items-center gap-2.5 py-2 text-sm font-medium hover:text-indigo-700 active:cursor-grabbing dark:hover:text-indigo-300"
              >
                <span aria-hidden className="h-3.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: data.categoryById.get(t.categoryId ?? '')?.color ?? DEFAULT_COLOR }} />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
            {unscheduled.length === 0 && <EmptyState>Nothing waiting to be scheduled.</EmptyState>}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-[15px] font-bold tracking-tight">Show categories</h2>
            <Link to="/settings#import" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Import from Google…
            </Link>
          </div>
          <div className="space-y-2">
            {[...data.categories, { id: '', name: 'Uncategorized', color: DEFAULT_COLOR }].map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleCategory(c.id)} style={{ accentColor: c.color }} />
                {c.id ? <CategoryBadge category={c} /> : <span className="text-slate-500">{c.name}</span>}
              </label>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderEvent(arg: EventContentArg) {
  const occ = arg.event.extendedProps.occ as Occurrence | undefined;
  const isList = arg.view.type.startsWith('list');
  if (!occ) {
    // Drag mirror of an external to-do being dropped onto the calendar.
    return (
      <div className="truncate px-0.5 font-medium">
        {arg.timeText && <span className="mr-1 opacity-90">{arg.timeText}</span>}
        {arg.event.title}
      </div>
    );
  }
  const categoryColor = arg.event.extendedProps.categoryColor as string | undefined;
  // In week/day views a timed event has room to stack the title under the time.
  const stacked = arg.view.type.startsWith('timeGrid') && !arg.event.allDay;
  return (
    <div className={`flex min-w-0 overflow-hidden ${stacked ? 'flex-wrap content-start items-center gap-x-1' : 'items-center gap-1'} ${isList ? '' : 'px-0.5 py-px'}`}>
      <span
        data-toggle-done
        role="checkbox"
        aria-checked={occ.done}
        title={occ.done ? 'Mark not done' : 'Mark done'}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none opacity-80"
      >
        {occ.done ? '✓' : ''}
      </span>
      {arg.timeText && !isList && <span className="shrink-0 opacity-80">{arg.timeText}</span>}
      <span
        className={`op-title font-medium ${stacked ? 'block w-fit max-w-full break-words leading-tight' : 'inline-block min-w-0 max-w-full truncate'}`}
        style={categoryColor ? ({ '--op-cat': categoryColor } as React.CSSProperties) : undefined}
      >
        <span className="op-title-text">
          {occ.item.kind === 'deadline' ? '⚑ ' : ''}
          {arg.event.title}
          {occ.recurring ? ' ↻' : ''}
        </span>
      </span>
    </div>
  );
}
