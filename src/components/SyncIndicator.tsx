import { useNavigate } from 'react-router-dom';
import { syncNow, useSyncStatus } from '../sync/syncService';
import { statusText, useTick } from './SyncSettings';

/** Small cloud status in the navigation. Tap to sync now (or open Settings when there's a problem). */
export function SyncIndicator() {
  const status = useSyncStatus();
  const navigate = useNavigate();
  useTick();
  if (status.state === 'disconnected' && !status.error) return null;

  const icon = { idle: '☁︎✓', syncing: '⟳', offline: '☁︎⋯', error: '☁︎!', disconnected: '☁︎!' }[status.state];
  const color = {
    idle: 'text-green-600 dark:text-green-400',
    syncing: 'text-indigo-600 dark:text-indigo-400',
    offline: 'text-slate-400',
    error: 'text-amber-600',
    disconnected: 'text-amber-600',
  }[status.state];

  return (
    <button
      type="button"
      onClick={() => (status.state === 'error' || status.state === 'disconnected' ? navigate('/settings#sync') : void syncNow())}
      title={statusText(status)}
      aria-label={`Sync status: ${statusText(status)}`}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${color}`}
    >
      <span aria-hidden className={status.state === 'syncing' ? 'inline-block animate-spin' : ''}>
        {icon}
      </span>
      <span className="hidden text-xs md:inline">{status.state === 'idle' ? 'Synced' : status.state === 'syncing' ? 'Syncing' : status.state === 'offline' ? 'Offline' : 'Sync issue'}</span>
    </button>
  );
}
