import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendFcmPush } from './fcm.js';

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

// A real PKCS8 RSA test key, generated solely for this test suite (not a production secret).
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCw07atHKMEncO1
HEdGfStrfzqrVfhpwXfa2fyWODy+NJiaCrgj9hGpaCthPMkEA9rLE8kOXocpEJ7v
4GyWEs9Vj+l/q4TpprKWkrFVHJ0TCK6Rc5O1dof4ZBkv6IFDsWOH0uuzbL4WdPUb
y8uXxuY/8y5mi81cNXuRg6dEX2Ek2io+qgTqE1k/3dhEiMFTiGke+F0KCGf46dqt
iRHb+MOAiC8lm4i0CtHE6m9jFahRa6mrtYLwL2Guo+OWeqdSMWNX4aLbXXjOkJN1
R64RNnwk8PZnyh0WROtXu1Gm4ueb+r2AGQW1G6wDD2iZgjgKR3EAlr48RFcRfrhS
xc92E+z/AgMBAAECggEAOoNMWztzLEdiaA97/HTWBePbj6/KnIBDP33Lyg/A9fXk
m3C5n1jBXmwUksAxCm2WHIYnDWS1WB7iYSFD/WMrDbap/y/MMx8Q0KepG690wMQq
NAJpWe5nrwe8l/BZugM8msjuavisbDT2mOSWsdpE/dtkOtW/NmiSQ8QreQIQ3Mbx
k7l1HJWme2x6DubY7Mw7TW+zff1FSYvPuosctG5+/yTTsxdCu7I+rT6KJM8U7XkU
3kpLdKYr5PBWi/nd3nm7LaW7FefjwfHeGwW4vOag3oYcoBleWfVCMoZaVOeJOBgW
WIq5ByUj8EVC/bn5RH9jPQyxM2sbtf9VAklZoGHpFQKBgQDhIx/6Mc9lwITWdLoJ
n8Q7YFBL3dyoTYC/qocZ0H+CDak0jBsZnax/75CkTQ6OZbaLp5DQeyyigGdClsfj
e85PuyU0BC+iYKORumDQyOrwNMSuDN0cm7I+R+Edh3hhnFj3tMqzylw7902YWYpS
UEY6Ed98OIhDJHFQ0dPssrMVhQKBgQDJETW2PufGOdxKuuWURmOfOF4Ztf39q1y4
IeVwsutS+5Z7oWrJUnQ5fJDi9+9pnmMr9v26Lw+qmRhUelNGD8AMM032hVCJBdfm
Sqj2yOVQ17hTEj0585GPBBOic4BuZ9PLlTFkXPqN1HZKZFm41AUsFzldb3EhCKIc
x4CjvF2tswKBgFaGLEz4ha+iXKsa80CtoTn8mv99Rcd8+cUvoXp/UfHGlEf4rJWc
rmYAyQMMBlMdrhlgDdzB6faOCKFj13CK7VBhKTwje7cZEuP30CuNfBVTAl+t2/CZ
udgLwe2aWd6RuvOADQMp+2akdbLefrWB2muI4O4Zv+yl/dLEwYDPcNoNAoGAfn/l
WxOYno4ompubdP4UD0hXa7WkZsQ5QV+SCqWGiF7g/kc/+Al4NfK49RMn/Ts5CaAL
YefZ42sOc5fCbIHcQdDFbCPT12Flw+2VAC7El2gg/6KqApvLKD9YWwxv8QZBqgPj
X1FgEXtqMMOR70b1OhgibzZ95lqYI6Mgu+L2zSECgYEA32+szb+mTyHWsZdhlbW/
EJpjqa9Qcy/qc/pOjQqq0JEl/gmfvXPN2qZBNmoQkfxf2g+AwwYyygU/BHWqqQg0
ah9ukREWQFaJ3deBwlv0FUaVjwYocicW4KfNMNMqHnSdU3BqNBNMUKPRMMSk+gCg
hHAtcxe9GBcci3IbiVCSLpk=
-----END PRIVATE KEY-----`;

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
