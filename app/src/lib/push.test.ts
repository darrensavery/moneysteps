import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capawesome/capacitor-badge', () => ({
  Badge: { isSupported: vi.fn(), set: vi.fn() },
}));

import { Badge } from '@capawesome/capacitor-badge';
import { safeSetBadge, hasPromptedForPushPermission, markPromptedForPushPermission } from './push.js';

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
