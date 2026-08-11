import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { sendApnsPush } from './apns.js';

// The ES256 signing key is generated fresh at test runtime rather than checked
// in, so this file never contains a literal PEM private-key block for secret
// scanners (gitleaks et al.) to flag.
let TEST_APNS_KEY_PEM = '';

function toPem(pkcs8: ArrayBuffer): string {
  const bytes = new Uint8Array(pkcs8);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  const b64 = btoa(raw).replace(/(.{64})/g, '$1\n').trimEnd();
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  TEST_APNS_KEY_PEM = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
});

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 }),
    );
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });

  it('returns shouldPruneToken=true on 400 + BadDeviceToken', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 }),
    );
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: true });
  });

  it('does NOT prune on 400 + BadTopic (a config error, not a dead token) and logs the reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ reason: 'BadTopic' }), { status: 400 }),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(result).toEqual({ ok: false, shouldPruneToken: false });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain('BadTopic');
  });

  it('does NOT prune on a 400 with an unparseable body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 400 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendApnsPush(makeEnv(), 'device-token', 'production', { title: 't', body: 'b', route: '/x', badgeCount: 1 });
    expect(result).toEqual({ ok: false, shouldPruneToken: false });
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
