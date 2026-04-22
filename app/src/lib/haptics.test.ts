import { describe, expect, test, vi, beforeEach } from 'vitest';

// Hoisted mocks for Capacitor — vi.mock is hoisted above imports
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT' },
}));

import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';
import { tick } from './haptics';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('haptics.tick', () => {
  test('uses Capacitor Haptics on native', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await tick();
    expect(Haptics.impact).toHaveBeenCalledOnce();
  });

  test('falls back to navigator.vibrate on web when available', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const vibrate = vi.fn();
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: vibrate, configurable: true,
    });
    await tick();
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(Haptics.impact).not.toHaveBeenCalled();
  });

  test('does not throw when nothing is available', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: undefined, configurable: true,
    });
    await expect(tick()).resolves.toBeUndefined();
  });
});
