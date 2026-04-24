/**
 * DataSettings — Data & Exports section.
 *
 * Renders three export rows gated by licence state:
 *   Family Summary (PDF + JSON) — always enabled for authenticated users
 *   Growth & Learning          — requires AI Mentor (hasAiMentor)
 *   Forensic Report            — requires Shield (hasShield)
 *
 * Data Pruning is Lead-parent only with a two-step inline confirm.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Database, FileText, Scale, AlertTriangle, Download, Lock, Zap, Shield } from 'lucide-react'
import { Toast, useToast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { getFamilyId } from '../../../lib/api'
import { useExportManager } from '../../../hooks/useExportManager'

interface Props {
  isLead:           boolean
  hasAiMentor:      boolean
  hasShield:        boolean
  toast:            string | null
  onBack:           () => void
  onNavigateToPlan: (sku: 'AI_ANNUAL' | 'SHIELD') => void
}

type PruneStep = 'idle' | 'confirm' | 'pruning'

export function DataSettings({
  isLead, hasAiMentor, hasShield,
  toast, onBack, onNavigateToPlan,
}: Props) {
  const familyId = useMemo(() => getFamilyId(), [])
  const { stateOf, errorOf, triggerExport, triggerPrune, prunedCount } =
    useExportManager(familyId)

  const [pruneStep, setPruneStep] = useState<PruneStep>('idle')
  const { toast: localToast, showToast } = useToast()

  // React to prune completion
  useEffect(() => {
    const state = stateOf('prune')
    if (pruneStep === 'pruning' && state === 'success') {
      showToast(prunedCount ? `Archived ${prunedCount} records` : 'Nothing to archive')
      setPruneStep('idle')
    } else if (pruneStep === 'pruning' && state === 'error') {
      showToast(errorOf('prune') ?? 'Prune failed')
      setPruneStep('idle')
    }
  }, [pruneStep, stateOf, errorOf, showToast, prunedCount])

  const handleBehavioralClick = useCallback(() => {
    if (hasAiMentor) triggerExport('pdf', 'behavioral')
    else onNavigateToPlan('AI_ANNUAL')
  }, [hasAiMentor, triggerExport, onNavigateToPlan])

  const handleForensicClick = useCallback(() => {
    if (hasShield) triggerExport('pdf', 'forensic')
    else onNavigateToPlan('SHIELD')
  }, [hasShield, triggerExport, onNavigateToPlan])

  const handlePruneConfirm = useCallback(() => {
    triggerPrune()
    setPruneStep('pruning')
  }, [triggerPrune])

  function exportLabel(key: Parameters<typeof stateOf>[0], idleLabel: string) {
    const s = stateOf(key)
    if (s === 'generating') return 'Generating…'
    if (s === 'success')    return 'Downloaded ✓'
    return idleLabel
  }

  function exportRightSlot(key: Parameters<typeof stateOf>[0]) {
    const s = stateOf(key)
    if (s === 'generating') return <Spinner aria-hidden="true" />
    if (s === 'success')    return <Download size={14} className="text-[var(--brand-primary)]" />
    return <Download size={14} className="text-gray-400" />
  }

  return (
    <div className="space-y-4">
      {toast      && <Toast message={toast} />}
      {localToast && <Toast message={localToast} />}

      <SectionHeader title="Data & Exports" onBack={onBack} />

      {/* Family Summary — always available */}
      <SectionCard>
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Family Summary
          </p>
        </div>

        <SettingsRow
          icon={<Database size={15} />}
          label={exportLabel('json-basic', 'Download Raw Data (JSON)')}
          description="Full transaction history — GDPR Article 20 data portability"
          onClick={() => triggerExport('json', 'basic')}
          disabled={stateOf('json-basic') === 'generating'}
          rightSlot={exportRightSlot('json-basic')}
        />
        {stateOf('json-basic') === 'error' && (
          <ErrorNote message={errorOf('json-basic')} />
        )}

        <SettingsRow
          icon={<FileText size={15} />}
          label={exportLabel('pdf-basic', 'Family Summary Report (PDF)')}
          description="Earnings, task ledger, and status log"
          onClick={() => triggerExport('pdf', 'basic')}
          disabled={stateOf('pdf-basic') === 'generating'}
          rightSlot={exportRightSlot('pdf-basic')}
        />
        {stateOf('pdf-basic') === 'error' && (
          <ErrorNote message={errorOf('pdf-basic')} />
        )}
      </SectionCard>

      {/* PDF Reports */}
      <SectionCard>
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            PDF Reports
          </p>
        </div>

        {/* Growth & Learning — requires AI Mentor */}
        <div className={!hasAiMentor ? 'opacity-50' : undefined}>
          <SettingsRow
            icon={<FileText size={15} className="text-purple-500" />}
            label={exportLabel('pdf-behavioral', 'Growth & Learning Report')}
            description="Adds Learning Lab modules and Behavioural Pulse"
            onClick={hasAiMentor ? handleBehavioralClick : undefined}
            disabled={!hasAiMentor || stateOf('pdf-behavioral') === 'generating'}
            rightSlot={
              !hasAiMentor
                ? <Lock size={14} className="text-[var(--color-text-muted)]" />
                : exportRightSlot('pdf-behavioral')
            }
          />
        </div>
        {!hasAiMentor && (
          <button
            type="button"
            onClick={handleBehavioralClick}
            className="w-full flex items-center gap-3 px-4 py-3 bg-violet-50 border-t border-violet-100 hover:bg-violet-100 active:bg-violet-100 transition-colors text-left"
          >
            <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center bg-violet-100 text-violet-600">
              <Zap size={12} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-violet-700 leading-snug">
                Requires AI Mentor (£19.99/yr)
              </p>
              <p className="text-[11px] text-violet-500 leading-snug">
                Tap to unlock — personalised learning insights for your child
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-violet-600 whitespace-nowrap">
              Add AI Mentor →
            </span>
          </button>
        )}
        {stateOf('pdf-behavioral') === 'error' && (
          <ErrorNote message={errorOf('pdf-behavioral')} />
        )}

        {/* Forensic Report — requires Shield */}
        <div className={!hasShield ? 'opacity-50 border-t border-[var(--color-border)]' : 'border-t border-[var(--color-border)]'}>
          <SettingsRow
            icon={<Scale size={15} className="text-orange-600" />}
            label={exportLabel('pdf-forensic', 'Forensic Report')}
            description="Tamper-evident record with secure digital signatures and device verification"
            onClick={hasShield ? handleForensicClick : undefined}
            disabled={!hasShield || stateOf('pdf-forensic') === 'generating'}
            rightSlot={
              !hasShield
                ? <Lock size={14} className="text-[var(--color-text-muted)]" />
                : exportRightSlot('pdf-forensic')
            }
          />
        </div>
        {!hasShield && (
          <button
            type="button"
            onClick={handleForensicClick}
            className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border-t border-amber-100 hover:bg-amber-100 active:bg-amber-100 transition-colors text-left"
          >
            <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center bg-amber-100 text-amber-600">
              <Shield size={12} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-amber-700 leading-snug">
                Requires Shield (£149.99 one-time)
              </p>
              <p className="text-[11px] text-amber-500 leading-snug">
                Tap to unlock — court-ready tamper-evident exports
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-amber-600 whitespace-nowrap">
              Add Shield →
            </span>
          </button>
        )}
        {stateOf('pdf-forensic') === 'error' && (
          <ErrorNote message={errorOf('pdf-forensic')} />
        )}
      </SectionCard>

      {/* Data Pruning — lead only */}
      {isLead && (
        <SectionCard>
          {pruneStep === 'idle' && (
            <SettingsRow
              icon={<AlertTriangle size={15} />}
              label="Data Pruning"
              description="Clean up records older than 2 years (immutable ledger protection)"
              onClick={() => setPruneStep('confirm')}
              destructive
            />
          )}

          {pruneStep === 'confirm' && (
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-red-600 text-white">
                  <AlertTriangle size={15} />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[var(--color-text)]">
                    Archive old records?
                  </p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    Records older than 2 years will be archived. The immutable ledger chain is preserved.
                    This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-11">
                <button
                  type="button"
                  onClick={handlePruneConfirm}
                  className="flex-1 py-2 rounded-xl bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 active:bg-red-700 transition-colors cursor-pointer"
                >
                  Yes, archive old records
                </button>
                <button
                  type="button"
                  onClick={() => setPruneStep('idle')}
                  className="flex-1 py-2 rounded-xl bg-[var(--color-surface-alt)] text-[var(--color-text)] text-[13px] font-semibold hover:bg-[var(--color-border)] active:bg-[var(--color-border)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {pruneStep === 'pruning' && (
            <div className="flex items-center gap-3 px-4 py-4">
              <span className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]">
                <Spinner aria-hidden="true" />
              </span>
              <p className="text-[14px] font-semibold text-[var(--color-text-muted)]">
                Archiving records…
              </p>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner({ 'aria-hidden': ariaHidden }: { 'aria-hidden'?: boolean | 'true' | 'false' }) {
  return (
    <svg
      aria-hidden={ariaHidden}
      className="animate-spin h-4 w-4 text-[var(--brand-primary)]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="px-4 pb-2 text-[11px] text-red-500 leading-snug">{message}</p>
  )
}
