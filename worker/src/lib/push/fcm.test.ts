import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { sendFcmPush } from './fcm.js';

// The signing key is generated fresh at test runtime rather than checked in, so
// this file never contains a literal PEM private-key block for secret scanners
// (gitleaks et al.) to flag.
let TEST_PRIVATE_KEY_PEM = '';

function toPem(pkcs8: ArrayBuffer): string {
  const bytes = new Uint8Array(pkcs8);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  const b64 = btoa(raw).replace(/(.{64})/g, '$1\n').trimEnd();
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  TEST_PRIVATE_KEY_PEM = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
});

function makeEnv(overrides: Partial<{ kvGet: unknown; fetchImpl: typeof fetch }> = {}) {
  const kvStore = new Map<string, string>();
  if (overrides.kvGet !== undefined) kvStore.set('fcm_oauth_token', overrides.kvGet as string);
  return {
    FCM_PROJECT_ID: 'proj-1',
    FCM_CLIENT_EMAIL: 'svc@proj-1.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM,
    CACHE: {
      get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
    },
  } as any;
}

describe('sendFcmPush', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reuses a cached OAuth token instead of re-exchanging it', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await sendFcmPush(env, 'device-token', { title: 't', body: 'b', route: '/x', pendingCount: 1 });

    // Only one fetch call — the send — not a second one to oauth2.googleapis.com/token
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('fcm.googleapis.com');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer cached-token');
  });

  it('returns shouldPruneToken=true on UNREGISTERED', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), { status: 404 }),
    );

    const result = await sendFcmPush(env, 'device-token', { title: 't', body: 'b', route: '/x', pendingCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });

  it('sends the hybrid notification+data payload', async () => {
    const env = makeEnv({ kvGet: JSON.stringify({ access_token: 'cached-token', expires_at: Date.now() + 60_000 }) });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await sendFcmPush(env, 'device-token', { title: 'Chore approved!', body: '+£5.00 added', route: '/chores/123', pendingCount: 2 });

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.message.token).toBe('device-token');
    expect(body.message.notification).toEqual({ title: 'Chore approved!', body: '+£5.00 added' });
    expect(body.message.data).toEqual({ pendingCount: '2', route: '/chores/123' });
  });

  it('exchanges a fresh OAuth token and caches it when nothing is cached', async () => {
    const env = makeEnv(); // no kvGet override — CACHE.get resolves to null

    const fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 3599 }), { status: 200 });
      }
      if (u.includes('fcm.googleapis.com')) {
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendFcmPush(env, 'device-token', { title: 't', body: 'b', route: '/x', pendingCount: 1 });
    expect(result).toEqual({ ok: true, shouldPruneToken: false });

    // Exactly two fetch calls: the OAuth exchange, then the FCM send.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [oauthUrl, oauthInit] = fetchSpy.mock.calls[0];
    expect(String(oauthUrl)).toContain('oauth2.googleapis.com/token');
    const oauthParams = oauthInit?.body as URLSearchParams;
    expect(oauthParams.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = oauthParams.get('assertion');
    expect(assertion).toBeTruthy();

    // The assertion is a JWT: three dot-separated base64url segments.
    const segments = String(assertion).split('.');
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    // Decode the claims segment and confirm the exact OAuth scope requested.
    const claimsJson = atob(segments[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segments[1].length / 4) * 4, '='));
    const claims = JSON.parse(claimsJson);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');

    // The freshly exchanged token is cached in KV.
    expect(env.CACHE.put).toHaveBeenCalledTimes(1);
    const [putKey, putValue] = (env.CACHE.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putKey).toBe('fcm_oauth_token');
    const cached = JSON.parse(putValue as string);
    expect(cached.access_token).toBe('fresh-token');
    expect(cached).toHaveProperty('expires_at');
  });
});
