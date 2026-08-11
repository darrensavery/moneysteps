import type { Env } from '../../types.js';

export interface ApnsSendResult {
  ok: boolean;
  shouldPruneToken: boolean;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/** ES256-signs a fresh APNs auth token. Computed on every call — sub-1ms
 * local CPU cost via crypto.subtle, cheaper than the KV round-trip that
 * caching it would require (unlike FCM, there's no network exchange to save). */
async function signApnsJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: env.APNS_KEY_ID };
  const claims = { iss: env.APNS_TEAM_ID, iat: now };

  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.APNS_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(signature)}`;
}

export async function sendApnsPush(
  env: Env,
  token: string,
  environment: 'sandbox' | 'production',
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<ApnsSendResult> {
  const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const jwt = await signApnsJwt(env);

  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, badge: payload.badgeCount, sound: 'default' },
      route: payload.route,
    }),
  });

  if (res.ok) return { ok: true, shouldPruneToken: false };
  return { ok: false, shouldPruneToken: res.status === 410 || res.status === 400 };
}
