import { describe, expect, test, vi, beforeEach } from 'vitest';

// Hoisted mocks for Capacitor — vi.mock is hoisted above imports
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';
import { tick, confirm, warn, celebrate } from './haptics';

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

describe('haptics.confirm', () => {
  test('uses a medium impact on native', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await confirm();
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });
});

describe('haptics.warn', () => {
  test('uses a warning notification on native', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await warn();
    expect(Haptics.notification).toHaveBeenCalledWith({ type: 'WARNING' });
  });

  test('falls back to a vibrate pattern on web', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const vibrate = vi.fn();
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: vibrate, configurable: true,
    });
    await warn();
    expect(vibrate).toHaveBeenCalledWith([15, 60, 15]);
  });
});

describe('haptics.celebrate', () => {
  test('standard tier fires one success notification, no follow-up impact', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await celebrate('standard');
    expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(Haptics.impact).not.toHaveBeenCalled();
  });

  test('landmark tier fires a success notification then a follow-up medium impact', async () => {
    (Capacitor.isNativePlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await celebrate('landmark');
    expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });
});
