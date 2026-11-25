/*
 * Per Dropbox account: the refresh token the Worker uses to read the sync file (for MCP and for
 * reminders) and the phones/browsers subscribed to push notifications. Stored in PLANNER_KV.
 */
import { DropboxError, DropboxFiles, refreshAccessToken } from '../dropboxApi';
import type { PushSubscriptionJSON } from './webpush';

export interface Env {
  OAUTH_KV: KVNamespace;
  PLANNER_KV: KVNamespace;
  /** e.g. https://omegaplanner-mcp.example.workers.dev (no trailing slash) */
  PUBLIC_URL: string;
  TIME_ZONE: string;
  /** Comma-separated origins of the app allowed to register for push. */
  APP_ORIGINS: string;
  DROPBOX_APP_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  /** Secret: VAPID private key as JWK JSON. */
  VAPID_PRIVATE_JWK: string;
  /** Secret: comma-separated Dropbox account ids that may use this Worker (empty = anyone). */
  ALLOWED_DROPBOX_ACCOUNTS?: string;
}

export interface Account {
  refreshToken: string;
  subscriptions: (PushSubscriptionJSON & { addedAt: string })[];
}

const key = (accountId: string) => `acct:${accountId}`;

export function isAllowed(env: Env, accountId: string): boolean {
  const list = (env.ALLOWED_DROPBOX_ACCOUNTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 0 || list.includes(accountId);
}

export const getAccount = (env: Env, accountId: string) => env.PLANNER_KV.get<Account>(key(accountId), 'json');
export async function putAccount(env: Env, accountId: string, a: Account): Promise<void> {
  await env.PLANNER_KV.put(key(accountId), JSON.stringify(a));
  const ids = await listAccountIds(env);
  if (!ids.includes(accountId)) await env.PLANNER_KV.put(INDEX, JSON.stringify([...ids, accountId]));
}

/*
 * Account ids live in one key rather than being found with KV `list`: the cron asks every minute,
 * and the free plan allows only 1,000 list operations a day (but 100,000 reads).
 */
const INDEX = 'accounts';

export async function listAccountIds(env: Env): Promise<string[]> {
  const indexed = await env.PLANNER_KV.get<string[]>(INDEX, 'json');
  if (indexed) return indexed;
  // First run after the index was introduced: build it once from the existing keys.
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PLANNER_KV.list({ prefix: 'acct:', cursor });
    ids.push(...page.keys.map((k) => k.name.slice(5)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await env.PLANNER_KV.put(INDEX, JSON.stringify(ids));
  return ids;
}

/** Saves a (newer) refresh token for an account, keeping its push subscriptions. */
export async function saveRefreshToken(env: Env, accountId: string, refreshToken: string): Promise<void> {
  const existing = await getAccount(env, accountId);
  if (!existing) await putAccount(env, accountId, { refreshToken, subscriptions: [] });
  else if (existing.refreshToken !== refreshToken) await putAccount(env, accountId, { ...existing, refreshToken });
}

/** Dropbox access for an account. Access tokens (valid ~4 h) are cached in KV to spare refreshes. */
export function dropboxFor(env: Env, accountId: string): DropboxFiles {
  return new DropboxFiles(async (force) => {
    const cacheKey = `tok:${accountId}`;
    if (!force) {
      const cached = await env.PLANNER_KV.get<{ token: string; expiresAt: number }>(cacheKey, 'json');
      if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
    }
    const account = await getAccount(env, accountId);
    if (!account) throw new DropboxError('This Dropbox account is not connected.', 'auth');
    const t = await refreshAccessToken(env.DROPBOX_APP_KEY, account.refreshToken);
    const expiresAt = Date.now() + t.expires_in * 1000;
    await env.PLANNER_KV.put(cacheKey, JSON.stringify({ token: t.access_token, expiresAt }), { expiration: Math.floor(expiresAt / 1000) });
    return t.access_token;
  });
}
