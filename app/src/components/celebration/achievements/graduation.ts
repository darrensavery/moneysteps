import type { MilestoneConfig } from '../types'

export const GRADUATION: MilestoneConfig = {
  key:      'graduation',
  bgColor:  '#0f1a14',
  transition: 'shimmer',

  orchard: [
    {
      icon:         '🌳',
      heading:      "You've mastered the Harvest.",
      body:         '"Every seed you planted, every drop of rainfall you saved — it brought you here. You\'re ready for something bigger."',
      attribution:  '— The Head Orchardist',
      headingColor: 'text-emerald-300',
      bodyColor:    'text-emerald-200/70',
      durationMs:   3000,
    },
    {
      icon:         '📊',
      heading:      'Welcome to your Professional Ledger.',
      body:         '"Your financial journey starts now. Track your balance, set targets, and build real wealth habits."',
      attribution:  '— The High-Integrity Mentor',
      headingColor: 'text-white',
      bodyColor:    'text-white/60',
      durationMs:   3500,
    },
  ],

  clean: [
    {
      icon:         '📈',
      heading:      'Account Upgraded.',
      body:         'Your account has been upgraded to Professional View. You now have access to full financial analytics and detailed transaction history.',
      attribution:  '— The High-Integrity Mentor',
      headingColor: 'text-white',
      bodyColor:    'text-white/60',
      durationMs:   4000,
    },
  ],
}
