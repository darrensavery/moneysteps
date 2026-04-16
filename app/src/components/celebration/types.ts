import type { AppView } from '../../lib/useTone'

/** A single stage within a milestone sequence. */
export interface MilestoneStage {
  icon:        string
  heading:     string
  body:        string
  attribution?: string
  headingColor: string
  bodyColor:    string
  durationMs:   number
}

/** Full config for one milestone type, split by app_view. */
export interface MilestoneConfig {
  key:        string
  bgColor:    string
  orchard:    MilestoneStage[]
  clean:      MilestoneStage[]
  transition: 'shimmer' | 'wipe'
}

/** All supported milestone event types. */
export type MilestoneEventType =
  | 'GRADUATION'
  | 'PAYDAY_REACHED'
  | 'GOAL_COMPLETED'

/** Passed to MilestoneOverlay to trigger a celebration. */
export interface MilestoneEvent {
  type:    MilestoneEventType
  appView: AppView
}
