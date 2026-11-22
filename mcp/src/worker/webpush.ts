/*
 * Web Push with WebCrypto only (runs in Workers): payload encryption per RFC 8291 (aes128gcm)
 * and VAPID authentication per RFC 8292.
 */

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what the browser needs as applicationServerKey). */
  publicKey: string;
  /** Private key as a JWK JSON string. */
  privateJwk: string;
  /** Contact for push services: a mailto: or https: URL. */
  subject: string;
}

const enc = new TextEncoder();
/** Typed-array to BufferSource (the Workers and DOM typings disagree about Uint8Array buffers). */
const bs = (u: Uint8Array) => u as unknown as ArrayBuffer;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', bs(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bs(data)));
}

/** P-256 public key (65 bytes, uncompressed) to a JWK, so a private key can be imported with it. */
function publicJwk(raw: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)) };
}

/** Test hooks: fixed sender keys and salt, as in the RFC 8291 example. */
export interface EncryptOptions {
  senderPrivate?: string;
  senderPublic?: string;
  salt?: Uint8Array;
}

/** Encrypts `payload` for one subscription; returns the request body (RFC 8188 header + record). */
export async function encryptPayload(payload: Uint8Array, sub: PushSubscriptionJSON, opts: EncryptOptions = {}): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);

  let senderKey: CryptoKey;
  let senderPublic: Uint8Array;
  if (opts.senderPrivate && opts.senderPublic) {
    senderPublic = b64urlDecode(opts.senderPublic);
    senderKey = await crypto.subtle.importKey('jwk', { ...publicJwk(senderPublic), d: opts.senderPrivate }, { name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    senderKey = pair.privateKey;
    senderPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey('raw', bs(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as { name: string }, senderKey, 256));

  // RFC 8291 section 3.4
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, senderPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);

  // One record: payload, then the 0x02 delimiter for the last record.
  const aes = await crypto.subtle.importKey('raw', bs(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce) }, aes, bs(concat(payload, new Uint8Array([2])))));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([rs >>> 24, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, senderPublic.length]), senderPublic);
  return concat(header, cipher);
}

/** VAPID `Authorization` header value for a push service (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const head = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })),
  );
  const key = await crypto.subtle.importKey('jwk', JSON.parse(vapid.privateJwk) as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bs(enc.encode(`${head}.${claims}`))));
  return `vapid t=${head}.${claims}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

export interface PushMessage {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
}

/** Sends one notification. Returns the push service's status (404/410 = subscription is gone). */
export async function sendPush(sub: PushSubscriptionJSON, msg: PushMessage, vapid: VapidKeys, ttlSeconds = 600): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(msg)), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high',
    },
    body: bs(body),
  });
  return res.status;
}

/** New VAPID keys (run once, e.g. `node dist/omegaplanner-mcp.mjs vapid`). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(raw), privateJwk: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) };
}
