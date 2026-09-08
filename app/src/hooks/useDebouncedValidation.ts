import { useEffect, useRef, useState } from 'react'

const DEFAULT_DELAY_MS = 500

/**
 * Validates a value only after the user has paused typing, per the
 * designmotionhq "Form Validation Timing" rule — flagging every keystroke as
 * invalid mid-word (e.g. an email with no @ yet) reads as the form fighting
 * the user. Returns null while the pause hasn't elapsed or the value is valid.
 */
export function useDebouncedValidation(
  value: string,
  validate: (value: string) => string | null,
  delayMs = DEFAULT_DELAY_MS,
): string | null {
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!value) { setError(null); return }
    timer.current = setTimeout(() => setError(validate(value)), delayMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `validate` is expected to be stable/inline per call site
  }, [value, delayMs])

  return error
}
