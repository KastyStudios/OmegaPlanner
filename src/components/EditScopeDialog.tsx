import { useState } from 'react';
import type { EditScope } from '../domain/seriesEdit';
import { Button, Modal } from './ui';

export interface ScopeRequest {
  action: 'edit' | 'delete';
  allowThis: boolean;
  resolve: (scope: EditScope | null) => void;
}

export function EditScopeDialog({ request }: { request: ScopeRequest }) {
  const [scope, setScope] = useState<EditScope>(request.allowThis ? 'this' : 'following');
  const verb = request.action === 'edit' ? 'Edit' : 'Delete';
  const options: { value: EditScope; label: string; disabled?: boolean }[] = [
    { value: 'this', label: 'This occurrence', disabled: !request.allowThis },
    { value: 'following', label: 'This and following occurrences' },
    { value: 'all', label: 'All occurrences' },
  ];
  return (
    <Modal
      title={`${verb} recurring item`}
      width="max-w-sm"
      onClose={() => request.resolve(null)}
      footer={
        <>
          <Button onClick={() => request.resolve(null)}>Cancel</Button>
          <Button variant={request.action === 'delete' ? 'danger' : 'primary'} onClick={() => request.resolve(scope)}>
            {verb}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex items-center gap-2 text-sm ${o.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name="scope"
              checked={scope === o.value}
              disabled={o.disabled}
              onChange={() => setScope(o.value)}
              className="accent-indigo-600"
            />
            {o.label}
          </label>
        ))}
        {!request.allowThis && (
          <p className="pt-1 text-xs text-slate-500">
            Changes to repetition, type, category, goal, priority or reminders apply to the whole series or the rest of it.
          </p>
        )}
      </div>
    </Modal>
  );
}
