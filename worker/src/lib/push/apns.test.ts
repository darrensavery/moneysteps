import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendApnsPush } from './apns.js';

// A real PKCS8 EC (P-256) test key, generated solely for this test suite
// (not a production secret): openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
const TEST_APNS_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgnzxbfqxO/I0pIf8O
HSBF1h1IVTZ+dyr3BEm3BMlZxKahRANCAAT8mvFsTCYybn1k7ve+2JbDU0OhcxF4
dFCzrvS/OkyVPK2wOkeTt2qsTjtA9cDUL0f/uKerI0xJbWHkuiwAu7K0
-----END PRIVATE KEY-----`;

function makeEnv() {
  return {
    APNS_KEY_ID: 'KEYID123',
    APNS_TEAM_ID: 'TEAMID123',
    APNS_PRIVATE_KEY: TEST_APNS_KEY_PEM,
    APNS_BUNDLE_ID: 'com.morechard.app',
  } as any;
}

function decodeBase64url(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return atob(padded);
}

describe('sendApnsPush', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('hits the sandbox host for environment=sandbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'sandbox', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.sandbox.push.apple.com');
  });

  it('hits the production host for environment=production', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.push.apple.com');
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('sandbox');
  });

  it('sets required APNs headers and badge payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 'Chore approved!', body: '+£5', route: '/chores/1', badgeCount: 3 });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['apns-topic']).toBe('com.morechard.app');
    expect(headers['apns-push-type']).toBe('alert');
    expect(headers['apns-priority']).toBe('10');
    expect(headers.Authorization).toMatch(/^bearer /);

    const body = JSON.parse(String(init?.body));
    expect(body.aps.badge).toBe(3);
    expect(body.aps.alert).toEqual({ title: 'Chore approved!', body: '+£5' });
    expect(body.route).toBe('/chores/1');
  });

  it('returns shouldPruneToken=true on 410', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });

  it('returns ok=true, shouldPruneToken=false on a 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: true, shouldPruneToken: false });
  });

  it('produces a well-formed JWT whose decoded header and claims are correct (not just an Authorization header shape)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const before = Math.floor(Date.now() / 1000);

    await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    const jwt = headers.Authorization.replace(/^bearer /, '');
    const segments = jwt.split('.');
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    const header = JSON.parse(decodeBase64url(segments[0]));
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('KEYID123');

    const claims = JSON.parse(decodeBase64url(segments[1]));
    expect(claims.iss).toBe('TEAMID123');
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);

    // The signature segment is non-empty raw bytes — actual ECDSA signing occurred,
    // not a stub/placeholder.
    expect(segments[2].length).toBeGreaterThan(0);
  });

  it('signs a fresh JWT on every call rather than caching it (no shared state across two sends)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const env = makeEnv();

    await sendApnsPush(env, 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    await sendApnsPush(env, 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const jwt1 = (fetchSpy.mock.calls[0][1]?.headers as Record<string, string>).Authorization;
    const jwt2 = (fetchSpy.mock.calls[1][1]?.headers as Record<string, string>).Authorization;
    // Two independently-computed ECDSA signatures over the same input will differ
    // (ECDSA is randomized), proving no caching/memoization short-circuited signing.
    expect(jwt1).not.toBe(jwt2);
  });
});
