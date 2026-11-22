/*
 * OmegaPlanner on Cloudflare Workers:
 *  - /mcp        remote MCP server (for claude.ai and other clients), behind OAuth
 *  - /authorize  consent page, then sign-in with Dropbox; /callback finishes it
 *  - /push/*     the app registers phones/browsers for push notifications
 *  - cron        every minute: push the reminders that are due
 */
import OAuthProvider, { AuthorizationError, authorizationErrorRedirect, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { setTimeZone } from '../../../src/lib/zone';
import { authorizeUrl, DropboxFiles, pkceChallenge, randomToken, tokenRequest } from '../dropboxApi';
import { makeStore } from '../store';
import { createPlannerServer } from '../tools';
import { dropboxFor, getAccount, isAllowed, listAccountIds, putAccount, saveRefreshToken, type Env } from './accounts';
import { remindersDue } from './reminders';
import { sendPush, type PushSubscriptionJSON, type VapidKeys } from './webpush';

type WorkerEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
interface Props {
  accountId: string;
}

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, headers = new Headers()): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a2233;background:#f4f5f1}h1{font-size:1.5rem}
button{font:inherit;padding:.6rem 1.1rem;border-radius:.6rem;border:1px solid #c2c6be;background:#fff;cursor:pointer}button.primary{background:#2340c8;border-color:#2340c8;color:#fff}
.warn{background:#fff4d6;padding:.6rem .8rem;border-radius:.5rem}</style><body>${body}</body></html>`,
    { headers },
  );
}

/* ---------------- authorization: consent, then Dropbox ---------------- */

async function authorize(request: Request, env: WorkerEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === 'GET') {
    const authRequest = await oauth.parseAuthRequest(request);
    const d = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    const who = d.clientDomain ? `<b>${escape(d.clientName)}</b> (${escape(d.clientDomain)})` : `<b>${escape(d.clientName)}</b> (name not verified)`;
    return page(
      'Connect OmegaPlanner',
      `<h1>Allow ${who} to use your OmegaPlanner?</h1>
<p>It will be able to read your plans and create, change and delete items. Access is sent to <b>${escape(d.redirectHost)}</b>.</p>
${d.redirectIsLoopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ''}
<p>Next you sign in with the Dropbox account your OmegaPlanner syncs to.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">
<p><button class="primary" name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>`,
      consent.headers,
    );
  }

  const form = await request.formData();
  const handle = String(form.get('handle'));
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = randomToken(48);
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  headers.set(
    'Location',
    authorizeUrl({ appKey: env.DROPBOX_APP_KEY, redirectUri: `${env.PUBLIC_URL}/callback`, challenge: await pkceChallenge(verifier), state }),
  );
  return new Response(null, { status: 302, headers });
}

async function callback(request: Request, env: WorkerEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
  const q = new URL(request.url).searchParams;
  if (q.get('error') || !q.get('code')) {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }
  const t = await tokenRequest({
    code: q.get('code')!,
    grant_type: 'authorization_code',
    code_verifier: data.verifier,
    client_id: env.DROPBOX_APP_KEY,
    redirect_uri: `${env.PUBLIC_URL}/callback`,
  });
  const accountId = t.account_id ?? (await new DropboxFiles(async () => t.access_token).currentAccountId());
  if (!isAllowed(env, accountId) || !t.refresh_token) {
    return page('Not allowed', '<h1>This Dropbox account can’t use this OmegaPlanner server.</h1><p>Sign in with the account your planner syncs to.</p>');
  }
  await saveRefreshToken(env, accountId, t.refresh_token);
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: encodeURIComponent(accountId),
    metadata: {},
    scope: original.scope,
    props: { accountId } satisfies Props,
  });
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

/* ---------------- push registration (called by the app) ---------------- */

function cors(request: Request, env: Env): Headers {
  const h = new Headers({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' });
  const origin = request.headers.get('Origin') ?? '';
  if (env.APP_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) h.set('Access-Control-Allow-Origin', origin);
  return h;
}

async function push(request: Request, env: Env, path: string): Promise<Response> {
  const headers = cors(request, env);
  const json = (body: unknown, status = 200) => {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(body), { status, headers });
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (path === '/push/key') return json({ publicKey: env.VAPID_PUBLIC_KEY });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // The app proves which Dropbox account it is with its own refresh token; the Worker keeps it to
  // read the planner when sending reminders.
  const body = (await request.json().catch(() => null)) as { refreshToken?: string; subscription?: PushSubscriptionJSON; endpoint?: string } | null;
  if (!body?.refreshToken) return json({ error: 'Missing Dropbox credentials' }, 400);
  let accountId: string;
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: body.refreshToken, client_id: env.DROPBOX_APP_KEY });
    accountId = await new DropboxFiles(async () => t.access_token).currentAccountId();
  } catch {
    return json({ error: 'Dropbox did not accept these credentials' }, 401);
  }
  if (!isAllowed(env, accountId)) return json({ error: 'This Dropbox account is not allowed' }, 403);

  const account = (await getAccount(env, accountId)) ?? { refreshToken: body.refreshToken, subscriptions: [] };
  account.refreshToken = body.refreshToken;
  if (path === '/push/subscribe') {
    const s = body.subscription;
    if (!s?.endpoint?.startsWith('https://') || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Invalid subscription' }, 400);
    account.subscriptions = [
      ...account.subscriptions.filter((x) => x.endpoint !== s.endpoint),
      { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, addedAt: new Date().toISOString() },
    ].slice(-10);
  } else if (path === '/push/unsubscribe') {
    account.subscriptions = account.subscriptions.filter((x) => x.endpoint !== body.endpoint);
  } else if (path === '/push/test') {
    await putAccount(env, accountId, account);
    const vapid = vapidOf(env);
    const sub = account.subscriptions.find((x) => x.endpoint === body.endpoint);
    if (!sub) return json({ error: 'This device is not subscribed' }, 404);
    const status = await sendPush(sub, { title: 'OmegaPlanner', body: 'Notifications work on this device.', tag: 'test', url: '/' }, vapid);
    return json({ ok: status < 300, status });
  } else {
    return json({ error: 'Not found' }, 404);
  }
  await putAccount(env, accountId, account);
  return json({ ok: true });
}

const vapidOf = (env: Env): VapidKeys => ({ publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK, subject: env.VAPID_SUBJECT });

/* ---------------- cron: push due reminders ---------------- */

async function sendReminders(env: Env, scheduledTime: number): Promise<void> {
  const vapid = vapidOf(env);
  for (const accountId of await listAccountIds(env)) {
    try {
      const account = await getAccount(env, accountId);
      if (!account?.subscriptions.length || !isAllowed(env, accountId)) continue;
      const messages = remindersDue(await makeStore(dropboxFor(env, accountId)).read(), scheduledTime);
      if (!messages.length) continue;
      const gone = new Set<string>();
      for (const sub of account.subscriptions) {
        for (const msg of messages) {
          const status = await sendPush(sub, msg, vapid).catch(() => 0);
          if (status === 404 || status === 410) gone.add(sub.endpoint);
          if (gone.has(sub.endpoint)) break;
        }
      }
      if (gone.size) await putAccount(env, accountId, { ...account, subscriptions: account.subscriptions.filter((s) => !gone.has(s.endpoint)) });
    } catch (e) {
      console.error(`reminders for ${accountId}: ${(e as Error).message}`);
    }
  }
}

/* ---------------- wiring ---------------- */

const mcpHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext & { props: Props }): Promise<Response> {
    setTimeZone(env.TIME_ZONE);
    const { accountId } = ctx.props;
    if (!isAllowed(env, accountId)) return new Response('Forbidden', { status: 403 });
    const server = createPlannerServer(makeStore(dropboxFor(env, accountId)), { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
    // Stateless: a fresh server and transport per request, plain JSON responses.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

const defaultHandler = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    setTimeZone(env.TIME_ZONE);
    const path = new URL(request.url).pathname;
    try {
      if (path === '/authorize') return await authorize(request, env);
      if (path === '/callback') return await callback(request, env);
      if (path.startsWith('/push/')) return await push(request, env, path);
    } catch (e) {
      if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
      if (e instanceof AuthorizationError) return page('Sign-in problem', `<h1>Sign-in problem</h1><p>${escape(e.description)}</p><p>Start connecting again.</p>`);
      throw e;
    }
    if (path === '/') return page('OmegaPlanner', `<h1>OmegaPlanner server</h1><p>Add <code>${escape(env.PUBLIC_URL)}/mcp</code> as a custom connector in Claude.</p>`);
    return new Response('Not found', { status: 404 });
  },
};

let provider: OAuthProvider<WorkerEnv> | undefined;
const providerFor = (env: Env) =>
  (provider ??= new OAuthProvider<WorkerEnv>({
    apiRoute: '/mcp',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiHandler: mcpHandler as any,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    scopesSupported: ['planner'],
    resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL] },
    refreshTokenIdleTTL: 90 * 24 * 3600,
  }));

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return providerFor(env).fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    setTimeZone(env.TIME_ZONE);
    ctx.waitUntil(sendReminders(env, event.scheduledTime));
  },
};
