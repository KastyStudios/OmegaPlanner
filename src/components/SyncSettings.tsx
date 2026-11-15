import { formatDistanceToNow } from 'date-fns';
import { useEffect, useState } from 'react';
import { appKeyFromBuild, getAppKey, isConnected, redirectUri, setAppKey } from '../sync/dropbox';
import { connectDropbox, disconnectDropbox, syncNow, useSyncStatus, type SyncStatus } from '../sync/syncService';
import { Button, inputCls } from './ui';

export function statusText(s: SyncStatus): string {
  switch (s.state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline: will sync when the connection is back';
    case 'error':
      return `Sync problem: ${s.error ?? 'unknown error'}`;
    case 'disconnected':
      return 'Not connected';
    default:
      return s.lastSync ? `Synced ${formatDistanceToNow(new Date(s.lastSync), { addSuffix: true })}` : 'Connected';
  }
}

/** Re-render every 30 s so "Synced 2 minutes ago" stays current. */
export function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function SyncSettings() {
  const status = useSyncStatus();
  useTick();
  const [key, setKey] = useState(getAppKey());
  const [savedKey, setSavedKey] = useState(getAppKey());
  const [error, setError] = useState('');
  const connected = isConnected() && status.state !== 'disconnected';
  const fromBuild = appKeyFromBuild();

  const dot =
    status.state === 'idle' ? 'bg-green-500' : status.state === 'syncing' ? 'bg-indigo-500 animate-pulse' : status.state === 'disconnected' ? 'bg-slate-400' : 'bg-amber-500';

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600 dark:text-slate-300">
        Keep this computer and your phone in sync through your own Dropbox. There's no OmegaPlanner account: your data goes only to a
        file in your Dropbox app folder.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          <span className={status.state === 'error' ? 'text-red-600' : ''}>{statusText(status)}</span>
        </span>
        {connected ? (
          <>
            <Button variant="primary" onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
              Sync now
            </Button>
            <Button
              onClick={() => {
                if (confirm('Disconnect Dropbox on this device? Your data stays here and in Dropbox.')) void disconnectDropbox();
              }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={!savedKey}
            onClick={() => connectDropbox().catch((e) => setError((e as Error).message))}
          >
            Connect Dropbox
          </Button>
        )}
      </div>
      {status.state === 'disconnected' && status.error && <p className="text-red-600">{status.error}</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!fromBuild && (
        <details open={!savedKey} className="rounded-lg bg-slate-50 p-3 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-100">
            {savedKey ? 'Dropbox app key' : 'One-time setup (about 5 minutes)'}
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>
              Open{' '}
              <a className="text-indigo-600 underline dark:text-indigo-400" href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noreferrer">
                dropbox.com/developers/apps/create
              </a>{' '}
              and choose <b>Scoped access</b> → <b>App folder</b>. Give it a unique name, e.g. “OmegaPlanner-yourname”.
            </li>
            <li>
              On the <b>Permissions</b> tab, tick <b>files.content.write</b> and <b>files.content.read</b>, then <b>Submit</b>.
            </li>
            <li>
              On the <b>Settings</b> tab under <b>Redirect URIs</b>, add the address of every place you open OmegaPlanner. For this one:
              <code className="mx-1 select-all rounded bg-white px-1.5 py-0.5 text-xs dark:bg-slate-900">{redirectUri()}</code>
              Leave <b>Allow public clients (Implicit Grant &amp; PKCE)</b> on <b>Allow</b>.
            </li>
            <li>
              Copy the <b>App key</b> from the same page and paste it here. Do the same once on your phone, or put it in the deployed build
              (see README) so you don't have to.
            </li>
          </ol>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAppKey(key);
              setSavedKey(key.trim());
            }}
          >
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Dropbox app key" className={inputCls} aria-label="Dropbox app key" />
            <Button type="submit" disabled={!key.trim() || key.trim() === savedKey}>
              Save
            </Button>
          </form>
        </details>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Syncs when the app opens, when you switch back to it, a few seconds after each change, and every minute while it's open. Theme,
        default item color and reminder settings stay per device.
      </p>
    </div>
  );
}
