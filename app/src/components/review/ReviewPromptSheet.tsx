import { useEffect, useRef, useState } from 'react'
import { requestPublicReview, recordOutcome, submitFeedback, trackReviewPrompt } from '../../lib/reviewPrompt'
import { BaseSheet } from '../ui/BaseSheet'
import { tick } from '../../lib/haptics'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'question' | 'feedback' | 'thanks'

export function ReviewPromptSheet({ open, onClose }: Props) {
  const [step,        setStep]        = useState<Step>('question')
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  if (!open) return null

  function handleLoveIt() {
    void tick()
    trackReviewPrompt('sentiment_positive')
    recordOutcome('prompted')
    requestPublicReview()
    onClose()
  }

  function handleNotReally() {
    trackReviewPrompt('sentiment_negative')
    setStep('feedback')
  }

  async function handleFeedbackSubmit() {
    if (submitting) return
    setSubmitting(true)
    const ok = await submitFeedback(feedbackMsg.trim())
    if (ok) trackReviewPrompt('feedback_submitted')
    recordOutcome('prompted')
    setStep('thanks')
    setSubmitting(false)
  }

  function handleMaybeLater() {
    void tick()
    trackReviewPrompt('outcome', { outcome: 'maybe_later' })
    recordOutcome('maybe_later')
    onClose()
  }

  function handleDismiss() {
    if (step === 'question') {
      trackReviewPrompt('outcome', { outcome: 'dismissed' })
      recordOutcome('dismissed')
    }
    onClose()
  }

  return (
    <BaseSheet
      onClose={handleDismiss}
      label={step === 'question' ? 'Are you enjoying Morechard?' : step === 'feedback' ? 'Thanks for telling us' : "We'll look into it"}
      panelClassName="w-full max-w-md mx-auto rounded-t-2xl bg-[var(--surface-card,#1a2a1f)] p-6 pb-8 shadow-2xl"
    >
      <div aria-live="polite">
      {step === 'question' && (
        <>
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 text-center text-lg font-semibold text-white outline-none">
            Are you enjoying Morechard?
          </h2>
          <p className="mb-6 text-center text-sm text-white/60">
            Takes 30 seconds and helps other families find us.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleLoveIt}
              className="w-full rounded-xl bg-[var(--brand-primary,#4ade80)] py-3 font-semibold text-[#0f1a14]"
            >
              Love it!
            </button>
            <button
              onClick={handleNotReally}
              className="w-full rounded-xl border border-white/20 py-3 font-semibold text-white/80"
            >
              Not really
            </button>
          </div>
          <button
            onClick={handleMaybeLater}
            className="mt-4 w-full text-center text-sm text-white/40 underline"
          >
            Maybe later
          </button>
        </>
      )}

      {step === 'feedback' && (
        <>
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 text-center text-lg font-semibold text-white outline-none">
            Thanks for telling us
          </h2>
          <p className="mb-4 text-center text-sm text-white/60">
            What could be better? (optional)
          </p>
          <textarea
            value={feedbackMsg}
            onChange={(e) => setFeedbackMsg(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Your feedback goes straight to Darren…"
            className="w-full rounded-xl border border-white/20 bg-white/5 p-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary,#4ade80)]"
          />
          <p className="mb-4 text-right text-xs text-white/30">{feedbackMsg.length}/500</p>
          <button
            onClick={handleFeedbackSubmit}
            disabled={submitting}
            className="w-full rounded-xl bg-[var(--brand-primary,#4ade80)] py-3 font-semibold text-[#0f1a14] disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
        </>
      )}

      {step === 'thanks' && (
        <>
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 text-center text-lg font-semibold text-white outline-none">
            We'll look into it
          </h2>
          <p className="mb-6 text-center text-sm text-white/60">
            Your feedback helps us improve Morechard for everyone.
          </p>
          <button
            onClick={() => { void tick(); onClose(); }}
            className="w-full rounded-xl bg-[var(--brand-primary,#4ade80)] py-3 font-semibold text-[#0f1a14]"
          >
            Done
          </button>
        </>
      )}
      </div>
    </BaseSheet>
  )
}
