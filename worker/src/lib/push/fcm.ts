import type { Env } from '../../types.js';

const FCM_KV_KEY = 'fcm_oauth_token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface FcmSendResult {
  ok: boolean;
  shouldPruneToken: boolean;
}

interface CachedFcmToken {
  access_token: string;
  expires_at: number; // epoch ms
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

async function signFcmJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.FCM_CLIENT_EMAIL,
    scope: FCM_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FCM_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(signature)}`;
}

async function getFcmAccessToken(env: Env): Promise<string> {
  const cachedRaw = await env.CACHE.get(FCM_KV_KEY);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedFcmToken;
    // Read-side buffer is smaller than the write-side KV TTL buffer (below) so a
    // freshly-cached token is never rejected by clock skew between write and read.
    if (cached.expires_at > Date.now() + 30_000) return cached.access_token;
  }

  const assertion = await signFcmJwt(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json<{ access_token: string; expires_in: number }>();

  const expires_at = Date.now() + data.expires_in * 1000;
  await env.CACHE.put(FCM_KV_KEY, JSON.stringify({ access_token: data.access_token, expires_at }), {
    expirationTtl: Math.max(60, data.expires_in - 60),
  });

  return data.access_token;
}

export async function sendFcmPush(
  env: Env,
  token: string,
  payload: { title: string; body: string; route: string; pendingCount: number },
): Promise<FcmSendResult> {
  const accessToken = await getFcmAccessToken(env);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { pendingCount: String(payload.pendingCount), route: payload.route },
      },
    }),
  });

  if (res.ok) return { ok: true, shouldPruneToken: false };

  const errBody = await res.json<{ error?: { status?: string } }>().catch(() => ({}));
  const shouldPrune = errBody.error?.status === 'UNREGISTERED' || errBody.error?.status === 'NOT_FOUND';
  return { ok: false, shouldPruneToken: shouldPrune };
}
