import { useState, useRef } from 'react'
import type { LabModuleProgress } from '../../lib/api'
import { PILLAR_ICONS, PILLAR_LABELS } from '../../lib/curriculum'

const ACT_LABELS = ['Hook', 'Lesson', 'Lab', 'Quiz'] as const

interface Props {
  childName:             string
  currentModule:         { slug: string; title: string; progress_pct: number; pillar: string } | null
  labModuleProgress:     LabModuleProgress[]
  labActsCompleted:      number
  labTimeInvestedMinutes: number
  labLastActiveAt:       number | null
  retentionScore:        number | null
  // Legacy — kept for backwards compat with older API responses
  completedSlugs?:       string[]
}

function PillarIcon({ pillar, size = 18 }: { pillar: string; size?: number }) {
  const d = PILLAR_ICONS[pillar] ?? PILLAR_ICONS.LABOR_VALUE
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d}/>
    </svg>
  )
}

function relativeTime(epoch: number): string {
  const diffSecs = Math.floor(Date.now() / 1000) - epoch
  if (diffSecs < 60)          return 'just now'
  if (diffSecs < 3600)        return `${Math.floor(diffSecs / 60)}m ago`
  if (diffSecs < 86400)       return `${Math.floor(diffSecs / 3600)}h ago`
  if (diffSecs < 7 * 86400)   return `${Math.floor(diffSecs / 86400)}d ago`
  if (diffSecs < 30 * 86400)  return `${Math.floor(diffSecs / 86400 / 7)}w ago`
  return `${Math.floor(diffSecs / 86400 / 30)}mo ago`
}

function ModuleDetailSheet({
  mod,
  onClose,
}: {
  mod:     LabModuleProgress
  onClose: () => void
}) {
  const allDone   = mod.completed_acts.length === 4
  const inProgress = mod.completed_acts.length > 0 && !allDone

  const statusLabel = allDone ? 'Completed' : inProgress ? 'In Progress' : 'Unlocked'
  const statusColor = allDone     ? 'var(--brand-primary)'
                    : inProgress  ? '#d97706'
                    : 'var(--color-text-muted)'
  const statusBg    = allDone     ? 'color-mix(in srgb, var(--brand-primary) 10%, transparent)'
                    : inProgress  ? 'color-mix(in srgb, #f59e0b 10%, transparent)'
                    : 'var(--color-surface-alt)'
  const statusBorder = allDone    ? 'color-mix(in srgb, var(--brand-primary) 30%, transparent)'
                    : inProgress  ? 'color-mix(in srgb, #f59e0b 30%, transparent)'
                    : 'var(--color-border)'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl overflow-hidden shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: statusBg, border: `1.5px solid ${statusBorder}`, color: statusColor }}>
              <PillarIcon pillar={mod.pillar} size={20}/>
            </div>
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-wide" style={{ color: statusColor }}>
                {statusLabel}
              </p>
              <p className="text-[0.9375rem] font-extrabold text-[var(--color-text)] leading-snug mt-0.5">
                {mod.title}
              </p>
              <p className="text-[0.625rem] text-[var(--color-text-muted)] mt-0.5">
                {PILLAR_LABELS[mod.pillar] ?? mod.pillar} · Level {mod.level}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] cursor-pointer shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Act progress */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Progress
          </p>
          <div className="flex gap-2">
            {ACT_LABELS.map((label, i) => {
              const actNum   = i + 1
              const done     = mod.completed_acts.includes(actNum)
              const isCurrent = !done && mod.completed_acts.length === i
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full h-1.5 rounded-full"
                    style={{
                      backgroundColor: done
                        ? 'var(--brand-primary)'
                        : isCurrent
                          ? 'rgba(0,149,156,0.3)'
                          : 'var(--color-border)',
                    }}
                  />
                  <span
                    className="text-[0.5625rem] font-semibold uppercase tracking-wide"
                    style={{ color: done ? 'var(--brand-primary)' : 'var(--color-text-muted)' }}
                  >
                    {done ? `${label} ✓` : label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Time stats */}
        <div className="px-5 py-3 flex gap-4 border-t border-[var(--color-border)]">
          <div>
            <p className="text-[0.625rem] text-[var(--color-text-muted)]">Time invested</p>
            <p className="text-[0.8125rem] font-bold text-[var(--color-text)]">
              {mod.minutes_done > 0 ? `~${mod.minutes_done} min` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[0.625rem] text-[var(--color-text-muted)]">Total module</p>
            <p className="text-[0.8125rem] font-bold text-[var(--color-text)]">~{mod.total_minutes} min</p>
          </div>
          {!allDone && mod.minutes_done > 0 && (
            <div>
              <p className="text-[0.625rem] text-[var(--color-text-muted)]">Remaining</p>
              <p className="text-[0.8125rem] font-bold text-[var(--color-text)]">
                ~{mod.total_minutes - mod.minutes_done} min
              </p>
            </div>
          )}
        </div>

        <div className="px-5 pb-5">
          <button onClick={onClose}
            className="w-full mt-2 py-3 rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[0.8125rem] font-semibold text-[var(--color-text-muted)] cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function LabSection({
  childName,
  currentModule,
  labModuleProgress,
  labActsCompleted,
  labTimeInvestedMinutes,
  labLastActiveAt,
  retentionScore,
}: Props) {
  const [detailSlug, setDetailSlug] = useState<string | null>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const dragState  = useRef({ dragging: false, moved: false, startX: 0, scrollLeft: 0 })

  function onMouseDown(e: React.MouseEvent) {
    const el = scrollRef.current; if (!el) return
    dragState.current = { dragging: true, moved: false, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft }
    el.style.cursor = 'grabbing'
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragState.current.dragging || !scrollRef.current) return
    e.preventDefault()
    const delta = e.pageX - scrollRef.current.offsetLeft - dragState.current.startX
    if (Math.abs(delta) > 4) dragState.current.moved = true
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - delta
  }
  function onMouseUp() {
    dragState.current.dragging = false
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab'
  }

  const detailMod     = detailSlug ? labModuleProgress.find(m => m.slug === detailSlug) : null
  const totalUnlocked = labModuleProgress.length
  const totalDone     = labModuleProgress.filter(m => m.completed_acts.length === 4).length

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-[0.75rem] font-bold text-[var(--color-text)]">
          {childName}'s Learning Lab
        </p>
        <span className="text-[0.625rem] font-bold px-2.5 py-1 rounded-full border"
          style={{
            background:  'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--brand-primary) 25%, transparent)',
            color:       'var(--brand-primary)',
          }}>
          {totalUnlocked === 0 ? 'Not started' : totalDone === totalUnlocked && totalUnlocked > 0 ? `All ${totalDone} done` : `${totalDone} of ${totalUnlocked} done`}
        </span>
      </div>

      {/* ── Summary stats ── */}
      {totalUnlocked > 0 && (
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
          <div className="px-3 py-2.5 text-center">
            <p className="text-[1rem] font-extrabold text-[var(--color-text)] tabular-nums">{labActsCompleted}</p>
            <p className="text-[0.625rem] text-[var(--color-text-muted)] leading-tight">acts done</p>
          </div>
          <div className="px-3 py-2.5 text-center">
            <p className="text-[1rem] font-extrabold text-[var(--color-text)] tabular-nums">
              {labTimeInvestedMinutes > 0 ? `~${labTimeInvestedMinutes}m` : '—'}
            </p>
            <p className="text-[0.625rem] text-[var(--color-text-muted)] leading-tight">time invested</p>
          </div>
          <div className="px-3 py-2.5 text-center">
            <p className="text-[1rem] font-extrabold tabular-nums"
              style={{ color: retentionScore !== null ? 'var(--brand-primary)' : 'var(--color-text)' }}>
              {retentionScore !== null ? `${retentionScore}%` : '—'}
            </p>
            <p className="text-[0.625rem] text-[var(--color-text-muted)] leading-tight">quiz pass rate</p>
          </div>
        </div>
      )}

      {/* ── Current module act strip ── */}
      {currentModule && (() => {
        const cm = labModuleProgress.find(m => m.slug === currentModule.slug)
        if (!cm) return null
        return (
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[0.75rem] font-semibold text-[var(--color-text)]">
                Now studying: <span className="font-bold">{currentModule.title}</span>
              </p>
              {labLastActiveAt && (
                <span className="text-[0.625rem] text-[var(--color-text-muted)]">
                  {relativeTime(labLastActiveAt)}
                </span>
              )}
            </div>
            {/* Act-by-act strip */}
            <div className="flex gap-1.5 mb-1.5">
              {ACT_LABELS.map((label, i) => {
                const done = cm.completed_acts.includes(i + 1)
                const next = !done && cm.completed_acts.length === i
                return (
                  <div key={i} className="flex-1">
                    <div className="h-1.5 rounded-full mb-1"
                      style={{
                        backgroundColor: done ? 'var(--brand-primary)'
                          : next ? 'rgba(0,149,156,0.3)'
                          : 'var(--color-border)',
                      }}/>
                    <p className="text-[0.5625rem] text-center font-medium"
                      style={{ color: done ? 'var(--brand-primary)' : next ? '#d97706' : 'var(--color-text-muted)' }}>
                      {done ? `${label} ✓` : next ? `${label} →` : label}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Module carousel ── */}
      {totalUnlocked > 0 ? (
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[0.625rem] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
              Unlocked modules
            </p>
            <div className="flex items-center gap-1 text-[0.625rem] text-[var(--color-text-muted)]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              <span>scroll</span>
            </div>
          </div>
          <div className="relative">
            <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to right, transparent, var(--color-surface))' }}/>
            <div
              ref={scrollRef}
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: 'none', overflowY: 'visible', cursor: 'grab', userSelect: 'none' }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            >
              {labModuleProgress.map(mod => {
                const allDone    = mod.completed_acts.length === 4
                const inProgress = mod.completed_acts.length > 0 && !allDone
                const isCurrent  = currentModule?.slug === mod.slug

                const cardBorder = allDone    ? 'var(--brand-primary)'
                                 : isCurrent  ? '#f59e0b'
                                 : 'var(--color-border)'
                const cardBg     = allDone    ? 'color-mix(in srgb, var(--brand-primary) 10%, var(--color-surface))'
                                 : isCurrent  ? 'color-mix(in srgb, #f59e0b 10%, var(--color-surface))'
                                 : 'var(--color-surface-alt)'
                const iconColor  = allDone    ? 'var(--brand-primary)'
                                 : isCurrent  ? '#d97706'
                                 : 'var(--color-text-muted)'

                return (
                  <button
                    key={mod.slug}
                    type="button"
                    onClick={() => { if (!dragState.current.moved) setDetailSlug(mod.slug) }}
                    className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer transition-opacity hover:opacity-80"
                    style={{ width: 72 }}
                  >
                    <div className="relative pt-2">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center border-2"
                        style={{ borderColor: cardBorder, background: cardBg, color: iconColor }}>
                        <PillarIcon pillar={mod.pillar} size={20}/>

                        {/* Act mini-progress: 4 dots */}
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                          {[1,2,3,4].map(a => (
                            <div key={a} className="w-1.5 h-1.5 rounded-full border border-white"
                              style={{ backgroundColor: mod.completed_acts.includes(a) ? 'var(--brand-primary)' : 'var(--color-border)' }}/>
                          ))}
                        </div>

                        {allDone && (
                          <div className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: 'var(--brand-primary)', border: '2px solid var(--color-surface)' }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                              <path d="M20 6 9 17l-5-5"/>
                            </svg>
                          </div>
                        )}
                        {isCurrent && !allDone && (
                          <div className="absolute top-0 right-0 w-4 h-4 rounded-full"
                            style={{ background: '#f59e0b', border: '2px solid var(--color-surface)' }}/>
                        )}
                      </div>
                    </div>

                    <span className="text-[0.625rem] text-center leading-tight font-semibold px-1"
                      style={{ color: allDone ? 'var(--brand-primary)' : isCurrent ? '#d97706' : 'var(--color-text-muted)' }}>
                      {mod.title.length > 14 ? mod.title.substring(0, 13) + '…' : mod.title}
                    </span>

                    {inProgress && (
                      <span className="text-[0.5625rem] text-[var(--color-text-muted)]">
                        {mod.completed_acts.length}/4 acts
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-5 text-center">
          <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
            No modules unlocked yet — they open as {childName} earns, saves, and sets goals.
          </p>
        </div>
      )}

      {/* Module detail sheet */}
      {detailMod && (
        <ModuleDetailSheet mod={detailMod} onClose={() => setDetailSlug(null)}/>
      )}
    </div>
  )
}
