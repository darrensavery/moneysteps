import { useState, useCallback, useRef, useEffect } from 'react'
import { apiUrl, authHeaders } from '../lib/api'

type ExportKey = 'json-basic' | 'pdf-basic' | 'pdf-behavioral' | 'pdf-forensic' | 'prune'
type ExportState = 'idle' | 'generating' | 'success' | 'error'

interface UseExportManager {
  stateOf:      (key: ExportKey) => ExportState
  errorOf:      (key: ExportKey) => string | null
  triggerExport: (format: 'pdf' | 'json', tier: 'basic' | 'behavioral' | 'forensic') => Promise<void>
  triggerPrune:  () => Promise<void>
  prunedCount:   number | null
}

const SUCCESS_RESET_MS = 3_000
// allow browser to begin download before revoking
const REVOKE_URL_DELAY_MS = 100

export function useExportManager(familyId: string): UseExportManager {
  const [states, setStates] = useState<Map<ExportKey, ExportState>>(new Map())
  const [errors, setErrors] = useState<Map<ExportKey, string | null>>(new Map())
  const [prunedCount, setPrunedCount] = useState<number | null>(null)

  // Keep refs to active success-reset timers so we never leak them
  const resetTimers = useRef<Map<ExportKey, ReturnType<typeof setTimeout>>>(new Map())

  // Clear all pending reset timers on unmount
  useEffect(() => {
    return () => {
      resetTimers.current.forEach(id => clearTimeout(id))
      resetTimers.current.clear()
    }
  }, [])

  const getState = useCallback(
    (key: ExportKey): ExportState => states.get(key) ?? 'idle',
    [states],
  )

  const getError = useCallback(
    (key: ExportKey): string | null => errors.get(key) ?? null,
    [errors],
  )

  function setState(key: ExportKey, value: ExportState) {
    setStates(prev => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }

  function setError(key: ExportKey, message: string | null) {
    setErrors(prev => {
      const next = new Map(prev)
      next.set(key, message)
      return next
    })
  }

  const scheduleReset = useCallback((key: ExportKey) => {
    // Clear any existing reset timer for this key
    const existing = resetTimers.current.get(key)
    if (existing !== undefined) clearTimeout(existing)

    const id = setTimeout(() => {
      setStates(prev => {
        const next = new Map(prev)
        next.set(key, 'idle')
        return next
      })
      resetTimers.current.delete(key)
    }, SUCCESS_RESET_MS)

    resetTimers.current.set(key, id)
  }, [])

  const triggerExport = useCallback(
    async (format: 'pdf' | 'json', tier: 'basic' | 'behavioral' | 'forensic') => {
      const key = `${format}-${tier}` as ExportKey

      setState(key, 'generating')
      setError(key, null)

      try {
        const params = new URLSearchParams({ tier, family_id: familyId })
        const url = apiUrl(`/api/export/${format}`) + '?' + params.toString()

        const res = await fetch(url, { headers: authHeaders() })

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error ?? 'Export failed')
        }

        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)

        // Derive a sensible filename from Content-Disposition or fall back to a default
        const disposition = res.headers.get('Content-Disposition') ?? ''
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        const filename =
          match ? match[1].replace(/['"]/g, '') : `morechard-export-${tier}.${format}`

        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = filename
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)

        setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_URL_DELAY_MS)

        setState(key, 'success')
        scheduleReset(key)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed'
        setState(key, 'error')
        setError(key, message)
      }
    },
    [familyId, scheduleReset],
  )

  const triggerPrune = useCallback(async () => {
    const key: ExportKey = 'prune'

    setState(key, 'generating')
    setError(key, null)

    try {
      const res = await fetch(apiUrl('/api/export/prune'), {
        method: 'POST',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ family_id: familyId }),
      })

      const body = await res.json().catch(() => ({})) as { pruned?: number; error?: string }

      if (!res.ok) {
        throw new Error(body.error ?? 'Prune failed')
      }

      setPrunedCount(body.pruned ?? 0)
      setState(key, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Prune failed'
      setState(key, 'error')
      setError(key, message)
    }
  }, [familyId])

  return {
    stateOf:      getState,
    errorOf:      getError,
    triggerExport,
    triggerPrune,
    prunedCount,
  }
}
