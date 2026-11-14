import { buildRRule, describeRRule, type Freq, type RecurrenceForm } from '../domain/recurrence';
import { inputCls } from './ui';

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const UNIT: Record<Freq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

export function RecurrenceEditor({ value, onChange }: { value: RecurrenceForm; onChange: (v: RecurrenceForm) => void }) {
  const set = (p: Partial<RecurrenceForm>) => onChange({ ...value, ...p });
  const toggleDay = (d: number) =>
    set({ weekdays: value.weekdays.includes(d) ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d] });

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Every</span>
        <input
          type="number"
          min={1}
          value={value.interval}
          onChange={(e) => set({ interval: Math.max(1, Number(e.target.value)) })}
          className={`${inputCls} !w-16`}
          aria-label="Interval"
        />
        <select value={value.freq} onChange={(e) => set({ freq: e.target.value as Freq })} className={`${inputCls} !w-auto`} aria-label="Frequency">
          {(Object.keys(UNIT) as Freq[]).map((f) => (
            <option key={f} value={f}>
              {UNIT[f]}
              {value.interval > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </div>

      {value.freq === 'weekly' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
          {DAY_LABELS.map((l, i) => {
            const on = value.weekdays.includes(i);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(i)}
                className={`h-8 w-9 rounded-md text-xs font-semibold transition ${
                  on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600'
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Ends</span>
        <select
          value={value.endMode}
          onChange={(e) => set({ endMode: e.target.value as RecurrenceForm['endMode'] })}
          className={`${inputCls} !w-auto`}
          aria-label="Ends"
        >
          <option value="never">never</option>
          <option value="until">on date</option>
          <option value="count">after</option>
        </select>
        {value.endMode === 'until' && (
          <input type="date" value={value.until ?? ''} onChange={(e) => set({ until: e.target.value })} className={`${inputCls} !w-auto`} aria-label="End date" />
        )}
        {value.endMode === 'count' && (
          <>
            <input
              type="number"
              min={1}
              value={value.count ?? 10}
              onChange={(e) => set({ count: Math.max(1, Number(e.target.value)) })}
              className={`${inputCls} !w-20`}
              aria-label="Occurrences"
            />
            <span>times</span>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{describeRRule(buildRRule(value))}</p>
    </div>
  );
}
