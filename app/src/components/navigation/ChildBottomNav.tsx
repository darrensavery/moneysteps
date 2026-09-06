import { Home, ClipboardList, Wallet, Target, GraduationCap } from 'lucide-react'
import type { ComponentType } from 'react'
import { tick } from '../../lib/haptics'

type Tab = 'home' | 'chores' | 'money' | 'goals' | 'lab'

interface TabDef {
  id: Tab
  label: string
  Icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
}

const TABS: TabDef[] = [
  { id: 'home',   label: 'Home',   Icon: Home          },
  { id: 'chores', label: 'Chores', Icon: ClipboardList },
  { id: 'money',  label: 'Money',  Icon: Wallet        },
  { id: 'goals',  label: 'Goals',  Icon: Target        },
  { id: 'lab',    label: 'Learn',  Icon: GraduationCap },
]

interface Props {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  badges?: Partial<Record<Tab, number>>
  disabled?: boolean
}

export function ChildBottomNav({ activeTab, onTabChange, badges = {}, disabled = false }: Props) {
  const activeIndex = TABS.findIndex(t => t.id === activeTab)

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const nextIndex = e.key === 'ArrowRight'
      ? (index + 1) % TABS.length
      : (index - 1 + TABS.length) % TABS.length
    const nextButton = e.currentTarget.parentElement?.querySelectorAll('button')[nextIndex] as HTMLButtonElement | undefined
    nextButton?.focus()
  }

  return (
    <>
      <style>{`
        @keyframes badge-pop {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .badge-pop {
          animation: badge-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
      `}</style>

      <div
        className="fixed bottom-0 inset-x-0 z-30 flex justify-center pointer-events-none"
        role="navigation"
        aria-label="Main navigation"
      >
        <div
          className="pointer-events-auto w-full max-w-[520px] mx-3"
          style={{ marginBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
          <nav className={`relative flex items-stretch bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.10),0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.40),0_2px_8px_rgba(0,0,0,0.20)] transition-opacity duration-200 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>

            {/* Sliding active pill — equal 4px inset on all sides */}
            <div
              className="absolute inset-y-1 rounded-xl bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] pointer-events-none"
              style={{
                left:       `calc(${activeIndex} * ${100 / TABS.length}% + 4px)`,
                width:      `calc(${100 / TABS.length}% - 8px)`,
                transition: 'left 280ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              aria-hidden="true"
            />

            {TABS.map(({ id, label, Icon }, index) => {
              const badge = badges[id]
              const isActive = activeTab === id

              return (
                <button
                  key={id}
                  onClick={() => { void tick(); onTabChange(id) }}
                  onKeyDown={e => handleKeyDown(e, index)}
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  className="relative z-10 flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 cursor-pointer select-none transition-transform duration-75 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                >
                  {/* Icon wrapper — badge anchors to this */}
                  <div className="relative">
                    <Icon
                      size={20}
                      strokeWidth={isActive ? 2.25 : 1.75}
                      className={`transition-colors duration-200 ${
                        isActive
                          ? 'text-[var(--brand-primary)]'
                          : 'text-[var(--color-text-muted)]'
                      }`}
                    />
                    {badge != null && badge > 0 && (
                      <span
                        key={badge}
                        className="badge-pop absolute -top-1.5 -right-2 bg-red-500 text-white text-[0.5625rem] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-[3px] leading-none tabular-nums"
                      >
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`text-[0.625rem] font-semibold tracking-tight transition-colors duration-200 ${
                      isActive
                        ? 'text-[var(--brand-primary)]'
                        : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    </>
  )
}
