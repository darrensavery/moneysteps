// app/src/lib/labCatalogue.ts
// Static catalogue for all 17 Learning Lab modules.
// Content sourced from /docs/notebooklm/09-module-*.md spec files.

import React from 'react'
import type { ReactNode } from 'react'
import { formatCurrency as fmtPence } from './api'
import {
  Receipt, ShieldAlert, Landmark, TrendingUp, TrendingDown, Gauge,
  Smartphone, Briefcase, Scale, Megaphone, GitFork, Star, CreditCard,
  Heart, Users, BarChart2, PieChart,
  Umbrella, Hourglass, Dices, ScrollText,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModuleSlug =
  | 'M2' | 'M3' | 'M3b' | 'M5' | 'M6' | 'M8' | 'M9' | 'M9b'
  | 'M10' | 'M11' | 'M12' | 'M13' | 'M14' | 'M15' | 'M16' | 'M17' | 'M18' | 'M18b'
  | 'M19' | 'M20' | 'M21'

export type AgeLevel = 1 | 2 | 3 | 4   // 1=Sprout(Phase2), 2=Sapling, 3=Oak, 4=Canopy
export type AppView  = 'ORCHARD' | 'CLEAN'

/** Real child data passed to every act render function. */
export interface ChildLabData {
  currency:                string
  currentBalancePence:     number
  lifetimeEarningsPence:   number
  choreRateMedianPence:    number   // median of last 5 approved chores; fallback 500 (£5)
  savingsStreakWeeks:       number
  balance4wkAgoPence:      number
  consecutiveWeeklyGrowth: number
  activeGoalsCount:        number
  reliabilityRating:       number   // 0–100
  distinctChoreTypes:      number
  appView:                 AppView
}

export interface QuizOption {
  label: 'A' | 'B' | 'C'
  text:  string
}

export interface QuizQuestion {
  // Use a function when the question text needs child data (e.g. referencing their earnings)
  question:    string | ((d: ChildLabData) => string)
  options:     QuizOption[]
  correct:     'A' | 'B' | 'C'
  explanation: string
}

/** Per-act time estimates in minutes. Vary by module complexity. */
export interface ActMinutes {
  hook:   number
  lesson: number
  lab:    number
  quiz:   number
}

export function totalMinutes(am: ActMinutes): number {
  return am.hook + am.lesson + am.lab + am.quiz
}

export function remainingMinutes(am: ActMinutes, completedActs: number[]): number {
  const actKeys: (keyof ActMinutes)[] = ['hook', 'lesson', 'lab', 'quiz']
  return actKeys.reduce((sum, key, i) => {
    return completedActs.includes(i + 1) ? sum : sum + am[key]
  }, 0)
}

export interface ModuleDef {
  slug:         ModuleSlug
  title:        string
  pillar:       1 | 2 | 3 | 4 | 5 | 6
  level:        AgeLevel
  // Lucide icon — retained for ModuleReader header
  icon:         React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
  // Unique inline SVG illustration rendered at the top of each grid tile
  illustration: (locked: boolean) => ReactNode
  triggerHint:  string
  description:  string
  actMinutes:   ActMinutes
  hook:         (d: ChildLabData) => ReactNode
  lesson:       (d: ChildLabData) => ReactNode
  lab:          (d: ChildLabData) => ReactNode
  quiz:         QuizQuestion[]
}

// ── Pillar config ──────────────────────────────────────────────────────────────

export const PILLARS: Record<number, { name: string; orchardName: string; color: string; mutedColor: string }> = {
  1: { name: 'Earning & Value',     orchardName: 'The Roots',      color: '#007A78', mutedColor: '#b2d8d8' },
  2: { name: 'Spending & Choices',  orchardName: 'The Trunk',      color: '#D97706', mutedColor: '#fde68a' },
  3: { name: 'Saving & Growth',     orchardName: 'The Fruit',      color: '#16a34a', mutedColor: '#bbf7d0' },
  4: { name: 'Borrowing & Debt',    orchardName: 'The Vine',       color: '#7c3aed', mutedColor: '#ddd6fe' },
  5: { name: 'Investing & Future',  orchardName: 'The Canopy',     color: '#b45309', mutedColor: '#fef3c7' },
  6: { name: 'Society & Wellbeing', orchardName: 'The Atmosphere', color: '#0369a1', mutedColor: '#bae6fd' },
}

/** Level display names — vary by persona. */
export const LEVEL_LABELS: Record<AgeLevel, Record<AppView, string>> = {
  1: { ORCHARD: 'Sprout',     CLEAN: 'Explorer'   },
  2: { ORCHARD: 'Sapling',    CLEAN: 'Foundation' },
  3: { ORCHARD: 'Oak',        CLEAN: 'Applied'    },
  4: { ORCHARD: 'Canopy',     CLEAN: 'Mastery'    },
}


// ── Illustration helpers ──────────────────────────────────────────────────────
// c()     → brand teal  (#00959c) or grey when locked
// cGold() → harvest gold (#e6b222) or grey when locked  — financial values, money
// cRed()  → warm coral  (#e8503a) or grey when locked   — warnings, negatives, debt
function c(locked: boolean, opacity = 1): string {
  return locked ? `rgba(160,170,170,${opacity})` : `rgba(0,149,156,${opacity})`
}
function cGold(locked: boolean, opacity = 1): string {
  return locked ? `rgba(160,170,170,${opacity})` : `rgba(230,178,34,${opacity})`
}
function cRed(locked: boolean, opacity = 1): string {
  return locked ? `rgba(160,170,170,${opacity})` : `rgba(232,80,58,${opacity})`
}

// ── Module definitions ─────────────────────────────────────────────────────────

export const MODULES: ModuleDef[] = [

  // ── M2: Taxes & Net Pay ───────────────────────────────────────────────────
  {
    slug:        'M2',
    title:       'Taxes & Net Pay',
    pillar:      1,
    level:       2,
    icon:        Receipt,
    triggerHint: 'Earn your first £20 to unlock',
    description: 'Why your pay slip shows less than you earned — and where the rest goes.',
    actMinutes:  { hook: 2, lesson: 5, lab: 7, quiz: 4 },  // 18 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Pay slip document
      React.createElement('rect', { x: 24, y: 8, width: 112, height: 48, rx: 6, fill: c(locked, 0.06), stroke: c(locked, 0.2), strokeWidth: 1 }),
      // Gross row — label + amount in teal
      React.createElement('rect', { x: 34, y: 18, width: 55, height: 5, rx: 2, fill: c(locked, 0.18) }),
      React.createElement('rect', { x: 98, y: 18, width: 28, height: 5, rx: 2, fill: c(locked, 0.45) }),
      // Tax deduction row — red (you lose this)
      React.createElement('rect', { x: 34, y: 27, width: 40, height: 5, rx: 2, fill: cRed(locked, 0.18) }),
      React.createElement('rect', { x: 98, y: 27, width: 20, height: 5, rx: 2, fill: cRed(locked, 0.55) }),
      // Divider
      React.createElement('line', { x1: 34, y1: 37, x2: 126, y2: 37, stroke: c(locked, 0.15), strokeWidth: 1 }),
      // Net pay row — gold (what you actually get)
      React.createElement('rect', { x: 34, y: 42, width: 30, height: 7, rx: 2, fill: c(locked, 0.2) }),
      React.createElement('rect', { x: 94, y: 41, width: 32, height: 8, rx: 3, fill: cGold(locked, 0.9) }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? `You've earned ${fmtPence(d.lifetimeEarningsPence, d.currency)} so far. Before we count the apples, let's talk about the slice the orchard infrastructure quietly takes.`
          : `Cumulative earnings: ${fmtPence(d.lifetimeEarningsPence, d.currency)}. This module explains the deductions applied to real-world wages.`
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed text-[var(--color-text)]' },
        'Every person who earns money pays a portion to fund shared services — roads, hospitals, schools. This isn\'t optional. It\'s called tax. The amount you actually receive is called your ',
        React.createElement('strong', null, 'net pay'),
        '. The amount before deductions is your ',
        React.createElement('strong', null, 'gross pay'),
        '.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Income Tax'),
        ' is a percentage of your earnings taken by the government. In the UK, the first £12,570 you earn in a year is tax-free (the Personal Allowance). Above that, 20% goes to the government.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'National Insurance (NI)'),
        ' is a separate contribution that funds the NHS and state pension. Employees pay 8% on earnings between £12,570 and £50,270.'
      ),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
        React.createElement('p', null, 'Gross pay:         £2,000/month'),
        React.createElement('p', null, 'Income tax (20%):  −£285'),
        React.createElement('p', null, 'NI (8%):           −£100'),
        React.createElement('p', { className: 'font-bold mt-1' }, 'Net pay:            £1,615')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'For every £100 earned, roughly £19 goes to the government before the worker sees it. This pays for the things no single person could afford alone.'
      )
    ),
    lab: (d) => {
      const median  = d.choreRateMedianPence
      const monthly = median * 20
      const tax     = Math.round(monthly * 0.20)
      const ni      = Math.round(monthly * 0.08)
      const net     = monthly - tax - ni
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          'Using your median chore rate of ', React.createElement('strong', null, fmtPence(median, d.currency))
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `If you did 20 chores this month:`),
          React.createElement('p', null, `Gross earnings:   ${fmtPence(monthly, d.currency)}`),
          React.createElement('p', null, `Income tax (20%): −${fmtPence(tax, d.currency)}`),
          React.createElement('p', null, `NI (8%):          −${fmtPence(ni, d.currency)}`),
          React.createElement('p', { className: 'font-bold border-t border-[var(--color-border)] pt-1' }, `Net pay: ${fmtPence(net, d.currency)}`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed' },
          `In the real world, your net pay would be ${fmtPence(net, d.currency)} — not ${fmtPence(monthly, d.currency)}. To cover the ${fmtPence(tax + ni, d.currency)} lost to tax and NI, you'd need `,
          React.createElement('strong', null, `${Math.ceil((tax + ni) / median)} extra chores`),
          ' at your median rate.'
        )
      )
    },
    quiz: [
      {
        question: 'What is the difference between gross pay and net pay?',
        options: [
          { label: 'A', text: 'Gross pay is what you receive; net pay is before deductions' },
          { label: 'B', text: 'Gross pay is before deductions; net pay is what you actually receive' },
          { label: 'C', text: 'They are the same — just different words for the same amount' },
        ],
        correct: 'B',
        explanation: 'Gross is the full amount earned. Net is what remains after tax and National Insurance are deducted.',
      },
      {
        question: 'Why do governments collect income tax?',
        options: [
          { label: 'A', text: 'To punish people for earning too much' },
          { label: 'B', text: 'To fund shared services like hospitals, roads, and schools that individuals cannot afford alone' },
          { label: 'C', text: 'To save money for the government\'s own expenses only' },
        ],
        correct: 'B',
        explanation: 'Tax funds public services that benefit everyone — healthcare, infrastructure, education, and the state pension.',
      },
      {
        question: (d: ChildLabData) => `Someone earns ${fmtPence(d.lifetimeEarningsPence, d.currency)} in a year. The personal allowance is £12,570. Do they owe income tax?`,
        options: [
          { label: 'A', text: 'Yes — everyone who earns any amount pays tax' },
          { label: 'B', text: 'No — only earnings above the personal allowance are taxed' },
          { label: 'C', text: 'Only if they choose to pay it' },
        ],
        correct: 'B',
        explanation: 'The personal allowance means the first £12,570 is tax-free. Tax only applies on earnings above that threshold.',
      },
    ],
  },

  // ── M5: Scams & Digital Safety ────────────────────────────────────────────
  {
    slug:        'M5',
    title:       'Scams & Digital Safety',
    pillar:      2,
    level:       2,
    icon:        ShieldAlert,
    triggerHint: 'Triggered when a suspicious item is flagged',
    description: 'How scams are designed to look real — and the signals that give them away.',
    actMinutes:  { hook: 1, lesson: 4, lab: 5, quiz: 4 },  // 14 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Phone outline — teal tinted
      React.createElement('rect', { x: 52, y: 6, width: 56, height: 52, rx: 8, fill: c(locked, 0.07), stroke: c(locked, 0.25), strokeWidth: 1.5 }),
      // Shield — teal fill, coral exclamation (danger signal)
      React.createElement('path', { d: 'M80 16 L94 22 L94 34 C94 41 80 48 80 48 C80 48 66 41 66 34 L66 22 Z', fill: c(locked, 0.12), stroke: c(locked, 0.55), strokeWidth: 1.5 }),
      // Exclamation in coral/red
      React.createElement('rect', { x: 78.5, y: 26, width: 3, height: 10, rx: 1.5, fill: cRed(locked, 0.85) }),
      React.createElement('circle', { cx: 80, cy: 41, r: 1.5, fill: cRed(locked, 0.85) }),
    ),
    hook: (_d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        'Something in your orchard smells like blight. Scams grow fast and look delicious — let\'s learn how to spot them before they spread.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'Every year, billions of pounds are lost to scams. Most victims aren\'t careless — they were targeted by professionals who spend their careers making fake things look real. Knowing the patterns is your best defence.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'The three signals every scam shares:'),
      React.createElement('ol', { className: 'flex flex-col gap-2 pl-4 list-decimal text-[0.875rem]' },
        React.createElement('li', null, React.createElement('strong', null, 'Urgency. '), '"Act now or lose this forever." Scammers create time pressure so you don\'t think clearly.'),
        React.createElement('li', null, React.createElement('strong', null, 'Too good to be true. '), 'Free money, free prizes, amazing deals with no catch. If it sounds impossible, it usually is.'),
        React.createElement('li', null, React.createElement('strong', null, 'Requests for credentials. '), 'Legitimate companies never ask for your PIN, password, or full card number via message or link.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Protecting your accounts: '),
        'Use a different PIN for every service. Never share it — not even with a parent or carer. If you receive a suspicious message asking you to click a link, don\'t. Go directly to the website by typing the address yourself.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'In gaming: '),
        '"Free V-Bucks generators," "account boosting," and "rare item trades" are almost always scams. No legitimate service needs your login credentials to give you something for free.'
      )
    ),
    lab: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'Spot the scam. For each scenario, decide: real or fake?'),
      ...[
        { scenario: 'An email from "PayPal" says your account will be closed in 24 hours unless you click a link and enter your password.', answer: 'SCAM', why: 'Urgency + credential request. PayPal communicates through your account dashboard, not urgent emails.' },
        { scenario: 'Your game\'s official app sends a push notification that you\'ve earned a reward for completing a challenge you actually did yesterday.', answer: 'LIKELY REAL', why: 'No urgency, no credential request, matches recent activity. Still verify by opening the app directly — not via the notification.' },
        { scenario: 'A website offers to double your Robux if you enter your username and password.', answer: 'SCAM', why: 'No platform gives away currency for credentials. This is a classic credential-harvesting scam.' },
      ].map((item, i) => React.createElement('div', { key: i, className: 'rounded-xl border border-[var(--color-border)] p-3 flex flex-col gap-2' },
        React.createElement('p', { className: 'text-[0.8125rem]' }, item.scenario),
        React.createElement('p', { className: 'text-[0.75rem] font-bold text-[var(--brand-primary)]' }, item.answer),
        React.createElement('p', { className: 'text-[0.75rem] text-[var(--color-text-muted)]' }, item.why)
      ))
    ),
    quiz: [
      {
        question: 'Which is the strongest sign that a message is a scam?',
        options: [
          { label: 'A', text: 'It comes from an unknown sender' },
          { label: 'B', text: 'It creates urgency and asks you to click a link to enter your password' },
          { label: 'C', text: 'It contains a spelling mistake' },
        ],
        correct: 'B',
        explanation: 'Urgency + credential request is the core scam pattern. Spelling mistakes are a hint but not proof — some sophisticated scams are perfectly written.',
      },
      {
        question: 'Someone offers you free in-game currency if you share your account login. What do you do?',
        options: [
          { label: 'A', text: 'Share it — free currency is worth the risk' },
          { label: 'B', text: 'Decline and report it — no legitimate service needs your credentials to give you something' },
          { label: 'C', text: 'Share a fake password first to test if they\'re real' },
        ],
        correct: 'B',
        explanation: 'Legitimate platforms never need your password to credit your account. Report it and ignore.',
      },
      {
        question: 'You receive an email that looks exactly like it\'s from your bank. What\'s the safest response?',
        options: [
          { label: 'A', text: 'Click the link in the email and log in' },
          { label: 'B', text: 'Reply to the email asking if it\'s real' },
          { label: 'C', text: 'Open a new browser tab, type your bank\'s address manually, and check your account there' },
        ],
        correct: 'C',
        explanation: 'Always navigate directly to a site by typing the address. Email links can point anywhere — even a perfect copy of the real site.',
      },
    ],
  },

  // ── M8: Banking 101 ───────────────────────────────────────────────────────
  {
    slug:        'M8',
    title:       'Banking 101',
    pillar:      3,
    level:       2,
    icon:        Landmark,
    triggerHint: 'Save up to £30 to unlock',
    description: 'Accounts, debit vs credit, and why a jar under the bed is a bad plan.',
    actMinutes:  { hook: 2, lesson: 5, lab: 6, quiz: 3 },  // 16 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Base
      React.createElement('rect', { x: 20, y: 44, width: 120, height: 12, rx: 3, fill: c(locked, 0.15), stroke: c(locked, 0.25), strokeWidth: 1 }),
      // Lintel
      React.createElement('rect', { x: 30, y: 32, width: 100, height: 7, rx: 2, fill: c(locked, 0.25) }),
      // Columns — teal highlights alternate
      React.createElement('rect', { x: 42, y: 39, width: 8, height: 5, rx: 1, fill: c(locked, 0.6) }),
      React.createElement('rect', { x: 60, y: 39, width: 8, height: 5, rx: 1, fill: c(locked, 0.35) }),
      React.createElement('rect', { x: 78, y: 39, width: 8, height: 5, rx: 1, fill: c(locked, 0.6) }),
      React.createElement('rect', { x: 96, y: 39, width: 8, height: 5, rx: 1, fill: c(locked, 0.35) }),
      React.createElement('rect', { x: 114, y: 39, width: 8, height: 5, rx: 1, fill: c(locked, 0.6) }),
      // Roof — solid teal fill
      React.createElement('path', { d: 'M18 32 L80 10 L142 32 Z', fill: c(locked, 0.2), stroke: c(locked, 0.45), strokeWidth: 1.5 }),
      // Gold coin / balance indicator
      React.createElement('circle', { cx: 80, cy: 21, r: 5, fill: cGold(locked, 0.7) }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? `Your grove is growing — ${fmtPence(d.currentBalancePence, d.currency)} saved. It's time to understand where the real orchards store their surplus.`
          : `Balance milestone reached: ${fmtPence(d.currentBalancePence, d.currency)}. This module covers real-world money storage and banking fundamentals.`
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'You\'ve built up real savings. Where should that money actually live when it\'s bigger than pocket money? The answer most people use is a bank — but most people don\'t understand how banks work. Let\'s fix that.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'A ', React.createElement('strong', null, 'current account'), ' is for day-to-day spending. Money goes in (wages, transfers) and out (purchases, bills). Most come with a debit card.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'A ', React.createElement('strong', null, 'savings account'), ' is for money you don\'t need immediately. The bank pays you ', React.createElement('strong', null, 'interest'), ' for keeping your money there — usually a percentage per year.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'Debit card vs credit card:'),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] flex flex-col gap-2' },
        React.createElement('p', null, React.createElement('strong', null, 'Debit:'), ' spends your own money directly from your account. If there\'s nothing in, it doesn\'t work.'),
        React.createElement('p', null, React.createElement('strong', null, 'Credit:'), ' the bank lends you money to spend now. You pay it back later — with interest if you don\'t clear the balance.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'Why not keep money in a jar? Two reasons: it can be stolen or lost, and it earns nothing. A savings account keeps it safe and makes it grow slowly.'
      )
    ),
    lab: (d) => {
      const balance = d.currentBalancePence
      const yr1 = Math.round(balance * 1.04)
      const yr2 = Math.round(yr1 * 1.04)
      const yr3 = Math.round(yr2 * 1.04)
      const earned = yr3 - balance
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          'If your current balance of ', React.createElement('strong', null, fmtPence(balance, d.currency)), ' were in a 4% savings account:'
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Today:   ${fmtPence(balance, d.currency)}`),
          React.createElement('p', null, `Year 1:  ${fmtPence(yr1, d.currency)}`),
          React.createElement('p', null, `Year 2:  ${fmtPence(yr2, d.currency)}`),
          React.createElement('p', null, `Year 3:  ${fmtPence(yr3, d.currency)}`),
          React.createElement('p', { className: 'font-bold border-t border-[var(--color-border)] pt-1' },
            `Interest earned: ${fmtPence(earned, d.currency)} — for doing nothing extra.`
          )
        ),
        React.createElement('p', { className: 'text-[0.8125rem]' },
          `That's ${Math.ceil(earned / d.choreRateMedianPence)} chores at your median rate — earned by a bank account while you slept.`
        )
      )
    },
    quiz: [
      {
        question: 'What is the main difference between a current account and a savings account?',
        options: [
          { label: 'A', text: 'Current accounts pay more interest' },
          { label: 'B', text: 'Current accounts are for daily spending; savings accounts hold money and earn interest' },
          { label: 'C', text: 'Savings accounts come with a debit card; current accounts don\'t' },
        ],
        correct: 'B',
        explanation: 'Current accounts handle day-to-day transactions. Savings accounts hold surplus money and pay interest — typically no card attached.',
      },
      {
        question: 'You spend £50 on a debit card. Where does that money come from?',
        options: [
          { label: 'A', text: 'The bank lends it to you' },
          { label: 'B', text: 'Your own account balance — it reduces immediately' },
          { label: 'C', text: 'It comes from an overdraft automatically' },
        ],
        correct: 'B',
        explanation: 'A debit card spends your own money directly. A credit card borrows it — a different product with different consequences.',
      },
      {
        question: 'Why is keeping large amounts of cash at home worse than a savings account?',
        options: [
          { label: 'A', text: 'It\'s illegal to keep cash at home' },
          { label: 'B', text: 'Cash at home can be lost or stolen, earns nothing, and isn\'t protected by the bank' },
          { label: 'C', text: 'Banks will confiscate it if they find out' },
        ],
        correct: 'B',
        explanation: 'Savings accounts are insured (up to £85,000 in the UK via FSCS), earn interest, and are far safer than storing cash at home.',
      },
    ],
  },

  // ── M9b: The Snowball ─────────────────────────────────────────────────────
  {
    slug:        'M9b',
    title:       'The Snowball',
    pillar:      3,
    level:       2,
    icon:        TrendingUp,
    triggerHint: 'Save consistently for 4 weeks to unlock',
    description: 'How compound interest makes money grow faster the longer you leave it.',
    actMinutes:  { hook: 2, lesson: 6, lab: 10, quiz: 4 }, // 22 min — numerically rich Lab
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Area under curve — soft teal
      React.createElement('path', { d: 'M20 54 C40 52 60 48 80 40 C100 30 120 18 145 8 L145 58 L20 58 Z', fill: c(locked, 0.08) }),
      // Curve line — teal
      React.createElement('path', { d: 'M20 54 C40 52 60 48 80 40 C100 30 120 18 145 8', stroke: c(locked, 0.65), strokeWidth: 2, strokeLinecap: 'round' }),
      // Axis lines
      React.createElement('line', { x1: 18, y1: 10, x2: 18, y2: 58, stroke: c(locked, 0.18), strokeWidth: 1 }),
      React.createElement('line', { x1: 18, y1: 58, x2: 148, y2: 58, stroke: c(locked, 0.18), strokeWidth: 1 }),
      // Snowball — gold (money = gold)
      React.createElement('circle', { cx: 128, cy: 22, r: 10, fill: cGold(locked, 0.25), stroke: cGold(locked, 0.75), strokeWidth: 1.5 }),
      // £ inside the snowball
      React.createElement('text', { x: 128, y: 27, fontSize: 9, textAnchor: 'middle', fill: cGold(locked, 0.9), fontWeight: 'bold' }, '£'),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? `${d.savingsStreakWeeks} weeks in a row — your snowball is rolling. Here's the secret: it gets heavier without you pushing harder.`
          : `${d.savingsStreakWeeks} consecutive weeks of balance growth recorded. This module explains compound interest.`
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        `You now have ${fmtPence(d.currentBalancePence, d.currency)}, up from ${fmtPence(d.balance4wkAgoPence, d.currency)} four weeks ago. You did that by earning and saving. In the real world, once a snowball gets big enough, it picks up extra snow just by rolling. Money can do the same thing — not inside Morechard, but in a savings account.`
      ),
      React.createElement('p', { className: 'text-[0.75rem] text-[var(--color-text-muted)] italic' },
        'Note: Morechard tracks what you earn. It doesn\'t add interest. This lesson is about the real-world tool you\'ll use when you\'re ready.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'When you put money in a savings account, the bank pays you a little extra for keeping it there. That extra is called ', React.createElement('strong', null, 'interest'), '. A typical savings account might pay 4% per year. If you saved £100, the bank adds £4 at the end of the year. You\'d have £104.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'Simple vs compound interest:'),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
        React.createElement('p', { className: 'font-bold' }, 'Simple (4% of original each year):'),
        React.createElement('p', null, 'Year 1: £100 → £104'),
        React.createElement('p', null, 'Year 2: £100 → £108'),
        React.createElement('p', null, 'Year 3: £100 → £112'),
        React.createElement('p', { className: 'font-bold mt-2' }, 'Compound (4% of growing total):'),
        React.createElement('p', null, 'Year 1: £100.00 → £104.00'),
        React.createElement('p', null, 'Year 2: £104.00 → £108.16'),
        React.createElement('p', null, 'Year 3: £108.16 → £112.49')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'The difference looks small now. Over 10 years on £50, compound interest earns £24 extra — for doing nothing. That\'s the snowball. Starting early is worth more than saving a lot. You can\'t buy back the years you didn\'t start. You\'re already doing that.'
      )
    ),
    lab: (d) => {
      const balance    = d.currentBalancePence
      const yr1 = Math.round(balance * 1.04)
      const yr2 = Math.round(yr1 * 1.04)
      const yr3 = Math.round(yr2 * 1.04)
      const compound3  = yr3 - balance
      const simple3    = Math.round(balance * 0.04 * 3)
      const extra      = compound3 - simple3
      const snowball   = Math.round(5000 * Math.pow(1.04, 10))
      const choreEquiv = Math.ceil(compound3 / d.choreRateMedianPence)
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          'Using your balance of ', React.createElement('strong', null, fmtPence(balance, d.currency)), ' at 4% compound interest:'
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Year 1: ${fmtPence(yr1, d.currency)}`),
          React.createElement('p', null, `Year 2: ${fmtPence(yr2, d.currency)}`),
          React.createElement('p', null, `Year 3: ${fmtPence(yr3, d.currency)}`),
          React.createElement('p', { className: 'font-bold border-t border-[var(--color-border)] pt-1' }, `Interest earned (3yr): ${fmtPence(compound3, d.currency)}`),
          React.createElement('p', null, `Simple interest same period: ${fmtPence(simple3, d.currency)}`),
          React.createElement('p', { style: { color: 'var(--brand-primary)', fontWeight: 'bold' } }, `Compound earns ${fmtPence(extra, d.currency)} extra`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem]' },
          `That ${fmtPence(compound3, d.currency)} of interest equals `, React.createElement('strong', null, `${choreEquiv} chores`), ' at your median rate — earned without working.'
        ),
        React.createElement('div', { className: 'rounded-xl border border-[var(--color-border)] p-3 text-[0.8125rem]' },
          React.createElement('p', { className: 'font-semibold mb-1' }, 'Snowball comparison: £50 for 10 years at 4%'),
          React.createElement('p', null, `Person A (savings account): ${fmtPence(snowball, d.currency)}`),
          React.createElement('p', null, `Person B (jar at home): ${fmtPence(5000, d.currency)}`),
          React.createElement('p', { style: { color: 'var(--brand-primary)', fontWeight: 'bold' }, className: 'mt-1' },
            `A earns ${fmtPence(snowball - 5000, d.currency)} extra — for doing nothing.`
          )
        )
      )
    },
    quiz: [
      {
        question: 'What makes compound interest grow faster than simple interest over time?',
        options: [
          { label: 'A', text: 'The interest rate is higher with compound interest' },
          { label: 'B', text: 'Each year\'s interest is calculated on the previous balance including earned interest, not just the original amount' },
          { label: 'C', text: 'Banks pay more when you\'ve been a customer longer' },
        ],
        correct: 'B',
        explanation: 'Compound interest builds on the growing total. Simple interest always calculates from the original amount. The snowball gets heavier on its own.',
      },
      {
        question: 'You save £200 in a 4% annual interest savings account. How much do you have after one year?',
        options: [
          { label: 'A', text: '£200 — interest doesn\'t apply in the first year' },
          { label: 'B', text: '£204' },
          { label: 'C', text: '£208' },
        ],
        correct: 'C',
        explanation: '4% of £200 = £8. £200 + £8 = £208. Interest applies from day one.',
      },
      {
        question: 'Why does starting to save early matter more than saving a large amount later?',
        options: [
          { label: 'A', text: 'Younger people get a higher interest rate' },
          { label: 'B', text: 'Early savings have more years to compound, so each pound grows longer' },
          { label: 'C', text: 'Savings accounts close after age 30' },
        ],
        correct: 'B',
        explanation: 'Compound interest multiplies over time. More years = more doublings. A small amount started early often beats a large amount started late.',
      },
    ],
  },

  // ── M10: The Interest Trap ────────────────────────────────────────────────
  {
    slug:        'M10',
    title:       'The Interest Trap',
    pillar:      4,
    level:       2,
    icon:        TrendingDown,
    triggerHint: 'Triggered when a parental loan is requested',
    description: 'What borrowing actually costs — and why minimum payments are a trap.',
    actMinutes:  { hook: 2, lesson: 5, lab: 7, quiz: 3 },  // 17 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Y1 — small, neutral (manageable)
      React.createElement('rect', { x: 28, y: 44, width: 24, height: 14, rx: 2, fill: c(locked, 0.25) }),
      // Y2 — medium, teal (growing concern)
      React.createElement('rect', { x: 68, y: 32, width: 24, height: 26, rx: 2, fill: c(locked, 0.4) }),
      // Y3 — tall, red (the trap has sprung)
      React.createElement('rect', { x: 108, y: 14, width: 24, height: 44, rx: 2, fill: cRed(locked, 0.65) }),
      // Labels
      React.createElement('text', { x: 40, y: 62, fontSize: 8, textAnchor: 'middle', fill: c(locked, 0.45) }, 'Y1'),
      React.createElement('text', { x: 80, y: 62, fontSize: 8, textAnchor: 'middle', fill: c(locked, 0.45) }, 'Y2'),
      React.createElement('text', { x: 120, y: 62, fontSize: 8, textAnchor: 'middle', fill: cRed(locked, 0.55) }, 'Y3'),
      // Up arrow in red
      React.createElement('path', { d: 'M120 10 L120 6 M117 9 L120 6 L123 9', stroke: cRed(locked, 0.8), strokeWidth: 1.5, strokeLinecap: 'round' }),
    ),
    hook: (_d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        'Borrowing tomorrow\'s seeds to buy today\'s fruit can work. But the vine always wants something back.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'When you borrow money, you don\'t just pay back what you borrowed. You pay back more — because the lender charges for the use of their money. This extra charge is called interest. Understanding it is one of the most important financial skills you can have.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'How interest on debt works: '),
        'If you borrow £100 at 20% annual interest and pay nothing for a year, you owe £120. Wait another year: £144. The debt grows — just like savings compound, so do debts.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The minimum payment trap: '),
        'Credit cards let you pay a small "minimum payment" each month — sometimes just 1–2% of what you owe. If you only pay the minimum on a £1,000 balance at 20% interest, it can take over 10 years to pay off and cost nearly £1,000 in interest alone.'
      ),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
        React.createElement('p', null, 'Borrow:           £1,000'),
        React.createElement('p', null, 'Interest rate:    20% per year'),
        React.createElement('p', null, 'Minimum payment:  £25/month'),
        React.createElement('p', { className: 'font-bold mt-1' }, 'Time to clear:    ~10 years'),
        React.createElement('p', { className: 'font-bold text-red-500' }, 'Total paid:       ~£1,900')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'The trap is not borrowing. The trap is borrowing and only paying the minimum.'
      )
    ),
    lab: (d) => {
      const loan    = Math.round(d.currentBalancePence * 1.5)
      const after1  = Math.round(loan * 1.20)
      const after2  = Math.round(after1 * 1.20)
      const extra   = after2 - loan
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          `Imagine borrowing ${fmtPence(loan, d.currency)} (50% more than your current balance) at 20% annual interest:`
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Borrowed:  ${fmtPence(loan, d.currency)}`),
          React.createElement('p', null, `After 1yr: ${fmtPence(after1, d.currency)} (+${fmtPence(after1 - loan, d.currency)})`),
          React.createElement('p', null, `After 2yr: ${fmtPence(after2, d.currency)} (+${fmtPence(extra, d.currency)} total)`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem]' },
          `If you paid nothing for 2 years, you'd owe ${fmtPence(extra, d.currency)} extra — that's `,
          React.createElement('strong', null, `${Math.ceil(extra / d.choreRateMedianPence)} chores`),
          ' at your median rate just to cover the interest.'
        )
      )
    },
    quiz: [
      {
        question: 'You borrow £500 at 20% annual interest and pay nothing for 2 years. Roughly how much do you owe?',
        options: [
          { label: 'A', text: '£520' },
          { label: 'B', text: '£600' },
          { label: 'C', text: '£720' },
        ],
        correct: 'C',
        explanation: 'Year 1: £500 × 1.20 = £600. Year 2: £600 × 1.20 = £720. Interest compounds on the growing debt.',
      },
      {
        question: 'What makes "minimum payments" on credit cards dangerous?',
        options: [
          { label: 'A', text: 'They are not accepted by all banks' },
          { label: 'B', text: 'They barely cover the interest, so the debt barely shrinks — you pay for years and the balance stays high' },
          { label: 'C', text: 'They are illegal in the UK' },
        ],
        correct: 'B',
        explanation: 'Minimum payments are designed to keep you in debt longer, maximising the interest the lender collects. Always pay more than the minimum.',
      },
      {
        question: 'When does borrowing cost zero interest?',
        options: [
          { label: 'A', text: 'Never — all borrowing has a cost' },
          { label: 'B', text: 'When you repay within the interest-free grace period (usually the same billing month)' },
          { label: 'C', text: 'Only when borrowing from a family member' },
        ],
        correct: 'B',
        explanation: 'Most credit cards offer an interest-free period if you repay the full balance before the statement date. Use it correctly and borrowing costs nothing.',
      },
    ],
  },

  // ── M14: Inflation ────────────────────────────────────────────────────────
  {
    slug:        'M14',
    title:       'Inflation',
    pillar:      5,
    level:       2,
    icon:        Gauge,
    triggerHint: 'No new chores for 21 days triggers this',
    description: 'Why money "shrinks" if it just sits still — and what to do about it.',
    actMinutes:  { hook: 1, lesson: 5, lab: 6, quiz: 3 },  // 15 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Price tag body — teal tint
      React.createElement('path', { d: 'M38 10 L100 10 L122 32 L100 54 L38 54 L38 10 Z', fill: c(locked, 0.07), stroke: c(locked, 0.25), strokeWidth: 1.5 }),
      // Hole — teal
      React.createElement('circle', { cx: 55, cy: 24, r: 4, fill: c(locked, 0.35) }),
      // Price rows — gold (the price you pay)
      React.createElement('rect', { x: 60, y: 31, width: 48, height: 6, rx: 2, fill: cGold(locked, 0.3) }),
      React.createElement('rect', { x: 60, y: 42, width: 38, height: 6, rx: 3, fill: cGold(locked, 0.65) }),
      // Up arrow — red (prices rising = inflation)
      React.createElement('path', { d: 'M132 38 L132 14 M126 20 L132 14 L138 20', stroke: cRed(locked, 0.8), strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? 'Your seeds are sitting still. Money has a slow rot — here\'s what\'s quietly happening to your pile.'
          : 'No transaction activity detected. This module explains purchasing power erosion over time.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        `Imagine you put ${fmtPence(d.currentBalancePence, d.currency)} under your mattress today. In 10 years, it's still ${fmtPence(d.currentBalancePence, d.currency)} — but it buys less. A chocolate bar that costs 80p today might cost £1.10 in a decade. Your money didn't shrink. But what it can buy did. That's inflation.`
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'What inflation is: '),
        'Inflation is the general rise in prices over time. The UK government targets about 2% per year. At 2% inflation, something that costs £1.00 today costs roughly £1.22 in 10 years.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'What it means for savings: '),
        'If your savings earn 0% interest and inflation runs at 2%, your money\'s real purchasing power falls by about 2% per year. After 10 years, you can buy roughly 20% less with the same amount.'
      ),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
        React.createElement('p', null, 'Today:    £100 buys a basket of goods'),
        React.createElement('p', null, '+5 years: same basket costs ~£110'),
        React.createElement('p', null, '+10 yrs:  same basket costs ~£122'),
        React.createElement('p', { className: 'font-bold mt-1' }, 'Your £100 (uninvested) buys less each year.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The fix: '),
        'Keep savings in accounts that earn interest at or above the inflation rate. Money sitting in a 0% account loses real value every year.'
      )
    ),
    lab: (d) => {
      const balance  = d.currentBalancePence
      const yr5real  = Math.round(balance / Math.pow(1.02, 5))
      const yr10real = Math.round(balance / Math.pow(1.02, 10))
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          `If your ${fmtPence(balance, d.currency)} earns 0% while inflation runs at 2%:`
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Today (face value):   ${fmtPence(balance, d.currency)}`),
          React.createElement('p', null, `In 5 years (real):    ${fmtPence(yr5real, d.currency)} (−${fmtPence(balance - yr5real, d.currency)} purchasing power)`),
          React.createElement('p', null, `In 10 years (real):   ${fmtPence(yr10real, d.currency)} (−${fmtPence(balance - yr10real, d.currency)} purchasing power)`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem]' },
          `After 10 years you'd still have ${fmtPence(balance, d.currency)} in your account — but it would only buy what ${fmtPence(yr10real, d.currency)} buys today. That's `,
          React.createElement('strong', null, `${Math.ceil((balance - yr10real) / d.choreRateMedianPence)} chores`),
          ' worth of purchasing power, silently erased.'
        )
      )
    },
    quiz: [
      {
        question: 'If inflation is 2% per year, what happens to the purchasing power of £100 kept in a 0% savings account?',
        options: [
          { label: 'A', text: 'It stays the same — you still have £100' },
          { label: 'B', text: 'It slowly decreases — £100 buys less each year as prices rise' },
          { label: 'C', text: 'It increases — your money is safe in the bank' },
        ],
        correct: 'B',
        explanation: 'The face value stays at £100, but inflation means prices rise each year. The same £100 buys less over time — real purchasing power falls.',
      },
      {
        question: 'What is the best way to protect your savings from inflation?',
        options: [
          { label: 'A', text: 'Spend it all before prices rise' },
          { label: 'B', text: 'Keep it in an account earning interest at or above the inflation rate' },
          { label: 'C', text: 'Keep it as cash — it doesn\'t lose value if you can hold it in your hand' },
        ],
        correct: 'B',
        explanation: 'Interest-earning accounts can offset inflation. If your savings earn 4% and inflation is 2%, your real purchasing power grows by ~2% per year.',
      },
      {
        question: 'The UK government targets roughly what annual inflation rate?',
        options: [
          { label: 'A', text: '0% — inflation should always be zero' },
          { label: 'B', text: '2%' },
          { label: 'C', text: '10%' },
        ],
        correct: 'B',
        explanation: 'The Bank of England targets 2% inflation. A small, stable rate is considered healthy — it encourages spending and investment rather than hoarding cash.',
      },
    ],
  },

  // ── M17: Digital vs Physical Currency ────────────────────────────────────
  {
    slug:        'M17',
    title:       'Digital vs Physical Currency',
    pillar:      6,
    level:       2,
    icon:        Smartphone,
    triggerHint: 'Create a gaming goal to unlock',
    description: 'V-Bucks, Robux, Gems — why in-game currency disconnects you from real money.',
    actMinutes:  { hook: 1, lesson: 4, lab: 5, quiz: 3 },  // 13 min — concise Lab
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Phone (digital) — teal tint (in-game currency world)
      React.createElement('rect', { x: 14, y: 8, width: 48, height: 48, rx: 7, fill: c(locked, 0.08), stroke: c(locked, 0.3), strokeWidth: 1.5 }),
      React.createElement('circle', { cx: 38, cy: 32, r: 10, fill: c(locked, 0.18) }),
      React.createElement('text', { x: 38, y: 36, fontSize: 9, textAnchor: 'middle', fill: c(locked, 0.65), fontWeight: 'bold' }, 'V'),
      // vs divider
      React.createElement('text', { x: 80, y: 36, fontSize: 10, textAnchor: 'middle', fill: c(locked, 0.28) }, 'vs'),
      // Banknote (physical) — gold (real money = gold)
      React.createElement('rect', { x: 98, y: 18, width: 48, height: 28, rx: 4, fill: cGold(locked, 0.12), stroke: cGold(locked, 0.45), strokeWidth: 1.5 }),
      React.createElement('rect', { x: 106, y: 24, width: 32, height: 16, rx: 2, fill: cGold(locked, 0.08), stroke: cGold(locked, 0.25), strokeWidth: 1 }),
      React.createElement('text', { x: 122, y: 35, fontSize: 11, textAnchor: 'middle', fill: cGold(locked, 0.85), fontWeight: 'bold' }, '£'),
    ),
    hook: (_d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        'V-Bucks, Robux, Gems — the orchard has a dark corner selling "magic seeds" that only grow inside one walled garden. Let\'s map the exit.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'In-game currencies aren\'t just a payment method — they\'re a design decision. Converting real money into game currency is intentional: it makes you forget how much you\'re spending. Understanding how it works puts you back in control.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Why game currencies exist: '),
        'When you buy V-Bucks or Robux, you exchange real money for in-game tokens. The conversion rate is usually awkward (e.g. 1,000 V-Bucks for £7.99) — this is deliberate. It\'s harder to think "is this skin worth 3 hours of chores?" when you\'re thinking in V-Bucks.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The "leftover" trick: '),
        'Bundles are often designed so you always have a little currency left over after a purchase. That leftover encourages you to buy another bundle to "not waste" it.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The real-money test: '),
        'Before any in-game purchase, convert it back to real money. 1,000 V-Bucks ≈ £8. Is this skin worth £8? Would you hand over that cash at a till for it?'
      )
    ),
    lab: (d) => {
      const vbucks1000 = 799
      const rate       = d.choreRateMedianPence
      const choreEquiv = (vbucks1000 / rate).toFixed(1)
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'The labour equivalent test'),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] flex flex-col gap-2' },
          React.createElement('p', null, `1,000 V-Bucks = ${fmtPence(vbucks1000, d.currency)}`),
          React.createElement('p', null, `Your median chore rate = ${fmtPence(rate, d.currency)}`),
          React.createElement('p', { className: 'font-bold' }, `That skin costs you ${choreEquiv} chores worth of effort.`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed' },
          `Next time you consider an in-game purchase, ask yourself: "Would I do ${choreEquiv} chores for this?" If the answer is no, the purchase isn't worth it at your real rate of earning.`
        )
      )
    },
    quiz: [
      {
        question: 'Why do game developers use their own currency instead of letting you pay in pounds directly?',
        options: [
          { label: 'A', text: 'It\'s technically easier to process custom currencies' },
          { label: 'B', text: 'It makes real-money costs less obvious, reducing the friction of spending' },
          { label: 'C', text: 'Governments require it for digital goods' },
        ],
        correct: 'B',
        explanation: 'In-game currency creates a psychological barrier between real money and purchases. When you think in V-Bucks, you don\'t naturally convert back to pounds — which is the point.',
      },
      {
        question: 'What is the "leftover" trick in in-game currency bundles?',
        options: [
          { label: 'A', text: 'Leftover currency expires, so you lose it' },
          { label: 'B', text: 'Bundles leave you with a small amount remaining, nudging you to buy another bundle to avoid wasting it' },
          { label: 'C', text: 'You can convert leftover currency back to real money' },
        ],
        correct: 'B',
        explanation: 'Bundle sizes are deliberately misaligned with item costs. The leftover is bait — it makes you feel like you need to top up, spending more than you planned.',
      },
      {
        question: 'Before spending V-Bucks, what is the most useful question to ask?',
        options: [
          { label: 'A', text: 'How many V-Bucks do I have left?' },
          { label: 'B', text: 'Would I pay this amount in real money at a shop for this item?' },
          { label: 'C', text: 'Did my friends buy this too?' },
        ],
        correct: 'B',
        explanation: 'Converting back to real money restores the friction the currency system removed. If you wouldn\'t pay £8 at a till for a digital outfit, the V-Bucks price isn\'t worth it either.',
      },
    ],
  },

  // ── Level 3 modules — stubs (populate lesson/lab/quiz from spec docs) ─────

  {
    slug: 'M3', title: 'Entrepreneurship', pillar: 1, level: 3, icon: Briefcase, actMinutes: { hook: 2, lesson: 7, lab: 8, quiz: 3 },  // 20 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Main gear — teal
      React.createElement('circle', { cx: 60, cy: 32, r: 14, fill: c(locked, 0.12), stroke: c(locked, 0.4), strokeWidth: 1.5 }),
      React.createElement('circle', { cx: 60, cy: 32, r: 6, fill: c(locked, 0.3) }),
      ...[0,45,90,135,180,225,270,315].map(a => {
        const rad = a * Math.PI / 180
        const x1 = 60 + Math.cos(rad) * 14, y1 = 32 + Math.sin(rad) * 14
        const x2 = 60 + Math.cos(rad) * 19, y2 = 32 + Math.sin(rad) * 19
        return React.createElement('line', { key: a, x1, y1, x2, y2, stroke: c(locked, 0.5), strokeWidth: 3, strokeLinecap: 'round' })
      }),
      // Arrow — gold (growth / value)
      React.createElement('path', { d: 'M84 32 L110 32 M104 26 L110 32 L104 38', stroke: cGold(locked, 0.8), strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      // Second gear — gold (the enterprise you built)
      React.createElement('circle', { cx: 124, cy: 32, r: 9, fill: cGold(locked, 0.12), stroke: cGold(locked, 0.55), strokeWidth: 1.5 }),
      React.createElement('circle', { cx: 124, cy: 32, r: 4, fill: cGold(locked, 0.25) }),
    ),
    triggerHint: 'Complete 10 different types of chore to unlock',
    description: 'What it means to make the work work for you — not just do more of it.',
    hook: (d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      `You've worked ${d.distinctChoreTypes} different types of job. Now here's the question every serious grower eventually asks: what if the orchard worked for `, React.createElement('em', null, 'you'), ' instead?'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-03-entrepreneurship.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M3b', title: 'Gig Trap vs Salary Safety', pillar: 1, level: 3, icon: Scale, actMinutes: { hook: 2, lesson: 6, lab: 8, quiz: 3 },  // 19 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Balance beam
      React.createElement('line', { x1: 80, y1: 22, x2: 80, y2: 54, stroke: c(locked, 0.3), strokeWidth: 1.5 }),
      React.createElement('line', { x1: 30, y1: 22, x2: 130, y2: 22, stroke: c(locked, 0.3), strokeWidth: 1.5 }),
      React.createElement('circle', { cx: 80, cy: 22, r: 3, fill: c(locked, 0.4) }),
      // Left pan — low (gig, volatile — red)
      React.createElement('line', { x1: 30, y1: 22, x2: 30, y2: 38, stroke: c(locked, 0.2), strokeWidth: 1 }),
      React.createElement('ellipse', { cx: 30, cy: 40, rx: 16, ry: 5, fill: cRed(locked, 0.1), stroke: cRed(locked, 0.35), strokeWidth: 1 }),
      React.createElement('rect', { x: 22, y: 28, width: 5, height: 8, rx: 1, fill: cRed(locked, 0.25) }),
      React.createElement('rect', { x: 33, y: 24, width: 5, height: 12, rx: 1, fill: cRed(locked, 0.2) }),
      // Right pan — higher (salary, stable — gold)
      React.createElement('line', { x1: 130, y1: 22, x2: 130, y2: 30, stroke: c(locked, 0.2), strokeWidth: 1 }),
      React.createElement('ellipse', { cx: 130, cy: 32, rx: 16, ry: 5, fill: cGold(locked, 0.18), stroke: cGold(locked, 0.5), strokeWidth: 1 }),
      React.createElement('rect', { x: 120, y: 22, width: 20, height: 7, rx: 2, fill: cGold(locked, 0.4) }),
    ),
    triggerHint: 'Triggered by variable earnings week to week',
    description: 'The trade-off between high-potential gig income and the safety of steady pay.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'Some weeks a feast, some weeks bare branches — your earnings are swinging. That pattern has a name, and it\'s worth knowing before you build a life around it.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-03b-gig-trap-vs-salary-safety.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M6', title: 'Advertising & Influence', pillar: 2, level: 3, icon: Megaphone, actMinutes: { hook: 1, lesson: 5, lab: 6, quiz: 4 },  // 16 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Megaphone — teal
      React.createElement('path', { d: 'M28 22 L28 42 L58 52 L58 12 Z', fill: c(locked, 0.18), stroke: c(locked, 0.45), strokeWidth: 1.5 }),
      React.createElement('rect', { x: 16, y: 26, width: 12, height: 12, rx: 2, fill: c(locked, 0.25), stroke: c(locked, 0.35), strokeWidth: 1 }),
      // Sound waves — teal fading out
      React.createElement('path', { d: 'M66 22 C74 26 74 38 66 42', stroke: c(locked, 0.5), strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M74 16 C88 24 88 40 74 48', stroke: c(locked, 0.35), strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M82 10 C102 22 102 42 82 54', stroke: c(locked, 0.2), strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }),
      // Attention dots — gold (the lure of advertising)
      React.createElement('circle', { cx: 116, cy: 20, r: 3.5, fill: cGold(locked, 0.75) }),
      React.createElement('circle', { cx: 132, cy: 32, r: 2.5, fill: cGold(locked, 0.55) }),
      React.createElement('circle', { cx: 118, cy: 46, r: 3, fill: cGold(locked, 0.65) }),
    ),
    triggerHint: 'Triggered by repeat spending in the same category',
    description: 'How advertising is designed to make you want things — and how to notice it.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'Three times in a month, the same shelf called your name. That\'s not a coincidence — someone designed that shelf. Let\'s inspect the architecture.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-06-advertising-influence.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M9', title: 'Opportunity Cost', pillar: 3, level: 3, icon: GitFork, actMinutes: { hook: 2, lesson: 6, lab: 7, quiz: 3 },  // 18 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Stem path
      React.createElement('line', { x1: 80, y1: 56, x2: 80, y2: 34, stroke: c(locked, 0.35), strokeWidth: 2, strokeLinecap: 'round' }),
      // Taken path — teal (the choice you made)
      React.createElement('path', { d: 'M80 34 C80 22 50 18 36 14', stroke: c(locked, 0.6), strokeWidth: 2, strokeLinecap: 'round', fill: 'none' }),
      // Foregone path — red dashed (what you lost)
      React.createElement('path', { d: 'M80 34 C80 22 110 18 124 14', stroke: cRed(locked, 0.45), strokeWidth: 2, strokeLinecap: 'round', fill: 'none', strokeDasharray: '4 3' }),
      // YES — teal label
      React.createElement('rect', { x: 18, y: 8, width: 28, height: 14, rx: 3, fill: c(locked, 0.15), stroke: c(locked, 0.45), strokeWidth: 1 }),
      React.createElement('text', { x: 32, y: 18, fontSize: 7, textAnchor: 'middle', fill: c(locked, 0.75) }, 'YES'),
      // NO — red dashed label
      React.createElement('rect', { x: 114, y: 8, width: 28, height: 14, rx: 3, fill: cRed(locked, 0.06), stroke: cRed(locked, 0.3), strokeWidth: 1, strokeDasharray: '3 2' }),
      React.createElement('text', { x: 128, y: 18, fontSize: 7, textAnchor: 'middle', fill: cRed(locked, 0.45) }, 'NO'),
    ),
    triggerHint: 'Triggered when a goal is cancelled after a competing purchase',
    description: 'Every yes is a hidden no — how to make trade-offs consciously.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'You said yes to something — and quietly said no to something else. That trade has a name. Here\'s how to make it consciously next time.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-09-opportunity-cost.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M11', title: 'Credit Scores & Trust', pillar: 4, level: 3, icon: Star, actMinutes: { hook: 2, lesson: 5, lab: 7, quiz: 3 },  // 17 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Background arc — grey track
      React.createElement('path', { d: 'M38 52 A42 42 0 0 1 122 52', stroke: c(locked, 0.12), strokeWidth: 8, strokeLinecap: 'round', fill: 'none' }),
      // Score arc — teal (good score filled)
      React.createElement('path', { d: 'M38 52 A42 42 0 0 1 108 27', stroke: c(locked, 0.6), strokeWidth: 8, strokeLinecap: 'round', fill: 'none' }),
      // Needle — gold (your personal score)
      React.createElement('line', { x1: 80, y1: 52, x2: 108, y2: 29, stroke: cGold(locked, 0.9), strokeWidth: 2.5, strokeLinecap: 'round' }),
      React.createElement('circle', { cx: 80, cy: 52, r: 4, fill: cGold(locked, 0.7) }),
      // Score number — gold
      React.createElement('text', { x: 80, y: 64, fontSize: 9, textAnchor: 'middle', fill: cGold(locked, 0.7), fontWeight: 'bold' }, '785'),
    ),
    triggerHint: 'Achieve 90% reliability over 8 weeks to unlock',
    description: 'How your financial reliability becomes a number — and why it matters.',
    hook: (d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      `Your consistency has a number. In the wider world, that number is ${d.reliabilityRating}% — and it opens doors or closes them. Here's how the system works.`
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-11-credit-scores-and-trust.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M12', title: 'Good vs Bad Debt', pillar: 4, level: 3, icon: CreditCard, actMinutes: { hook: 2, lesson: 7, lab: 8, quiz: 4 },  // 21 min — builds on M10
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Good debt — house/asset, teal (grows in value)
      React.createElement('rect', { x: 18, y: 22, width: 54, height: 34, rx: 4, fill: c(locked, 0.1), stroke: c(locked, 0.35), strokeWidth: 1.5 }),
      React.createElement('path', { d: 'M18 22 L45 8 L72 22', fill: c(locked, 0.2), stroke: c(locked, 0.4), strokeWidth: 1.5 }),
      React.createElement('text', { x: 45, y: 44, fontSize: 7, textAnchor: 'middle', fill: c(locked, 0.65) }, 'GOOD'),
      React.createElement('text', { x: 45, y: 53, fontSize: 6, textAnchor: 'middle', fill: c(locked, 0.4) }, 'asset'),
      // Bad debt — consumption, coral/red (shrinks value)
      React.createElement('rect', { x: 88, y: 36, width: 54, height: 20, rx: 4, fill: cRed(locked, 0.07), stroke: cRed(locked, 0.35), strokeWidth: 1.5, strokeDasharray: '4 3' }),
      React.createElement('text', { x: 115, y: 47, fontSize: 7, textAnchor: 'middle', fill: cRed(locked, 0.55) }, 'BAD'),
      React.createElement('text', { x: 115, y: 55, fontSize: 6, textAnchor: 'middle', fill: cRed(locked, 0.35) }, 'consumes'),
    ),
    triggerHint: 'Complete The Interest Trap module first',
    description: 'Not all debt is equal — a mortgage and a payday loan are not the same thing.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'Not all debt is a vine strangling your tree. Some debt is a trellis. Here\'s the test every serious grower uses to tell the difference.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-12-good-vs-bad-debt.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M18', title: 'Money & Mental Health', pillar: 6, level: 3, icon: Heart, actMinutes: { hook: 1, lesson: 5, lab: 5, quiz: 4 },  // 15 min — reflective, less numerical
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Heart — warm coral (emotion, wellbeing)
      React.createElement('path', { d: 'M80 52 C80 52 36 34 36 20 C36 12 44 8 52 10 C60 12 80 26 80 26 C80 26 100 12 108 10 C116 8 124 12 124 20 C124 34 80 52 80 52 Z', fill: cRed(locked, 0.1), stroke: cRed(locked, 0.4), strokeWidth: 1.5 }),
      // £ — gold (money inside the feeling)
      React.createElement('text', { x: 80, y: 36, fontSize: 16, textAnchor: 'middle', fill: cGold(locked, 0.8), fontWeight: 'bold' }, '£'),
    ),
    triggerHint: 'Triggered after a purchase you felt mixed about',
    description: 'Buyer\'s remorse, contentment, and why getting the thing doesn\'t fix the feeling.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'You got the thing — and something feels off. That feeling has a name. Let\'s talk about it before it shapes your next harvest.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-18-money-and-mental-health.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M18b', title: 'Social Comparison', pillar: 6, level: 3, icon: Users, actMinutes: { hook: 1, lesson: 4, lab: 6, quiz: 3 },  // 14 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Person A — teal
      React.createElement('circle', { cx: 50, cy: 20, r: 10, fill: c(locked, 0.18), stroke: c(locked, 0.45), strokeWidth: 1.5 }),
      React.createElement('path', { d: 'M30 56 C30 44 70 44 70 56', fill: c(locked, 0.1), stroke: c(locked, 0.3), strokeWidth: 1.5 }),
      // Person B — gold (the person you're comparing yourself to)
      React.createElement('circle', { cx: 110, cy: 20, r: 10, fill: cGold(locked, 0.18), stroke: cGold(locked, 0.5), strokeWidth: 1.5 }),
      React.createElement('path', { d: 'M90 56 C90 44 130 44 130 56', fill: cGold(locked, 0.1), stroke: cGold(locked, 0.35), strokeWidth: 1.5 }),
      // Mirror arrows — coral (comparison is a trap)
      React.createElement('path', { d: 'M68 34 L92 34 M72 30 L68 34 L72 38', stroke: cRed(locked, 0.55), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      React.createElement('path', { d: 'M92 34 L68 34 M88 30 L92 34 L88 38', stroke: cRed(locked, 0.55), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ),
    triggerHint: 'Triggered when spending follows a peer\'s purchase',
    description: 'Why "keeping up" is a race with no finish line — and how to opt out.',
    hook: (_d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      'Someone else planted a seed and now you want the same crop. That\'s human — but let\'s make sure it\'s your hunger driving this, not theirs.'
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-18b-social-comparison.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  // ── Level 4 modules ───────────────────────────────────────────────────────

  {
    slug: 'M13', title: 'Stocks & Shares', pillar: 5, level: 4, icon: BarChart2, actMinutes: { hook: 2, lesson: 8, lab: 10, quiz: 5 }, // 25 min — most complex Level 4
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Candlestick chart — teal=up (price rose), red=down (price fell)
      ...[
        { x: 24,  high: 18, open: 40, close: 26, low: 50 }, // down
        { x: 48,  high: 12, open: 28, close: 18, low: 52 }, // down
        { x: 72,  high: 14, open: 36, close: 22, low: 48 }, // down
        { x: 96,  high: 10, open: 22, close: 34, low: 52 }, // up
        { x: 120, high: 8,  open: 30, close: 14, low: 50 }, // down
        { x: 144, high: 6,  open: 16, close: 8,  low: 52 }, // up (last bar rising)
      ].flatMap(({ x, high, open, close, low }, i) => {
        const up   = close < open
        const fill = up ? c(locked, 0.6) : cRed(locked, 0.55)
        const wick = up ? c(locked, 0.4) : cRed(locked, 0.4)
        return [
          React.createElement('line', { key: `w${i}`, x1: x, y1: high, x2: x, y2: low, stroke: wick, strokeWidth: 1 }),
          React.createElement('rect', { key: `b${i}`, x: x-5, y: Math.min(open,close), width: 10, height: Math.abs(close-open) || 2, rx: 1, fill }),
        ]
      }),
      React.createElement('line', { x1: 14, y1: 58, x2: 154, y2: 58, stroke: c(locked, 0.15), strokeWidth: 1 }),
    ),
    triggerHint: 'Earn £100 lifetime to unlock',
    description: 'Fractional ownership of companies — and why long-term investors usually win.',
    hook: (d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      `${fmtPence(d.lifetimeEarningsPence, d.currency)} earned. The orchard now has a question: do you want to own a small piece of someone else's farm?`
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-13-compound-growth.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  {
    slug: 'M15', title: 'Risk & Diversification', pillar: 5, level: 4, icon: PieChart, actMinutes: { hook: 2, lesson: 7, lab: 10, quiz: 4 }, // 23 min
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Pie chart — three segments: teal (largest), gold (medium), muted (smallest)
      React.createElement('path', { d: 'M80 32 L80 8 A24 24 0 0 1 104 56 Z', fill: c(locked, 0.55) }),
      React.createElement('path', { d: 'M80 32 L104 56 A24 24 0 0 1 56 56 Z', fill: cGold(locked, 0.55) }),
      React.createElement('path', { d: 'M80 32 L56 56 A24 24 0 0 1 80 8 Z', fill: c(locked, 0.2) }),
      // Three eggs — teal, gold, muted (don't put them all in one basket)
      React.createElement('ellipse', { cx: 122, cy: 18, rx: 9, ry: 11, fill: c(locked, 0.12), stroke: c(locked, 0.4), strokeWidth: 1 }),
      React.createElement('ellipse', { cx: 138, cy: 34, rx: 9, ry: 11, fill: cGold(locked, 0.12), stroke: cGold(locked, 0.45), strokeWidth: 1 }),
      React.createElement('ellipse', { cx: 122, cy: 50, rx: 9, ry: 11, fill: c(locked, 0.08), stroke: c(locked, 0.25), strokeWidth: 1 }),
    ),
    triggerHint: 'Have 3 active goals including one long-term goal',
    description: 'Don\'t put all your seeds in one basket — the maths of spreading risk.',
    hook: (d) => React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
      `${d.activeGoalsCount} active goals — you're thinking like a strategist. Now let's examine what happens when one of those soils turns bad.`
    ),
    lesson: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Content coming soon — see docs/notebooklm/09-module-15-risk-and-diversification.md Act 2'),
    lab: (_d) => React.createElement('p', { className: 'text-[0.875rem] text-[var(--color-text-muted)]' }, 'Interactive lab coming soon'),
    quiz: [],
  },

  // ── M16: Insurance & Protection ──────────────────────────────────────────
  {
    slug:        'M16',
    title:       'Insurance & Protection',
    pillar:      5,
    level:       3,
    icon:        Umbrella,
    triggerHint: 'Save up to £75 to unlock',
    description: 'Why paying a little, often, can protect you from a loss you couldn\'t afford.',
    actMinutes:  { hook: 2, lesson: 6, lab: 6, quiz: 4 },  // 18 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Rain — coral drops (the risks)
      React.createElement('line', { x1: 40, y1: 8, x2: 36, y2: 16, stroke: cRed(locked, 0.5), strokeWidth: 1.5, strokeLinecap: 'round' }),
      React.createElement('line', { x1: 80, y1: 6, x2: 76, y2: 14, stroke: cRed(locked, 0.5), strokeWidth: 1.5, strokeLinecap: 'round' }),
      React.createElement('line', { x1: 120, y1: 8, x2: 116, y2: 16, stroke: cRed(locked, 0.5), strokeWidth: 1.5, strokeLinecap: 'round' }),
      // Umbrella canopy — teal (the protection)
      React.createElement('path', { d: 'M44 30 C44 18 116 18 116 30 Z', fill: c(locked, 0.18), stroke: c(locked, 0.5), strokeWidth: 1.5 }),
      React.createElement('line', { x1: 80, y1: 30, x2: 80, y2: 48, stroke: c(locked, 0.45), strokeWidth: 1.5, strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M80 48 C80 54 74 54 74 50', stroke: c(locked, 0.45), strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }),
      // Coin sheltered underneath — gold (what you're protecting)
      React.createElement('circle', { cx: 80, cy: 40, r: 6, fill: cGold(locked, 0.6) }),
      React.createElement('text', { x: 80, y: 43.5, fontSize: 8, textAnchor: 'middle', fill: cGold(locked, 0.95), fontWeight: 'bold' }, '£'),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? `You've sheltered ${fmtPence(d.currentBalancePence, d.currency)} in your grove. One bad storm could flatten it overnight — unless you build a roof before the clouds arrive.`
          : `You've built ${fmtPence(d.currentBalancePence, d.currency)} in savings. A single unexpected loss could wipe it out. Insurance is the tool that stops one bad day from undoing months of work.`
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'Insurance is a deal: you pay a small, predictable amount regularly, and in return someone else agrees to cover a big, unpredictable loss if it happens. You\'re trading a small certain cost for protection against a large uncertain one.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'How it works — pooling risk: '),
        'Thousands of people each pay a small amount (the ', React.createElement('strong', null, 'premium'), ') into a shared pot. Most won\'t need it. The few who suffer a big loss are paid from the pot. Everyone trades a little money for peace of mind.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The excess: '),
        'When you claim, you usually pay the first slice yourself — the ', React.createElement('strong', null, 'excess'), '. A £400 phone claim with a £50 excess means the insurer pays £350 and you pay £50. A higher excess makes the premium cheaper, but leaves more to find if you claim.'
      ),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] flex flex-col gap-2' },
        React.createElement('p', null, React.createElement('strong', null, 'Required by law: '), 'Car insurance — you cannot legally drive without it.'),
        React.createElement('p', null, React.createElement('strong', null, 'Strongly worth it: '), 'Home contents, and travel insurance (medical bills abroad can be enormous).'),
        React.createElement('p', null, React.createElement('strong', null, 'Often not worth it: '), 'Cheap gadgets and extended warranties on low-cost items you could simply replace.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The rule: '),
        'Insure what you couldn\'t afford to replace. Don\'t insure what you could comfortably cover yourself — for small losses, you are your own best insurer.'
      )
    ),
    lab: (d) => {
      const phone   = 40000  // £400 in pence
      const premium = 700    // £7/month
      const annual  = premium * 12
      const excess  = 5000   // £50
      const rate    = d.choreRateMedianPence
      const phoneChores = Math.ceil(phone / rate)
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          'Imagine a phone worth ', React.createElement('strong', null, fmtPence(phone, d.currency)), ' — that\'s ', React.createElement('strong', null, `${phoneChores} chores`), ' of effort at your median rate.'
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Replace it yourself:   ${fmtPence(phone, d.currency)}`),
          React.createElement('p', null, `Insurance premium:     ${fmtPence(premium, d.currency)}/month (${fmtPence(annual, d.currency)}/yr)`),
          React.createElement('p', null, `Excess if you claim:   ${fmtPence(excess, d.currency)}`),
          React.createElement('p', { className: 'font-bold border-t border-[var(--color-border)] pt-1' }, `If it breaks: you pay ${fmtPence(excess, d.currency)}, not ${fmtPence(phone, d.currency)}`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed' },
          `If your savings couldn't absorb a sudden ${fmtPence(phone, d.currency)} loss, the ${fmtPence(annual, d.currency)} a year buys protection worth having. If you could easily replace it, you might skip the premium and self-insure. The question is never "will it break?" — it's "could I cope if it did?"`
        )
      )
    },
    quiz: [
      {
        question: 'What is an insurance "premium"?',
        options: [
          { label: 'A', text: 'The large payout you receive when you make a claim' },
          { label: 'B', text: 'The regular amount you pay to be insured' },
          { label: 'C', text: 'A bonus the insurer pays if you never claim' },
        ],
        correct: 'B',
        explanation: 'The premium is the regular cost of being insured. You pay it whether or not you ever claim — it\'s the price of transferring the risk to the insurer.',
      },
      {
        question: 'Insurance works by "pooling risk". What does that mean?',
        options: [
          { label: 'A', text: 'Many people pay in; the few who suffer a loss are paid from the shared pot' },
          { label: 'B', text: 'The insurer invests your money and gives it all back later' },
          { label: 'C', text: 'You only pay anything if something goes wrong' },
        ],
        correct: 'A',
        explanation: 'Lots of people each contribute a small premium. Most won\'t claim, so there\'s enough in the pot to cover the unlucky few. That\'s how a small cost can protect against a large loss.',
      },
      {
        question: 'Which of these is usually NOT worth insuring?',
        options: [
          { label: 'A', text: 'Your car (which is also a legal requirement)' },
          { label: 'B', text: 'A cheap item you could easily afford to replace yourself' },
          { label: 'C', text: 'Expensive medical costs while travelling abroad' },
        ],
        correct: 'B',
        explanation: 'Insure what you couldn\'t afford to lose. For small, easily-replaced items the premiums often cost more over time than just replacing the item — so self-insuring is smarter.',
      },
    ],
  },

  // ── M19: Pensions & The Long Game ────────────────────────────────────────
  {
    slug:        'M19',
    title:       'Pensions & The Long Game',
    pillar:      5,
    level:       4,
    icon:        Hourglass,
    triggerHint: 'Earn £150 lifetime to unlock',
    description: 'The money you set aside for a "you" that\'s decades away — and why starting first beats saving most.',
    actMinutes:  { hook: 2, lesson: 7, lab: 10, quiz: 4 },  // 23 min — numerically rich Lab
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Hourglass caps — teal
      React.createElement('line', { x1: 56, y1: 10, x2: 104, y2: 10, stroke: c(locked, 0.5), strokeWidth: 2, strokeLinecap: 'round' }),
      React.createElement('line', { x1: 56, y1: 54, x2: 104, y2: 54, stroke: c(locked, 0.5), strokeWidth: 2, strokeLinecap: 'round' }),
      // Glass sides — teal
      React.createElement('path', { d: 'M60 10 C60 26 80 30 80 32 C80 34 60 38 60 54', stroke: c(locked, 0.45), strokeWidth: 1.5, fill: 'none' }),
      React.createElement('path', { d: 'M100 10 C100 26 80 30 80 32 C80 34 100 38 100 54', stroke: c(locked, 0.45), strokeWidth: 1.5, fill: 'none' }),
      // Top sand — small remaining (teal)
      React.createElement('path', { d: 'M66 14 L94 14 C94 22 80 28 80 28 C80 28 66 22 66 14 Z', fill: c(locked, 0.2) }),
      // Falling grain — gold
      React.createElement('line', { x1: 80, y1: 30, x2: 80, y2: 40, stroke: cGold(locked, 0.7), strokeWidth: 1.5, strokeLinecap: 'round' }),
      // Bottom sand — large pile (gold — wealth accumulating)
      React.createElement('path', { d: 'M66 50 C66 40 80 36 80 36 C80 36 94 40 94 50 Z', fill: cGold(locked, 0.6) }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? 'The oldest orchards were planted by people who knew they\'d never sit in their shade. A pension is that tree — planted now, harvested in fifty years.'
          : 'A pension is money you lock away now for a version of you that won\'t exist for decades. It sounds distant — but the maths makes starting early the single most powerful move you can make.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'You\'ve already learned how compound growth works. A pension is compound growth given its longest possible run — often 40 or 50 years. Over that long, the difference between starting now and starting "later" is enormous.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'What a pension is: '),
        'A pension is a long-term savings pot for retirement. The money is invested (usually in shares and bonds) so it grows over decades, and you generally can\'t touch it until your late 50s — which is the point.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Free money — the employer match: '),
        'In the UK, most workers are automatically enrolled into a workplace pension. You pay in, your ', React.createElement('strong', null, 'employer also pays in'), ', and the government adds tax relief on top. Opting out means turning down free money from your employer.'
      ),
      React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] flex flex-col gap-1' },
        React.createElement('p', null, React.createElement('strong', null, 'You contribute:'), ' e.g. 5% of pay'),
        React.createElement('p', null, React.createElement('strong', null, 'Employer adds:'), ' e.g. 3% of pay — free'),
        React.createElement('p', null, React.createElement('strong', null, 'Government adds:'), ' tax relief on your share'),
        React.createElement('p', { className: 'font-bold border-t border-[var(--color-border)] pt-1' }, 'Every £1 you pay becomes more than £1 invested.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The State Pension exists too '),
        '— but it\'s modest and starts late. It\'s a floor, not a comfortable retirement. The earlier you add your own pension on top, the more the decades of compounding do the heavy lifting for you.'
      )
    ),
    lab: (d) => {
      const monthly = 10000 // £100/month in pence
      const r = 0.05 / 12   // 5% annual, monthly
      const fv = (months: number) => Math.round(monthly * ((Math.pow(1 + r, months) - 1) / r))
      const early   = fv(47 * 12)  // started at 20, to 67
      const late    = fv(37 * 12)  // started at 30, to 67
      const earlyIn = monthly * 47 * 12
      const lateIn  = monthly * 37 * 12
      const gap     = early - late
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.8125rem] text-[var(--color-text-muted)]' },
          'Two people each save ', React.createElement('strong', null, fmtPence(monthly, d.currency)), '/month into a pension growing ~5% a year. The only difference: when they started.'
        ),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', { className: 'font-bold' }, 'Started at 20 (paid in 47 years):'),
          React.createElement('p', null, `Paid in:   ${fmtPence(earlyIn, d.currency)}`),
          React.createElement('p', null, `Pot at 67: ${fmtPence(early, d.currency)}`),
          React.createElement('p', { className: 'font-bold mt-2' }, 'Started at 30 (paid in 37 years):'),
          React.createElement('p', null, `Paid in:   ${fmtPence(lateIn, d.currency)}`),
          React.createElement('p', null, `Pot at 67: ${fmtPence(late, d.currency)}`),
          React.createElement('p', { style: { color: 'var(--brand-primary)', fontWeight: 'bold' }, className: 'border-t border-[var(--color-border)] pt-1' }, `Ten years earlier = ${fmtPence(gap, d.currency)} more`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed' },
          `The early starter paid in only ${fmtPence(earlyIn - lateIn, d.currency)} more, but ended up with ${fmtPence(gap, d.currency)} more. That gap is pure compounding — the reward for time, not effort. You can't buy back the years you didn't start, which is exactly why this lesson reaches you now.`
        )
      )
    },
    quiz: [
      {
        question: 'In a UK workplace pension, who pays into your pot?',
        options: [
          { label: 'A', text: 'Only you' },
          { label: 'B', text: 'You, your employer, and the government (via tax relief)' },
          { label: 'C', text: 'Only your employer' },
        ],
        correct: 'B',
        explanation: 'Auto-enrolment means you contribute, your employer adds their own contribution, and the government tops it up with tax relief. Opting out means giving up the free employer and government money.',
      },
      {
        question: 'Why does starting a pension early matter so much?',
        options: [
          { label: 'A', text: 'Younger people are given higher interest rates' },
          { label: 'B', text: 'The money has more years to compound, so each pound grows far larger' },
          { label: 'C', text: 'Pensions become more expensive to open as you age' },
        ],
        correct: 'B',
        explanation: 'A pension is compound growth over decades. Starting ten years earlier can mean a dramatically bigger pot, even if you pay in only a little more — time does the work.',
      },
      {
        question: 'The "employer match" in a workplace pension is best described as:',
        options: [
          { label: 'A', text: 'A loan you repay later' },
          { label: 'B', text: 'Essentially free money added to your pension by your employer' },
          { label: 'C', text: 'A tax taken from your salary' },
        ],
        correct: 'B',
        explanation: 'When your employer contributes alongside you, that\'s extra money you wouldn\'t otherwise get. Turning it down is leaving part of your pay on the table.',
      },
    ],
  },

  // ── M20: Gambling & Loot Boxes ───────────────────────────────────────────
  {
    slug:        'M20',
    title:       'Gambling & Loot Boxes',
    pillar:      6,
    level:       3,
    icon:        Dices,
    triggerHint: 'Triggered by repeated chance-based in-game spending',
    description: 'Why the house always wins — and how loot boxes borrow the same playbook.',
    actMinutes:  { hook: 2, lesson: 6, lab: 7, quiz: 4 },  // 19 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Mystery / loot box — teal, with a ?
      React.createElement('rect', { x: 30, y: 26, width: 40, height: 30, rx: 4, fill: c(locked, 0.1), stroke: c(locked, 0.4), strokeWidth: 1.5 }),
      React.createElement('path', { d: 'M30 34 L70 34 M50 26 L50 56', stroke: c(locked, 0.3), strokeWidth: 1 }),
      React.createElement('path', { d: 'M30 34 L50 22 L70 34', fill: c(locked, 0.18), stroke: c(locked, 0.4), strokeWidth: 1.5 }),
      React.createElement('text', { x: 50, y: 49, fontSize: 12, textAnchor: 'middle', fill: c(locked, 0.6), fontWeight: 'bold' }, '?'),
      // Coins going in — gold (you put in a lot)
      React.createElement('circle', { cx: 88, cy: 16, r: 4, fill: cGold(locked, 0.7) }),
      React.createElement('circle', { cx: 98, cy: 22, r: 4, fill: cGold(locked, 0.6) }),
      React.createElement('circle', { cx: 88, cy: 28, r: 4, fill: cGold(locked, 0.65) }),
      // One small coin out — coral (you get back less)
      React.createElement('circle', { cx: 120, cy: 46, r: 4, fill: cRed(locked, 0.4) }),
      // Net loss arrow — coral down
      React.createElement('path', { d: 'M138 14 L138 50 M132 44 L138 50 L144 44', stroke: cRed(locked, 0.7), strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? 'A stall at the orchard market sells sealed baskets — "one might hold a golden apple!" Most hold a single bruised plum. The stallholder, somehow, is always rich.'
          : 'A loot box promises a rare reward for a small payment. Most of the time you get something nearly worthless. The company selling it always comes out ahead — and that\'s not luck, it\'s design.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'Gambling and chance-based game purchases run on the same maths: you pay a certain amount for an uncertain reward that, on average, is worth less than you paid. Understanding the maths is how you stop being the product.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The house edge: '),
        'Every casino game, lottery and loot box is built so that, on average, players get back less than they put in. The gap is the operator\'s profit. You might win sometimes — but play long enough and the maths grinds you down. The house never needs luck; it just needs you to keep playing.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'The gambler\'s fallacy: '),
        'After five reds in a row, it feels like black is "due". It isn\'t. Each spin is independent — the odds reset every time. Believing you\'re "owed" a win is exactly the thought that keeps people spending.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Why loot boxes hook you: '),
        'They use "variable rewards" — you never know when the good one is coming, so your brain keeps you opening "just one more". Near-misses (the rare item that "almost" dropped) and flashy animations are deliberately designed to feel like a win even when you lost.'
      ),
      React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]' },
        'Spending on chance can quietly turn into a habit, and the costs can build into debt. If it ever stops feeling like a free choice — for you or a friend — talk to an adult you trust.'
      )
    ),
    lab: (d) => {
      const box       = 200            // £2 per box
      const avgBack   = 80             // avg value you actually get: £0.80
      const lossEach  = box - avgBack  // £1.20
      const tries     = 20
      const totalSpent = box * tries
      const totalBack  = avgBack * tries
      const totalLost  = totalSpent - totalBack
      const rate      = d.choreRateMedianPence
      const choresLost = Math.ceil(totalLost / rate)
      return React.createElement('div', { className: 'flex flex-col gap-4' },
        React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'The house edge, in numbers'),
        React.createElement('div', { className: 'rounded-xl bg-[var(--color-surface-alt)] p-3 text-[0.8125rem] font-mono flex flex-col gap-1' },
          React.createElement('p', null, `Each box costs:        ${fmtPence(box, d.currency)}`),
          React.createElement('p', null, `Average reward value:  ${fmtPence(avgBack, d.currency)}`),
          React.createElement('p', { className: 'font-bold' }, `Average loss per box:   ${fmtPence(lossEach, d.currency)}`),
          React.createElement('p', { className: 'border-t border-[var(--color-border)] pt-1' }, `Open ${tries} boxes — spend: ${fmtPence(totalSpent, d.currency)}`),
          React.createElement('p', null, `Get back (value):      ${fmtPence(totalBack, d.currency)}`),
          React.createElement('p', { style: { color: 'var(--brand-primary)', fontWeight: 'bold' } }, `Lost to the house:     ${fmtPence(totalLost, d.currency)}`)
        ),
        React.createElement('p', { className: 'text-[0.8125rem] leading-relaxed' },
          `That ${fmtPence(totalLost, d.currency)} is `, React.createElement('strong', null, `${choresLost} chores`), ` of real effort, gone — not to a thing you chose, but to chance. The flashy animation hides a simple truth: the more boxes you open, the closer your result gets to that guaranteed loss.`
        )
      )
    },
    quiz: [
      {
        question: 'After a coin lands heads five times in a row, what are the odds the next flip is heads?',
        options: [
          { label: 'A', text: 'Lower — tails is "due" now' },
          { label: 'B', text: 'Still 50% — each flip is independent of the last' },
          { label: 'C', text: 'Higher — heads is on a streak' },
        ],
        correct: 'B',
        explanation: 'This is the gambler\'s fallacy. The coin has no memory — every flip is 50/50 regardless of what came before. Believing you\'re "due" a result is what keeps gamblers betting.',
      },
      {
        question: 'Why does "the house always win" over the long run?',
        options: [
          { label: 'A', text: 'The games are random, so it\'s pure luck either way' },
          { label: 'B', text: 'Games are designed so players get back less than they pay in on average — the gap is the operator\'s profit' },
          { label: 'C', text: 'The house cheats on every single game' },
        ],
        correct: 'B',
        explanation: 'It isn\'t cheating — it\'s the "house edge" built into the odds. You might win occasionally, but the longer you play, the closer you get to the average outcome, which is a loss for you.',
      },
      {
        question: 'What makes loot boxes so effective at keeping you spending?',
        options: [
          { label: 'A', text: 'They always give you exactly what you want' },
          { label: 'B', text: 'Unpredictable "variable" rewards and near-misses are designed to keep you opening "one more"' },
          { label: 'C', text: 'They are free, so there\'s no harm in trying' },
        ],
        correct: 'B',
        explanation: 'Not knowing when the good reward will come is exactly what makes the urge so strong. Near-misses and flashy effects are deliberate design choices that make losing feel like almost-winning.',
      },
    ],
  },

  // ── M21: Consumer Rights & Contracts ─────────────────────────────────────
  {
    slug:        'M21',
    title:       'Consumer Rights & Contracts',
    pillar:      2,
    level:       3,
    icon:        ScrollText,
    triggerHint: 'Triggered when you complete a goal purchase',
    description: 'Every purchase is a contract — and the law gives you rights a "no refunds" sign can\'t remove.',
    actMinutes:  { hook: 2, lesson: 6, lab: 6, quiz: 4 },  // 18 min total
    illustration: (locked) => React.createElement('svg', { width: '100%', height: 64, viewBox: '0 0 160 64', fill: 'none' },
      // Contract document — teal
      React.createElement('rect', { x: 44, y: 8, width: 72, height: 48, rx: 5, fill: c(locked, 0.06), stroke: c(locked, 0.35), strokeWidth: 1.5 }),
      // Small-print lines — teal
      React.createElement('rect', { x: 52, y: 18, width: 44, height: 4, rx: 2, fill: c(locked, 0.22) }),
      React.createElement('rect', { x: 52, y: 26, width: 56, height: 4, rx: 2, fill: c(locked, 0.16) }),
      React.createElement('rect', { x: 52, y: 34, width: 50, height: 4, rx: 2, fill: c(locked, 0.16) }),
      // Seal of your rights — gold tick
      React.createElement('circle', { cx: 100, cy: 46, r: 9, fill: cGold(locked, 0.18), stroke: cGold(locked, 0.55), strokeWidth: 1.5 }),
      React.createElement('path', { d: 'M96 46 L99 49 L105 42', stroke: cGold(locked, 0.9), strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }),
    ),
    hook: (d) => React.createElement('div', { className: 'flex flex-col gap-3' },
      React.createElement('p', { className: 'text-[0.9375rem] font-bold leading-snug' },
        d.appView === 'ORCHARD'
          ? 'Every trade at the orchard market is a two-way promise: your coins for sound fruit. When the fruit turns out rotten, the law sides with the buyer — even if the stall has a "no swaps" sign.'
          : 'Every time you buy something you enter a legal contract — and UK law gives you rights the seller cannot take away, no matter what their returns sign says.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        'Knowing your rights turns "I suppose I\'m stuck with it" into "actually, I\'m owed a refund." It\'s one of the most useful — and least taught — money skills there is.'
      )
    ),
    lesson: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'A purchase is a contract: '),
        'When you buy something, you and the seller make a legal agreement. In the UK, the ', React.createElement('strong', null, 'Consumer Rights Act 2015'), ' says everything you buy must be:'
      ),
      React.createElement('ol', { className: 'flex flex-col gap-2 pl-4 list-decimal text-[0.875rem]' },
        React.createElement('li', null, React.createElement('strong', null, 'Of satisfactory quality '), '— not faulty or damaged.'),
        React.createElement('li', null, React.createElement('strong', null, 'Fit for purpose '), '— it does what it\'s meant to do.'),
        React.createElement('li', null, React.createElement('strong', null, 'As described '), '— it matches the photo, label or claims.')
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'If it\'s faulty: '),
        'You have a ', React.createElement('strong', null, '30-day right to reject'), ' it for a full refund. After that, you\'re entitled to a repair or replacement. A shop sign saying "no refunds" is meaningless for faulty goods — your legal rights override it.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Changed your mind? '),
        'In a shop there\'s no automatic right to a refund for simply changing your mind — returns are the shop\'s goodwill. But buy ', React.createElement('strong', null, 'online'), ' and you usually get a 14-day cooling-off period to return it for any reason.'
      ),
      React.createElement('p', { className: 'text-[0.875rem] leading-relaxed' },
        React.createElement('strong', null, 'Watch the small print: '),
        'Free trials that auto-renew into paid subscriptions are a common trap. Always check what happens when the trial ends — and keep receipts and order confirmations as proof of the contract.'
      )
    ),
    lab: (_d) => React.createElement('div', { className: 'flex flex-col gap-4' },
      React.createElement('p', { className: 'text-[0.875rem] font-semibold' }, 'Know your rights. For each case, what are you actually entitled to?'),
      ...[
        { scenario: 'Headphones you bought in a shop 10 days ago stop working through no fault of yours.', answer: 'FULL REFUND', why: 'Faulty goods within 30 days — you have the right to reject them for a full refund under the Consumer Rights Act.' },
        { scenario: 'The shop has a big "STRICTLY NO REFUNDS" sign by the till. Your new kettle arrived broken.', answer: 'YOUR RIGHTS WIN', why: 'A "no refunds" sign cannot remove your legal rights for faulty goods. It is not enforceable here.' },
        { scenario: 'You bought a jumper online, it fits fine, but you\'ve gone off the colour. It arrived 3 days ago.', answer: 'RETURN IT (ONLINE)', why: 'Online purchases come with a 14-day cooling-off period — you can return it just for changing your mind. (In-store, this would be goodwill only.)' },
      ].map((item, i) => React.createElement('div', { key: i, className: 'rounded-xl border border-[var(--color-border)] p-3 flex flex-col gap-2' },
        React.createElement('p', { className: 'text-[0.8125rem]' }, item.scenario),
        React.createElement('p', { className: 'text-[0.75rem] font-bold text-[var(--brand-primary)]' }, item.answer),
        React.createElement('p', { className: 'text-[0.75rem] text-[var(--color-text-muted)]' }, item.why)
      ))
    ),
    quiz: [
      {
        question: 'Under the Consumer Rights Act 2015, goods you buy must be all of the following EXCEPT:',
        options: [
          { label: 'A', text: 'Of satisfactory quality' },
          { label: 'B', text: 'Fit for purpose and as described' },
          { label: 'C', text: 'The cheapest available version' },
        ],
        correct: 'C',
        explanation: 'The three legal standards are satisfactory quality, fit for purpose, and as described. There\'s no rule that goods must be cheap — only that they meet those quality standards.',
      },
      {
        question: 'A shop has a "no refunds" sign. You bought a toaster that turned out to be faulty. What are your rights?',
        options: [
          { label: 'A', text: 'None — the sign means no refunds' },
          { label: 'B', text: 'You\'re entitled to a refund or repair; the sign can\'t remove your legal rights for faulty goods' },
          { label: 'C', text: 'You can only get store credit' },
        ],
        correct: 'B',
        explanation: 'Your statutory rights for faulty goods cannot be signed away by the shop. A "no refunds" notice has no legal force when an item is faulty — within 30 days you can claim a full refund.',
      },
      {
        question: 'You change your mind about a non-faulty item. When do you have an automatic right to return it?',
        options: [
          { label: 'A', text: 'Always, in any shop' },
          { label: 'B', text: 'When you bought it online — there\'s usually a 14-day cooling-off period' },
          { label: 'C', text: 'Never — you can never return something you simply don\'t want' },
        ],
        correct: 'B',
        explanation: 'For online purchases you typically get 14 days to change your mind and return for a refund. In a physical shop, returns for a change of mind are goodwill, not a legal right.',
      },
    ],
  },
]
