import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { registerDeviceToken, safeSetBadge } from '../lib/push.js';

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

    // Cold-start capture: if the app was launched by tapping a push (not
    // just backgrounded), the tap event can fire before this listener
    // attached. Check for a delivered/launch notification explicitly.
    PushNotifications.getDeliveredNotifications().then(({ notifications }) => {
      const launchRoute = notifications[0]?.data?.route;
      if (typeof launchRoute === 'string' && launchRoute.startsWith('/')) navigate(launchRoute);
    }).catch(() => {});

    return () => { handles.forEach(h => h.remove().catch(() => {})); };
  }, [navigate]);

  return null;
}
