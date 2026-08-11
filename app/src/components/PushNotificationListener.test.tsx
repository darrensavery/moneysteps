import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
const { addListenerMock } = vi.hoisted(() => ({
  addListenerMock: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: addListenerMock,
    getDeliveredNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
  },
}));
vi.mock('../lib/push.js', () => ({
  registerDeviceToken: vi.fn().mockResolvedValue(undefined),
  safeSetBadge: vi.fn().mockResolvedValue(undefined),
}));

import { PushNotificationListener } from './PushNotificationListener.js';

describe('PushNotificationListener', () => {
  beforeEach(() => { addListenerMock.mockClear(); });

  it('registers all four expected native listeners on mount', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    const registeredEvents = addListenerMock.mock.calls.map(call => call[0]);
    expect(registeredEvents).toEqual(
      expect.arrayContaining(['registration', 'pushNotificationReceived', 'pushNotificationActionPerformed']),
    );
  });
});
