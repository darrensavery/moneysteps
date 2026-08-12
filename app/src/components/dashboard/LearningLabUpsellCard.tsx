/**
 * LearningLabUpsellCard — shown in the Insights tab's Learning Lab slot for
 * post-trial Core-only parents (has_ai_mentor and has_shield both false).
 * Deep-links to Settings → Plans & Upgrades via onUpgrade.
 */

import { PremiumShell, MentorAvatar } from '../ui/PremiumShell'

interface Props {
  childName: string
  onUpgrade: () => void
}

export function LearningLabUpsellCard({ childName, onUpgrade }: Props) {
  return (
    <PremiumShell>
      <div className="relative p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <MentorAvatar accent="#d4a017" />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-white leading-snug">
              Unlock Learning Lab for {childName}
            </p>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
              25 short modules that turn {childName}'s real chores and savings into financial lessons —
              plus deeper AI Mentor coaching.
            </p>
          </div>
        </div>

        <button
          onClick={onUpgrade}
          className="w-full h-10 rounded-xl text-[13px] font-bold transition-all duration-150 active:scale-[0.98] cursor-pointer"
          style={{ background: '#d4a017', color: '#1a1206' }}
        >
          Add AI Mentor + Learning Lab — £29.99
        </button>
      </div>
    </PremiumShell>
  )
}
