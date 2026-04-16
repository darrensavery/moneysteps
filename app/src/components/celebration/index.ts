export type { MilestoneConfig, MilestoneEvent, MilestoneEventType, MilestoneStage } from './types'
export { MilestoneOverlay } from './MilestoneOverlay'
export { GRADUATION } from './achievements/graduation'

export function consumeMilestonePending(type: string): boolean {
  const key = `mc_milestone_${type.toLowerCase()}`
  try {
    const pending = localStorage.getItem(key) === '1'
    if (pending) localStorage.removeItem(key)
    return pending
  } catch {
    return false
  }
}

export function setPendingMilestone(type: string): void {
  const key = `mc_milestone_${type.toLowerCase()}`
  try { localStorage.setItem(key, '1') } catch { /* ignore */ }
}
