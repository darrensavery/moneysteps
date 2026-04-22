import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Fire a short haptic tick. Best-effort, no-throw.
// Order: Capacitor native → navigator.vibrate → silent (visual-only fallback
// is the caller's responsibility — e.g., the checkmark animation).
// Android Chrome requires a user gesture; call this from the click handler,
// not from an async .then() after a network round-trip.
export async function tick(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    }
  } catch {
    // fall through
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(10); } catch { /* ignore */ }
  }
}
