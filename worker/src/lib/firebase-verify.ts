/**
 * Firebase ID Token verifier — Cloudflare Workers compatible.
 *
 * Uses crypto.subtle (Web Crypto) only. No Firebase Admin SDK.
 *
 * Key source: https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 * Keys rotate roughly every 6 hours. We cache them in-memory with a TTL derived
 * from the Cache-Control max-age header so we never use stale keys.
 *
 * Token validation follows Firebase's documented requirements:
 *   https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */

export interface FirebaseClaims {
  uid:   string;   // Firebase UID (= sub claim)
  email: string | undefined;
  email_verified: boolean;
  name:  string | undefined;
}

// ── In-memory key cache ────────────────────────────────────────────────────
interface CachedKeys {
  keys:      Record<string, CryptoKey>; // kid → CryptoKey
  expiresAt: number;                    // ms since epoch
}

let keyCache: CachedKeys | null = null;

const GOOGLE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

async function getPublicKeys(): Promise<Record<string, CryptoKey>> {
  const now = Date.now();
  if (keyCache && keyCache.expiresAt > now) return keyCache.keys;

  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google public keys: ${res.status}`);

  // Parse Cache-Control max-age to set TTL
  let ttlMs = 3600 * 1000; // default 1h if header missing
  const cc = res.headers.get('Cache-Control');
  if (cc) {
    const match = cc.match(/max-age=(\d+)/);
    if (match) ttlMs = parseInt(match[1], 10) * 1000;
  }

  const json = await res.json() as { keys: JsonWebKey[] };
  const keys: Record<string, CryptoKey> = {};

  await Promise.all(
    json.keys.map(async (jwk) => {
      const kid = (jwk as unknown as Record<string, unknown>).kid as string | undefined;
      if (!kid) return;
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys[kid] = key;
    }),
  );

  keyCache = { keys, expiresAt: now + ttlMs };
  return keys;
}

// ── JWT helpers ────────────────────────────────────────────────────────────

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function parseJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
}

// ── Public verifier ────────────────────────────────────────────────────────

/**
 * Verifies a Firebase ID token and returns the decoded claims.
 * Throws a descriptive Error on any failure — caller should return 401.
 */
export async function verifyFirebaseToken(
  idToken: string,
  projectId: string,
): Promise<FirebaseClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [rawHeader, rawPayload, rawSig] = parts;

  const header  = parseJwtPart(rawHeader)  as { alg?: string; kid?: string };
  const payload = parseJwtPart(rawPayload) as {
    iss?: string; aud?: string; sub?: string;
    iat?: number; exp?: number; auth_time?: number;
    email?: string; email_verified?: boolean; name?: string;
  };

  // 1. Algorithm must be RS256
  if (header.alg !== 'RS256') throw new Error('Invalid algorithm');
  if (!header.kid)             throw new Error('Missing kid');

  // 2. Expiry
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now)  throw new Error('Token expired');
  if (!payload.iat || payload.iat > now)  throw new Error('Token issued in the future');

  // 3. Audience = Firebase project ID
  if (payload.aud !== projectId) throw new Error('Invalid audience');

  // 4. Issuer
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) throw new Error('Invalid issuer');

  // 5. Subject (uid) must be non-empty string
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Missing subject');

  // 6. auth_time must be in the past
  if (!payload.auth_time || payload.auth_time > now) throw new Error('Invalid auth_time');

  // 7. Signature verification
  const keys = await getPublicKeys();
  const key  = keys[header.kid];
  if (!key) throw new Error(`Unknown kid: ${header.kid}`);

  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signature    = b64urlDecode(rawSig);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    signingInput,
  );
  if (!valid) throw new Error('Invalid signature');

  return {
    uid:            payload.sub,
    email:          payload.email,
    email_verified: payload.email_verified ?? false,
    name:           payload.name,
  };
}