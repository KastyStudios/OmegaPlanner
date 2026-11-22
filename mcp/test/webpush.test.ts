import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/worker/webpush';

describe('Web Push', () => {
  it('encrypts exactly like the RFC 8291 example (section 5)', async () => {
    const body = await encryptPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
        keys: {
          p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      },
      {
        senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('signs a VAPID token the push service can verify', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://omegaplanner.pages.dev' }, Date.UTC(2026, 10, 22));
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = t.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://omegaplanner.pages.dev' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey) as unknown as ArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s) as unknown as ArrayBuffer, new TextEncoder().encode(`${h}.${c}`) as unknown as ArrayBuffer);
    expect(ok).toBe(true);
  });
});
