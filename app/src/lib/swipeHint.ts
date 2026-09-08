/**
 * Swipe-to-archive coachmark — "has the user seen it" flag.
 *
 * Storage key: mc_has_seen_swipe_archive_hint (localStorage)
 * Set once, after the first auto-peek animation plays on the Chores tab.
 * Never cleared automatically.
 */

export const SWIPE_ARCHIVE_HINT_SEEN_KEY = 'mc_has_seen_swipe_archive_hint'

export function hasSeenSwipeArchiveHint(): boolean {
  try {
    return localStorage.getItem(SWIPE_ARCHIVE_HINT_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markSwipeArchiveHintSeen(): void {
  try {
    localStorage.setItem(SWIPE_ARCHIVE_HINT_SEEN_KEY, '1')
  } catch {
    // Storage unavailable — worst case the hint replays next launch.
  }
}
