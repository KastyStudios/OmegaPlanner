/*
 * Minimal Dropbox client for a browser-only app: OAuth 2 PKCE with a refresh token
 * (no app secret needed), plus download/upload of a single file in the app folder.
 */

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

const STORE_KEY = 'omegaplanner.dropbox';
const PENDING_KEY = 'omegaplanner.dropbox.pkce';
const APP_KEY_KEY = 'omegaplanner.dropboxAppKey';

interface StoredAuth {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  accountId?: string;
}

export class DropboxError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'conflict' | 'network' | 'other',
  ) {
    super(message);
  }
}

/* ---------------- configuration ---------------- */

/** The app key is public (PKCE needs no secret). Build-time env var, else entered in Settings. */
export function getAppKey(): string {
  const env = (import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined)?.trim();
  if (env) return env;
  try {
    return localStorage.getItem(APP_KEY_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}
export const appKeyFromBuild = () => !!(import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined)?.trim();
export function setAppKey(key: string): void {
  try {
    localStorage.setItem(APP_KEY_KEY, key.trim());
  } catch {
    /* ignore */
  }
}

/** Where Dropbox sends the user back; must be listed under "Redirect URIs" in the Dropbox app console. */
export const redirectUri = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}
function saveAuth(a: StoredAuth | null) {
  try {
    if (a) localStorage.setItem(STORE_KEY, JSON.stringify(a));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export const isConnected = () => !!loadAuth()?.refreshToken;

/* ---------------- OAuth (PKCE) ---------------- */

function base64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Redirects the browser to Dropbox to approve access. */
export async function startConnect(): Promise<void> {
  const appKey = getAppKey();
  if (!appKey) throw new DropboxError('Enter your Dropbox app key first.', 'other');
  const verifier = randomString(64);
  const state = randomString(24);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, appKey }));
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

async function tokenRequest(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new DropboxError('No connection to Dropbox.', 'network');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error_description || json.error || `HTTP ${res.status}`;
    throw new DropboxError(`Dropbox sign-in failed: ${msg}`, res.status === 400 || res.status === 401 ? 'auth' : 'other');
  }
  return json as { access_token: string; expires_in: number; refresh_token?: string; account_id?: string };
}

/**
 * Finish the OAuth redirect if the page was opened with ?code=…&state=….
 * Returns true when a new connection was made.
 */
export async function completeConnectFromUrl(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;
  const pendingRaw = localStorage.getItem(PENDING_KEY);
  // Clean the URL either way.
  ['code', 'state', 'error', 'error_description'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (!pendingRaw) return false;
  localStorage.removeItem(PENDING_KEY);
  if (error) throw new DropboxError('Dropbox access was not granted.', 'auth');
  const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; appKey: string };
  if (pending.state !== state) throw new DropboxError('Dropbox sign-in could not be verified. Please try again.', 'auth');
  const t = await tokenRequest({
    code: code!,
    grant_type: 'authorization_code',
    code_verifier: pending.verifier,
    client_id: pending.appKey,
    redirect_uri: redirectUri(),
  });
  if (!t.refresh_token) throw new DropboxError('Dropbox did not return a refresh token.', 'auth');
  saveAuth({ refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, accountId: t.account_id });
  return true;
}

async function accessToken(forceRefresh = false): Promise<string> {
  const a = loadAuth();
  if (!a) throw new DropboxError('Not connected to Dropbox.', 'auth');
  if (!forceRefresh && a.accessToken && a.expiresAt && a.expiresAt - 60_000 > Date.now()) return a.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: getAppKey() });
  saveAuth({ ...a, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function disconnect(): Promise<void> {
  const a = loadAuth();
  saveAuth(null);
  if (a?.accessToken) {
    await fetch(`${API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${a.accessToken}` } }).catch(() => {});
  }
}

/* ---------------- files ---------------- */

/** Header values must be ASCII; escape anything else as JSON \u sequences. */
const headerJson = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

async function call(url: string, init: (token: string) => RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt > 0);
    let res: Response;
    try {
      res = await fetch(url, init(token));
    } catch {
      throw new DropboxError('No connection to Dropbox.', 'network');
    }
    if (res.status !== 401) return res;
  }
  saveAuth(null);
  throw new DropboxError('Dropbox access was revoked. Connect again in Settings.', 'auth');
}

async function errorSummary(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    return (JSON.parse(text) as { error_summary?: string }).error_summary ?? text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export interface RemoteFile {
  text: string;
  rev: string;
}

export async function downloadFile(path: string): Promise<RemoteFile | null> {
  const res = await call(`${CONTENT}/files/download`, (token) => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': headerJson({ path }) },
  }));
  if (res.status === 409) {
    const summary = await errorSummary(res);
    if (summary.includes('not_found')) return null;
    throw new DropboxError(`Dropbox download failed: ${summary}`, 'other');
  }
  if (!res.ok) throw new DropboxError(`Dropbox download failed: ${await errorSummary(res)}`, 'other');
  const text = await res.text();
  let rev = '';
  try {
    rev = (JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as { rev?: string }).rev ?? '';
  } catch {
    /* fall through */
  }
  if (!rev) rev = await fileRev(path);
  return { text, rev };
}

async function fileRev(path: string): Promise<string> {
  const res = await call(`${API}/files/get_metadata`, (token) => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }));
  if (!res.ok) throw new DropboxError(`Dropbox metadata failed: ${await errorSummary(res)}`, 'other');
  return ((await res.json()) as { rev: string }).rev;
}

/** Upload; with `rev` the write only succeeds if the file is unchanged since that revision. */
export async function uploadFile(path: string, text: string, rev: string | null): Promise<string> {
  const res = await call(`${CONTENT}/files/upload`, (token) => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': headerJson({
        path,
        mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' },
        autorename: false,
        mute: true,
        strict_conflict: true,
      }),
    },
    body: new TextEncoder().encode(text),
  }));
  if (res.status === 409) {
    const summary = await errorSummary(res);
    if (summary.includes('conflict')) throw new DropboxError('The sync file changed meanwhile.', 'conflict');
    throw new DropboxError(`Dropbox upload failed: ${summary}`, 'other');
  }
  if (!res.ok) throw new DropboxError(`Dropbox upload failed: ${await errorSummary(res)}`, 'other');
  return ((await res.json()) as { rev: string }).rev;
}
