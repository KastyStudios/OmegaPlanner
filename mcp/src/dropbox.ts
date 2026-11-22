/*
 * Dropbox credentials for the local (Node) server: a refresh token kept in
 * ~/.omegaplanner/dropbox.json, obtained once with `login`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  authorizeUrl,
  DEFAULT_APP_KEY,
  DropboxError,
  DropboxFiles,
  pkceChallenge,
  randomToken,
  refreshAccessToken,
  tokenRequest,
} from './dropboxApi';

const APP_KEY = process.env.OMEGAPLANNER_DROPBOX_APP_KEY?.trim() || DEFAULT_APP_KEY;
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

/** Dropbox files with the locally stored credentials. */
export const localDropbox = () =>
  new DropboxFiles(async (force) => {
    const a = loadAuth();
    if (!a?.refreshToken) throw new DropboxError(NOT_CONNECTED, 'auth');
    if (!force && a.accessToken && a.expiresAt && a.expiresAt - 60_000 > Date.now()) return a.accessToken;
    const t = await refreshAccessToken(a.appKey, a.refreshToken);
    saveAuth({ ...a, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  });

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

/** One-time sign-in from a terminal: opens Dropbox, catches the redirect on localhost. */
export async function login(): Promise<void> {
  const verifier = randomToken(48);
  const state = randomToken(18);
  const url = authorizeUrl({ appKey: APP_KEY, redirectUri: REDIRECT_URI, challenge: await pkceChallenge(verifier), state });

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
