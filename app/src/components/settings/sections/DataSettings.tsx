/**
 * DataSettings — Data & Exports section.
 *
 * Renders three PDF export tiers based on the family's licence state:
 *   basic       — Standard licence (£34.99)
 *   behavioral  — Basic + AI Mentor (£19.99/yr add-on)
 *   forensic    — Legal/forensic version (Legal Integrity Bundle)
 *
 * JSON export is always available (GDPR Article 20 portability).
 * Data Pruning is Lead-parent only.
 */

import { useState } from 'react'
import { Database, FileText, Scale, AlertTriangle, Download } from 'lucide-react'
import { Toast, SettingsRow, SectionCard, SectionHeader } from '../shared'
import { getFamilyId, getToken } from '../../../lib/api'

interface Props {
  isLead:              boolean
  hasLifetimeLicense:  boolean
  hasAiMentor:         boolean
  hasLegalBundle:      boolean
  lang:                string
  toast:               string | null
  onBack:              () => void
  onComingSoon:        () => void
}

type ExportFormat = 'pdf' | 'json'
type ReportTier   = 'basic' | 'behavioral' | 'forensic'

export function DataSettings({
  isLead, hasLifetimeLicense, hasAiMentor, hasLegalBundle,
  lang, toast, onBack, onComingSoon,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport(format: ExportFormat, tier: ReportTier) {
    const family_id = getFamilyId()
    const token     = getToken()
    if (!family_id || !token) return

    const key = `${format}-${tier}`
    setLoading(key)
    setExportError(null)

    try {
      const params = new URLSearchParams({ family_id, lang, tier })
      const res = await fetch(`/api/export/${format}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const ext  = format === 'json' ? 'json' : 'html'
      a.href     = url
      a.download = `morechard-${tier}-report-${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setLoading(null)
    }
  }

  const busy = (key: string) => loading === key

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} />}
      {exportError && <Toast message={exportError} />}

      <SectionHeader title="Data & Exports" onBack={onBack} />

      {/* JSON — always available */}
      <SectionCard>
        <SettingsRow
          icon={<Database size={15} />}
          label="Download Raw Data (JSON)"
          description="Full transaction history — GDPR Article 20 data portability"
          onClick={() => handleExport('json', 'basic')}
          rightSlot={busy('json-basic') ? <Spinner /> : <Download size={14} className="text-gray-400" />}
        />
      </SectionCard>

      {/* PDF Reports */}
      <SectionCard>
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            PDF Reports
          </p>
        </div>

        {/* Basic — always available if licensed */}
        <SettingsRow
          icon={<FileText size={15} />}
          label={busy('pdf-basic') ? 'Generating Report…' : 'Family Summary Report'}
          description="Earnings, task ledger, and status log"
          onClick={hasLifetimeLicense
            ? () => handleExport('pdf', 'basic')
            : onComingSoon}
          rightSlot={busy('pdf-basic')
            ? <Spinner />
            : hasLifetimeLicense
              ? <Download size={14} className="text-gray-400" />
              : <LockedBadge />}
        />

        {/* Behavioral — requires AI Mentor */}
        <SettingsRow
          icon={<FileText size={15} className="text-purple-500" />}
          label={busy('pdf-behavioral') ? 'Generating Report…' : 'Growth & Learning Report'}
          description="Adds Learning Lab modules and Behavioural Pulse"
          onClick={(hasLifetimeLicense && hasAiMentor)
            ? () => handleExport('pdf', 'behavioral')
            : onComingSoon}
          rightSlot={busy('pdf-behavioral')
            ? <Spinner />
            : (hasLifetimeLicense && hasAiMentor)
              ? <Download size={14} className="text-gray-400" />
              : <LockedBadge label="AI Mentor" />}
        />

        {/* Forensic — requires Legal Bundle */}
        <SettingsRow
          icon={<Scale size={15} className="text-orange-600" />}
          label={busy('pdf-forensic') ? 'Generating Report…' : 'Forensic Legal Report'}
          description="Chain of custody with SHA-256 hashes, device & location evidence"
          onClick={(hasLifetimeLicense && hasLegalBundle)
            ? () => handleExport('pdf', 'forensic')
            : onComingSoon}
          rightSlot={busy('pdf-forensic')
            ? <Spinner />
            : (hasLifetimeLicense && hasLegalBundle)
              ? <Download size={14} className="text-gray-400" />
              : <LockedBadge label="Legal Bundle" />}
        />
      </SectionCard>

      {/* Data Pruning — lead only */}
      {isLead && (
        <SectionCard>
          <SettingsRow
            icon={<AlertTriangle size={15} />}
            label="Data Pruning"
            description="Clean up records older than 2 years (immutable ledger protection)"
            onClick={onComingSoon}
            destructive
          />
        </SectionCard>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-[var(--brand-primary)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function LockedBadge({ label }: { label?: string }) {
  return (
    <span className="text-[9px] font-semibold text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
      {label ?? 'Upgrade'}
    </span>
  )
}
