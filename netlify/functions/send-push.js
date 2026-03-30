const webpush = require('web-push');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Validate env vars are present
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email      = process.env.CONTACT_EMAIL || 'admin@pocketmoney.app';

  if (!publicKey || !privateKey) {
    console.error('Missing VAPID environment variables');
    return { statusCode: 500, body: 'Server misconfigured: VAPID keys not set in Netlify environment variables' };
  }

  // Set VAPID details inside the handler so missing env vars don't crash on startup
  try {
    webpush.setVapidDetails('mailto:' + email, publicKey, privateKey);
  } catch (e) {
    console.error('VAPID setup error:', e.message);
    return { statusCode: 500, body: 'VAPID setup failed: ' + e.message };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { subscription, payload } = body;
  if (!subscription || !payload) {
    return { statusCode: 400, body: 'Missing subscription or payload' };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    if (err.statusCode === 410) {
      return { statusCode: 410, body: 'Subscription expired' };
    }
    console.error('Push send error:', err.message);
    return { statusCode: 500, body: 'Failed to send: ' + err.message };
  }
};
