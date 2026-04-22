import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

// Copy text to the system clipboard.
// Capacitor native → navigator.clipboard → textarea execCommand fallback.
// Returns true on success so the caller can swap the icon to a checkmark.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Clipboard.write({ string: text });
      return true;
    }
  } catch {
    // fall through to web
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  // Last-ditch fallback for non-HTTPS LAN dev.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
