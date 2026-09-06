// app/src/components/dashboard/LabTab.tsx
// Learning Lab — level-grouped module grid, behaviour-triggered unlocks only.
// No chat input — the Mentor is observation-driven, not interactive.

import { useState, useEffect } from 'react'
import { Lock, BookOpen } from 'lucide-react'
import { getLabModules, type LabModulesResponse } from '../../lib/api'
import {
  MODULES, LEVEL_LABELS, PILLARS, totalMinutes, remainingMinutes,
  type ModuleSlug, type AgeLevel, type AppView, type ChildLabData,
} from '../../lib/labCatalogue'
import { ModuleReader } from './ModuleReader'

const INTRO_DISMISSED_KEY = 'lab_intro_dismissed'

interface LabTabProps {
  appView: AppView
}

export function LabTab({ appView }: LabTabProps) {
  const [labData,       setLabData]       = useState<LabModulesResponse | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [activeSlug,    setActiveSlug]    = useState<ModuleSlug | null>(null)
  const [introDismissed, setIntroDismissed] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem(INTRO_DISMISSED_KEY) === '1'
  )

  function dismissIntro() {
    localStorage.setItem(INTRO_DISMISSED_KEY, '1')
    setIntroDismissed(true)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getLabModules()
      .then(res => { if (!cancelled) { setLabData(res); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load modules.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const levels: AgeLevel[]      = [2, 3, 4]
  const childAge                 = (labData?.ageLevel ?? 2) as AgeLevel
  const unlockedSlugs            = new Set(Object.keys(labData?.modules ?? {}))
  const childLabData: ChildLabData | null = labData
    ? { ...labData.childData, appView }
    : null

  if (loading) return (
    <div className="flex flex-col gap-3 pt-1">
      {[1,2,3,4,5,6].map(i => (
        <div key={i} className="animate-pulse rounded-xl bg-[var(--color-border)] h-20" />
      ))}
    </div>
  )

  if (error || !labData) return (
    <p className="text-[0.8125rem] text-red-500 pt-2">{error ?? 'No data'}</p>
  )

  const totalUnlocked = Object.keys(labData.modules).length
  const totalModules  = MODULES.length

  return (
    <div className="flex flex-col gap-7">

      {/* ── Introduction ── */}
      {!introDismissed && (
        <div className="rounded-xl border border-teal-500/30 bg-[color-mix(in_srgb,var(--brand-primary)_7%,var(--color-surface))] p-4 flex flex-col gap-3 relative">
          {/* Dismiss button */}
          <button
            onClick={dismissIntro}
            className="absolute top-3 right-3 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Dismiss introduction"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>

          <h2 className="text-[0.875rem] font-bold text-[var(--color-text)] leading-snug pr-6">
            {appView === 'ORCHARD' ? 'The Orchard Curriculum' : 'Learning Lab'}
          </h2>

          {appView === 'ORCHARD' ? (
            <p className="text-[0.8125rem] text-[var(--color-text-muted)] leading-relaxed">
              Seventeen modules on the money skills that actually matter — how wages work, how to spot a financial trap before it closes, how savings compound into something real.
              The kind of knowledge most adults had to learn the hard way, usually after it cost them.
            </p>
          ) : (
            <p className="text-[0.8125rem] text-[var(--color-text-muted)] leading-relaxed">
              17 modules covering earnings, tax, saving, debt, and investment — financial concepts most adults encountered too late.
              Each lesson uses your actual figures, not textbook examples.
            </p>
          )}

          <div className="flex items-start gap-2.5 pt-1 border-t border-[var(--color-border)]">
            <svg className="flex-shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-relaxed">
              {appView === 'ORCHARD'
                ? 'Modules don\'t unlock by tapping buttons — they unlock when you do something. Save for four weeks and compound interest opens. Create a gaming goal and digital currency unlocks.'
                : 'Modules unlock based on your activity. Save consistently for four weeks and compound interest triggers. Each lesson arrives when your data makes it directly relevant.'}
            </p>
          </div>

          {totalUnlocked > 0 && (
            <p className="text-[0.6875rem] font-semibold text-[var(--brand-primary)]">
              {totalUnlocked} of {totalModules} unlocked
            </p>
          )}
        </div>
      )}

      {levels.map(level => {
        const levelModules  = MODULES.filter(m => m.level === level)
        const unlockedCount = levelModules.filter(m => unlockedSlugs.has(m.slug)).length
        const levelLabel    = LEVEL_LABELS[level][appView]
        const isFuture      = level > childAge
        const totalCount    = levelModules.length

        return (
          <section key={level}>

            {/* ── Level header ── */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.5625rem] font-bold shrink-0 ${
                  isFuture
                    ? 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                    : 'bg-[var(--brand-primary)] text-white'
                }`}>
                  {level - 1}
                </span>
                <div>
                  <h2 className={`text-[0.6875rem] font-bold uppercase tracking-[0.08em] ${isFuture ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                    {levelLabel}
                    {isFuture && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-[0.625rem]">
                        · unlocks later
                      </span>
                    )}
                  </h2>
                  <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-0.5">
                    {unlockedCount} of {totalCount} {unlockedCount === totalCount && totalCount > 0 ? '— complete' : 'unlocked'}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              {!isFuture && (
                <div className="w-16 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: totalCount > 0 ? `${(unlockedCount / totalCount) * 100}%` : '0%',
                      backgroundColor: 'var(--brand-primary)',
                    }}
                  />
                </div>
              )}
            </div>

            {/* ── 2-column tile grid ── */}
            <div className="grid grid-cols-2 gap-2.5">
              {levelModules.map(mod => {
                const isUnlocked  = unlockedSlugs.has(mod.slug)
                const pillarLabel = appView === 'ORCHARD' ? PILLARS[mod.pillar].orchardName : PILLARS[mod.pillar].name

                // ── Too advanced ──
                if (isFuture) {
                  return (
                    <div key={mod.slug} className="rounded-xl overflow-hidden opacity-30 flex flex-col" style={{ background: 'var(--color-surface-alt)' }}>
                      <div className="w-full overflow-hidden" style={{ height: 64, background: 'var(--color-border)' }}>
                        {mod.illustration(true)}
                      </div>
                      <div className="p-2.5 flex flex-col gap-1">
                        <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] leading-tight">{mod.title}</p>
                        <p className="text-[0.5625rem] text-[var(--color-text-muted)]">{levelLabel}</p>
                      </div>
                    </div>
                  )
                }

                // ── Locked (within level) ──
                if (!isUnlocked) {
                  return (
                    <div key={mod.slug} className="rounded-xl overflow-hidden flex flex-col border-t-2 border-t-amber-400/50" style={{ background: 'var(--color-surface-alt)' }}>
                      <div className="w-full overflow-hidden" style={{ height: 64 }}>
                        {mod.illustration(true)}
                      </div>
                      <div className="p-2.5 flex flex-col gap-1.5">
                        <p className="text-[0.6875rem] font-bold text-[var(--color-text)] leading-tight">{mod.title}</p>
                        <p className="text-[0.6875rem] text-[var(--color-text-muted)] leading-tight line-clamp-2">{mod.description}</p>
                        <div className="flex items-center justify-between mt-auto pt-0.5">
                          <p className="text-[0.625rem] text-[var(--color-text-muted)] leading-tight flex-1 pr-2 italic">{mod.triggerHint}</p>
                          <Lock size={9} className="text-amber-400/70 flex-shrink-0" />
                        </div>
                      </div>
                    </div>
                  )
                }

                // ── Unlocked ──
                const completedActs = labData.modules[mod.slug]?.completed_acts ?? []
                const allDone       = completedActs.length === 4
                const minsLeft      = remainingMinutes(mod.actMinutes, completedActs)
                const totalMins     = totalMinutes(mod.actMinutes)

                return (
                  <button
                    key={mod.slug}
                    onClick={() => setActiveSlug(mod.slug as ModuleSlug)}
                    className="rounded-xl overflow-hidden flex flex-col text-left cursor-pointer transition-all hover:shadow-md hover:-translate-y-px active:translate-y-0 border-t-2 border-t-[var(--brand-primary)]"
                    style={{ background: 'var(--color-surface)', boxShadow: '0 1px 6px rgba(0,0,0,0.09)' }}
                  >
                    {/* Illustration — no badge overlay */}
                    <div className="w-full overflow-hidden" style={{ height: 64, background: 'rgba(0,149,156,0.05)' }}>
                      {mod.illustration(false)}
                    </div>

                    {/* Text content */}
                    <div className="p-2.5 flex flex-col gap-1 flex-1 relative">
                      <p className="text-[0.6875rem] font-bold text-[var(--color-text)] leading-tight">{mod.title}</p>
                      <p className="text-[0.6875rem] text-[var(--color-text-muted)] leading-tight line-clamp-2">{mod.description}</p>
                      {/* Pillar label left, status badge bottom-right */}
                      <div className="flex items-end justify-between mt-auto pt-1">
                        <p className="text-[0.5rem] font-semibold text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] px-1.5 py-0.5 rounded-full leading-none">{pillarLabel}</p>
                        {allDone ? (
                          <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full text-white leading-none" style={{ background: 'var(--brand-primary)' }}>
                            ✓ Done
                          </span>
                        ) : completedActs.length > 0 ? (
                          <span className="text-[0.5rem] font-semibold px-1.5 py-0.5 rounded-full leading-none" style={{ background: 'rgba(0,149,156,0.12)', color: 'var(--brand-primary)' }}>
                            ~{minsLeft}m left
                          </span>
                        ) : (
                          <span className="text-[0.5rem] text-[var(--color-text-muted)] font-medium leading-none">
                            ~{totalMins}m
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* ── Empty state if no modules at all ── */}
      {!loading && MODULES.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10">
          <BookOpen size={32} className="text-[var(--color-text-muted)]" />
          <p className="text-[0.8125rem] text-[var(--color-text-muted)] text-center">
            Modules unlock as you use the app.
          </p>
        </div>
      )}

      {/* ── Module Reader overlay ── */}
      {activeSlug && childLabData && labData && (
        <ModuleReader
          slug={activeSlug}
          childData={childLabData}
          completedActs={labData.modules[activeSlug]?.completed_acts ?? []}
          onActComplete={(actNum) => {
            setLabData(prev => {
              if (!prev) return prev
              const existing = prev.modules[activeSlug] ?? { unlocked_at: Date.now(), completed_acts: [] }
              const acts = existing.completed_acts.includes(actNum)
                ? existing.completed_acts
                : [...existing.completed_acts, actNum]
              return {
                ...prev,
                modules: { ...prev.modules, [activeSlug]: { ...existing, completed_acts: acts } },
              }
            })
          }}
          onClose={() => setActiveSlug(null)}
        />
      )}

    </div>
  )
}
