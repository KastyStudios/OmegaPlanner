import { differenceInCalendarDays, format } from 'date-fns';
import { useState } from 'react';
import { useApp } from '../components/context';
import { PriorityTag } from '../components/Rows';
import { Button, CategoryBadge, Checkbox, EmptyState, Field, Icon, inputCls, Modal, ProgressBar } from '../components/ui';
import { deleteGoal, saveGoal, setItemDone } from '../db/repo';
import type { Goal, GoalMode } from '../db/schema';
import { formatAmount, goalProgress, progressText } from '../domain/goals';
import { describeRRule, seriesEnded } from '../domain/recurrence';
import { friendlyDay, fromInputs } from '../lib/dates';

export function GoalsPage() {
  const { data } = useApp();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-8 sm:pt-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[2rem] font-extrabold leading-tight tracking-[-0.03em]">Goals</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" className="h-4 w-4" />
          New goal
        </Button>
      </div>
      {data.goals.length === 0 ? (
        <EmptyState>
          No goals yet. Create a <b>habit</b> goal (e.g. “Gym 3× per week”) and link recurring events to it, or a <b>milestone</b>{' '}
          goal (e.g. “Finish thesis”) and link tasks to it.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}
      {editing && <GoalEditor goal={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const { data, openEditor } = useApp();
  const now = new Date();
  const p = goalProgress(goal, data.items, data.completions, now, data.overrides);
  const cat = data.categoryById.get(goal.categoryId ?? '');
  // Series that have finished (e.g. the old half of a split series) still count, but aren't listed.
  const linked = data.items.filter((i) => i.goalId === goal.id && !seriesEnded(i, now));
  const daysLeft = goal.targetDate ? differenceInCalendarDays(fromInputs(goal.targetDate), now) : undefined;

  return (
    <div className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(18_22_32/0.06),0_8px_24px_-12px_rgb(18_22_32/0.12)] dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-800 sm:p-6">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">{goal.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">{goal.mode === 'habit' ? 'Habit' : 'Milestone'}</span>
            <CategoryBadge category={cat} />
            {daysLeft !== undefined && (
              <span className={daysLeft < 0 ? 'text-red-700 dark:text-red-400' : ''}>
                {daysLeft < 0 ? `${-daysLeft} days past target` : daysLeft === 0 ? 'Target is today' : `${daysLeft} days left`}, until{' '}
                {format(fromInputs(goal.targetDate!), 'd MMM yyyy')}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" onClick={onEdit} aria-label={`Edit goal ${goal.title}`}>
          Edit
        </Button>
      </div>
      {goal.description && <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{goal.description}</p>}

      <div className="my-3">
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-semibold tabular-nums">{progressText(p)}</span>
          {p.streak !== undefined && p.streak > 0 && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {p.streak} {goal.habitTarget?.period}
              {p.streak > 1 ? 's' : ''} streak
            </span>
          )}
        </div>
        <ProgressBar ratio={p.ratio} color={cat?.color} />
        {p.unit === 'hours' && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {formatAmount(p.planned ?? 0)} h planned {p.periodLabel}
            {(p.planned ?? 0) < p.total && `. Schedule ${formatAmount(p.total - (p.planned ?? 0))} h more to reach the target.`}
          </p>
        )}
      </div>

      <div className="mt-auto divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {linked.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {goal.mode === 'habit' ? 'Link a recurring event (e.g. Gym) to start tracking.' : 'Add tasks to break this goal down.'}
          </p>
        )}
        {linked.map((i) => (
          <div
            key={i.id}
            role="button"
            tabIndex={0}
            onClick={() => openEditor({ item: i })}
            onKeyDown={(e) => e.key === 'Enter' && openEditor({ item: i })}
            className="flex cursor-pointer items-center gap-2.5 py-2 text-sm font-medium hover:text-indigo-700 dark:hover:text-indigo-300"
          >
            {i.rrule ? (
              <Icon name="repeat" className="mx-[3px] h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <Checkbox checked={!!i.done} onChange={(v) => setItemDone(i.id, v)} color={cat?.color} label={`Mark ${i.title} done`} />
            )}
            <span className={`min-w-0 flex-1 truncate ${i.done ? 'text-slate-400 line-through' : ''}`}>{i.title}</span>
            {i.rrule && <span className="min-w-0 max-w-[55%] truncate text-xs text-slate-400">{describeRRule(i.rrule)}</span>}
            {!i.rrule && i.start && (
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {friendlyDay(new Date(i.start))}
                {!i.allDay && i.end && `, ${formatAmount((Date.parse(i.end) - Date.parse(i.start)) / 3_600_000)} h`}
              </span>
            )}
            <PriorityTag p={i.priority} />
          </div>
        ))}
        <Button
          variant="ghost"
          className="!mt-0 w-full !justify-start !rounded-none !px-0 !py-2.5 hover:!bg-transparent hover:!text-indigo-700 dark:hover:!text-indigo-300"
          onClick={() =>
            openEditor({ defaults: { goalId: goal.id, categoryId: goal.categoryId, kind: goal.mode === 'habit' ? 'event' : 'task' } })
          }
        >
          + Add {goal.mode === 'habit' ? 'recurring event' : 'task'}
        </Button>
      </div>
    </div>
  );
}

function GoalEditor({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { data } = useApp();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [mode, setMode] = useState<GoalMode>(goal?.mode ?? 'habit');
  const [count, setCount] = useState(goal?.habitTarget?.count ?? 3);
  const [period, setPeriod] = useState<'week' | 'month'>(goal?.habitTarget?.period ?? 'week');
  const [unit, setUnit] = useState<'times' | 'hours'>(goal?.habitTarget?.unit ?? 'times');
  const [categoryId, setCategoryId] = useState(goal?.categoryId ?? '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');

  async function save() {
    if (!title.trim()) return;
    await saveGoal({
      id: goal?.id,
      createdAt: goal?.createdAt,
      title: title.trim(),
      description: description.trim() || undefined,
      mode,
      habitTarget:
        mode === 'habit'
          ? { count: unit === 'hours' ? Math.max(0.5, Math.round(count * 2) / 2) : Math.max(1, Math.round(count)), period, unit }
          : undefined,
      categoryId: categoryId || undefined,
      targetDate: targetDate || undefined,
    });
    onClose();
  }

  async function remove() {
    if (!goal || !confirm(`Delete goal "${goal.title}"? Linked items are kept.`)) return;
    await deleteGoal(goal.id);
    onClose();
  }

  return (
    <Modal
      title={goal ? 'Edit goal' : 'New goal'}
      onClose={onClose}
      footer={
        <>
          {goal && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Gym 3× per week" />
        </Field>
        <Field label="Type" group>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" checked={mode === 'habit'} onChange={() => setMode('habit')} className="mt-1 accent-indigo-600" />
              <span>
                <b>Habit</b>: do something a number of times, or for a number of hours, per week or month. Checked-off
                occurrences of linked items count.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" checked={mode === 'milestone'} onChange={() => setMode('milestone')} className="mt-1 accent-indigo-600" />
              <span>
                <b>Milestone</b>: reach an outcome. Progress is the share of linked tasks that are done.
              </span>
            </label>
          </div>
        </Field>
        {mode === 'habit' && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Target</span>
            <input
              type="number"
              min={unit === 'hours' ? 0.5 : 1}
              step={unit === 'hours' ? 0.5 : 1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className={`${inputCls} !w-20`}
              aria-label="Target amount"
            />
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'times' | 'hours')} className={`${inputCls} !w-auto`} aria-label="Unit">
              <option value="times">times</option>
              <option value="hours">hours</option>
            </select>
            <span>per</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as 'week' | 'month')} className={`${inputCls} !w-auto`} aria-label="Period">
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </div>
        )}
        {mode === 'habit' && unit === 'hours' && (
          <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">
            Hours are the length of checked-off timed items linked to this goal (all-day items don't count).
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target date (optional)">
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
