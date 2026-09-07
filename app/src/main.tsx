// Polyfill Array.prototype.at for older browsers (required by web-vitals v5 via @sentry/react)
if (!Array.prototype.at) {
  Array.prototype.at = function (index: number) {
    const i = index < 0 ? this.length + index : index
    return this[i]
  }
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAnalytics } from './lib/analytics'
import './index.css'
import App from './App.tsx'

initAnalytics()

// Render the app immediately — no blocking on Sentry
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Prefetch the two most likely first-render route chunks so the Suspense
// boundary resolves instantly for both new users (LandingGate) and returning
// users (LockScreen).
const prefetchRoutes = () => {
  import('./screens/LandingGate')
  import('./screens/LockScreen')
}
if ('requestIdleCallback' in window) {
  (window as Window & typeof globalThis & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(prefetchRoutes)
} else {
  setTimeout(prefetchRoutes, 100)
}

// Defer Sentry until the browser is idle so it does not block first paint.
// Errors that occur before the idle callback (~100–200 ms after first render)
// won't be captured, which is an acceptable trade-off.
if (import.meta.env.PROD) {
  const initSentry = async () => {
    const [Sentry, { replayAllowed }] = await Promise.all([
      import('@sentry/react'),
      import('./lib/analytics'),
    ])
    const allowReplay = replayAllowed()
    const SENSITIVE_FIELDS = new Set(['password', 'pin', 'token', 'secret', 'authorization', 'jwt', 'api_key', 'apikey'])
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN ?? '',
      environment: import.meta.env.MODE,
      enabled: true,
      tracesSampleRate: 0.2,
      replaysOnErrorSampleRate: allowReplay ? 1.0 : 0,
      integrations: [
        Sentry.browserTracingIntegration(),
        ...(allowReplay ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })] : []),
      ],
      // The browser's own wording for "the request never reached the network"
      // (offline, flaky mobile signal, a request aborted by navigation) —
      // a client network condition, not an app defect, on every browser engine.
      ignoreErrors: [
        'Failed to fetch',                             // Chromium
        'NetworkError when attempting to fetch resource', // Firefox
        'Load failed',                                  // Safari/WebKit
      ],
      beforeSend(event) {
        if (event.extra) {
          for (const key of Object.keys(event.extra)) {
            if (SENSITIVE_FIELDS.has(key.toLowerCase())) delete event.extra[key]
          }
        }
        return event
      },
    })
  }

  if ('requestIdleCallback' in window) {
    (window as Window & typeof globalThis & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(initSentry)
  } else {
    setTimeout(initSentry, 200)
  }
}
