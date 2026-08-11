import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capawesome/capacitor-badge', () => ({
  Badge: { isSupported: vi.fn(), set: vi.fn() },
}));

vi.mock('./api.js', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
  authHeaders: vi.fn().mockResolvedValue({}),
}));

import { Badge } from '@capawesome/capacitor-badge';
import {
  safeSetBadge, hasPromptedForPushPermission, markPromptedForPushPermission,
  registerDeviceToken, unregisterDeviceTokenOnLogout,
} from './push.js';

describe('safeSetBadge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets the badge when supported', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: true });
    await safeSetBadge(3);
    expect(Badge.set).toHaveBeenCalledWith({ count: 3 });
  });

  it('skips setting when unsupported', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: false });
    await safeSetBadge(3);
    expect(Badge.set).not.toHaveBeenCalled();
  });

  it('swallows a thrown error from the badge plugin', async () => {
    (Badge.isSupported as any).mockResolvedValue({ isSupported: true });
    (Badge.set as any).mockRejectedValue(new Error('launcher rejected badge API'));
    await expect(safeSetBadge(3)).resolves.toBeUndefined();
  });
});

describe('push permission prompt tracking', () => {
  beforeEach(() => { localStorage.clear(); });

  it('is false until marked', () => {
    expect(hasPromptedForPushPermission()).toBe(false);
    markPromptedForPushPermission();
    expect(hasPromptedForPushPermission()).toBe(true);
  });
});

describe('unregisterDeviceTokenOnLogout', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('no-ops when no token was ever registered on this device', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(unregisterDeviceTokenOnLogout()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('unregisters the last successfully-registered token and clears it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await registerDeviceToken('tok-abc', 'ios');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/push/register');

    await unregisterDeviceTokenOnLogout();

    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('/api/push/unregister');
    expect(JSON.parse(String(init?.body))).toEqual({ token: 'tok-abc' });

    // Cleared — a second logout must not re-send.
    fetchSpy.mockClear();
    await unregisterDeviceTokenOnLogout();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not remember the token when registration failed server-side', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    await registerDeviceToken('tok-bad', 'android');
    fetchSpy.mockClear();
    await unregisterDeviceTokenOnLogout();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws when the unregister request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await registerDeviceToken('tok-xyz', 'ios');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(unregisterDeviceTokenOnLogout()).resolves.toBeUndefined();
  });
});
