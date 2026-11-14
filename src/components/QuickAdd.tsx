import { useState } from 'react';
import { createItem } from '../db/repo';
import { fromInputs } from '../lib/dates';
import { useApp } from './context';
import { Button, inputCls } from './ui';

/** One-line task entry: title, optional due date and category. Enter to add. */
export function QuickAdd({ goalId }: { goalId?: string }) {
  const { data } = useApp();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState('');

  async function add() {
    const t = title.trim();
    if (!t) return;
    const start = date ? fromInputs(date) : undefined;
    await createItem({
      kind: 'task',
      title: t,
      allDay: true,
      start: start?.toISOString(),
      end: start ? fromInputs(date, '24:00').toISOString() : undefined,
      categoryId: categoryId || undefined,
      goalId,
    });
    setTitle('');
    setDate('');
  }

  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a to-do and press Enter…"
        className={`${inputCls} min-w-0 flex-1 basis-60`}
        aria-label="New to-do title"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} !w-auto`} aria-label="Date (optional)" title="Date (optional)" />
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} !w-auto`} aria-label="Category">
        <option value="">No category</option>
        {data.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="primary" disabled={!title.trim()}>
        Add
      </Button>
    </form>
  );
}
