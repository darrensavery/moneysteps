import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { PushNotifications, type ActionPerformed, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { registerDeviceToken, safeSetBadge, fetchCurrentPendingCount } from '../lib/push.js';

function platformOf(): 'ios' | 'android' {
  return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
}

export function PushNotificationListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handles: Array<{ remove: () => Promise<void> }> = [];

    PushNotifications.addListener('registration', (token: Token) => {
      registerDeviceToken(token.value, platformOf()).catch(() => {});
    }).then(h => handles.push(h));

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      // Foreground: suppress the native banner (already the default for a
      // received-while-open event on both platforms), just refresh the badge.
      const pendingCount = Number(notification.data?.pendingCount ?? 0);
      if (!Number.isNaN(pendingCount)) safeSetBadge(pendingCount).catch(() => {});
    }).then(h => handles.push(h));

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const route = action.notification.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) navigate(route);
    }).then(h => handles.push(h));

    // Cold start is covered by `pushNotificationActionPerformed` above: on both
    // iOS and Android, Capacitor replays the launch-tap event to the listener
    // once it attaches, so a tap that started the app arrives there too. We
    // deliberately do NOT inspect getDeliveredNotifications() — that returns
    // the whole notification tray, not the one that launched the app, so a
    // normal launch with old undismissed notifications sitting in the tray
    // would incorrectly redirect the user.

    // Re-register the device token on every launch and resume when permission
    // is already granted. requestPushPermission() is gated behind a one-time
    // localStorage prompt flag, so without this, register() would never run
    // again after the first grant — leaving a stale/missing token after token
    // rotation, a reinstall, or a second account signing in on this device.
    // register() is idempotent (the server upserts on token), so calling it
    // repeatedly is safe.
    const reRegisterIfGranted = (): void => {
      PushNotifications.checkPermissions()
        .then(status => { if (status.receive === 'granted') return PushNotifications.register(); })
        .catch(() => {});
    };
    reRegisterIfGranted();

    // Badge self-heal: on every foreground resume, re-fetch the real pending
    // count from the server and reconcile the badge. Covers the case where a
    // push was dropped/coalesced by the OS while backgrounded and the badge
    // drifted from reality (e.g. a completion was approved from the parent's
    // side while this device was asleep).
    CapacitorApp.addListener('resume', () => {
      reRegisterIfGranted();
      fetchCurrentPendingCount().then(safeSetBadge).catch(() => {});
    }).then(h => handles.push(h));

    return () => { handles.forEach(h => h.remove().catch(() => {})); };
  }, [navigate]);

  return null;
}
