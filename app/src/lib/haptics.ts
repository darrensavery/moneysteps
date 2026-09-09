import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// Tiered haptic feedback. All best-effort, no-throw.
// Order: Capacitor native → navigator.vibrate fallback pattern → silent
// (visual-only fallback is the caller's responsibility — e.g. confetti).
// Android Chrome requires a user gesture; call these from the click handler,
// not from an async .then() after a network round-trip.

async function impact(style: ImpactStyle, vibrateMs: number): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style });
      return;
    }
  } catch {
    // fall through
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(vibrateMs); } catch { /* ignore */ }
  }
}

async function notification(type: NotificationType, pattern: number[]): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.notification({ type });
      return;
    }
  } catch {
    // fall through
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

// Selection / nav change — the lightest tier. Used for tab and picker taps.
export async function tick(): Promise<void> {
  await impact(ImpactStyle.Light, 10);
}

// Deliberate confirmation — approving a chore, confirming a purchase.
export async function confirm(): Promise<void> {
  await impact(ImpactStyle.Medium, 20);
}

// Something went wrong or needs attention — redo requested, payment failed,
// streak lost.
export async function warn(): Promise<void> {
  await notification(NotificationType.Warning, [15, 60, 15]);
}

// Celebration — driven by the same 'standard'/'landmark' tier already used
// by the celebration overlay config (components/celebration/types.ts), so
// callers should pass the milestone's own tier rather than picking one.
export async function celebrate(tier: 'standard' | 'landmark'): Promise<void> {
  await notification(NotificationType.Success, [10, 40, 20]);
  if (tier === 'landmark') {
    await new Promise(resolve => setTimeout(resolve, 120));
    await impact(ImpactStyle.Medium, 25);
  }
}
