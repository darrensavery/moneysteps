/**
 * useTone — returns age-appropriate copy based on teen_mode setting,
 * and locale-aware terminology based on the current AppLocale.
 *
 * teen_mode = 0 (default): child view — orchard language, playful icons visible
 * teen_mode = 1:           mature view — fintech language, minimal icon set
 *
 * Usage:
 *   const tone = useTone(teenMode)
 *   tone.balance          → "Your Harvest"  |  "Total Balance"
 *   tone.terminology.money → "pocket money" | "allowance" | "kieszonkowe"
 */

import { useLocale, type AppLocale } from './locale'

export interface Terminology {
  money:          string   // 'pocket money' | 'allowance' | 'kieszonkowe'
  allowanceLabel: string   // UI-safe capitalised form: 'Allowance' | 'Kieszonkowe'
}

export interface Tone {
  isChild: boolean        // true = child view, false = mature/teen view

  // Labels
  dashboard:     string
  balance:       string
  addToSchedule: string
  allowance:     string
  rewards:       string
  weekSection:   string
  weekSubtitle:  string
  emptyGrove:    string
  emptyGroveSub: string
  nothingToday:  string
  doneButton:    string
  submitButton:  string
  waitingBadge:  string
  allChores:     string

  // Locale-driven parent-side terminology
  terminology: Terminology
}

const CHILD_TONE_BASE = {
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

const TEEN_TONE_BASE = {
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

function buildTerminology(locale: AppLocale): Terminology {
  if (locale === 'pl') return { money: 'kieszonkowe', allowanceLabel: 'Kieszonkowe' }
  if (locale === 'en-US') return { money: 'allowance', allowanceLabel: 'Allowance' }
  return { money: 'pocket money', allowanceLabel: 'Pocket money' }  // en-GB / en-AU fallback
}

export function useTone(teenMode: number | boolean | undefined): Tone {
  const { locale } = useLocale()
  const terminology = buildTerminology(locale)
  const base = teenMode ? TEEN_TONE_BASE : CHILD_TONE_BASE
  return { ...base, terminology }
}
