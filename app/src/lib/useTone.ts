/**
 * useTone — returns age-appropriate copy based on teen_mode setting.
 *
 * teen_mode = 0 (default): child view — orchard language, playful icons visible
 * teen_mode = 1:           mature view — fintech language, minimal icon set
 *
 * Usage:
 *   const tone = useTone(teenMode)
 *   tone.balance        → "Your Harvest"  |  "Total Balance"
 *   tone.isChild        → true            |  false
 */

export interface Tone {
  isChild: boolean        // true = child view, false = mature/teen view

  // Labels
  dashboard:     string   // section header for the main screen
  balance:       string   // balance card eyebrow label
  addToSchedule: string   // plant-button tooltip / label
  allowance:     string   // regular/recurring payment label
  rewards:       string   // bonus payment label
  weekSection:   string   // weekly tracker section heading
  weekSubtitle:  string   // weekly tracker sub-heading
  emptyGrove:    string   // empty state headline
  emptyGroveSub: string   // empty state body
  nothingToday:  string   // no chores on selected day
  doneButton:    string   // primary action button on each chore
  submitButton:  string   // confirm-submission button in note drawer
  waitingBadge:  string   // badge shown after submission while awaiting approval
  allChores:     string   // "All my jobs" section heading
}

const CHILD_TONE: Tone = {
  isChild:       true,
  dashboard:     'The Orchard',
  balance:       'Your harvest',
  addToSchedule: 'Plant in my grove',
  allowance:     'Rainfall',
  rewards:       'Sunshine',
  weekSection:   'Your week in the grove',
  weekSubtitle:  "Tap a day to see what's growing",
  emptyGrove:    'Your grove is empty',
  emptyGroveSub: 'Ask a parent to plant some jobs for you.',
  nothingToday:  'Nothing planted for',
  doneButton:    'Done!',
  submitButton:  'Send to parent',
  waitingBadge:  'Waiting…',
  allChores:     'All my jobs',
}

const TEEN_TONE: Tone = {
  isChild:       false,
  dashboard:     'My Account',
  balance:       'Total balance',
  addToSchedule: 'Add to schedule',
  allowance:     'Regular pay',
  rewards:       'Bonus',
  weekSection:   'My week',
  weekSubtitle:  'Select a day to filter tasks',
  emptyGrove:    'No tasks yet',
  emptyGroveSub: 'A parent will assign tasks to your account.',
  nothingToday:  'No tasks scheduled for',
  doneButton:    'Mark complete',
  submitButton:  'Submit for approval',
  waitingBadge:  'Pending',
  allChores:     'All tasks',
}

export function useTone(teenMode: number | boolean | undefined): Tone {
  return teenMode ? TEEN_TONE : CHILD_TONE
}
