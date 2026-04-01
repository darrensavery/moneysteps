/**
 * Cloudflare Pages Function: POST /api/send-push
 * Web push relay — replaces the Netlify function.
 */

export async function onRequestPost({ request, env }) {
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
    const response = await sendWebPush({ subscription, payload, publicKey, privateKey, email });
    if (response.status === 410) return new Response('Subscription expired', { status: 410 });
    return new Response('OK', { status: 200 });
  } catch (err) {
    return new Response('Failed to send: ' + err.message, { status: 500 });
  }
}

async function sendWebPush({ subscription, payload, publicKey, privateKey, email }) {
  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  const vapidHeaders = await buildVapidHeaders({ endpoint, publicKey, privateKey, email });
  const encrypted = await encryptPayload(payload, p256dh, auth);

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: encrypted,
  });
}

async function buildVapidHeaders({ endpoint, publicKey, privateKey, email }) {
  const origin = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claim = btoa(JSON.stringify({ aud: origin, exp: expiration, sub: 'mailto:' + email }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = header + '.' + claim;

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

  return { Authorization: `vapid t=${signingInput}.${sig}, k=${publicKey}` };
}

async function encryptPayload(payload, p256dhBase64, authBase64) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const p256dh = base64urlDecode(p256dhBase64);
  const auth   = base64urlDecode(authBase64);

  const recipientKey = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );

  const senderPublicKeyRaw = await crypto.subtle.exportKey('raw', senderKeyPair.publicKey);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey }, senderKeyPair.privateKey, 256
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hkdf(auth, sharedBits, concat(
    new TextEncoder().encode('WebPush: info\0'),
    p256dh, new Uint8Array(senderPublicKeyRaw)
  ), 32);

  const cek   = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cekKey,
    concat(payloadBytes, new Uint8Array([2]))
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  return concat(salt, rs, new Uint8Array([65]), new Uint8Array(senderPublicKeyRaw), new Uint8Array(ciphertext));
}

async function hkdf(salt, ikm, info, length) {
  const saltArr = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
  const ikmArr  = ikm  instanceof Uint8Array ? ikm  : new Uint8Array(ikm);

  const hmacKey = await crypto.subtle.importKey(
    'raw', saltArr, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prk = await crypto.subtle.sign('HMAC', hmacKey, ikmArr);

  const expandKey = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const t = await crypto.subtle.sign('HMAC', expandKey, concat(info, new Uint8Array([1])));
  return new Uint8Array(t).slice(0, length);
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + (a.byteLength ?? a.length), 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    const arr = a instanceof Uint8Array ? a : new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer);
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4);
  return new Uint8Array([...atob(padded)].map(c => c.charCodeAt(0)));
}
