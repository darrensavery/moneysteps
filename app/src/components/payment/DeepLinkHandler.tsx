import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

type Status = 'pending' | 'opened' | 'fallback';

type Props = {
  url: string;
  onOpened: () => void;    // fired when we're confident the deep link resolved
  onFallback: () => void;  // fired when it didn't (show Smart Copy with apology)
};

// Best-effort detection of whether a custom-scheme or https deep link
// actually opened an external app.
// - Capacitor native: window.open(url, '_system') hands the URI to the OS;
//   we then rely on visibilitychange — if the page hides, the OS switched apps.
// - PWA: same visibilitychange sentinel. If the page never hides within ~1.5s,
//   the scheme didn't resolve and we fall back to Smart Copy.
export function DeepLinkHandler({ url, onOpened, onFallback }: Props) {
  // Preserved intentionally: status is unused now but reserved for future
  // extensions that may surface it (e.g. loading spinners, analytics).
  const [_status, setStatus] = useState<Status>('pending');
  const firedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pageHidden = false;

    function onVisibility() {
      if (document.hidden) pageHidden = true;
    }
    document.addEventListener('visibilitychange', onVisibility);

    (async () => {
      if (Capacitor.isNativePlatform()) {
        // On Capacitor native, window.open(url, '_system') instructs the OS
        // to handle the URI externally (opens the target app if installed).
        window.open(url, '_system');

        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        fire(pageHidden ? 'opened' : 'fallback');
        return;
      }

      // Web/PWA path.
      window.location.href = url;

      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;
      fire(pageHidden ? 'opened' : 'fallback');
    })();

    function fire(s: Status) {
      if (firedRef.current) return;
      firedRef.current = true;
      setStatus(s);
      if (s === 'opened') onOpened();
      else onFallback();
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, onOpened, onFallback]);

  // Invisible — parent component owns the UI.
  return null;
}
