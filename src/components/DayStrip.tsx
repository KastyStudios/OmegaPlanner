import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import type { Occurrence } from '../domain/recurrence';
import { useApp } from './context';

const LANE = 34; // px per row of overlapping blocks

/**
 * Today as a strip of time: each timed item is a highlighter stroke in its
 * category color, placed by its hours, with a pen-blue line at the current time.
 */
export function DayStrip({ day, occurrences }: { day: Date; occurrences: Occurrence[] }) {
  const { data, openEditor } = useApp();
  const now = useNow();
  const timed = occurrences.filter((o) => !o.allDay).sort((a, b) => a.start.localeCompare(b.start));

  const hourOf = (iso: string) => (Date.parse(iso) - day.getTime()) / 3_600_000;
  const first = Math.floor(Math.min(7, ...timed.map((o) => Math.max(0, hourOf(o.start)))));
  const last = Math.ceil(Math.max(23, ...timed.map((o) => Math.min(24, hourOf(o.end)))));
  const span = last - first;
  const pct = (h: number) => `${((Math.min(Math.max(h, first), last) - first) / span) * 100}%`;

  // Greedy lanes so overlapping items stack instead of covering each other.
  const laneEnds: number[] = [];
  const placed = timed.map((o) => {
    const s = hourOf(o.start);
    const e = Math.max(hourOf(o.end), s + 0.25);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = e;
    return { o, s, e, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  const nowH = hourOf(now.toISOString());
  const ticks = Array.from({ length: span + 1 }, (_, i) => first + i);

  return (
    <figure className="mb-9 select-none" aria-label="Today's schedule">
      <div className="relative" style={{ height: lanes * LANE + 4 }}>
        {/* A rule every 3 hours, like a ruled page */}
        {ticks
          .filter((h) => h % 3 === 0)
          .map((h) => (
            <div key={h} aria-hidden className="absolute inset-y-0 w-px bg-slate-200 dark:bg-slate-800" style={{ left: pct(h) }} />
          ))}
        {placed.map(({ o, s, e, lane }, i) => {
          const color = data.categoryById.get(o.item.categoryId ?? '')?.color ?? o.item.color ?? '#2340C8';
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => openEditor({ item: o.item, occurrence: o })}
              title={`${o.title}, ${format(new Date(o.start), 'HH:mm')}–${format(new Date(o.end), 'HH:mm')}`}
              className={`op-stroke absolute flex items-center overflow-hidden px-1.5 text-left text-xs font-semibold text-slate-900 dark:text-slate-50 ${o.done ? 'op-stroke-done text-slate-500 line-through dark:text-slate-400' : ''}`}
              style={{
                ['--mark' as string]: color,
                ['--delay' as string]: `${120 + i * 70}ms`,
                left: pct(s),
                width: `calc(${pct(e)} - ${pct(s)} - 2px)`,
                top: lane * LANE + 2,
                height: LANE - 6,
              }}
            >
              <span className="truncate">{o.title}</span>
            </button>
          );
        })}
        {nowH >= first && nowH <= last && (
          <div aria-hidden className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 rounded bg-indigo-600 dark:bg-indigo-300" style={{ left: pct(nowH) }}>
            <span className="absolute -left-[3px] -top-1 h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-300" />
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-slate-500 dark:text-slate-400" aria-hidden>
        {ticks
          .filter((h) => h % 3 === 0 && h < last)
          .map((h) => (
            <span key={h} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(h) }}>
              {String(h % 24).padStart(2, '0')}
            </span>
          ))}
      </div>
      {timed.length === 0 && (
        <figcaption className="mt-1 text-sm text-slate-500 dark:text-slate-400">No timed plans today.</figcaption>
      )}
    </figure>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
