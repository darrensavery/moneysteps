declare global {
  interface Window {
    fdWidget?: {
      init: (config: { token: string; host: string; widgetId: string }) => void
      open:  () => void
      hide:  () => void
      show:  () => void
    }
  }
}

export function FreshdeskWidget() {
  return null
}
