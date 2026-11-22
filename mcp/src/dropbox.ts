/*
 * Dropbox access for the MCP server: OAuth 2 PKCE (no app secret) with a refresh token kept in
 * ~/.omegaplanner/dropbox.json, plus download/upload of the app's sync file.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

/** The OmegaPlanner Dropbox app. The key is public: PKCE needs no secret. */
const APP_KEY = process.env.OMEGAPLANNER_DROPBOX_APP_KEY?.trim() || '9ie94ild959vvn6';
/** Already registered as a redirect URI of the Dropbox app (it is the dev server's address). */
const LOGIN_PORT = Number(process.env.OMEGAPLANNER_LOGIN_PORT ?? 5173);
const REDIRECT_URI = `http://localhost:${LOGIN_PORT}/`;

const CONFIG_DIR = process.env.OMEGAPLANNER_HOME ?? join(homedir(), '.omegaplanner');
const AUTH_FILE = join(CONFIG_DIR, 'dropbox.json');

interface StoredAuth {
  appKey: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export class DropboxError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'conflict' | 'network' | 'other',
  ) {
    super(message);
  }
}

const NOT_CONNECTED =
  'OmegaPlanner is not connected to Dropbox. Run `node <path to mcp>/dist/omegaplanner-mcp.mjs login` once, in a terminal.';

function loadAuth(): StoredAuth | null {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as StoredAuth;
  } catch {
    return null;
  }
}

function saveAuth(a: StoredAuth): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(a, null, 2), { mode: 0o600 });
}

async function tokenRequest(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) });
  } catch {
    throw new DropboxError('No connection to Dropbox.', 'network');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, string | number>;
  if (!res.ok) {
    const msg = [json.error, json.error_description].filter(Boolean).join(': ') || `HTTP ${res.status}`;
    throw new DropboxError(`Dropbox sign-in failed: ${msg}`, res.status === 400 || res.status === 401 ? 'auth' : 'other');
  }
  return json as unknown as { access_token: string; expires_in: number; refresh_token?: string };
}

async function accessToken(forceRefresh = false): Promise<string> {
  const a = loadAuth();
  if (!a?.refreshToken) throw new DropboxError(NOT_CONNECTED, 'auth');
  if (!forceRefresh && a.accessToken && a.expiresAt && a.expiresAt - 60_000 > Date.now()) return a.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: a.appKey });
  saveAuth({ ...a, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/* ---------------- login (run once from a terminal) ---------------- */

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed as well */
  }
}

export async function login(): Promise<void> {
  const verifier = b64url(randomBytes(48));
  const state = b64url(randomBytes(18));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: REDIRECT_URI,
    state,
  })}`;

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const q = new URL(req.url ?? '/', REDIRECT_URI).searchParams;
      if (!q.get('code') && !q.get('error')) {
        res.writeHead(404).end();
        return;
      }
      const reply = (msg: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><title>OmegaPlanner</title><body style="font-family:system-ui;padding:2rem"><p>${msg}</p>`);
      };
      try {
        if (q.get('error')) throw new Error('Dropbox access was not granted.');
        if (q.get('state') !== state) throw new Error('Sign-in could not be verified. Please try again.');
        const t = await tokenRequest({
          code: q.get('code')!,
          grant_type: 'authorization_code',
          code_verifier: verifier,
          client_id: APP_KEY,
          redirect_uri: REDIRECT_URI,
        });
        if (!t.refresh_token) throw new Error('Dropbox did not return a refresh token.');
        saveAuth({ appKey: APP_KEY, refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
        reply('OmegaPlanner MCP is connected to Dropbox. You can close this tab.');
        server.close();
        resolve();
      } catch (e) {
        reply(`Sign-in failed: ${(e as Error).message}`);
        server.close();
        reject(e);
      }
    });
    server.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'EADDRINUSE' ? new Error(`Port ${LOGIN_PORT} is in use (is the dev server running?). Stop it and try again.`) : e),
    );
    server.listen(LOGIN_PORT, () => {
      console.log(`Opening Dropbox to approve access. If no browser opens, visit:\n\n${url}\n`);
      openInBrowser(url);
    });
  });
  console.log(`Connected. Credentials saved to ${AUTH_FILE}`);
}

/* ---------------- files ---------------- */

const headerJson = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

async function errorSummary(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    return (JSON.parse(text) as { error_summary?: string }).error_summary ?? text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

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
    const summary = await errorSummary(res);
    if (!/invalid_access_token|expired_access_token/.test(summary)) throw new DropboxError(`Dropbox refused the request: ${summary}`, 'other');
  }
  throw new DropboxError(`Dropbox access was revoked. ${NOT_CONNECTED}`, 'auth');
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
  const rev = (JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as { rev?: string }).rev ?? '';
  return { text: await res.text(), rev };
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

