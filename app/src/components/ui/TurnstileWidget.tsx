import { useEffect, useRef, useState } from 'react'

/**
 * Cloudflare Turnstile bot-challenge widget. Renders nothing (and never
 * loads the Turnstile script) when `VITE_TURNSTILE_SITE_KEY` isn't set —
 * mirrors the server's soft-no-op in worker/src/lib/turnstile.ts, so this
 * ships safely before a Turnstile site exists in the Cloudflare dashboard.
 *
 * Usage: render inside a form, read the token from `onVerify`, and include
 * it as `turnstile_token` in the request body. If the site key isn't
 * configured, `onVerify` is never called — calling code should already
 * treat a missing/undefined token as fine (the server no-ops too).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'error-callback'?: () => void;
        theme?: 'light' | 'dark' | 'auto';
      }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

type Props = {
  onVerify: (token: string) => void;
};

export function TurnstileWidget({ onVerify }: Props) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          'error-callback': () => setError(true),
        });
      })
      .catch(() => setError(true));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerify identity churn shouldn't re-mount the widget
  }, [siteKey]);

  if (!siteKey) return null; // not configured — no-op, matches the server

  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={containerRef} />
      {error && (
        <p className="text-[0.6875rem] text-red-500">Verification failed to load — please refresh.</p>
      )}
    </div>
  );
}
