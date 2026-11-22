/*
 * Push reminders: the OmegaPlanner Worker checks the planner every minute and pushes due reminders
 * to subscribed devices, so they arrive even when the app is closed. The Worker reads the planner
 * from Dropbox, so a device must be connected to Dropbox to subscribe.
 */
import { refreshToken } from '../sync/dropbox';

const SERVER = __PUSH_SERVER__;

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone/iPad only allow push for an app added to the home screen. */
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.matchMedia('(display-mode: standalone)').matches || 'standalone' in navigator && (navigator as { standalone?: boolean }).standalone);

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The app is still installing; try again in a moment.')), 10_000)),
  ]);
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = refreshToken();
  if (!token) throw new Error('Connect Dropbox first: the reminder server reads your planner from there.');
  let res: Response;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, refreshToken: token }),
    });
  } catch {
    throw new Error('Could not reach the reminder server.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `Reminder server error ${res.status}`));
  return json;
}

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site.');
  const reg = await registration();
  const { publicKey } = (await (await fetch(`${SERVER}/push/key`)).json()) as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for another server key can't receive these pushes.
  if (sub && sub.options.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    if (current.join() !== keyBytes(publicKey).join()) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await post('/push/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Push is not on for this device.');
  const r = await post('/push/test', { endpoint: sub.endpoint });
  if (!r.ok) throw new Error(`The push service answered ${String(r.status)}.`);
}
