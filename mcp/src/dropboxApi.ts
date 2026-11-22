/*
 * Dropbox HTTP API used by both the local (Node) server and the Cloudflare Worker: only `fetch`,
 * so it runs anywhere. Where the access token comes from is up to the caller.
 */

export const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

/** The OmegaPlanner Dropbox app. The key is public: PKCE needs no secret. */
export const DEFAULT_APP_KEY = '9ie94ild959vvn6';

export class DropboxError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'conflict' | 'network' | 'other',
  ) {
    super(message);
  }
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  account_id?: string;
}

export async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
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
  return json as unknown as TokenResponse;
}

export const refreshAccessToken = (appKey: string, refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey });

/* ---------------- PKCE helpers (WebCrypto, works in Node and Workers) ---------------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier) as unknown as ArrayBuffer)));
}

export function authorizeUrl(p: { appKey: string; redirectUri: string; challenge: string; state: string }): string {
  return `${DROPBOX_AUTH_URL}?${new URLSearchParams({
    client_id: p.appKey,
    response_type: 'code',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: p.redirectUri,
    state: p.state,
  })}`;
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

export interface RemoteFile {
  text: string;
  rev: string;
}

/** Access token source; `force` asks for a fresh token after Dropbox rejected the current one. */
export type TokenSource = (force: boolean) => Promise<string>;

export class DropboxFiles {
  constructor(private readonly token: TokenSource) {}

  private async call(url: string, init: (token: string) => RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
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
    throw new DropboxError('Dropbox access was revoked. Connect OmegaPlanner to Dropbox again.', 'auth');
  }

  async currentAccountId(): Promise<string> {
    const res = await this.call(`${API}/users/get_current_account`, (token) => ({ method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
    if (!res.ok) throw new DropboxError(`Dropbox account lookup failed: ${await errorSummary(res)}`, 'other');
    return ((await res.json()) as { account_id: string }).account_id;
  }

  async download(path: string): Promise<RemoteFile | null> {
    const res = await this.call(`${CONTENT}/files/download`, (token) => ({
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
  async upload(path: string, text: string, rev: string | null): Promise<string> {
    const res = await this.call(`${CONTENT}/files/upload`, (token) => ({
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
      body: new TextEncoder().encode(text) as unknown as ArrayBuffer,
    }));
    if (res.status === 409) {
      const summary = await errorSummary(res);
      if (summary.includes('conflict')) throw new DropboxError('The sync file changed meanwhile.', 'conflict');
      throw new DropboxError(`Dropbox upload failed: ${summary}`, 'other');
    }
    if (!res.ok) throw new DropboxError(`Dropbox upload failed: ${await errorSummary(res)}`, 'other');
    return ((await res.json()) as { rev: string }).rev;
  }
}
