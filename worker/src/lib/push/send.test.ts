import { describe, it, expect, vi } from 'vitest';
import { sendPushNotification } from './send.js';
import * as tokens from './tokens.js';
import * as fcm from './fcm.js';
import * as apns from './apns.js';

describe('sendPushNotification', () => {
  it('fans out to all of a user\'s devices concurrently', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'ios-tok', user_id: 'u1', platform: 'ios', environment: 'production' },
      { token: 'android-tok', user_id: 'u1', platform: 'android', environment: 'production' },
    ]);
    const fcmSpy = vi.spyOn(fcm, 'sendFcmPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const apnsSpy = vi.spyOn(apns, 'sendApnsPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const deleteSpy = vi.spyOn(tokens, 'deleteDeviceToken').mockResolvedValue(undefined);

    await sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(fcmSpy).toHaveBeenCalledWith(expect.anything(), 'android-tok', expect.objectContaining({ title: 't' }));
    expect(apnsSpy).toHaveBeenCalledWith(expect.anything(), 'ios-tok', 'production', expect.objectContaining({ title: 't' }));
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('prunes a token flagged shouldPruneToken, and does not let one failure block the other device', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'dead-ios', user_id: 'u1', platform: 'ios', environment: 'production' },
      { token: 'live-android', user_id: 'u1', platform: 'android', environment: 'production' },
    ]);
    vi.spyOn(apns, 'sendApnsPush').mockResolvedValue({ ok: false, shouldPruneToken: true });
    vi.spyOn(fcm, 'sendFcmPush').mockResolvedValue({ ok: true, shouldPruneToken: false });
    const deleteSpy = vi.spyOn(tokens, 'deleteDeviceToken').mockResolvedValue(undefined);

    await sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 });

    expect(deleteSpy).toHaveBeenCalledWith(expect.anything(), 'dead-ios', 'u1');
    expect(deleteSpy).not.toHaveBeenCalledWith(expect.anything(), 'live-android', 'u1');
  });

  it('never throws, even if a send rejects outright', async () => {
    vi.spyOn(tokens, 'getDeviceTokensForUser').mockResolvedValue([
      { token: 'ios-tok', user_id: 'u1', platform: 'ios', environment: 'production' },
    ]);
    vi.spyOn(apns, 'sendApnsPush').mockRejectedValue(new Error('network error'));

    await expect(
      sendPushNotification({ DB: {} } as any, 'u1', { title: 't', body: 'b', route: '/x', badgeCount: 1 }),
    ).resolves.toBeUndefined();
  });
});
