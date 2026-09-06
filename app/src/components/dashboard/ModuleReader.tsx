// app/src/components/dashboard/ModuleReader.tsx
// Four-act stepped module reader: Hook → Lesson → Lab → Quiz
// Full-screen overlay, resumable from last completed act.

import { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react'
import { MODULES, PILLARS, type ModuleSlug, type ChildLabData, type ActMinutes } from '../../lib/labCatalogue'
import { completeLabAct } from '../../lib/api'

const ACT_LABELS = ['Hook', 'Lesson', 'Lab', 'Quiz'] as const
type ActIndex = 0 | 1 | 2 | 3

interface ModuleReaderProps {
  slug:           ModuleSlug
  childData:      ChildLabData
  completedActs:  number[]
  onActComplete:  (actNum: 1 | 2 | 3 | 4) => void
  onClose:        () => void
}

export function ModuleReader({ slug, childData, completedActs, onActComplete, onClose }: ModuleReaderProps) {
  const mod    = MODULES.find(m => m.slug === slug)!
  // Pillar retained for semantic label; all chrome uses brand teal
  const pillar = PILLARS[mod.pillar]

  const firstIncomplete = ([0, 1, 2, 3] as ActIndex[]).find(i => !completedActs.includes(i + 1)) ?? 0
  const [actIndex,    setActIndex]    = useState<ActIndex>(firstIncomplete)
  const [quizAnswer,  setQuizAnswer]  = useState<'A' | 'B' | 'C' | null>(null)
  const [quizIdx,     setQuizIdx]     = useState(0)
  const [quizResults, setQuizResults] = useState<boolean[]>([])
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    setQuizAnswer(null)
    setQuizIdx(0)
    setQuizResults([])
  }, [actIndex])

  const actNum      = (actIndex + 1) as 1 | 2 | 3 | 4
  const isCompleted = completedActs.includes(actNum)

  async function markComplete() {
    if (saving || isCompleted) return
    setSaving(true)
    try {
      await completeLabAct(slug, actNum)
      onActComplete(actNum)
      const newActs = [...new Set([...completedActs, actNum])]
      try {
        localStorage.setItem('mc_lab_act_progress', JSON.stringify({
          completedActs: newActs,
          totalActs: 4,
          newAct: actNum,
          ts: Date.now(),
        }))
      } catch { /* storage unavailable */ }
    } catch { /* optimistic update applied — non-fatal */ }
    finally { setSaving(false) }
  }

  function handleNext() {
    if (!isCompleted) markComplete()
    if (actIndex < 3) setActIndex(prev => (prev + 1) as ActIndex)
    else onClose()
  }

  // ── Quiz renderer ─────────────────────────────────────────────────────────
  function renderQuiz() {
    const q = mod.quiz[quizIdx]
    if (!q) {
      return (
        <div className="flex flex-col gap-3 items-center py-8">
          <CheckCircle2 size={36} className="text-[var(--brand-primary)]" />
          <p className="text-[0.9375rem] font-semibold text-[var(--color-text)]">Quiz complete</p>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
            {quizResults.filter(Boolean).length} of {mod.quiz.length} correct
          </p>
        </div>
      )
    }

    const questionText = typeof q.question === 'function' ? q.question(childData) : q.question
    const answered     = quizAnswer !== null

    return (
      <div className="flex flex-col gap-4">
        <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.06em]">
          Question {quizIdx + 1} of {mod.quiz.length}
        </p>
        <p className="text-[0.9375rem] font-semibold leading-snug">{questionText}</p>
        <div className="flex flex-col gap-2">
          {q.options.map(opt => {
            const isSelected = quizAnswer === opt.label
            const isCorrect  = answered && opt.label === q.correct
            const isWrong    = answered && isSelected && opt.label !== q.correct
            return (
              <button
                key={opt.label}
                disabled={answered}
                onClick={() => {
                  setQuizAnswer(opt.label)
                  setQuizResults(prev => [...prev, opt.label === q.correct])
                }}
                className={[
                  'text-left rounded-xl border px-4 py-3 text-[0.8125rem] transition-colors',
                  answered ? '' : 'cursor-pointer hover:border-[var(--brand-primary)]',
                  isCorrect ? 'border-[var(--brand-primary)] bg-[rgba(0,149,156,0.06)] text-[var(--color-text)]' : '',
                  isWrong   ? 'border-red-400 bg-red-50 text-red-800' : '',
                  !answered ? 'border-[var(--color-border)]' : '',
                  answered && !isSelected && opt.label !== q.correct ? 'opacity-40' : '',
                ].filter(Boolean).join(' ')}
              >
                <span className="font-bold mr-2">{opt.label}.</span>{opt.text}
              </button>
            )
          })}
        </div>
        {answered && (
          <div className="rounded-xl bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-3 text-[0.8125rem] leading-relaxed">
            <span className="font-semibold">{quizAnswer === q.correct ? '✓ Correct. ' : '✗ Not quite. '}</span>
            {q.explanation}
          </div>
        )}
        {answered && quizIdx < mod.quiz.length - 1 && (
          <button
            onClick={() => { setQuizAnswer(null); setQuizIdx(prev => prev + 1) }}
            className="self-end text-[0.8125rem] font-semibold text-[var(--brand-primary)] cursor-pointer"
          >
            Next question →
          </button>
        )}
      </div>
    )
  }

  function renderAct() {
    switch (actIndex) {
      case 0: return mod.hook(childData)
      case 1: return mod.lesson(childData)
      case 2: return mod.lab(childData)
      case 3: return renderQuiz()
    }
  }

  const quizDone   = actIndex === 3 && (quizResults.length === mod.quiz.length || mod.quiz.length === 0)
  const canProceed = actIndex < 3 || quizDone

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => actIndex > 0 ? setActIndex(prev => (prev - 1) as ActIndex) : onClose()}
          className="tap-target-44 w-9 h-9 flex items-center justify-center rounded-xl border border-[var(--color-border)] cursor-pointer"
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[0.6875rem] font-semibold text-[var(--color-text)] tracking-wide">
            {mod.title}
          </span>
          <span className="text-[0.625rem] text-[var(--color-text-muted)]">
            {childData.appView === 'ORCHARD' ? pillar.orchardName : pillar.name}
            {' · '}~{(mod.actMinutes as ActMinutes)[(['hook','lesson','lab','quiz'] as (keyof ActMinutes)[])[actIndex]]}m
          </span>
        </div>
        <button
          onClick={onClose}
          className="tap-target-44 w-9 h-9 flex items-center justify-center rounded-xl border border-[var(--color-border)] cursor-pointer"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Act progress strip ── */}
      <div className="flex px-4 pt-3 pb-1 gap-1.5 bg-[var(--color-surface)]">
        {([0, 1, 2, 3] as ActIndex[]).map(i => (
          <div
            key={i}
            className="flex-1 h-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor: completedActs.includes(i + 1)
                ? 'var(--brand-primary)'
                : i === actIndex
                  ? 'rgba(0,149,156,0.25)'
                  : 'var(--color-border)',
            }}
          />
        ))}
      </div>

      {/* ── Act label row ── */}
      <div className="flex px-4 pb-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        {ACT_LABELS.map((label, i) => (
          <div key={i} className="flex-1 text-center">
            <span
              className="text-[0.5625rem] font-semibold uppercase tracking-[0.06em]"
              style={{
                color: i === actIndex
                  ? 'var(--brand-primary)'
                  : completedActs.includes(i + 1)
                    ? 'var(--brand-primary)'
                    : 'var(--color-text-muted)',
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Scrollable act content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {renderAct()}
      </div>

      {/* ── Footer CTA ── */}
      <div className="px-4 pb-6 pt-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        {!canProceed ? (
          <p className="text-center text-[0.8125rem] text-[var(--color-text-muted)]">
            Answer all questions to continue
          </p>
        ) : (
          <button
            onClick={handleNext}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-[var(--brand-primary)] text-white text-[0.875rem] font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-opacity"
          >
            {isCompleted && actIndex < 3 && <CheckCircle2 size={16} />}
            {actIndex < 3 ? 'Next' : 'Finish'}
            {actIndex < 3 && <ChevronRight size={16} />}
          </button>
        )}
      </div>

    </div>
  )
}
