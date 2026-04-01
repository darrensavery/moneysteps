/**
 * MoneySteps Cloudflare Worker
 * - POST /api/send-push  — web push relay (replaces Netlify function)
 * - Everything else      — served from ./dist via ASSETS binding
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/send-push') {
      return handleSendPush(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleSendPush(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const publicKey  = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const email      = env.CONTACT_EMAIL || 'admin@pocketmoney.app';

  if (!publicKey || !privateKey) {
    return new Response('Server misconfigured: VAPID keys not set', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { subscription, payload } = body;
  if (!subscription || !payload) {
    return new Response('Missing subscription or payload', { status: 400 });
  }

  try {
    const result = await sendWebPush({ subscription, payload, publicKey, privateKey, email });
    return new Response('OK', { status: result.status === 410 ? 410 : 200 });
  } catch (err) {
    return new Response('Failed to send: ' + err.message, { status: 500 });
  }
}

/**
 * Minimal VAPID web push using the Web Crypto API (no npm deps needed in Workers).
 */
async function sendWebPush({ subscription, payload, publicKey, privateKey, email }) {
  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  // Build VAPID JWT
  const vapidHeaders = await buildVapidHeaders({ endpoint, publicKey, privateKey, email });

  // Encrypt the payload
  const encrypted = await encryptPayload(payload, p256dh, auth);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: encrypted,
  });

  return response;
}

async function buildVapidHeaders({ endpoint, publicKey, privateKey, email }) {
  const origin = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = btoa(JSON.stringify({ aud: origin, exp: expiration, sub: 'mailto:' + email }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = header + '.' + payload;

  // Import private key
  const privateKeyBytes = base64urlDecode(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const token = signingInput + '.' + sig;

  return {
    Authorization: `vapid t=${token}, k=${publicKey}`,
  };
}

async function encryptPayload(payload, p256dhBase64, authBase64) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const p256dh = base64urlDecode(p256dhBase64);
  const auth   = base64urlDecode(authBase64);

  // Recipient public key
  const recipientKey = await crypto.subtle.importKey(
    'raw', p256dh,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // Generate sender key pair
  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveKey', 'deriveBits']
  );

  const senderPublicKeyRaw = await crypto.subtle.exportKey('raw', senderKeyPair.publicKey);

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey },
    senderKeyPair.privateKey, 256
  );

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF to derive content encryption key + nonce
  const prk = await hkdf(auth, sharedBits, concat(
    new TextEncoder().encode('WebPush: info\0'),
    p256dh,
    new Uint8Array(senderPublicKeyRaw)
  ), 32);

  const cek   = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cekKey,
    concat(payloadBytes, new Uint8Array([2])) // padding delimiter
  );

  // aes128gcm record: salt(16) + rs(4) + keyid_len(1) + sender_pub(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  return concat(salt, rs, new Uint8Array([65]), new Uint8Array(senderPublicKeyRaw), new Uint8Array(ciphertext));
}

async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt instanceof ArrayBuffer ? salt : salt.buffer, 'HKDF', false, ['deriveBits']);
  // extract
  const prk = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey(
    'raw', salt instanceof Uint8Array ? salt : new Uint8Array(salt),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  ), ikm instanceof ArrayBuffer ? ikm : ikm.buffer || ikm);
  // expand
  const expandKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = await crypto.subtle.sign('HMAC', expandKey, concat(info, new Uint8Array([1])));
  return new Uint8Array(t).slice(0, length);
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer || a), offset);
    offset += a.byteLength;
  }
  return out;
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}
