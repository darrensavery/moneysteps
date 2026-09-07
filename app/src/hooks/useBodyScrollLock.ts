import { useEffect } from 'react';

let lockCount = 0;

/**
 * Locks page scroll while `locked` is true. Reference-counted so nested/stacked
 * sheets (e.g. a confirm sheet opened on top of another sheet) don't unlock the
 * body until the last one closes.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
      }
    };
  }, [locked]);
}
