import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { apiUrl, authHeaders } from './api.js';

const PROMPT_FLAG_KEY = 'mc_push_permission_prompted';

export function hasPromptedForPushPermission(): boolean {
  return localStorage.getItem(PROMPT_FLAG_KEY) === '1';
}

export function markPromptedForPushPermission(): void {
  localStorage.setItem(PROMPT_FLAG_KEY, '1');
}

export async function safeSetBadge(count: number): Promise<void> {
  try {
    const { isSupported } = await Badge.isSupported();
    if (isSupported) await Badge.set({ count });
  } catch (err) {
    console.warn('[push] badge not supported on this device:', err);
  }
}

export async function registerDeviceToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  // TODO: Capacitor has no JS-accessible signal for which provisioning profile
  // (Development vs Distribution) signed the running native binary — this reflects
  // the Vite web build mode instead, which is only a proxy and can be wrong for a
  // Capacitor-wrapped native build (e.g. a `vite build` in PROD mode bundled into a
  // TestFlight archive is genuinely 'production', but a `vite build` in PROD mode
  // installed via a local Xcode debug run is not). Verify during the real-device
  // verification pass (design doc Section 5) that TestFlight/App Store builds
  // actually register as 'production' — not just that local dev builds don't.
  const environment = import.meta.env.PROD ? 'production' : 'sandbox';
  await fetch(apiUrl('/api/push/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ token, platform, environment }),
  });
}

export async function requestPushPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const permStatus = await PushNotifications.checkPermissions();
  let granted = permStatus.receive === 'granted';

  if (!granted && permStatus.receive !== 'denied') {
    const requested = await PushNotifications.requestPermissions();
    granted = requested.receive === 'granted';
  }

  markPromptedForPushPermission();
  if (!granted) return false;

  await PushNotifications.register();
  return true;
}
