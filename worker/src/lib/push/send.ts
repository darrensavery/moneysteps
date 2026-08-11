import type { Env } from '../../types.js';
import { getDeviceTokensForUser, deleteDeviceToken, type DeviceToken } from './tokens.js';
import { sendFcmPush } from './fcm.js';
import { sendApnsPush } from './apns.js';

async function sendToDevice(
  env: Env,
  device: DeviceToken,
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<void> {
  const result =
    device.platform === 'android'
      ? await sendFcmPush(env, device.token, { ...payload, pendingCount: payload.badgeCount })
      : await sendApnsPush(env, device.token, device.environment, payload);

  if (result.shouldPruneToken) {
    await deleteDeviceToken(env.DB, device.token, device.user_id);
  }
}

/** Fire-and-forget push send to every device a user is registered on.
 * Never throws — callers wrap this in ctx.waitUntil() and it must not be
 * able to surface a rejection back into the triggering API response. */
export async function sendPushNotification(
  env: Env,
  userId: string,
  payload: { title: string; body: string; route: string; badgeCount: number },
): Promise<void> {
  try {
    const devices = await getDeviceTokensForUser(env.DB, userId);
    await Promise.allSettled(devices.map(device => sendToDevice(env, device, payload)));
  } catch (err) {
    console.error('[push] sendPushNotification failed:', err);
  }
}
