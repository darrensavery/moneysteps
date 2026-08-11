import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));

const { addListenerMock, getDeliveredNotificationsMock, checkPermissionsMock, registerMock } = vi.hoisted(() => ({
  addListenerMock: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
  getDeliveredNotificationsMock: vi.fn().mockResolvedValue({ notifications: [] }),
  checkPermissionsMock: vi.fn().mockResolvedValue({ receive: 'granted' }),
  registerMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: addListenerMock,
    getDeliveredNotifications: getDeliveredNotificationsMock,
    checkPermissions: checkPermissionsMock,
    register: registerMock,
  },
}));

const { appAddListenerMock } = vi.hoisted(() => ({
  appAddListenerMock: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: appAddListenerMock } }));

const { registerDeviceTokenMock, safeSetBadgeMock, fetchCurrentPendingCountMock } = vi.hoisted(() => ({
  registerDeviceTokenMock: vi.fn().mockResolvedValue(undefined),
  safeSetBadgeMock: vi.fn().mockResolvedValue(undefined),
  fetchCurrentPendingCountMock: vi.fn().mockResolvedValue(0),
}));
vi.mock('../lib/push.js', () => ({
  registerDeviceToken: registerDeviceTokenMock,
  safeSetBadge: safeSetBadgeMock,
  fetchCurrentPendingCount: fetchCurrentPendingCountMock,
}));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { PushNotificationListener } from './PushNotificationListener.js';

/** Finds the callback registered via `PushNotifications.addListener(eventName, callback)`. */
function callbackFor(eventName: string): (...args: unknown[]) => void {
  const call = addListenerMock.mock.calls.find(c => c[0] === eventName);
  if (!call) throw new Error(`No listener registered for "${eventName}"`);
  return call[1];
}

/** Finds the callback registered via `CapacitorApp.addListener(eventName, callback)`. */
function appCallbackFor(eventName: string): (...args: unknown[]) => void {
  const call = appAddListenerMock.mock.calls.find(c => c[0] === eventName);
  if (!call) throw new Error(`No app listener registered for "${eventName}"`);
  return call[1];
}

describe('PushNotificationListener', () => {
  beforeEach(() => {
    addListenerMock.mockClear();
    appAddListenerMock.mockClear();
    getDeliveredNotificationsMock.mockClear();
    getDeliveredNotificationsMock.mockResolvedValue({ notifications: [] });
    checkPermissionsMock.mockClear();
    checkPermissionsMock.mockResolvedValue({ receive: 'granted' });
    registerMock.mockClear();
    registerDeviceTokenMock.mockClear();
    safeSetBadgeMock.mockClear();
    fetchCurrentPendingCountMock.mockClear();
    fetchCurrentPendingCountMock.mockResolvedValue(0);
    navigateMock.mockClear();
  });

  it('registers all four expected native listeners on mount', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    const registeredEvents = addListenerMock.mock.calls.map(call => call[0]);
    expect(registeredEvents).toEqual(
      expect.arrayContaining(['registration', 'pushNotificationReceived', 'pushNotificationActionPerformed']),
    );
  });

  it('registers the device token with the platform when the registration callback fires', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    callbackFor('registration')({ value: 'fake-token-123' });
    expect(registerDeviceTokenMock).toHaveBeenCalledWith('fake-token-123', 'ios');
  });

  it('sets the badge to the numeric pendingCount when a notification is received in the foreground', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    callbackFor('pushNotificationReceived')({ data: { pendingCount: '3' } });
    expect(safeSetBadgeMock).toHaveBeenCalledWith(3);
  });

  it('does not set the badge when pendingCount is not a number', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    callbackFor('pushNotificationReceived')({ data: { pendingCount: 'not-a-number' } });
    expect(safeSetBadgeMock).not.toHaveBeenCalled();
  });

  it('navigates to the route when a notification tap is actioned', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    callbackFor('pushNotificationActionPerformed')({ notification: { data: { route: '/parent?tab=activity' } } });
    expect(navigateMock).toHaveBeenCalledWith('/parent?tab=activity');
  });

  it('does not navigate when the actioned route is malformed', () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    callbackFor('pushNotificationActionPerformed')({ notification: { data: { route: 'not-a-path' } } });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does NOT navigate just because undismissed notifications sit in the tray', async () => {
    // A normal (non-tap) launch with stale notifications still in the tray must
    // not redirect — cold-start taps arrive via pushNotificationActionPerformed.
    getDeliveredNotificationsMock.mockResolvedValue({ notifications: [{ data: { route: '/child?tab=goals' } }] });
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    await waitFor(() => expect(checkPermissionsMock).toHaveBeenCalled());
    expect(getDeliveredNotificationsMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('re-registers the device token on mount when permission is already granted', async () => {
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
  });

  it('does not re-register on mount when permission is not granted', async () => {
    checkPermissionsMock.mockResolvedValue({ receive: 'prompt' });
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    await waitFor(() => expect(checkPermissionsMock).toHaveBeenCalled());
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('registers an app resume listener that self-heals the badge and re-registers the token', async () => {
    fetchCurrentPendingCountMock.mockResolvedValue(4);
    render(<MemoryRouter><PushNotificationListener /></MemoryRouter>);
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1)); // mount call
    await appCallbackFor('resume')();
    expect(fetchCurrentPendingCountMock).toHaveBeenCalledTimes(1);
    expect(safeSetBadgeMock).toHaveBeenCalledWith(4);
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(2)); // + resume call
  });
});
