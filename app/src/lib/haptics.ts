import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// Tiered haptic feedback. All best-effort, no-throw.
// Order: Capacitor native → navigator.vibrate fallback pattern → silent
// (visual-only fallback is the caller's responsibility — e.g. confetti).
// Android Chrome requires a user gesture; call these from the click handler,
// not from an async .then() after a network round-trip.
//
// Calls fired automatically right after app boot (e.g. a celebration for a
// milestone reached while the app was closed) can race the native plugin
// bridge, which isn't guaranteed to have finished registering by the time
// that first effect runs — Haptics.impact/notification throws in that
// window, and since navigator.vibrate is a no-op on native WebViews, the
// old catch-and-fall-through silently dropped the haptic with no retry.
// That race is what made haptics on app open intermittent: whichever side
// of the bridge-ready race a given cold start landed on decided whether
// the tap was felt. One short retry covers the transient case without
// masking a genuinely unavailable plugin (which fails the retry too and
// falls through as before).
const BRIDGE_RETRY_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function impact(style: ImpactStyle, vibrateMs: number): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.impact({ style });
      return;
    } catch {
      // possibly the plugin bridge wasn't ready yet — retry once
    }
    try {
      await delay(BRIDGE_RETRY_DELAY_MS);
      await Haptics.impact({ style });
      return;
    } catch {
      // fall through to vibrate (inert on native, but nothing left to try)
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(vibrateMs); } catch { /* ignore */ }
  }
}

async function notification(type: NotificationType, pattern: number[]): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.notification({ type });
      return;
    } catch {
      // possibly the plugin bridge wasn't ready yet — retry once
    }
    try {
      await delay(BRIDGE_RETRY_DELAY_MS);
      await Haptics.notification({ type });
      return;
    } catch {
      // fall through to vibrate (inert on native, but nothing left to try)
    }
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
