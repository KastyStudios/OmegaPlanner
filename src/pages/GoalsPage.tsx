import { differenceInCalendarDays, format } from 'date-fns';
import { useState } from 'react';
import { useApp } from '../components/context';
import { PriorityTag } from '../components/Rows';
import { Button, CategoryBadge, Checkbox, EmptyState, Field, inputCls, Modal, ProgressBar } from '../components/ui';
import { deleteGoal, saveGoal, setItemDone } from '../db/repo';
import type { Goal, GoalMode } from '../db/schema';
import { goalProgress } from '../domain/goals';
import { describeRRule, seriesEnded } from '../domain/recurrence';
import { fromInputs } from '../lib/dates';

export function GoalsPage() {
  const { data } = useApp();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + New goal
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
  const p = goalProgress(goal, data.items, data.completions, now);
  const cat = data.categoryById.get(goal.categoryId ?? '');
  // Series that have finished (e.g. the old half of a split series) still count, but aren't listed.
  const linked = data.items.filter((i) => i.goalId === goal.id && !seriesEnded(i, now));
  const daysLeft = goal.targetDate ? differenceInCalendarDays(fromInputs(goal.targetDate), now) : undefined;

  return (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{goal.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium uppercase dark:bg-slate-800">{goal.mode}</span>
            <CategoryBadge category={cat} />
            {daysLeft !== undefined && (
              <span className={daysLeft < 0 ? 'text-red-600' : ''}>
                {daysLeft < 0 ? `${-daysLeft} days past target` : daysLeft === 0 ? 'Target is today' : `${daysLeft} days left`} ·{' '}
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
          <span className="font-medium tabular-nums">
            {p.done} / {p.total} {goal.mode === 'habit' ? p.periodLabel : 'tasks done'}
          </span>
          {p.streak !== undefined && p.streak > 0 && (
            <span className="text-xs text-amber-600">
              🔥 {p.streak} {goal.habitTarget?.period}
              {p.streak > 1 ? 's' : ''} streak
            </span>
          )}
        </div>
        <ProgressBar ratio={p.ratio} color={cat?.color} />
      </div>

      <div className="mt-auto space-y-1">
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
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {i.rrule ? (
              <span className="w-5 text-center text-slate-400">↻</span>
            ) : (
              <Checkbox checked={!!i.done} onChange={(v) => setItemDone(i.id, v)} color={cat?.color} label={`Mark ${i.title} done`} />
            )}
            <span className={`min-w-0 flex-1 truncate ${i.done ? 'text-slate-400 line-through' : ''}`}>{i.title}</span>
            {i.rrule && <span className="min-w-0 max-w-[55%] truncate text-xs text-slate-400">{describeRRule(i.rrule)}</span>}
            <PriorityTag p={i.priority} />
          </div>
        ))}
        <Button
          variant="ghost"
          className="mt-1 !px-1.5"
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
      habitTarget: mode === 'habit' ? { count: Math.max(1, count), period } : undefined,
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
                <b>Habit</b>: do something a number of times per week or month. Completed occurrences of linked items count.
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
          <div className="flex items-center gap-2 text-sm">
            <span>Target</span>
            <input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} className={`${inputCls} !w-20`} aria-label="Times" />
            <span>times per</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as 'week' | 'month')} className={`${inputCls} !w-auto`} aria-label="Period">
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </div>
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
